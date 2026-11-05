"""Publication dates for the unchanged Korean corpus collection window.

Aware ISO timestamps are converted to UTC+09:00. Date-only values keep their
calendar date. Naive timestamps keep the publisher's literal calendar date and
are explicitly marked unverified; this helper never invents a source timezone.
"""
import re
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9), name='Asia/Seoul')
COLLECTION_START = date(2024, 1, 1)
COLLECTION_END = date(2026, 11, 4)
DATE_ONLY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ISO_TIMESTAMP = re.compile(
    r'^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}'
    r'(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:?\d{2})?$')


def publication_calendar(value):
    """Return (calendar date, basis), raising ValueError for invalid values."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Publication date must be a nonempty ISO string')
    value = value.strip()
    if DATE_ONLY.fullmatch(value):
        return date.fromisoformat(value), 'date_only_publisher_calendar'
    if not ISO_TIMESTAMP.fullmatch(value):
        raise ValueError('Publication timestamp must use an ISO calendar date')
    parsed = datetime.fromisoformat(value[:-1] + '+00:00' if value[-1] in 'Zz' else value)
    if parsed.tzinfo is None:
        return parsed.date(), 'naive_timestamp_calendar_unverified'
    return parsed.astimezone(KST).date(), 'aware_timestamp_converted_to_kst'


def publication_day_kst(value):
    """Return the KST day, or literal unverified day for a naive timestamp."""
    return publication_calendar(value)[0]
