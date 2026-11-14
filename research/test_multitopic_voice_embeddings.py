"""Synthetic regression checks for split integrity and truthful incomplete states."""
from datetime import date, timedelta
import hashlib
import unittest

from train_stance import digest
from prepare_multitopic_voice_embeddings import prepare, research_split
from train_multitopic_voice_embeddings import checked_input, train_topic


def fixtures(topic='nuclear_energy', model='fixture'):
    corpus, annotations = [], []
    for index in range(12):
        direction = ['neutral', 'support', 'oppose'][index % 3]
        identity = chr(ord('a') + index) * 8
        texts = [f'Article {topic} {identity} source position.', f'Article {topic} {identity} reporter context.']
        body = ' '.join(texts)
        units, offset = [], 0
        for position, text in enumerate(texts):
            units.append({'sentenceId': f's{position}', 'start': offset, 'end': offset + len(text), 'text': text})
            offset += len(text) + 1
        article_id = f'{topic}-fixture-{index}'
        body_hash = hashlib.sha256(body.encode()).hexdigest()
        corpus.append({'id': article_id, 'topicId': topic, 'text': body, 'voiceVersion': 'sentence-voice-1.0',
            'segmenter': 'sentence-3.1', 'scopeCharacters': 2000, 'sentences': units,
            'publishedAt': (date(2024, 1, 1) + timedelta(days=index * 10)).isoformat()})
        issue = 'expansion' if topic == 'nuclear_energy' else 'increase'
        annotations.append({'articleId': article_id, 'articleHash': body_hash, 'topic': topic,
            'version': 'sentence-voice-1.0', 'segmenter': 'sentence-3.1', 'scopeCharacters': 2000,
            'annotator': {'kind': 'ai', 'model': model, 'version': 'split-regression-only'},
            'labels': [{'sentenceId': 's0', 'issue': issue, 'direction': direction, 'speaker': 'source'},
                       {'sentenceId': 's1', 'issue': 'none', 'direction': 'neutral', 'speaker': 'journalist'}]})
    return corpus, annotations


class MultitopicEmbeddingTests(unittest.TestCase):
    def test_one_article_rare_issue_does_not_block_common_issue_research(self):
        corpus, labels = fixtures()
        labels[0]['labels'][0]['issue'] = 'lifetime'
        prepared = prepare(corpus, labels)
        details = prepared['preparation']['topics']['nuclear_energy']
        self.assertEqual(details['splitDiagnostics']['researchFallback'], 'rare_issue_class_coverage_unavailable')
        self.assertTrue(prepared['sets']['train'] and prepared['sets']['evaluation'])
        train_issues, evaluation_issues = details['trainingIssueCounts'], details['evaluationIssueCounts']
        self.assertEqual(train_issues.get('lifetime', 0) + evaluation_issues.get('lifetime', 0), 1)
        self.assertFalse('lifetime' in train_issues and 'lifetime' in evaluation_issues)
        repeated = prepare(corpus, labels, frozen=prepared['splitManifest'])
        self.assertEqual(prepared['sets'], repeated['sets'])
        # Registered manifests retain their original coverage requirement.
        from train_voice import validate, connected_groups
        rows, _ = validate(corpus, labels)
        groups = connected_groups(rows)
        manifest = dict(prepared['splitManifest']['topics']['nuclear_energy'])
        del manifest['researchSplitPolicy']
        split, diagnostics = research_split(rows, groups, manifest)
        self.assertIsNone(split)
        self.assertNotIn('researchFallback', diagnostics)

    def test_independent_topic_teachers_keep_provenance_and_group_isolation(self):
        first_corpus, first_labels = fixtures()
        second_corpus, second_labels = fixtures('minimum_wage', 'other-fixture-teacher')
        prepared = prepare(first_corpus + second_corpus, first_labels + second_labels)
        self.assertIsNone(prepared['teacher'])
        self.assertEqual(prepared['teachersByTopic']['nuclear_energy'][1], 'fixture')
        self.assertEqual(prepared['teachersByTopic']['minimum_wage'][1], 'other-fixture-teacher')
        self.assertEqual({row['topic'] for row in prepared['sets']['train']}, {'nuclear_energy', 'minimum_wage'})
        self.assertFalse({row['group'] for row in prepared['sets']['train']}
                         & {row['group'] for row in prepared['sets']['evaluation']})

    def test_mixed_teachers_within_one_topic_are_rejected(self):
        corpus, labels = fixtures()
        labels[0]['annotator']['model'] = 'another-teacher'
        with self.assertRaisesRegex(ValueError, 'Do not mix annotation versions'):
            prepare(corpus, labels)

    def test_preparation_freezes_groups_before_vectors_and_round_trips(self):
        corpus, labels = fixtures()
        prepared = prepare(corpus, labels)
        self.assertEqual(checked_input(prepared), {row['key'] for row in prepared['records']})
        training, evaluation = prepared['sets']['train'], prepared['sets']['evaluation']
        self.assertTrue(training and evaluation)
        self.assertFalse({row['group'] for row in training} & {row['group'] for row in evaluation})
        self.assertFalse({row['key'] for row in training} & {row['key'] for row in evaluation})
        self.assertTrue(all(row['topic'] == 'nuclear_energy' for row in training + evaluation))
        repeated = prepare(corpus, labels, frozen=prepared['splitManifest'])
        self.assertEqual(prepared['sets'], repeated['sets'])

    def test_a_tampered_prepared_text_is_rejected(self):
        prepared = prepare(*fixtures())
        prepared['records'][0]['text'] += ' changed'
        prepared['inputDigest'] = digest({key: value for key, value in prepared.items() if key != 'inputDigest'})
        with self.assertRaisesRegex(ValueError, 'text hash'):
            checked_input(prepared)

    def test_missing_vectors_do_not_drop_unembedded_heldout_rows(self):
        prepared = prepare(*fixtures())
        model, report = train_topic('nuclear_energy', prepared['sets']['train'], prepared['sets']['evaluation'], {})
        self.assertIsNone(model)
        self.assertIn('embeddings_incomplete', report['blockers'])
        self.assertFalse(report['ready'])


if __name__ == '__main__':
    unittest.main()
