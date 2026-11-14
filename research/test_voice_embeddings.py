"""Offline preparation boundaries, not article classification accuracy tests."""
import hashlib
import json
import unittest

from prepare_voice_embeddings import natural_text, neutral_sample, request_batches, OPTIONS


class PreparationTests(unittest.TestCase):
    def test_semantic_text_keeps_numbers_and_nuclear_aliases(self):
        self.assertEqual(natural_text('데일리안 원자력 발전소 2030년 12.5%'), '원자력 발전소 2030년 12.5%')

    def test_utf8_request_size_not_character_count_controls_batches(self):
        records = [{'key': hashlib.sha256(str(i).encode()).hexdigest(), 'text': '한' * 100} for i in range(50)]
        batches = request_batches(records)
        self.assertEqual(sum(map(len, batches)), 50)
        for batch in batches:
            body = json.dumps({**OPTIONS, 'input': [row['text'] for row in batch]}, ensure_ascii=False, separators=(',', ':')).encode()
            self.assertLessEqual(len(body), 6000)
            self.assertLessEqual(len(batch), 32)

    def test_one_oversized_sentence_cannot_be_silently_truncated(self):
        with self.assertRaisesRegex(ValueError, 'sentence exceeds'):
            request_batches([{'text': '한' * 3000}])

    def test_hash_order_round_robin_is_deterministic_and_uses_multiple_groups(self):
        rows = [{'article': {'id': article}, 'sentenceId': str(i), 'text': str(i), 'direction': 'neutral'}
                for i, article in enumerate(['a', 'a', 'a', 'b', 'b', 'c', 'c'])]
        groups = [1, 1, 1, 2, 2, 3, 3]
        selected = neutral_sample(rows, list(range(7)), groups, 3)
        self.assertEqual(selected, neutral_sample(rows, list(reversed(range(7))), groups, 3))
        self.assertEqual(len({groups[i] for i in selected}), 3)

    def test_neutral_sampler_cannot_substitute_directional_rows(self):
        rows = [{'article': {'id': 'a'}, 'sentenceId': '0', 'text': 'fixture', 'direction': 'support'}]
        with self.assertRaisesRegex(ValueError, 'Not enough'):
            neutral_sample(rows, [0], [1], 1)


if __name__ == '__main__':
    unittest.main()
