"""Release boundary checks, not article accuracy measurements."""
import unittest
from unittest.mock import patch
from release_stance import checked_release
from train_stance import digest


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.rows = [{'id': 'test-only'}]
        self.labels = [{'articleId': 'test-only'}]
        self.model = {'status': 'ready', 'version': 'synthetic-boundary-only'}
        self.review = {'corpusDigest': digest(self.rows), 'labelsDigest': digest(self.labels),
                       'trainingAllowed': True, 'modelDistributionAllowed': True,
                       'reviewedBy': 'test-only', 'reviewedAt': '2026-01-01T00:00:00Z',
                       'basisUrl': 'https://example.org/test-license'}

    def test_research_weights_never_released(self):
        for model in (None, {'status': 'research'}):
            with self.assertRaises(ValueError):
                checked_release(self.rows, self.labels, model, self.review)

    def test_review_cannot_approve_other_corpus_or_labels(self):
        for field, value in [('corpusDigest', 'wrong'), ('labelsDigest', 'wrong'),
                             ('trainingAllowed', False), ('modelDistributionAllowed', False),
                             ('reviewedBy', ''), ('basisUrl', 'http://example.org'),
                             ('reviewedAt', '2999-01-01T00:00:00Z')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                checked_release(self.rows, self.labels, self.model, {**self.review, field: value})

    def test_report_flags_cannot_replace_reproduction(self):
        with patch('release_stance.train', return_value=({'status': 'ready', 'version': 'different'},
                   {'ready': True, 'blockers': []})), self.assertRaises(ValueError):
            checked_release(self.rows, self.labels, self.model, self.review)

    def test_failed_metrics_or_source_permissions_still_block(self):
        with patch('release_stance.train', return_value=(self.model,
                   {'ready': False, 'blockers': ['usage_review_pending']})), self.assertRaises(ValueError):
            checked_release(self.rows, self.labels, self.model, self.review)

    def test_release_keeps_review_identity_and_source_text_local(self):
        report = {'ready': True, 'blockers': [], 'counts': {}, 'classCounts': {}}
        with patch('release_stance.train', return_value=(self.model, report)):
            artifact, status = checked_release(self.rows, self.labels, self.model, self.review)
        self.assertEqual(artifact['release']['reviewDigest'], digest(self.review))
        self.assertNotIn('reviewedBy', artifact['release'])
        self.assertNotIn('basisUrl', artifact['release'])
        self.assertTrue(status['ready'])


if __name__ == '__main__':
    unittest.main()
