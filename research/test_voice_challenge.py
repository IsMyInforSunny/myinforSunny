"""Synthetic fixtures test provenance security, not real-label accuracy."""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import unittest

from train_stance import normalize
from voice_challenge import ground_challenge, _overlap


def article(number, text=None, **extra):
    text = text or f'Independent fixture statement number {number} ends here.'
    row = {'id': f'a{number}', 'topicId': 'nuclear_energy', 'text': text,
           'publishedAt': (date(2020, 1, 1) + timedelta(days=number * 12)).isoformat(),
           'voiceVersion': 'sentence-voice-1.0', 'segmenter': 'sentence-3.1',
           'scopeCharacters': 2000, 'voiceHash': hashlib.sha256(normalize(text).encode()).hexdigest(),
           'sentences': [{'sentenceId': 'body_s0', 'start': 0,
                          'end': len(text.encode('utf-16-le')) // 2, 'text': text}]}
    row.update(extra)
    return row


def pair(left, right):
    result = {'topic': 'nuclear_energy', 'issue': 'expansion'}
    for side, row in [('support', left), ('oppose', right)]:
        result[side] = row['sentences'][0]['text']
        result[side + 'Source'] = {'articleId': row['id'], 'sentenceId': 'body_s0',
                                  'articleHash': row['voiceHash']}
    return result


def run(pairs, corpus, excluded=(), events=None):
    return ground_challenge({'version': 'sentence-voice-1.0', 'pairs': pairs}, corpus, excluded, events)


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.rows = [article(i) for i in range(1, 9)]
        self.pair = pair(*self.rows[:2])

    def rejects(self, reason, value=None, rows=None, excluded=(), events=None):
        result = run([value or self.pair], rows or self.rows, excluded, events)
        self.assertEqual(result['pairs'], [])
        self.assertEqual(result['rejectedCounts'], {reason: 1})
        self.assertEqual(result['candidatePairCount'], 1)

    def test_valid_independent_fixture_preserves_original_pair(self):
        second = pair(*self.rows[2:4])
        result = run([self.pair, second], self.rows)
        self.assertEqual(result['pairs'], [self.pair, second])
        self.assertIs(result['pairs'][0], self.pair)
        self.assertEqual(result['rejectedCounts'], {})

    def test_fabricated_or_partial_quote(self):
        for quote in ['Fabricated claim.', self.pair['support'][:-1]]:
            value = deepcopy(self.pair)
            value['support'] = quote
            self.rejects('quote_mismatch', value)

    def test_unknown_or_absent_proof(self):
        value = deepcopy(self.pair)
        value['supportSource']['articleId'] = 'not-an-article'
        self.rejects('unknown_source', value)
        del value['supportSource']
        self.rejects('missing_source_proof', value)

    def test_hash_and_prepared_hash_must_match(self):
        value = deepcopy(self.pair)
        value['supportSource']['articleHash'] = '0' * 64
        self.rejects('source_hash_mismatch', value)
        rows = deepcopy(self.rows)
        rows[0]['voiceHash'] = '0' * 64
        self.rejects('source_hash_mismatch', rows=rows)

    def test_versions_and_topic(self):
        for key, bad in [('voiceVersion', 'old'), ('segmenter', 'old'), ('scopeCharacters', 1000)]:
            rows = deepcopy(self.rows)
            rows[0][key] = bad
            self.rejects('invalid_source_version', rows=rows)
        rows = deepcopy(self.rows)
        rows[0]['topicId'] = 'pension_reform'
        self.rejects('source_topic_mismatch', rows=rows)

    def test_utf16_nonbmp_and_corrupt_offsets(self):
        rows = [article(1, 'First fixture \U0001f331 sentence.'), article(2)]
        value = pair(*rows)
        self.assertEqual(len(run([value], rows)['pairs']), 1)
        rows[0]['sentences'][0]['end'] -= 1
        self.rejects('invalid_sentence_range', value, rows)

    def test_same_and_repeated_articles(self):
        self.rejects('same_article', pair(self.rows[0], self.rows[0]))
        result = run([self.pair, pair(self.rows[0], self.rows[2])], self.rows)
        self.assertEqual(result['rejectedCounts'], {'reused_article': 1})

    def test_range_cannot_extend_beyond_body(self):
        rows = deepcopy(self.rows)
        rows[0]['sentences'][0]['end'] += 10
        self.rejects('invalid_sentence_range', rows=rows)

    def test_excluded_article_and_text(self):
        self.rejects('excluded_article', excluded=['a1'])
        # Different bodies and dates, but one full source sentence was copied.
        rows = deepcopy(self.rows)
        rows[2]['sentences'].append({'sentenceId': 'extra', 'text': self.pair['support']})
        self.rejects('excluded_text_overlap', rows=rows, excluded=['a3'])

    def test_common_short_retained_fragment_is_not_text_leakage(self):
        fragment = '\uc18c\ud615\ubaa8\ub4c8\uc6d0\uc790\ub85c(SM'
        rows = [article(1, 'An independent complete statement mentioning ' + fragment + 'R).'),
                article(2), article(3, fragment)]
        result = run([pair(*rows[:2])], rows, ['a3'])
        self.assertEqual(len(result['pairs']), 1)
        self.assertEqual(result['rejectedCounts'], {})

    def test_short_exact_equality_still_leaks(self):
        rows = [article(1, 'Short.'), article(2), article(3, 'Prefix. Short.')]
        rows[2]['sentences'] = [{'sentenceId': 'extra', 'text': 'Short.'}]
        self.rejects('excluded_text_overlap', pair(*rows[:2]), rows, ['a3'])

    def test_long_copied_containment_is_rejected(self):
        fragment = 'A meaningful copied passage contains at least forty characters.'
        rows = [article(1, 'Before ' + fragment + ' After.'), article(2), article(3, fragment)]
        self.rejects('excluded_text_overlap', pair(*rows[:2]), rows, ['a3'])

    def test_containment_boundary_counts_unicode_characters(self):
        for length, expected in [(39, False), (40, True)]:
            fragment = '\U0001f331' * length
            self.assertEqual(_overlap(fragment, 'Before' + fragment + 'After'), expected)
            self.assertEqual(_overlap('Before' + fragment + 'After', fragment), expected)
        self.assertTrue(_overlap('x', 'x'))
        self.assertFalse(_overlap('', 'anything'))

    def test_same_date_or_event_groups(self):
        for key in ['publishedAt', 'eventId', 'sourceGroupId']:
            rows = deepcopy(self.rows)
            rows[0][key] = rows[1][key] = '2020-02-01' if key == 'publishedAt' else 'shared'
            self.rejects('same_connected_group', rows=rows)
        self.rejects('same_connected_group', events={'a1': 'shared', 'a2': 'shared'})

    def test_excluded_transitive_group(self):
        rows = deepcopy(self.rows)
        rows[0]['eventId'] = rows[2]['eventId'] = 'event-bridge'
        rows[2]['sourceGroupId'] = rows[3]['sourceGroupId'] = 'original-bridge'
        self.rejects('excluded_connected_group', rows=rows, excluded=['a4'])
        rows = deepcopy(self.rows)
        rows[2]['publishedAt'] = rows[0]['publishedAt']
        self.rejects('excluded_connected_group', rows=rows, excluded=['a3'])

    def test_reused_group_across_pairs(self):
        rows = deepcopy(self.rows)
        rows[0]['eventId'] = rows[2]['eventId'] = 'shared'
        result = run([pair(*rows[:2]), pair(*rows[2:4])], rows)
        self.assertEqual(result['rejectedCounts'], {'reused_connected_group': 1})

    def test_repeated_text_with_distinct_bodies(self):
        rows = deepcopy(self.rows)
        # Add preceding material to preserve different body hashes.
        rows[2] = article(3, 'Prefix. ' + self.pair['support'])
        rows[2]['sentences'][0].update(start=8, text=self.pair['support'])
        result = run([self.pair, pair(*rows[2:4])], rows)
        self.assertEqual(result['rejectedCounts'], {'reused_text': 1})

    def test_identical_body_group_exclusion(self):
        rows = deepcopy(self.rows)
        rows[2] = article(3, rows[0]['text'])
        self.rejects('excluded_connected_group', rows=rows, excluded=['a3'])

    def test_missing_invalid_and_unknown_sentence(self):
        self.assertEqual(ground_challenge(None, [], [])['rejectedCounts'], {'missing': 1})
        result = ground_challenge({'version': 'old', 'pairs': [self.pair]}, self.rows, [])
        self.assertEqual(result['rejectedCounts'], {'invalid_version': 1})
        value = deepcopy(self.pair)
        value['supportSource']['sentenceId'] = 'missing'
        self.rejects('unknown_or_duplicate_sentence', value)
        value = deepcopy(self.pair)
        value['issue'] = {}
        self.rejects('invalid_topic_or_issue', value)


if __name__ == '__main__':
    unittest.main()
