"""Merge directly collected local articles and report candidate quality, never approvals."""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from corpus_dates import COLLECTION_END, COLLECTION_START, publication_calendar

TOPICS = {
    'medical_school_quota': r'의대|의과대|의사\s*정원',
    'pension_reform': r'국민연금|연금개혁|연금\s*개혁|소득대체율|보험료율',
    'minimum_wage': r'최저임금|생활임금',
    'electricity_prices': r'전기\s*(?:요금|료)|전력\s*요금',
    'housing_supply': r'주택|부동산|아파트',
    'nuclear_energy': r'원전|원자력|핵폐기',
}
NAMES = {'dailian': 'dailian.co.kr', 'newdaily': 'newdaily.co.kr'}
PROMOTIONAL_TITLE = re.compile(
    r'(?:견본주택|모델하우스).*(?:개관|개장|오픈)'
    r'|주택행정.*(?:우수상|수상|우수.*선정|우수기관|우수\s*시군)'
    r'|(?:우수상|최우수상).*주택행정')


def content_hash(text):
    return hashlib.sha256(re.sub(r'\s+', ' ', text).strip().encode()).hexdigest()


def publication_year(value):
    try:
        return str(publication_calendar(value)[0].year)
    except (TypeError, ValueError):
        return 'unknown'


def article_identity(row):
    parsed = urlparse(row['url'])
    host = parsed.hostname.removeprefix('www.').removeprefix('m.')
    if host == 'ohmynews.com':
        key = parse_qs(parsed.query).get('CNTN_CD')
        if key:
            return host + ':' + key[0]
    if host == 'pressian.com':
        key = re.search(r'/articles/(\d+)', parsed.path)
        if key:
            return host + ':' + key[1]
    return row['url'].split('#')[0]


def audit(paths, excluded_ids=()):
    articles, seen, source_reports = [], set(), []
    excluded_ids, excluded_rows, read_records = set(excluded_ids), [], 0
    for path in paths:
        count = 0
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            read_records += 1
            if row.get('id') in excluded_ids:
                excluded_rows.append(row['id'])
                continue
            text = row.get('text', row.get('body', ''))
            if not isinstance(text, str) or not text.strip():
                continue
            row['text'] = text
            row['publisherId'] = NAMES.get(row.get('publisherId'), row.get('publisherId'))
            parsed = urlparse(row['url'])
            if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                    or not isinstance(row.get('publisherId'), str)
                    or not (parsed.hostname == row['publisherId'] or parsed.hostname.endswith('.' + row['publisherId']))):
                raise ValueError('Publisher/HTTPS source mismatch')
            identity = article_identity(row)
            if identity in seen:
                continue
            seen.add(identity)
            row['sourceEditionHost'] = parsed.hostname
            row['contentHash'] = content_hash(text)
            row.setdefault('id', 'article_' + hashlib.sha256(identity.encode()).hexdigest()[:20])
            flags = []
            if PROMOTIONAL_TITLE.search(str(row.get('title', ''))):
                flags.append('promotional_genre_review')
            if row.get('publishedAtNote'):
                flags.append('publication_timezone_needs_review')
            if parsed.hostname.startswith('biz.'):
                flags.append('publisher_edition_scope_needs_review')
            publication = row.get('publishedAt')
            calendar_basis = 'invalid_or_missing'
            try:
                day, calendar_basis = publication_calendar(publication)
                if not COLLECTION_START <= day <= COLLECTION_END:
                    flags.append('outside_collection_period')
                if calendar_basis == 'naive_timestamp_calendar_unverified' and 'publication_timezone_needs_review' not in flags:
                    flags.append('publication_timezone_needs_review')
            except (TypeError, ValueError):
                flags.append('missing_or_invalid_publication_date')
            try:
                fetched = datetime.fromisoformat(row.get('fetchedAt', '').replace('Z', '+00:00'))
                if fetched.tzinfo is None:
                    flags.append('missing_fetch_timezone')
            except (TypeError, ValueError):
                flags.append('missing_or_invalid_fetch_time')
            topic = row.get('topicId')
            hits = len(re.findall(TOPICS.get(topic, r'(?!)'), text + ' ' + str(row.get('title', ''))))
            if hits < 2:
                flags.append('topic_needs_review')
            if len(text) < 300:
                flags.append('short_body_needs_review')
            if re.search(r'무단전재|무단 전재|저작권자|구독신청|로그인하세요', text):
                flags.append('possible_boilerplate')
            row['collectionAudit'] = {'topicKeywordHits': hits, 'flags': flags,
                                      'publicationCalendarBasis': calendar_basis,
                                      'sourceFile': str(path), 'reviewStatus': 'candidate_only'}
            # A URL or different hash does not establish independent reporting.
            row['sourceGroupId'] = None
            row['sourceGroupIdCandidate'] = 'content:' + row['contentHash']
            articles.append(row)
            count += 1
        source_reports.append({'path': str(path), 'newArticles': count})
    hashes = Counter(row['contentHash'] for row in articles)
    near = []
    if len(articles) > 1:
        from sklearn.feature_extraction.text import TfidfVectorizer
        matrix = TfidfVectorizer(analyzer='char', ngram_range=(3, 5), max_features=30000).fit_transform([r['text'] for r in articles])
        similarity = (matrix @ matrix.T).tocoo()
        for left, right, value in zip(similarity.row, similarity.col, similarity.data):
            if left < right and value >= .92:
                near.append({'leftId': articles[left]['id'], 'rightId': articles[right]['id'],
                             'cosine': round(float(value), 5), 'status': 'duplicate_candidate_not_approved_group'})
    metadata = [{key: row.get(key) for key in ('id', 'publisherId', 'sourceEditionHost', 'url', 'title', 'topicId', 'publishedAt', 'fetchedAt', 'contentHash')}
                | {'characters': len(row['text']), 'audit': row['collectionAudit']} for row in articles]
    report = {'schemaVersion': 'direct-collection-audit-1', 'articles': len(articles),
              'readRecords': read_records, 'explicitlyExcludedArticleIds': excluded_rows,
              'uniqueContentHashes': len(hashes), 'exactDuplicateExtraRows': sum(n-1 for n in hashes.values()),
              'byPublisher': dict(Counter(r['publisherId'] for r in articles)),
              'byPublisherTopic': dict(Counter(r['publisherId'] + ':' + str(r.get('topicId')) for r in articles)),
              'byEditionHost': dict(Counter(r['sourceEditionHost'] for r in articles)),
              'byPublisherYear': dict(Counter(r['publisherId'] + ':' + publication_year(r.get('publishedAt')) for r in articles)),
              'publicationYearBasis': 'KST for aware timestamps; publisher calendar for date-only or naive timestamps',
              'flagCounts': dict(Counter(flag for r in articles for flag in r['collectionAudit']['flags'])),
              'trainingApprovedRows': sum(r.get('usage', {}).get('trainingAllowed') is True for r in articles),
              'humanAxisReviewCompleted': False, 'releaseReady': False,
              'nearDuplicateCandidates': near, 'sources': source_reports, 'articleMetadata': metadata}
    return articles, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, nargs='+', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--exclude-id', action='append', default=[], help='Explicitly reviewed exclusion; original files are unchanged')
    args = parser.parse_args()
    root, target = Path('.sites-runtime').resolve(), args.output_dir.resolve()
    if root not in target.parents:
        parser.error('Output must be a new directory inside ignored .sites-runtime')
    articles, report = audit(args.input, args.exclude_id)
    target.mkdir()
    (target / 'articles.local.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in articles), encoding='utf-8')
    (target / 'report.local.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    fields = ['id', 'publisherId', 'sourceEditionHost', 'url', 'title', 'topicId', 'publishedAt',
              'topicConfirmed', 'sourceGroupId', 'trainingAllowed', 'modelDistributionAllowed', 'reviewedBy', 'reviewedAt', 'notes']
    with (target / 'review.local.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in articles:
            entry = {key: row.get(key, '') for key in fields[:7]}
            entry['notes'] = ';'.join(row['collectionAudit']['flags'])
            writer.writerow(entry)
    print(json.dumps({key: value for key, value in report.items() if key not in ('articleMetadata', 'sources', 'nearDuplicateCandidates')}, ensure_ascii=True))


if __name__ == '__main__':
    main()
