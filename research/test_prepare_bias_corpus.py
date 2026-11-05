"""Synthetic metadata tests, never a real corpus, rights review, or model evaluation."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from prepare_bias_corpus import prepare, public_url


def fixture():
    articles, reviews = [], []
    manifest = {'axisId': 'synthetic-test-only', 'profiles': [
        {'publisherId': 'one.example', 'orientation': 'left'},
        {'publisherId': 'two.example', 'orientation': 'right'}]}
    for publisher in ('one.example', 'two.example'):
        for i in range(6):
            article_id = f'{publisher}-{i}'
            articles.append({'id': article_id, 'publisherId': publisher,
                             'url': f'https://{publisher}/article/{i}',
                             'publishedAt': '2026-05-28T12:00:00Z', 'fetchedAt': '2026-05-29T12:00:00Z',
                             'text': f'합성 문장 {publisher}의 서로 다른 예시 {i}번이며 실제 기사가 아니다.',
                             'extractionVersion': 'synthetic-test', 'provenance': 'public_article'})
            reviews.append({'articleId': article_id, 'sourceGroupId': f'original-{article_id}',
                            'topicReview': {'comparisonGroup': 'synthetic-topic',
                                            'reviewedBy': 'synthetic reviewer', 'evidence': 'synthetic-only'},
                            'usage': {'textStorageAllowed': True, 'trainingAllowed': True,
                                      'evaluationAllowed': True, 'modelDistributionAllowed': True,
                                      'basisUrl': 'https://rights.example/synthetic-only',
                                      'reviewedBy': 'synthetic reviewer', 'reviewedAt': '2026-05-28'}})
    return articles, {'comparisonGroup': 'synthetic-topic', 'windowStart': '2026-05-28T00:00:00Z',
                      'windowEnd': '2026-05-28T23:59:59Z', 'articles': reviews}, manifest


class CorpusPreparationTests(unittest.TestCase):
    def test_metadata_report_never_contains_article_body_or_invents_approval(self):
        articles, reviews, manifest = fixture()
        report, rows = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'train_input_ready')
        self.assertEqual(len(rows), 12)
        self.assertFalse(report['releaseReady'])
        self.assertEqual(report['missingAnchorPublishers'], [])
        self.assertNotIn(articles[0]['text'], json.dumps(report, ensure_ascii=False))
        self.assertNotIn('humanAxisReview', report)
        self.assertNotIn('label', rows[0])
        self.assertEqual(rows[0]['usage'], reviews['articles'][0]['usage'])

    def test_unreviewed_candidates_remain_pending_without_auto_groups_or_rights(self):
        articles, reviews, manifest = fixture()
        reviews['articles'] = []
        report, rows = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'pending_review')
        self.assertEqual(rows, [])
        self.assertIn('human_original_group_review_missing', report['articles'][0]['issues'])
        self.assertIn('article_usage_review_incomplete', report['articles'][0]['issues'])
        self.assertIsNone(report['articles'][0]['sourceGroupId'])

    def test_licensed_dataset_receipt_does_not_require_an_invented_publisher_fetch(self):
        articles, reviews, manifest = fixture()
        for article in articles:
            article.update(intakeMethod='licensed_dataset_import', fetchedAt=None,
                           importedAt='2026-05-29T12:00:00Z',
                           dataset={'id': 'synthetic-dataset-metadata',
                                    'sourceUrl': 'https://dataset.example/source'})
        report, rows = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'train_input_ready')
        self.assertNotIn('fetchedAt', rows[0])
        self.assertEqual(rows[0]['acquisition'], {
            'method': 'licensed_dataset_import', 'acquiredAt': articles[0]['importedAt'],
            'sourceUrl': 'https://dataset.example/source', 'datasetId': 'synthetic-dataset-metadata'})
        self.assertEqual(report['articles'][0]['acquisitionMethod'], 'licensed_dataset_import')
        self.assertFalse(report['releaseReady'])
        self.assertNotIn(articles[0]['text'], json.dumps(report, ensure_ascii=False))

    def test_dataset_import_still_requires_real_receipt_metadata_and_usage_review(self):
        for field, bad, issue in [
                ('importedAt', None, 'importedAt_missing_or_invalid'),
                ('importedAt', '2999-01-01T00:00:00Z', 'imported_at_in_future'),
                ('importedAt', '2026-05-27T00:00:00Z', 'publication_after_import_time'),
                ('dataset', None, 'licensed_dataset_source_missing_or_invalid'),
                ('dataset', {'id': 'synthetic', 'sourceUrl': 'https://localhost/source'},
                 'licensed_dataset_source_missing_or_invalid')]:
            with self.subTest(field=field, bad=bad):
                articles, reviews, manifest = fixture()
                for article in articles:
                    article.update(intakeMethod='licensed_dataset_import', fetchedAt=None,
                                   importedAt='2026-05-29T12:00:00Z',
                                   dataset={'id': 'synthetic', 'sourceUrl': 'https://dataset.example/source'})
                articles[0][field] = bad
                report, _ = prepare(articles, reviews, manifest)
                self.assertEqual(report['status'], 'pending_review')
                self.assertIn(issue, report['articles'][0]['issues'])
        articles, reviews, manifest = fixture()
        articles[0].update(intakeMethod='licensed_dataset_import', fetchedAt=None,
                           importedAt='2026-05-29T12:00:00Z',
                           dataset={'id': 'synthetic', 'sourceUrl': 'https://dataset.example/source'})
        reviews['articles'][0]['usage']['trainingAllowed'] = False
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('article_usage_review_incomplete', report['articles'][0]['issues'])

    def test_false_or_truthy_rights_and_missing_dates_are_not_approvals(self):
        for field in ('textStorageAllowed', 'trainingAllowed', 'evaluationAllowed', 'modelDistributionAllowed'):
            for bad in (False, 'true', 1):
                with self.subTest(field=field, bad=bad):
                    articles, reviews, manifest = fixture()
                    reviews['articles'][0]['usage'][field] = bad
                    report, _ = prepare(articles, reviews, manifest)
                    self.assertEqual(report['status'], 'pending_review')
        articles, reviews, manifest = fixture()
        reviews['articles'][0]['usage']['reviewedAt'] = 'not-a-date'
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('article_usage_review_date_missing_or_invalid', report['articles'][0]['issues'])

    def test_topic_publication_window_and_fetch_metadata_are_required(self):
        for field, bad, expected in [('publishedAt', '2026-05-27', 'outside_comparison_publication_window'),
                                     ('fetchedAt', 'not-a-date', 'fetchedAt_missing_or_invalid'),
                                     ('fetchedAt', '2026-05-27', 'publication_after_fetch_time'),
                                     ('publisherId', 'unrelated.example', 'publisher_url_mismatch'),
                                     ('extractionVersion', '', 'extraction_version_missing'),
                                     ('provenance', 'synthetic', 'fetched_public_article_provenance_missing')]:
            with self.subTest(field=field):
                articles, reviews, manifest = fixture()
                articles[0][field] = bad
                report, _ = prepare(articles, reviews, manifest)
                self.assertIn(expected, report['articles'][0]['issues'])
        articles, reviews, manifest = fixture()
        reviews['articles'][0]['topicReview']['comparisonGroup'] = 'different-proposition'
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('human_topic_match_review_missing', report['articles'][0]['issues'])

    def test_timezone_free_clock_and_future_fetch_times_are_rejected(self):
        for value, expected in [('2026-05-29T09:00:00', 'fetchedAt_missing_or_invalid'),
                                ('20260529T090000Z', 'fetchedAt_missing_or_invalid'),
                                ('2099-05-29T09:00:00Z', 'fetched_at_in_future')]:
            with self.subTest(value=value):
                articles, reviews, manifest = fixture()
                articles[0]['fetchedAt'] = value
                report, _ = prepare(articles, reviews, manifest)
                self.assertIn(expected, report['articles'][0]['issues'])

    def test_date_only_comparison_window_includes_the_full_korean_calendar_day(self):
        articles, reviews, manifest = fixture()
        articles[0]['publishedAt'] = '2026-05-28'
        reviews['windowStart'] = '2026-05-28'
        reviews['windowEnd'] = '2026-05-28'
        report, _ = prepare(articles, reviews, manifest)
        self.assertNotIn('outside_comparison_publication_window', report['articles'][0]['issues'])

        articles, reviews, manifest = fixture()
        articles[0]['publishedAt'] = '2026-05-28'
        reviews['windowStart'] = '2026-05-28T00:00:00+09:00'
        reviews['windowEnd'] = '2026-05-28T23:59:59.999999+09:00'
        report, _ = prepare(articles, reviews, manifest)
        self.assertNotIn('publication_precision_insufficient_for_window', report['articles'][0]['issues'])

        articles, reviews, manifest = fixture()
        articles[0]['publishedAt'] = '2026-05-28'
        reviews['windowStart'] = '2026-05-28T00:00:00Z'
        reviews['windowEnd'] = '2026-05-28T23:59:59Z'
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('publication_precision_insufficient_for_window', report['articles'][0]['issues'])

    def test_known_publisher_alias_is_allowed_but_unrelated_subdomain_is_not(self):
        for mobile, publisher in [('m.pressian.com', 'pressian.com'), ('m.ohmynews.com', 'ohmynews.com')]:
            articles, reviews, manifest = fixture()
            for article in articles:
                if article['publisherId'] == 'one.example':
                    article['publisherId'] = publisher
                    article['url'] = article['url'].replace('https://one.example', 'https://' + mobile)
            manifest['profiles'][0]['publisherId'] = publisher
            report, _ = prepare(articles, reviews, manifest)
            self.assertEqual(report['status'], 'train_input_ready')

        articles, reviews, manifest = fixture()
        for article in articles:
            if article['publisherId'] == 'one.example':
                article['publisherId'] = 'news.donga.com'
                article['url'] = article['url'].replace('https://one.example', 'https://news.donga.com')
        manifest['profiles'][0]['publisherId'] = 'donga.com'
        report, _ = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'train_input_ready')
        self.assertEqual(report['articles'][0]['publisherId'], 'donga.com')

        articles, reviews, manifest = fixture()
        articles[0]['publisherId'] = 'chosun.com'
        articles[0]['url'] = 'https://biz.chosun.com/news/1'
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('publisher_url_mismatch', report['articles'][0]['issues'])

    def test_manifest_alias_is_canonicalized_before_training_validation(self):
        articles, reviews, manifest = fixture()
        for article in articles:
            if article['publisherId'] == 'one.example':
                article['publisherId'] = 'imbc.com'
                article['url'] = article['url'].replace('https://one.example', 'https://imnews.imbc.com')
        manifest['profiles'][0]['publisherId'] = 'imnews.imbc.com'
        report, _ = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'train_input_ready', report['trainingValidationError'])
        self.assertEqual(report['missingAnchorPublishers'], [])

        manifest['profiles'].append({'publisherId': 'imbc.com', 'orientation': 'right'})
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('existing_training_validation_failed', report['blockingReasons'])

    def test_date_only_fetch_record_covers_its_whole_day(self):
        articles, reviews, manifest = fixture()
        articles[0]['publishedAt'] = '2026-05-28T15:00:00+09:00'
        articles[0]['fetchedAt'] = '2026-05-28'
        report, _ = prepare(articles, reviews, manifest)
        self.assertNotIn('publication_after_fetch_time', report['articles'][0]['issues'])
        articles[0]['fetchedAt'] = '2026-05-27'
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('publication_after_fetch_time', report['articles'][0]['issues'])

    def test_existing_duplicate_and_sample_safeguards_are_preserved(self):
        articles, reviews, manifest = fixture()
        articles[1]['text'] = articles[0]['text']
        report, _ = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'pending_review')
        self.assertIn('Duplicate text', report['trainingValidationError'])
        articles, reviews, manifest = fixture()
        articles.pop()
        reviews['articles'].pop()
        report, _ = prepare(articles, reviews, manifest)
        self.assertIn('six independent', report['trainingValidationError'])

    def test_tracking_fragment_and_www_variants_are_not_independent_urls(self):
        articles, reviews, manifest = fixture()
        articles[1]['url'] = articles[0]['url'].replace('https://', 'https://www.') + '/?utm_source=test#fragment'
        report, _ = prepare(articles, reviews, manifest)
        self.assertEqual(report['status'], 'pending_review')
        self.assertIn('duplicate_canonical_url', report['articles'][1]['issues'])
        self.assertEqual(report['articles'][0]['url'], report['articles'][1]['url'])

    def test_unknown_review_ids_and_duplicate_review_ids_fail_closed(self):
        articles, reviews, manifest = fixture()
        reviews['articles'].append({'articleId': 'not-fetched'})
        report, _ = prepare(articles, reviews, manifest)
        self.assertEqual(report['unknownReviewedArticleIds'], ['not-fetched'])
        self.assertEqual(report['status'], 'pending_review')
        reviews['articles'].append(copy.deepcopy(reviews['articles'][0]))
        with self.assertRaisesRegex(ValueError, 'unique'):
            prepare(articles, reviews, manifest)

    def test_public_url_rejects_internal_addresses_credentials_and_key_queries(self):
        for value in ('http://news.example/1', 'https://localhost/1', 'https://127.0.0.1/1',
                      'https://[::1]/1', 'https://news.local/1', 'https://user:pass@news.example/1',
                      'https://news.internal/1', 'https://0127.0.0.1/1', 'https://news.example/white space',
                      'https://news.example:444/1', 'https://news.example/1?api_key=secret'):
            self.assertFalse(public_url(value), value)
        self.assertTrue(public_url('https://news.example/1?id=123'))

    def test_cli_does_not_overwrite_or_export_incomplete_article_text(self):
        articles, reviews, manifest = fixture()
        reviews['articles'] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {'articles.jsonl': '\n'.join(json.dumps(a) for a in articles),
                     'reviews.json': json.dumps(reviews), 'orientation.json': json.dumps(manifest)}
            for name, value in files.items():
                (root / name).write_text(value, encoding='utf-8')
            command = [sys.executable, str(Path(__file__).with_name('prepare_bias_corpus.py')),
                       '--input', str(root / 'articles.jsonl'), '--reviews', str(root / 'reviews.json'),
                       '--manifest', str(root / 'orientation.json'), '--report', str(root / 'report.json'),
                       '--export', str(root / 'training.local.jsonl')]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((root / 'training.local.jsonl').exists())
            self.assertTrue((root / 'report.json').exists())
            report_before = (root / 'report.json').read_text()
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((root / 'report.json').read_text(), report_before)
            self.assertNotIn(articles[0]['text'], result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
