"""KST publication boundaries; all examples are synthetic, no corpus writes."""
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from audit_collected_articles import audit, publication_year
from checkpoint_bias_collection import intake
from corpus_dates import COLLECTION_END, COLLECTION_START, publication_calendar, publication_day_kst


def article(identifier, publication):
    return {'id': identifier, 'publisherId': 'pressian.com',
            'url': 'https://www.pressian.com/pages/articles/' + identifier,
            'topicId': 'medical_school_quota', 'publishedAt': publication,
            'fetchedAt': '2026-11-05T01:00:00Z', 'title': '의대 정원 정책 ' + identifier,
            'text': ('의대 정원 정책의 실제 문장과 근거를 검토합니다. ' * 20) + identifier}


class CorpusDateTests(unittest.TestCase):
    def test_lower_kst_boundary(self):
        self.assertEqual(publication_day_kst('2023-12-31T15:00:00Z'), COLLECTION_START)
        self.assertLess(publication_day_kst('2023-12-31T14:59:59Z'), COLLECTION_START)

    def test_upper_kst_boundary(self):
        self.assertEqual(publication_day_kst('2026-11-04T14:59:59Z'), COLLECTION_END)
        self.assertGreater(publication_day_kst('2026-11-04T15:00:00Z'), COLLECTION_END)

    def test_explicit_offsets_use_kst_calendar(self):
        self.assertEqual(publication_day_kst('2026-11-05T00:15:00+10:00'), date(2026, 11, 4))
        self.assertEqual(publication_day_kst('2026-11-04T23:30:00-0100'), date(2026, 11, 5))

    def test_date_only_retains_publisher_calendar(self):
        self.assertEqual(publication_calendar('2026-11-04'),
                         (date(2026, 11, 4), 'date_only_publisher_calendar'))

    def test_naive_timestamp_does_not_invent_timezone(self):
        self.assertEqual(publication_calendar('2026-11-04T23:59:59'),
                         (date(2026, 11, 4), 'naive_timestamp_calendar_unverified'))

    def test_real_calendar_and_iso_shape_are_validated(self):
        for value in ('2024-02-30', '2025-02-29T00:00:00Z', '2026-13-01',
                      '2026-11-04T25:00:00Z', '2026-11-04T01:00:00+24:00',
                      '2024-W01-1', '2026/11/04', '', None, 1793800000):
            with self.subTest(value=value), self.assertRaises(ValueError):
                publication_day_kst(value)
        self.assertEqual(publication_day_kst('2024-02-29T00:00:00+09:00'), date(2024, 2, 29))

    def test_intake_admits_and_excludes_by_kst_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.jsonl'
            rows = [article('lower', '2023-12-31T15:00:00Z'),
                    article('upper', '2026-11-04T14:59:59Z'),
                    article('outside', '2026-11-04T15:00:00Z'),
                    article('bad', '2025-02-29T00:00:00Z')]
            path.write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
            accepted, excluded = intake(path)
            self.assertEqual([r['id'] for r in accepted], ['lower', 'upper'])
            self.assertEqual(excluded['missing_or_outside_publication_date'], 2)

    def test_audit_uses_kst_year_and_marks_naive_dates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.jsonl'
            rows = [article('lower', '2023-12-31T15:00:00Z'),
                    article('outside', '2026-11-04T15:00:00Z'),
                    article('naive', '2026-11-04T23:59:59')]
            path.write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
            audited, report = audit([path])
            self.assertNotIn('outside_collection_period', audited[0]['collectionAudit']['flags'])
            self.assertIn('outside_collection_period', audited[1]['collectionAudit']['flags'])
            self.assertIn('publication_timezone_needs_review', audited[2]['collectionAudit']['flags'])
            self.assertEqual(report['byPublisherYear']['pressian.com:2024'], 1)
            self.assertEqual(publication_year('2023-12-31T15:00:00Z'), '2024')


if __name__ == '__main__':
    unittest.main()
