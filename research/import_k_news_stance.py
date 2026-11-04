"""Import a locally received K-News-Stance JSON file as unreviewed article intake.

No network, original-source decisions, usage approvals, model training, or axis
review occurs. Article text is written only beneath this checkout's ignored
.sites-runtime directory. Reports and stdout contain metadata, never article text.
"""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from prepare_bias_corpus import canonical_publisher_host, canonical_url, timestamp
from train_bias import content_hash

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_URL = 'https://github.com/ssu-humane/K-News-Stance'
INSTRUCTIONS_URL = DATASET_URL + '/blob/main/data/instructions.md'
LICENSE = {'identifier': 'CC-BY-NC-4.0', 'basisUrl': DATASET_URL,
           'licenseUrl': 'https://creativecommons.org/licenses/by-nc/4.0/',
           'status': 'published_dataset_license_not_article_usage_approval'}
EXTRACTION_VERSION = 'k-news-stance-json-import-1'
MAX_FILE_BYTES = 150 * 1024 * 1024
MAX_ROWS = 10000
STANCE_LABELS = {'supportive', 'neutral', 'oppositional'}
# Whole-brand aliases only. A publisher's name embedded in another company name
# must not assign that publisher. URL identity is checked independently below.
BRANDS = {
    '한겨레': 'hani.co.kr', '한겨레신문': 'hani.co.kr',
    '경향신문': 'khan.co.kr', '경향': 'khan.co.kr',
    '오마이뉴스': 'ohmynews.com', '프레시안': 'pressian.com',
    '조선일보': 'chosun.com', '중앙일보': 'joongang.co.kr',
    '동아일보': 'donga.com', '한국일보': 'hankookilbo.com',
    'kbs': 'kbs.co.kr', 'kbs뉴스': 'kbs.co.kr',
    'mbc': 'imbc.com', 'mbc뉴스': 'imbc.com',
    'sbs': 'sbs.co.kr', 'sbs뉴스': 'sbs.co.kr',
    'ebs': 'ebs.co.kr', 'ebs뉴스': 'ebs.co.kr',
    '연합뉴스': 'yna.co.kr', 'zdnetkorea': 'zdnet.co.kr',
    '지디넷코리아': 'zdnet.co.kr', '전자신문': 'etnews.com',
}
SEPARATE_BRAND_HOSTS = {'biz.chosun.com', 'it.chosun.com'}


def metadata_string(value, limit):
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= limit
            and not re.search(r'[\x00-\x1f\x7f]', value))


def source_id_digest(value):
    # Even a malformed dataset ID is never copied to a report or error message.
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def publication(value):
    """Normalize explicit calendar separators without inventing a clock/timezone."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    calendar = re.fullmatch(r'(\d{4})[./-](\d{1,2})[./-](\d{1,2})\.?', candidate)
    if calendar:
        candidate = f'{int(calendar[1]):04d}-{int(calendar[2]):02d}-{int(calendar[3]):02d}'
    try:
        when = timestamp(candidate)
    except (ValueError, TypeError, OverflowError):
        return None
    return candidate if when <= datetime.now(timezone.utc) else None


def publisher_identity(name, url, profiles):
    if not metadata_string(name, 100):
        return None, 'publisher_name_missing_or_invalid'
    brand = BRANDS.get(re.sub(r'\s+', '', name).casefold())
    if not brand:
        return None, 'unknown_publisher_name'
    if brand not in profiles or profiles[brand] == 'excluded':
        return None, 'publisher_outside_active_manifest'
    host = urlparse(url).hostname or ''
    if host in SEPARATE_BRAND_HOSTS or not (host == brand or host.endswith('.' + brand)):
        return None, 'publisher_url_mismatch'
    return brand, None


def import_records(records, manifest, *, issue=None, genre=None, imported_at=None):
    if not isinstance(records, list) or not records or len(records) > MAX_ROWS:
        raise ValueError('Dataset must contain 1 to 10000 JSON article records')
    if not isinstance(manifest, dict) or not isinstance(manifest.get('profiles'), list):
        raise ValueError('Need the existing publisher orientation manifest')
    profiles = {}
    for profile in manifest['profiles']:
        if not isinstance(profile, dict) or not metadata_string(profile.get('publisherId'), 253):
            raise ValueError('Malformed publisher manifest')
        publisher = canonical_publisher_host(profile['publisherId'])
        if publisher in profiles or profile.get('orientation') not in {'left', 'right', 'unspecified', 'excluded'}:
            raise ValueError('Duplicate or invalid publisher manifest entry')
        profiles[publisher] = profile['orientation']
    imported_at = imported_at or datetime.now(timezone.utc).isoformat()
    accepted, rejected, seen_ids, seen_urls = [], [], set(), set()
    groups, labels, reasons = defaultdict(list), Counter(), Counter()
    filtered = 0
    for number, raw in enumerate(records, 1):
        if not isinstance(raw, dict):
            rejected.append({'rowNumber': number, 'issues': ['article_record_invalid']})
            reasons['article_record_invalid'] += 1
            continue
        if (issue is not None and raw.get('issue') != issue) or (genre is not None and raw.get('genre') != genre):
            filtered += 1
            continue
        problems = []
        raw_id = raw.get('id')
        valid_id = (isinstance(raw_id, str) and bool(raw_id.strip()) and len(raw_id) <= 200
                    or type(raw_id) is int and raw_id >= 0)
        identity = source_id_digest(raw_id)
        if not valid_id:
            problems.append('dataset_id_missing_or_invalid')
        elif identity in seen_ids:
            problems.append('duplicate_dataset_id')
        else:
            seen_ids.add(identity)
        url = canonical_url(raw.get('link'))
        if not url:
            problems.append('public_https_url_missing_or_invalid')
        elif url in seen_urls:
            problems.append('duplicate_canonical_url')
        else:
            seen_urls.add(url)
        publisher, publisher_problem = publisher_identity(raw.get('news_outlet'), url, profiles) if url else (None, None)
        if publisher_problem:
            problems.append(publisher_problem)
        published = publication(raw.get('publish_date'))
        if not published:
            problems.append('publication_date_missing_invalid_or_future')
        text = raw.get('article')
        if not isinstance(text, str) or not text.strip() or len(text) > 100000:
            problems.append('article_body_missing_or_oversized')
        if not metadata_string(raw.get('issue'), 500):
            problems.append('dataset_issue_missing_or_invalid')
        if not metadata_string(raw.get('genre'), 80):
            problems.append('dataset_genre_missing_or_invalid')
        if problems:
            rejected.append({'rowNumber': number, 'sourceIdDigest': identity, 'issues': problems})
            reasons.update(problems)
            continue
        article_id = 'kns_' + identity[:32]
        text_hash = content_hash(text)
        # Identical normalized text is a candidate shared original. Different
        # hashes do not establish independent originals or exclude wire reuse.
        candidate = 'content-sha256:' + text_hash
        stance = raw.get('article_stance')
        original_stance = stance if isinstance(stance, str) and len(stance) <= 100 else None
        labels[stance if isinstance(stance, str) and stance in STANCE_LABELS else 'missing_or_invalid'] += 1
        record = {
            'id': article_id, 'publisherId': publisher, 'url': url,
            'publishedAt': published, 'text': text, 'provenance': 'public_article',
            'extractionVersion': EXTRACTION_VERSION,
            # File import time is not a publisher fetch timestamp.
            'fetchedAt': None, 'importedAt': imported_at, 'intakeMethod': 'licensed_dataset_import',
            'contentHash': text_hash, 'sourceGroupIdCandidate': candidate,
            'sourceGroupId': None, 'reviewStatus': 'unreviewed_intake',
            'trainingApproved': False, 'modelDistributionApproved': False,
            'usageReview': None, 'topicReview': None,
            'dataset': {'id': 'K-News-Stance', 'sourceId': raw_id, 'sourceIdDigest': identity, 'sourceUrl': DATASET_URL,
                        'newsOutlet': raw['news_outlet'], 'publishDateOriginal': raw['publish_date'],
                        'licenseCandidate': LICENSE, 'issue': raw['issue'], 'genre': raw['genre'],
                        'articleStance': original_stance, 'articleStanceValid': stance in STANCE_LABELS if isinstance(stance, str) else False,
                        'stanceIsPoliticalOrientation': False},
        }
        # Existing preparation accepts only its reviewed host aliases. Preserve
        # the actual source URL and flag a missing alias rather than rewriting it.
        if canonical_publisher_host(urlparse(url).hostname or '') != publisher:
            record['preparationWarnings'] = ['publisher_host_alias_review_required']
        accepted.append(record)
        groups[(raw['issue'], raw['genre'])].append(record)
    duplicate_hashes = Counter(row['contentHash'] for row in accepted)
    group_report = []
    for (target, form), rows in sorted(groups.items()):
        group_report.append({'issue': target, 'genre': form,
                             'articleCount': len(rows),
                             'publisherCounts': dict(sorted(Counter(r['publisherId'] for r in rows).items())),
                             'publishedDates': sorted({r['publishedAt'] for r in rows}),
                             'exactContentHashCandidateCount': len({r['contentHash'] for r in rows}),
                             'independentOriginalCount': None, 'topicReviewStatus': 'pending_review'})
    report = {
        'schemaVersion': 'k-news-stance-intake-1', 'status': 'pending_review',
        'datasetUrl': DATASET_URL, 'licenseCandidate': LICENSE,
        'inputRecordCount': len(records), 'filteredOutCount': filtered,
        'acceptedArticleCount': len(accepted), 'rejectedArticleCount': len(rejected),
        'publisherCounts': dict(sorted(Counter(r['publisherId'] for r in accepted).items())),
        'originalStanceCounts': dict(sorted(labels.items())),
        'exactDuplicateHashGroups': sum(n > 1 for n in duplicate_hashes.values()),
        'independentOriginalCount': None, 'approvedTrainingArticleCount': 0,
        'releaseReady': False, 'modelCreated': False,
        'rejectionReasons': dict(sorted(reasons.items())), 'rejectedRecords': rejected,
        'groups': group_report,
        'blockingReasons': ['source_acquisition_metadata_review_required', 'original_group_review_required',
                            'topic_and_window_review_required', 'article_usage_review_required',
                            'separate_model_axis_review_required'],
        'note': 'Original stance labels are retained, not converted to political labels or humanAxisReview approval. File import time is not publisher fetch time. Distinct hashes are not independent originals.',
    }
    reviews = {'comparisonGroup': None, 'windowStart': None, 'windowEnd': None,
               'articles': [{'articleId': row['id'], 'sourceGroupId': None,
                             'sourceGroupIdCandidate': row['sourceGroupIdCandidate'],
                             'topicReview': None, 'usage': None} for row in accepted]}
    return accepted, report, reviews


def output_directory(value):
    project = PROJECT_ROOT.resolve()
    runtime = (project / '.sites-runtime').resolve()
    target = Path(value).resolve()
    if not runtime.is_relative_to(project) or target == runtime or not target.is_relative_to(runtime):
        raise ValueError('Output directory must be a new subdirectory of this checkout .sites-runtime')
    if target.exists():
        raise ValueError('Output directory already exists; imported articles and reviews are never overwritten')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog=f'Official dataset access: {INSTRUCTIONS_URL}')
    parser.add_argument('--input', type=Path, help='Local k-news-stance.json received from the official download form')
    parser.add_argument('--output-dir', help='New ignored directory, e.g. .sites-runtime/k-news-stance-intake')
    parser.add_argument('--manifest', type=Path, default=PROJECT_ROOT / 'research/bias-orientation.example.json')
    parser.add_argument('--issue', help='Exact source issue value to import; omitted means all issues')
    parser.add_argument('--genre', help='Exact source genre value to import; omitted means all genres')
    args = parser.parse_args()
    if not args.input or not args.input.is_file():
        parser.error('Need the local k-news-stance.json file. It is not in the public repository. '
                     f'Request it using the official instructions: {INSTRUCTIONS_URL}. No download or application was performed.')
    if not args.output_dir:
        parser.error('Specify a new --output-dir beneath this checkout .sites-runtime; article text is never printed')
    try:
        target = output_directory(args.output_dir)
        if args.input.stat().st_size > MAX_FILE_BYTES:
            raise ValueError('Input exceeds the 150 MiB import ceiling')
        payload = json.loads(args.input.read_text(encoding='utf-8-sig'))
        if isinstance(payload, dict):
            payload = payload.get('articles', payload.get('data'))
        manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        articles, report, reviews = import_records(payload, manifest, issue=args.issue, genre=args.genre)
    except (OSError, UnicodeError, ValueError, TypeError, OverflowError):
        parser.error('Invalid input, manifest, or output location. Article text and raw parse errors are withheld; use the documented JSON schema and a new ignored output directory.')
    try:
        target.mkdir(parents=True, exist_ok=False)
        with (target / 'articles.local.jsonl').open('x', encoding='utf-8') as stream:
            for article in articles:
                stream.write(json.dumps(article, ensure_ascii=False, allow_nan=False) + '\n')
        for filename, value in [('intake-report.local.json', report), ('reviews.local.json', reviews)]:
            with (target / filename).open('x', encoding='utf-8') as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
    except (OSError, ValueError):
        parser.error('Could not finish writing local intake. Existing files were not overwritten; inspect the output directory before trying a different new directory.')
    print(json.dumps({'status': report['status'], 'acceptedArticleCount': report['acceptedArticleCount'],
                      'rejectedArticleCount': report['rejectedArticleCount'], 'groupCount': len(report['groups']),
                      'approvedTrainingArticleCount': 0, 'modelCreated': False, 'releaseReady': False}))


if __name__ == '__main__':
    main()
