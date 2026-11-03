"""Synthetic infrastructure tests; reviewer identities and article labels are fictional."""
import copy
import csv
import tempfile
import unittest
from pathlib import Path

from review_bias_axis import FIELDS, agreement, build_report, prepare, review_corpus


def artifact_fixture(real_flag=False):
    # The real flag exercises a release branch; these rows are never real articles.
    lineage = []
    for index in range(50):
        lineage.append({'articleId': f'synthetic-{index}', 'url': f'https://synthetic.example/{index}',
                        'publishedAt': '2026-01-01', 'publisherId': 'synthetic.example',
                        'sourceGroupId': f'original-{index}', 'contentHash': f'hash-{index}',
                        'split': 'training' if index < 10 else 'evaluation',
                        'usage': {'trainingAllowed': True, 'modelDistributionAllowed': True,
                                  'basisUrl': 'https://synthetic.example/test-only',
                                  'reviewedBy': 'synthetic-rights-check', 'reviewedAt': '2026-01-02'}})
    return {'schemaVersion': 'publisher-coordinate-svm-1', 'status': 'research_only',
            'dataKind': 'real' if real_flag else 'synthetic', 'synthetic': not real_flag,
            'classifierEvidence': {'modelVersion': 'synthetic-version', 'axisId': 'synthetic-axis',
                                   'evaluation': {'heldOutUnit': 'original_source_group', 'split': 'held_out_articles',
                                                  'trainingSourceGroupIds': [f'original-{i}' for i in range(10)],
                                                  'evaluationSourceGroupIds': [f'original-{i}' for i in range(10, 50)]}},
            'lineage': lineage, 'validation': {'heldoutAnchorSeparation': True}}


def fill(path, reviewer, labeler=lambda index: ('left', 'center', 'right')[index % 3]):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    for index, row in enumerate(rows):
        row['reviewerId'] = reviewer
        row['label'] = labeler(index)
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader(); writer.writerows(rows)


def decision_fixture():
    return {'reviewedModelVersion': 'synthetic-version', 'reviewedBy': 'synthetic-supervisor',
            'evidence': 'synthetic-test-only', 'reviewers': [
                {'reviewerId': name, 'axisApproved': True, 'independentReview': True,
                 'evidence': 'synthetic-test-only'} for name in ('synthetic-one', 'synthetic-two')]}


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.one, self.two = Path(self.temp.name) / 'one.csv', Path(self.temp.name) / 'two.csv'

    def make(self, artifact=None):
        artifact = artifact or artifact_fixture()
        prepare(artifact, self.one, self.two)
        fill(self.one, 'synthetic-one'); fill(self.two, 'synthetic-two')
        return artifact

    def test_templates_are_blind_and_repeatable_and_never_overwrite(self):
        data = artifact_fixture()
        result = prepare(data, self.one, self.two)
        self.assertEqual(result['templateArticleCount'], 40)
        with self.one.open(encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            self.assertEqual(reader.fieldnames, list(FIELDS))
            rows = list(reader)
        self.assertTrue(all(not row['label'] and not row['reviewerId'] for row in rows))
        self.assertFalse({'coordinate', 'publisherId', 'orientation'} & set(rows[0]))
        self.assertEqual(self.one.read_bytes(), self.two.read_bytes())
        with self.assertRaises(FileExistsError):
            prepare(data, self.one, self.two)

    def test_kappa_is_measured_and_undefined_single_label_is_explicit(self):
        measured = agreement(['left', 'left', 'right', 'right'], ['left', 'right', 'right', 'right'])
        self.assertAlmostEqual(measured['cohensKappa'], .5)
        self.assertAlmostEqual(measured['observedAgreement'], .75)
        self.assertIsNone(agreement(['left'] * 40, ['left'] * 40)['cohensKappa'])
        self.assertEqual(agreement([], [])['undefinedReason'], 'no_common_labels')

    def test_high_kappa_does_not_approve_without_explicit_decision(self):
        data = self.make(artifact_fixture(real_flag=True))
        report = build_report(data, self.one, self.two)
        self.assertEqual(report['agreementDeterminate']['cohensKappa'], 1)
        self.assertIsNone(report['humanAxisReview'])
        self.assertIn('explicit_independent_axis_approvals_missing', report['blockingReasons'])
        approved = build_report(data, self.one, self.two, decision_fixture())
        self.assertEqual(approved['status'], 'human_review_ready')
        self.assertEqual(approved['humanAxisReview']['sampleCount'], 40)
        self.assertEqual(approved['humanAxisReview']['reviewedModelVersion'], 'synthetic-version')

    def test_synthetic_never_produces_release_metadata(self):
        data = self.make()
        report = build_report(data, self.one, self.two, decision_fixture())
        self.assertEqual(report['status'], 'research_only')
        self.assertIsNone(report['humanAxisReview'])

    def test_undetermined_and_blank_labels_do_not_meet_sample_minimum(self):
        data = self.make(artifact_fixture(real_flag=True))
        fill(self.two, 'synthetic-two', lambda i: 'undetermined' if i == 0 else ('left', 'center', 'right')[i % 3])
        report = build_report(data, self.one, self.two, decision_fixture())
        self.assertEqual(report['commonArticleCount'], 40)
        self.assertEqual(report['commonDeterminateArticleCount'], 39)
        self.assertIsNone(report['humanAxisReview'])
        fill(self.two, 'synthetic-two', lambda i: '' if i == 0 else ('left', 'center', 'right')[i % 3])
        self.assertEqual(build_report(data, self.one, self.two)['commonArticleCount'], 39)

    def test_same_reviewer_and_stale_version_are_rejected(self):
        data = self.make()
        fill(self.two, 'synthetic-one')
        with self.assertRaisesRegex(ValueError, 'distinct'):
            build_report(data, self.one, self.two)
        changed = copy.deepcopy(data)
        changed['classifierEvidence']['modelVersion'] = 'different'
        with self.assertRaisesRegex(ValueError, 'metadata changed'):
            build_report(changed, self.one, self.two)

    def test_group_and_content_leakage_and_missing_rights_are_rejected(self):
        for field in ('sourceGroupId', 'contentHash'):
            data = artifact_fixture()
            data['lineage'][10][field] = data['lineage'][0][field]
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'leakage'):
                review_corpus(data)
        data = artifact_fixture(real_flag=True)
        del data['lineage'][10]['usage']
        with self.assertRaisesRegex(ValueError, 'usage review'):
            review_corpus(data)

    def test_decision_must_approve_exact_version_and_independence(self):
        data = self.make(artifact_fixture(real_flag=True))
        for field, value in [('axisApproved', False), ('independentReview', False), ('evidence', '')]:
            decision = decision_fixture()
            decision['reviewers'][0][field] = value
            with self.subTest(field=field):
                self.assertIsNone(build_report(data, self.one, self.two, decision)['humanAxisReview'])
        decision = decision_fixture()
        decision['reviewedModelVersion'] = 'different'
        self.assertIsNone(build_report(data, self.one, self.two, decision)['humanAxisReview'])


if __name__ == '__main__':
    unittest.main()
