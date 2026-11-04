"""Synthetic infrastructure checks only; these are not real bias evaluations."""
import copy
import unittest

from train_bias import grouped_topic_split, normalize, reviewed_axis, train_model, validate


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


def topic_fixture():
    originals, manifest = fixture()
    rows = []
    for topic in range(5):
        for publisher in ('left.example', 'right.example'):
            base = next(row for row in originals if row['publisherId'] == publisher)
            for index in range(10):
                identity = f'{publisher}-topic-{topic}-{index}'
                rows.append({**base, 'id': identity, 'url': f'https://{publisher}/{topic}/{index}',
                             'sourceGroupId': identity, 'comparisonGroup': f'synthetic-topic-{topic}',
                             'text': base['text'] + f' 별도 합성 주제 {topic} 사례 {index}'})
    return rows, manifest


class TrainingTests(unittest.TestCase):
    def test_cross_topic_mode_holds_out_complete_topics_and_originals(self):
        rows, manifest = topic_fixture()
        artifact = train_model(rows, manifest, synthetic=True, cross_topic=True)
        self.assertEqual(artifact['status'], 'research_only')
        scope = artifact['topicScope']
        self.assertEqual(scope['mode'], 'cross_topic')
        self.assertGreaterEqual(len(scope['trainingTopics']), 3)
        self.assertGreaterEqual(len(scope['evaluationTopics']), 2)
        self.assertFalse(set(scope['trainingTopics']) & set(scope['evaluationTopics']))
        for split, key in [('training', 'trainingTopics'), ('evaluation', 'evaluationTopics')]:
            lineage = [row for row in artifact['lineage'] if row['split'] == split]
            self.assertEqual(set(scope[key]), {row['comparisonGroup'] for row in lineage})
            for publisher in ('left.example', 'right.example'):
                publisher_rows = [row for row in lineage if row['publisherId'] == publisher]
                self.assertGreaterEqual(len(publisher_rows), 3)
                self.assertGreaterEqual(len({row['comparisonGroup'] for row in publisher_rows}), 2)
        evaluation = artifact['classifierEvidence']['evaluation']
        self.assertFalse(set(evaluation['trainingSourceGroupIds']) & set(evaluation['evaluationSourceGroupIds']))
        self.assertNotEqual(artifact['comparisonGroup'], rows[0]['comparisonGroup'])

    def test_cross_topic_originals_linking_topics_stay_in_one_split(self):
        rows, _ = topic_fixture()
        left = next(row for row in rows if row['publisherId'] == 'left.example' and row['comparisonGroup'] == 'synthetic-topic-0')
        right = next(row for row in rows if row['publisherId'] == 'right.example' and row['comparisonGroup'] == 'synthetic-topic-1')
        left['sourceGroupId'] = right['sourceGroupId'] = 'shared-original-between-topics'
        training, evaluation = grouped_topic_split(rows)
        self.assertEqual(any(rows[index]['comparisonGroup'] == 'synthetic-topic-0' for index in training),
                         any(rows[index]['comparisonGroup'] == 'synthetic-topic-1' for index in training))
        self.assertFalse({rows[i]['sourceGroupId'] for i in training} & {rows[i]['sourceGroupId'] for i in evaluation})

    def test_cross_topic_mode_requires_five_topics_and_publisher_topic_coverage(self):
        rows, manifest = topic_fixture()
        with self.assertRaisesRegex(ValueError, 'one comparable'):
            train_model(rows, manifest, synthetic=True)
        fewer = [row for row in rows if row['comparisonGroup'] != 'synthetic-topic-4']
        with self.assertRaisesRegex(ValueError, 'five reviewed topics'):
            train_model(fewer, manifest, synthetic=True, cross_topic=True)
        narrow = [row for row in rows if row['publisherId'] != 'right.example'
                  or row['comparisonGroup'] in ('synthetic-topic-0', 'synthetic-topic-1', 'synthetic-topic-2')]
        with self.assertRaisesRegex(ValueError, 'two topics per publisher'):
            train_model(narrow, manifest, synthetic=True, cross_topic=True)

    def test_cross_topic_model_identity_covers_topic_names(self):
        rows, manifest = topic_fixture()
        first = train_model(rows, manifest, synthetic=True, cross_topic=True)
        renamed = copy.deepcopy(rows)
        for row in renamed:
            row['comparisonGroup'] += '-reviewed'
        second = train_model(renamed, manifest, synthetic=True, cross_topic=True)
        self.assertNotEqual(first['classifierEvidence']['modelVersion'], second['classifierEvidence']['modelVersion'])

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

    def test_real_path_metadata_cannot_claim_more_reviewed_originals_than_held_out(self):
        # Fictional metadata exercises the real-path guard; no real corpus is trained or saved.
        rows, manifest = fixture()
        for row in rows:
            row['provenance'] = 'public_article'
            row['usage'] = {'trainingAllowed': True, 'modelDistributionAllowed': True,
                            'basisUrl': 'https://synthetic.example/fixture-only',
                            'reviewedBy': 'synthetic metadata fixture', 'reviewedAt': '2026-01-01'}
        first = train_model(rows, manifest)
        self.assertLess(len(first['classifierEvidence']['evaluation']['evaluationSourceGroupIds']), 40)
        manifest['humanAxisReview'] = {'status': 'approved', 'reviewedBy': 'synthetic reviewer',
                                      'reviewers': ['synthetic one', 'synthetic two'], 'sampleCount': 40,
                                      'evidence': 'synthetic metadata fixture only', 'interReviewerAgreement': .8,
                                      'reviewedModelVersion': first['classifierEvidence']['modelVersion']}
        self.assertEqual(train_model(rows, manifest)['status'], 'research_only')

    def test_review_count_can_match_forty_actual_heldout_fixture_originals(self):
        originals, manifest = fixture()
        rows = []
        for publisher in ('left.example', 'right.example'):
            base = next(row for row in originals if row['publisherId'] == publisher)
            for i in range(50):
                rows.append({**base, 'id': f'{publisher}-{i}', 'url': f'https://{publisher}/{i}',
                             'sourceGroupId': f'{publisher}-original-{i}', 'text': base['text'] + f' 별도 합성 원본 {i}',
                             'provenance': 'public_article',
                             'usage': {'trainingAllowed': True, 'modelDistributionAllowed': True,
                                       'basisUrl': 'https://synthetic.example/fixture-only',
                                       'reviewedBy': 'synthetic fixture', 'reviewedAt': '2026-01-01'}})
        first = train_model(rows, manifest)
        self.assertEqual(len(first['classifierEvidence']['evaluation']['evaluationSourceGroupIds']), 40)
        manifest['humanAxisReview'] = {'status': 'approved', 'reviewedBy': 'synthetic reviewer',
                                      'reviewers': ['synthetic one', 'synthetic two'], 'sampleCount': 40,
                                      'evidence': 'synthetic metadata fixture only', 'interReviewerAgreement': .8,
                                      'reviewedModelVersion': first['classifierEvidence']['modelVersion']}
        self.assertEqual(train_model(rows, manifest)['status'], 'validated')
        manifest['humanAxisReview']['sampleCount'] = 41
        self.assertEqual(train_model(rows, manifest)['status'], 'research_only')

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
