"""Synthetic infrastructure checks only; these are not real bias evaluations."""
import copy
import unittest

from train_bias import normalize, reviewed_axis, train_model, validate


def fixture():
    manifest = {'axisId': 'synthetic-axis', 'profiles': [
        {'publisherId': 'left.example', 'orientation': 'left'},
        {'publisherId': 'right.example', 'orientation': 'right'}]}
    rows = []
    for publisher, text in [('left.example', '사과 사과 사과 배 분배 복지 검토'),
                            ('right.example', '자동차 자동차 자동차 도로 시장 투자')]:
        for i in range(12):
            rows.append({'id': f'{publisher}-{i}', 'publisherId': publisher,
                         'text': f'{text} 구체적인 합성 사례 번호 {i}를 검토한다.',
                         'sourceGroupId': f'{publisher}-original-{i}', 'comparisonGroup': 'synthetic-topic',
                         'url': f'https://{publisher}/{i}', 'publishedAt': '2026-01-01',
                         'provenance': 'synthetic'})
    return rows, manifest


class TrainingTests(unittest.TestCase):
    def test_provenance_and_duplicate_group_checks(self):
        rows, manifest = fixture()
        with self.assertRaisesRegex(ValueError, 'permissions'):
            validate(rows, manifest)
        rows[1]['text'] = rows[0]['text']
        with self.assertRaisesRegex(ValueError, 'Duplicate text'):
            validate(rows, manifest, synthetic=True)

    def test_insufficient_and_mixed_topic_rejected(self):
        rows, manifest = fixture()
        with self.assertRaisesRegex(ValueError, 'six independent'):
            validate(rows[:5] + rows[12:17], manifest, True)
        rows[0]['comparisonGroup'] = 'different-topic'
        with self.assertRaisesRegex(ValueError, 'one comparable'):
            validate(rows, manifest, True)

    def test_group_split_metrics_and_export_inference(self):
        import numpy as np
        rows, manifest = fixture()
        artifact = train_model(rows, manifest, synthetic=True)
        self.assertEqual(artifact['status'], 'research_only')
        evaluation = artifact['classifierEvidence']['evaluation']
        self.assertFalse(set(evaluation['trainingSourceGroupIds']) & set(evaluation['evaluationSourceGroupIds']))
        self.assertTrue(all(m['sampleCount'] >= 3 for m in evaluation['metrics']))
        self.assertTrue(all(0 <= m['publisherAccuracy'] <= 1 for m in evaluation['metrics']))
        self.assertTrue(artifact['validation']['heldoutAnchorSeparation'])
        self.assertNotIn('text', artifact['lineage'][0])
        vocab = artifact['vectorizer']['vocabulary']
        idf = artifact['vectorizer']['idf']
        coefficients = artifact['projection']['coefficients']
        lookup = {row['id']: row for row in rows}
        for reference in artifact['references']:
            text = normalize(lookup[reference['articleId']]['text'])
            counts = {}
            for n in range(2, 5):
                for at in range(len(text) - n + 1):
                    token = text[at:at+n]
                    if token in vocab:
                        idx = vocab[token]
                        counts[idx] = counts.get(idx, 0) + 1
            weighted = {idx: (1 + np.log(count)) * idf[idx] for idx, count in counts.items()}
            length = np.sqrt(sum(value ** 2 for value in weighted.values()))
            projected = sum(value / length * coefficients[idx] for idx, value in weighted.items())
            projection = artifact['projection']
            actual = float(np.clip((projected + projection['offset']) / projection['scale'], -1, 1))
            self.assertAlmostEqual(actual, reference['classifier']['coordinate'], places=12)

    def test_anchor_names_do_not_train_classifier(self):
        rows, manifest = fixture()
        first = train_model(rows, manifest, synthetic=True)
        flipped = copy.deepcopy(manifest)
        for profile in flipped['profiles']:
            profile['orientation'] = 'right' if profile['orientation'] == 'left' else 'left'
        second = train_model(rows, flipped, synthetic=True)
        self.assertEqual(first['vectorizer'], second['vectorizer'])
        self.assertEqual(first['classifierEvidence']['evaluation']['metrics'], second['classifierEvidence']['evaluation']['metrics'])
        for a, b in zip(first['projection']['coefficients'], second['projection']['coefficients']):
            self.assertAlmostEqual(a, -b)

    def test_synthetic_cannot_become_validated_with_review(self):
        rows, manifest = fixture()
        first = train_model(rows, manifest, synthetic=True)
        manifest['humanAxisReview'] = {'status': 'approved', 'reviewedBy': 'synthetic reviewer',
                                      'reviewers': ['synthetic one', 'synthetic two'], 'sampleCount': 40,
                                      'evidence': 'synthetic-check-only', 'interReviewerAgreement': 1,
                                      'reviewedModelVersion': first['classifierEvidence']['modelVersion']}
        reviewed = train_model(rows, manifest, synthetic=True)
        self.assertEqual(reviewed['status'], 'research_only')
        self.assertEqual(reviewed['dataKind'], 'synthetic')

    def test_missing_configured_anchor_is_not_validated(self):
        rows, manifest = fixture()
        manifest['profiles'].append({'publisherId': 'absent.example', 'orientation': 'left'})
        artifact = train_model(rows, manifest, synthetic=True)
        self.assertFalse(artifact['validation']['heldoutAnchorSeparation'])
        self.assertEqual(artifact['status'], 'research_only')

    def test_review_boundary_rejects_malformed_or_truthy_metadata(self):
        review = {'status': 'approved', 'reviewedBy': 'reviewer', 'evidence': 'review-record',
                  'reviewedModelVersion': 'version', 'reviewers': ['one', 'two'],
                  'sampleCount': 40, 'interReviewerAgreement': .8}
        self.assertTrue(reviewed_axis(review, 'version'))
        for key, bad in [('reviewedBy', True), ('evidence', '  '), ('reviewers', ['one', ' one ']),
                         ('reviewers', [{'name': 'one'}, 'two']), ('sampleCount', True),
                         ('sampleCount', 40.0), ('interReviewerAgreement', True),
                         ('interReviewerAgreement', float('nan')), ('reviewedModelVersion', 'other')]:
            with self.subTest(key=key, bad=bad):
                self.assertFalse(reviewed_axis({**review, key: bad}, 'version'))
        self.assertFalse(reviewed_axis(None, 'version'))


if __name__ == '__main__':
    unittest.main()
