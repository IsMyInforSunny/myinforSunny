"""Synthetic planning/metadata checks; no collected corpus or measured accuracy."""
import copy
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from plan_bias_collection import collection_plan, minimum_originals
from prepare_bias_corpus import prepare
from test_prepare_bias_corpus import fixture
from train_bias import EVALUATION_FRACTION


class CollectionPlanTests(unittest.TestCase):
    def test_default_manifest_reports_all_seven_anchors_without_inventing_progress(self):
        manifest = json.loads((Path(__file__).parent / 'bias-orientation.example.json').read_text(encoding='utf-8'))
        result = collection_plan(manifest)
        self.assertEqual(result['anchorPublisherCount'], 7)
        self.assertEqual(result['evaluationSplitOriginalLowerBound'], 98)
        self.assertEqual(result['balancedAnchorOriginalTarget'], 98)
        self.assertTrue(all(row['balancedCollectionTarget'] == 14 for row in result['publisherTargets']))
        self.assertTrue(all(row['observedReviewedOriginals'] is None for row in result['publisherTargets']))
        self.assertIsNone(result['observedReviewedOriginalGroups'])
        self.assertFalse(result['releaseReady'])
        self.assertEqual(result['humanReview']['minimumLabelDecisions'], 80)
        self.assertEqual(result['status'], 'planning_only')

    def test_split_lower_bound_matches_actual_rounding_and_keeps_training_minima(self):
        for publishers in (2, 7, 15, 40):
            for reviews in (40, 60, 80):
                count = minimum_originals(publishers, reviews)
                evaluation = math.ceil(count * EVALUATION_FRACTION)
                self.assertGreaterEqual(evaluation, reviews)
                self.assertGreaterEqual(count - evaluation, 3)
                if count > 6:
                    previous_evaluation = math.ceil((count - 1) * EVALUATION_FRACTION)
                    self.assertTrue(previous_evaluation < reviews
                                    or count - 1 - previous_evaluation < 3)

    def test_observed_optional_publisher_has_its_own_training_deficit(self):
        articles, reviews, manifest = fixture()
        report, _ = prepare(articles, reviews, manifest)
        manifest['profiles'].append({'publisherId': 'optional.example', 'orientation': 'unspecified'})
        row = copy.deepcopy(report['articles'][0])
        row.update(articleId='optional', publisherId='optional.example', sourceGroupId='optional-original',
                   contentHash='f' * 64, url='https://optional.example/one')
        report['articles'].append(row)
        result = collection_plan(manifest, report)
        self.assertEqual(result['participatingPublisherCount'], 3)
        target = next(t for t in result['publisherTargets'] if t['publisherId'] == 'optional.example')
        self.assertFalse(target['isRequiredAnchor'])
        self.assertEqual(target['observedReviewedOriginals'], 1)
        self.assertEqual(target['missingForMinimum'], 5)

    def test_large_publisher_set_does_not_multiply_the_global_original_lower_bound(self):
        manifest = {'axisId': 'synthetic', 'profiles': [
            {'publisherId': f'p{i}.example', 'orientation': 'left' if i < 8 else 'right'} for i in range(15)]}
        result = collection_plan(manifest)
        self.assertEqual(result['evaluationSplitOriginalLowerBound'], 98)
        self.assertEqual(result['balancedPublisherArticleTarget'], 120)
        self.assertGreaterEqual(result['balancedPlanEvaluationSlots'], 15 * 3)
        self.assertTrue(result['balancedPlanAssumesDistinctOriginalsAcrossPublishers'])
        self.assertTrue(all(t['minimumBeforeGroupSplit'] == 6 for t in result['publisherTargets']))
        for publishers in (2, 7, 13, 14, 15, 40):
            profiles = [{'publisherId': f'p{i}.example', 'orientation': 'left' if i == 0 else 'right'} for i in range(publishers)]
            plan = collection_plan({'axisId': 'synthetic', 'profiles': profiles})
            self.assertGreaterEqual(plan['balancedPlanEvaluationSlots'], publishers * 3)
            self.assertGreaterEqual(plan['balancedPublisherArticleTarget'] - plan['balancedPlanEvaluationSlots'], publishers * 3)

    def test_counts_only_reviewed_originals_without_copying_body_or_reviewer_data(self):
        articles, reviews, manifest = fixture()
        report, _ = prepare(articles, reviews, manifest)
        result = collection_plan(manifest, report)
        self.assertEqual(result['observedReviewedOriginalGroups'], 12)
        self.assertEqual(result['originalGroupsMissingForSplitLowerBound'], 86)
        self.assertTrue(all(row['missingForMinimum'] == 0 for row in result['publisherTargets']))
        encoded = json.dumps(result)
        self.assertNotIn(articles[0]['text'], encoded)
        self.assertNotIn('synthetic reviewer', encoded)
        self.assertNotIn(articles[0]['url'], encoded)
        self.assertIsNone(result['groupSplitVerified'])
        self.assertIsNone(result['eligibleHeldoutOriginals'])

    def test_unreviewed_rows_do_not_reduce_acquisition_deficits(self):
        articles, reviews, manifest = fixture()
        reviews['articles'].pop()
        report, _ = prepare(articles, reviews, manifest)
        result = collection_plan(manifest, report)
        self.assertEqual(result['observedReviewedOriginalGroups'], 11)
        self.assertEqual(sum(row['missingForMinimum'] for row in result['publisherTargets']), 1)
        self.assertGreater(result['preparationBlockerCount'], 0)

    def test_shared_originals_across_publishers_are_not_extra_independent_groups(self):
        articles, reviews, manifest = fixture()
        report, _ = prepare(articles, reviews, manifest)
        report['articles'][6]['sourceGroupId'] = report['articles'][0]['sourceGroupId']
        result = collection_plan(manifest, report)
        self.assertEqual(result['observedReviewedOriginalGroups'], 11)
        self.assertTrue(all(row['observedReviewedOriginals'] == 6 for row in result['publisherTargets']))

    def test_same_content_cannot_inflate_independent_original_counts(self):
        articles, reviews, manifest = fixture()
        report, _ = prepare(articles, reviews, manifest)
        report['articles'][1]['contentHash'] = report['articles'][0]['contentHash']
        with self.assertRaisesRegex(ValueError, 'independent originals'):
            collection_plan(manifest, report)

    def test_missing_anchors_duplicate_aliases_and_host_paths_are_rejected(self):
        _, _, manifest = fixture()
        malformed = [copy.deepcopy(manifest) for _ in range(3)]
        malformed[0]['profiles'][1]['orientation'] = 'unspecified'
        malformed[1]['profiles'].extend([{'publisherId': 'imbc.com', 'orientation': 'unspecified'},
                                         {'publisherId': 'imnews.imbc.com', 'orientation': 'unspecified'}])
        malformed[2]['profiles'][0]['publisherId'] = 'one.example/path'
        for bad in malformed:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                collection_plan(bad)
        with self.assertRaises(ValueError):
            collection_plan(manifest, review_samples=39)

    def test_tampered_preparation_identity_is_rejected(self):
        articles, reviews, manifest = fixture()
        report, _ = prepare(articles, reviews, manifest)
        report['articles'][0]['url'] = 'https://unrelated.example/article'
        with self.assertRaises(ValueError):
            collection_plan(manifest, report)

    def test_cli_is_offline_and_never_overwrites_an_existing_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'plan.local.json'
            command = [sys.executable, str(Path(__file__).parent / 'plan_bias_collection.py'),
                       '--manifest', str(Path(__file__).parent / 'bias-orientation.example.json'), '--output', str(output)]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0)
            original = output.read_bytes()
            again = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(again.returncode, 0)
            self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
