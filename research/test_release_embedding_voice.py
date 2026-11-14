"""Synthetic release-boundary fixtures, never article accuracy measurements."""
import copy
from datetime import datetime, timezone
import hashlib
import json
import unittest
from unittest.mock import patch

from release_embedding_voice import (checked_release, masking_summary,
                                     require_performance, validate_usage_review)
from train_stance import digest


class EmbeddingReleaseTests(unittest.TestCase):
    def setUp(self):
        self.corpus = [{'id': article_id, 'text': 'fixture body ' + article_id,
                        'usage': {'trainingAllowed': True, 'modelDistributionAllowed': True}}
                       for article_id in ['train', 'evaluation1', 'evaluation2', 'challenge']]
        self.labels = [{'articleId': 'fixture-boundary-only'}]
        text = 'Actual-input invariant fixture, not training data'
        record = {'text': text, 'key': hashlib.sha256(text.encode()).hexdigest()}
        self.prepared = {'schemaVersion': 'voice-embedding-input-1.0', 'records': [record],
            'sets': {'train': [{'articleId': 'train', 'direction': label} for label in ['neutral', 'oppose', 'support'] for _ in range(10)],
                     'evaluation': [{'articleId': 'evaluation1'}, {'articleId': 'evaluation2'}],
                     'challenge': [{'articleId': 'challenge'}]}}
        self.prepared['inputDigest'] = digest(self.prepared)
        self.review = {'corpusDigest': digest(self.corpus), 'labelsDigest': digest(self.labels),
            'trainingAllowed': True, 'modelDistributionAllowed': True, 'reviewedBy': 'fixture-reviewer-private',
            'reviewedAt': '2026-01-01T00:00:00Z', 'basisUrl': 'https://example.org/fixture-permission'}
        self.report = {'ready': True, 'measuredPerformanceGatesPassed': True, 'blockers': [],
            'rawMacroF1': .8, 'majorityMacroF1': .3, 'rawRecall': {'support': .8, 'oppose': .8},
            'speakerMacroF1': .8, 'issueMacroF1': .8, 'groupOverlap': 0,
            'runtime': {'minimumMarginGap': .15, 'count': 2, 'macroF1': .8,
                        'supportRecall': .8, 'opposeRecall': .8,
                        'heads': {'speaker': {'jointMacroF1': .8}, 'issue': {'jointMacroF1': .8}}},
            'flipChallenge': {'pairCount': 10, 'pairAccuracy': .8}}
        self.candidate = {'schemaVersion': 'voice-embedding-svm-research-1.0', 'status': 'research',
            'version': 'fixture-boundary-only', 'inputDigest': self.prepared['inputDigest'], 'heads': {},
            'evaluation': self.report}

    def test_permission_review_never_approves_pending_source_rows(self):
        self.corpus[0]['usage']['trainingAllowed'] = None
        self.review['corpusDigest'] = digest(self.corpus)
        with self.assertRaisesRegex(ValueError, 'permissions remain unapproved'):
            validate_usage_review(self.corpus, self.labels, self.prepared, self.review)

    def test_evaluation_and_challenge_sources_also_require_explicit_permissions(self):
        for index in [1, 2, 3]:
            corpus = copy.deepcopy(self.corpus)
            corpus[index]['usage']['modelDistributionAllowed'] = False
            review = {**self.review, 'corpusDigest': digest(corpus)}
            with self.subTest(index=index), self.assertRaises(ValueError):
                validate_usage_review(corpus, self.labels, self.prepared, review)

    def test_usage_review_must_match_exact_inputs_identity_time_and_https_basis(self):
        for field, value in [('corpusDigest', 'wrong'), ('labelsDigest', 'wrong'), ('reviewedBy', ''),
                             ('reviewedBy', None), ('trainingAllowed', False), ('modelDistributionAllowed', False),
                             ('reviewedAt', '2999-01-01T00:00:00Z'), ('reviewedAt', '2026-01-01'),
                             ('basisUrl', 'http://example.org'), ('basisUrl', 'https://user:secret@example.org')]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_usage_review(self.corpus, self.labels, self.prepared, {**self.review, field: value})

    def test_prepared_digest_tampering_is_rejected_before_reproduction(self):
        self.prepared['records'][0]['text'] += ' modified'
        with patch('release_embedding_voice._reproduce') as reproduce, self.assertRaises(ValueError):
            checked_release(self.corpus, self.labels, self.prepared, {}, self.candidate, self.review)
        reproduce.assert_not_called()

    def test_claimed_passing_flags_cannot_replace_exact_weight_reproduction(self):
        changed = {**self.candidate, 'heads': {'changed': True}}
        with patch('release_embedding_voice._reproduce', return_value=(changed, self.report)), self.assertRaisesRegex(ValueError, 'exact reproduction'):
            checked_release(self.corpus, self.labels, self.prepared, {}, self.candidate, self.review)

    def test_each_numerical_gate_is_checked_even_when_all_flags_claim_pass(self):
        mutations = [lambda r: r.update(rawMacroF1=.59), lambda r: r['rawRecall'].update(support=.49),
                     lambda r: r.update(speakerMacroF1=.59), lambda r: r.update(issueMacroF1=.59),
                     lambda r: r['runtime'].update(macroF1=.59), lambda r: r['runtime'].update(supportRecall=.49),
                     lambda r: r['runtime']['heads']['issue'].update(jointMacroF1=.59),
                     lambda r: r['flipChallenge'].update(pairAccuracy=.49),
                     lambda r: r['flipChallenge'].update(pairCount=9), lambda r: r.update(groupOverlap=1),
                     lambda r: r.update(rawMacroF1=float('nan'))]
        for index, mutate in enumerate(mutations):
            report = copy.deepcopy(self.report)
            mutate(report)
            with self.subTest(index=index), self.assertRaises(ValueError):
                require_performance(report, self.prepared, masking_summary(self.prepared))

    def test_masking_counts_input_variants_without_api_or_accuracy_claim(self):
        summary = masking_summary(self.prepared)
        self.assertEqual(summary['maskingCheckCount'], 1)
        self.assertEqual(summary['maskingVariantCount'], 4)
        self.assertEqual(summary['maskingAgreement'], 1.)
        self.assertEqual(summary['humanEvaluationCount'], 0)
        self.assertIn('No new embedding/API request', summary['method'])

    def test_missing_class_cannot_pass_sample_count_gate(self):
        prepared = copy.deepcopy(self.prepared)
        prepared['sets']['train'] = [row for row in prepared['sets']['train'] if row['direction'] != 'oppose']
        with self.assertRaisesRegex(ValueError, 'insufficient samples'):
            require_performance(self.report, prepared, masking_summary(prepared))

    def test_new_policy_needs_matching_measured_direction_evidence(self):
        policy = 'voice-neutral-independent-1.0'
        report = copy.deepcopy(self.report)
        report['configuration'] = {'decisionPolicy': policy}
        with self.assertRaises(ValueError):
            require_performance(report, self.prepared, masking_summary(self.prepared))
        report['runtime']['heads']['direction'] = {'acceptedCount': 2}
        report['runtime']['directionDecision'] = {'policy': policy, 'macroF1': .8, 'supportRecall': .8, 'opposeRecall': .8,
                                                  'acceptedCount': 2, 'abstainedCount': 0, 'coverage': 1.}
        require_performance(report, self.prepared, masking_summary(self.prepared))
        report['runtime']['directionDecision']['supportRecall'] = .49
        with self.assertRaises(ValueError):
            require_performance(report, self.prepared, masking_summary(self.prepared))

    def test_policy_release_reproduction_receives_policy_and_versions_artifact(self):
        policy = 'voice-neutral-independent-1.0'
        self.candidate['configuration'] = {'decisionPolicy': policy}
        self.report['configuration'] = {'decisionPolicy': policy}
        self.report['runtime']['heads']['direction'] = {'acceptedCount': 2}
        self.report['runtime']['directionDecision'] = {'policy': policy, 'macroF1': .8, 'supportRecall': .8, 'opposeRecall': .8,
                                                       'acceptedCount': 2, 'abstainedCount': 0, 'coverage': 1.}
        with patch('release_embedding_voice._reproduce', return_value=(self.candidate, self.report)) as reproduce:
            artifact, _ = checked_release(self.corpus, self.labels, self.prepared, {}, self.candidate, self.review)
        self.assertEqual(reproduce.call_args.args[-1], policy)
        self.assertEqual(artifact['schemaVersion'], 'sentence-voice-embedding-svm-1.1')
        self.assertEqual(artifact['decisionPolicy'], policy)

    def test_success_keeps_original_sources_review_identity_and_vectors_out_of_artifact(self):
        # Only export-boundary structure is tested. Reproduction is separately
        # exercised on the real retained experiment, never these fixtures.
        with patch('release_embedding_voice._reproduce', return_value=(self.candidate, self.report)):
            artifact, report = checked_release(self.corpus, self.labels, self.prepared, {}, self.candidate, self.review)
        self.assertEqual(artifact['schemaVersion'], 'sentence-voice-embedding-svm-1.0')
        self.assertEqual(artifact['status'], 'ready')
        self.assertTrue(report['ready'])
        self.assertEqual(report['blockers'], [])
        self.assertEqual(len(artifact['trainingArticleHashes']), 1)
        serialized = json.dumps(artifact)
        for private in ['fixture body', 'fixture-reviewer-private', 'example.org', 'sourceIDs', 'vectors":']:
            self.assertNotIn(private, serialized)


if __name__ == '__main__':
    unittest.main()
