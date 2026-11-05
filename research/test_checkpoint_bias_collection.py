"""Focused leakage, intake and frozen-holdout regression checks; synthetic data."""
import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from checkpoint_bias_collection import (components, content_hash, fixed_benchmark, freeze_holdout,
                                        intake, run, unique_components)


def row(identifier, publisher='pressian.com', topic='medical_school_quota'):
    return {'id': identifier, 'publisherId': publisher, 'sourceEditionHost': 'www.' + publisher,
            'url': 'https://www.' + publisher + '/articles/' + identifier,
            'publishedAt': '2025-05-01', 'topicId': topic,
            'text': ('의대 정원 확대에 관한 서로 다른 내용의 기사입니다. ' * 20) + identifier,
            'contentHash': identifier, 'collectionAudit': {'flags': []}}


def corpus():
    topics = ['medical_school_quota', 'pension_reform', 'minimum_wage',
              'electricity_prices', 'housing_supply', 'nuclear_energy']
    return [row(f'{p}-{t}-{i}', p, t) for p in ('pressian.com', 'ohmynews.com')
            for t in topics for i in range(5)]


class CheckpointTests(unittest.TestCase):
    def test_explicit_promotion_is_withheld_without_banning_policy_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.jsonl'
            articles = [
                {**row('promotion'), 'title': '아파트 견본주택 개관'},
                {**row('award'), 'title': '주택행정 평가 우수기관 선정'},
                {**row('policy'), 'title': '주택공급 정책과 모델하우스 운영 기준 개선'},
                {**row('politics'), 'title': '일본 수상 원전 재가동 정책 논의'},
            ]
            path.write_text('\n'.join(json.dumps(r) for r in articles), encoding='utf-8')
            accepted, excluded = intake(path)
            self.assertEqual([r['id'] for r in accepted], ['policy', 'politics'])
            self.assertEqual(excluded, {'promotional_genre_review': 2})

    def test_intake_rejects_missing_date_restriction_and_duplicate_body(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.jsonl'
            first = row('1')
            duplicate = {**first, 'id': '2', 'url': first['url'] + '?x=2'}
            missing = {**row('3'), 'publishedAt': None}
            denied = {**row('4'), 'acquisition': {'pageMetaRobots': 'nosnippet'}}
            path.write_text(''.join(json.dumps(r) + '\n' for r in (first, duplicate, missing, denied)), encoding='utf-8')
            rows, exclusions = intake(path)
            self.assertEqual([r['id'] for r in rows], ['1'])
            self.assertEqual(exclusions, {'duplicate_url_body_or_id': 1,
                'missing_or_outside_publication_date': 1, 'explicit_page_restriction': 1})

    def test_dailian_aliases_do_not_inflate_count(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.jsonl'
            a = {**row('a', 'dailian.co.kr'), 'url': 'https://www.dailian.co.kr/news/view/123'}
            b = {**row('b', 'dailian.co.kr'), 'url': 'https://www.dailian.co.kr/news/view/123/?utm_source=test'}
            path.write_text('\n'.join(json.dumps(r) for r in (a, b)), encoding='utf-8')
            rows, _ = intake(path)
            self.assertEqual(len(rows), 1)

    def test_near_duplicate_components_are_transitive(self):
        rows = [row(str(i)) for i in range(4)]
        groups = components(rows, [{'leftId': '0', 'rightId': '1'}, {'leftId': '1', 'rightId': '2'}])
        self.assertEqual(groups['0'], groups['2'])
        self.assertEqual([r['id'] for r in unique_components(rows, groups)], ['0', '3'])

    def test_frozen_evaluation_keeps_ids_as_training_grows(self):
        rows = corpus()
        groups = {r['id']: r['id'] for r in rows}
        with tempfile.TemporaryDirectory() as directory:
            frozen = freeze_holdout(Path(directory), rows, groups)
            first = fixed_benchmark(rows, groups, frozen)
            added = row('new-training', topic=frozen['trainingTopics'][0])
            extended = rows + [added]
            second = fixed_benchmark(extended, {**groups, added['id']: added['id']}, frozen)
            self.assertEqual(first['fixedEvaluationIdsDigest'], second['fixedEvaluationIdsDigest'])
            self.assertEqual(second['trainingRows'], first['trainingRows'] + 1)
            self.assertFalse(second['exactContentHashOverlap'])
            self.assertFalse(second['releaseReady'])

    def test_cross_split_near_duplicate_is_withheld(self):
        rows = corpus()
        groups = {r['id']: r['id'] for r in rows}
        with tempfile.TemporaryDirectory() as directory:
            frozen = freeze_holdout(Path(directory), rows, groups)
            training = next(r for r in rows if r['topicId'] in frozen['trainingTopics'])
            groups[training['id']] = groups[frozen['heldout'][0]['id']]
            result = fixed_benchmark(rows, groups, frozen)
            self.assertEqual(result['crossSplitNearDuplicateTrainingRowsWithheld'], 1)

    def test_changed_frozen_article_fails_closed(self):
        rows = corpus()
        groups = {r['id']: r['id'] for r in rows}
        with tempfile.TemporaryDirectory() as directory:
            frozen = freeze_holdout(Path(directory), rows, groups)
            target = next(r for r in rows if r['id'] == frozen['heldout'][0]['id'])
            target['contentHash'] = 'changed'
            with self.assertRaisesRegex(ValueError, 'Frozen evaluation article changed'):
                fixed_benchmark(rows, groups, frozen)

    def test_single_checkpoint_run_preserves_matching_legacy_summaries(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            rows = [row(str(i)) for i in range(600)]
            (base / 'articles.local.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
            # Real checkpoint artifacts are deliberately not rerun: emulate
            # completed reports with signatures of the exact current prefixes.
            (base / 'frozen-evaluation.local.json').write_text('{}', encoding='utf-8')
            hashes = [content_hash(r['text']) for r in rows]
            for size in (300, 600, 900):
                output = base / f'checkpoint-{size}'
                output.mkdir()
                signature = hashlib.sha256('\n'.join(hashes[:size]).encode()).hexdigest()
                summary = {'checkpoint': size, 'inputSignature': signature, 'fixedEvaluation': {}}
                (output / 'summary.local.json').write_text(json.dumps(summary), encoding='utf-8')
            original = (base / 'checkpoint-300/summary.local.json').read_bytes()
            run(base, requested=600)
            aggregate = json.loads((base / 'checkpoint-summary.local.json').read_text(encoding='utf-8'))
            self.assertEqual(aggregate['completedCheckpoints'], [300, 600])
            self.assertEqual(aggregate['staleCheckpointSummariesExcluded'], [900])
            self.assertEqual((base / 'checkpoint-300/summary.local.json').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
