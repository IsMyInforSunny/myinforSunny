"""Validate fetched article metadata plus human reviews before offline SVM training.

No fetching, labelling, rights decisions, splitting, or model activation occurs.
The report contains metadata and hashes only; full article text is exported only
when explicitly requested and every preparation condition is met.
"""
import argparse
import ipaddress
import json
import re
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from train_bias import content_hash, validate, MIN_AXIS_REVIEW_ORIGINALS

KST = timezone(timedelta(hours=9))
DATE_ONLY = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
ISO_TIMESTAMP = re.compile(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]{1,6})?)?(?:Z|[+-][0-9]{2}:[0-9]{2})$')


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def public_url(value):
    if not nonempty(value):
        return False
    try:
        parsed = urlparse(value)
        host = parsed.hostname or ''
        if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port
                or re.search(r'\s', value)
                or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?', host)
                or host.endswith(('.local', '.localhost', '.internal'))
                or host in ('localhost', 'metadata.google.internal')):
            return False
        try:
            ipaddress.ip_address(host)
            return False
        except ValueError:
            pass
        return not any(key.lower() in {'token', 'access_token', 'api_key', 'key', 'signature'}
                       for key, _ in parse_qsl(parsed.query))
    except (ValueError, TypeError):
        return False


def timestamp(value):
    if not nonempty(value):
        raise ValueError('Missing timestamp')
    if DATE_ONLY.fullmatch(value):
        return datetime.combine(date.fromisoformat(value), time.min, tzinfo=KST)
    if not ISO_TIMESTAMP.fullmatch(value):
        raise ValueError('Timestamp must use an extended ISO date and explicit timezone')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return result


def window_boundary(value, *, end=False):
    if not nonempty(value):
        raise ValueError('Missing window boundary')
    if DATE_ONLY.fullmatch(value):
        bound = time.max if end else time.min
        return datetime.combine(date.fromisoformat(value), bound, tzinfo=KST)
    return timestamp(value)


PUBLISHER_HOST_ALIASES = {
    'imnews.imbc.com': 'imbc.com',
    'news.kbs.co.kr': 'kbs.co.kr',
    'news.sbs.co.kr': 'sbs.co.kr',
    'm.khan.co.kr': 'khan.co.kr',
    'news.donga.com': 'donga.com',
}


def canonical_publisher_host(value):
    host = value.strip().lower().removeprefix('www.')
    return PUBLISHER_HOST_ALIASES.get(host, host)


def canonical_url(value):
    if not public_url(value):
        return None
    parsed = urlparse(value)
    host = parsed.hostname.removeprefix('www.')
    query = sorted((key, val) for key, val in parse_qsl(parsed.query, keep_blank_values=True)
                   if not key.lower().startswith('utm_') and key.lower() not in ('fbclid', 'gclid'))
    return urlunparse(('https', host, parsed.path.rstrip('/') or '/', parsed.params, urlencode(query), ''))


def prepare(articles, reviews, manifest):
    """Return the redacted readiness report and reviewed train rows, never labels."""
    if (not isinstance(articles, list) or not articles or not isinstance(reviews, dict)
            or not isinstance(manifest, dict) or not isinstance(manifest.get('profiles'), list)):
        raise ValueError('Need article records and a review document')
    review_rows = reviews.get('articles')
    if not isinstance(review_rows, list) or any(not isinstance(r, dict) for r in review_rows):
        raise ValueError('Review articles must be records')
    by_id = {}
    for row in review_rows:
        if not nonempty(row.get('articleId')) or row['articleId'] in by_id:
            raise ValueError('Review article IDs must be nonempty and unique')
        by_id[row['articleId']] = row
    comparison = reviews.get('comparisonGroup')
    if not nonempty(comparison):
        raise ValueError('Need the human-defined comparison proposition')
    try:
        start = window_boundary(reviews.get('windowStart'))
        end = window_boundary(reviews.get('windowEnd'), end=True)
        if end < start:
            raise ValueError('Invalid window')
    except (ValueError, TypeError):
        raise ValueError('Need an explicit valid publication comparison window') from None

    report_rows, output_rows, article_ids, urls = [], [], set(), set()
    for article in articles:
        if not isinstance(article, dict):
            raise ValueError('Article entries must be records')
        article_id = article.get('id')
        if not nonempty(article_id) or article_id in article_ids:
            raise ValueError('Fetched article IDs must be nonempty and unique')
        article_ids.add(article_id)
        review = by_id.get(article_id, {})
        issues = []
        url = canonical_url(article.get('url'))
        if not url:
            issues.append('public_https_url_missing_or_invalid')
        elif url in urls:
            issues.append('duplicate_canonical_url')
        else:
            urls.add(url)
        publisher = article.get('publisherId')
        if not nonempty(publisher):
            issues.append('publisher_identity_missing')
            publisher_key = None
        else:
            publisher_key = canonical_publisher_host(publisher)
        if publisher_key and url:
            host = urlparse(url).hostname
            if canonical_publisher_host(host) != publisher_key:
                issues.append('publisher_url_mismatch')
        dates = {}
        for field in ('publishedAt', 'fetchedAt'):
            try:
                when = timestamp(article.get(field))
                dates[field] = when
                if field == 'fetchedAt' and when > datetime.now(timezone.utc):
                    issues.append('fetched_at_in_future')
                if field == 'publishedAt' and when > datetime.now(timezone.utc):
                    issues.append('published_at_in_future')
                if field == 'publishedAt':
                    if DATE_ONLY.fullmatch(article['publishedAt']):
                        day_end = when + timedelta(days=1) - timedelta(microseconds=1)
                        if day_end < start or when > end:
                            issues.append('outside_comparison_publication_window')
                        elif when < start or day_end > end:
                            issues.append('publication_precision_insufficient_for_window')
                    elif not start <= when <= end:
                        issues.append('outside_comparison_publication_window')
            except (ValueError, TypeError):
                issues.append(field + '_missing_or_invalid')
        # A date-only fetch record covers its whole Korean calendar day; compare against the day's end.
        if 'fetchedAt' in dates and DATE_ONLY.fullmatch(article['fetchedAt']):
            dates['fetchedAt'] += timedelta(days=1) - timedelta(microseconds=1)
        if len(dates) == 2 and dates['publishedAt'] > dates['fetchedAt']:
            issues.append('publication_after_fetch_time')
        if article.get('provenance') != 'public_article':
            issues.append('fetched_public_article_provenance_missing')
        if not nonempty(article.get('text')):
            issues.append('article_body_missing')
        if not nonempty(article.get('extractionVersion')):
            issues.append('extraction_version_missing')
        if not nonempty(review.get('sourceGroupId')):
            issues.append('human_original_group_review_missing')
        topic = review.get('topicReview', {})
        if (not isinstance(topic, dict) or topic.get('comparisonGroup') != comparison
                or any(not nonempty(topic.get(k)) for k in ('reviewedBy', 'evidence'))):
            issues.append('human_topic_match_review_missing')
        usage = review.get('usage', {})
        if (not isinstance(usage, dict)
                or any(usage.get(k) is not True for k in (
                    'textStorageAllowed', 'trainingAllowed', 'evaluationAllowed', 'modelDistributionAllowed'))
                or not public_url(usage.get('basisUrl'))
                or not nonempty(usage.get('reviewedBy'))):
            issues.append('article_usage_review_incomplete')
        try:
            reviewed_at = timestamp(usage.get('reviewedAt') if isinstance(usage, dict) else None)
            if reviewed_at > datetime.now(timezone.utc):
                issues.append('article_usage_review_date_in_future')
        except (ValueError, TypeError):
            issues.append('article_usage_review_date_missing_or_invalid')
        report_rows.append({'articleId': article_id,
                            'url': url,
                            'publisherId': publisher_key,
                            'publishedAt': article.get('publishedAt') if 'publishedAt' in dates else None,
                            'sourceGroupId': review.get('sourceGroupId') if nonempty(review.get('sourceGroupId')) else None,
                            'contentHash': content_hash(article['text']) if nonempty(article.get('text')) else None,
                            'issues': issues})
        if not issues:
            output_rows.append({k: article[k] for k in ('id', 'text', 'url', 'publishedAt', 'provenance')})
            output_rows[-1]['publisherId'] = publisher_key
            output_rows[-1].update({'comparisonGroup': comparison, 'sourceGroupId': review['sourceGroupId'],
                                   'url': url,
                                   'usage': usage, 'fetchedAt': article['fetchedAt'],
                                   'extractionVersion': article['extractionVersion'], 'topicReview': topic})

    extra_reviews = sorted(set(by_id) - article_ids)
    blockers = []
    if len(output_rows) != len(articles):
        blockers.append('article_preparation_incomplete')
    if extra_reviews:
        blockers.append('reviews_reference_unknown_articles')
    training_validation_error = None
    # Rows carry canonical publisher IDs, so the manifest must be compared in the same form.
    # Two profiles collapsing onto one canonical ID are rejected by validate() as a duplicate.
    canonical_manifest = {**manifest, 'profiles': [
        {**p, 'publisherId': canonical_publisher_host(p['publisherId'])}
        if isinstance(p, dict) and nonempty(p.get('publisherId')) else p
        for p in manifest['profiles']]}
    if not blockers:
        try:
            validate(output_rows, canonical_manifest, synthetic=False)
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            blockers.append('existing_training_validation_failed')
            training_validation_error = str(error) if isinstance(error, ValueError) else 'Malformed orientation manifest'
    counts = Counter(row['publisherId'] for row in output_rows)
    anchors = {canonical_publisher_host(p['publisherId']) for p in manifest.get('profiles', [])
               if isinstance(p, dict) and p.get('orientation') in ('left', 'right') and nonempty(p.get('publisherId'))}
    report = {'schemaVersion': 'bias-corpus-preparation-1', 'status': 'train_input_ready' if not blockers else 'pending_review',
              'comparisonGroup': comparison, 'articleCount': len(articles), 'reviewedArticleCount': len(output_rows),
              'publisherCounts': dict(sorted(counts.items())), 'missingAnchorPublishers': sorted(anchors - set(counts)),
              'independentOriginalGroupCount': len({row['sourceGroupId'] for row in output_rows}),
              'humanAxisReviewMinimumOriginals': MIN_AXIS_REVIEW_ORIGINALS, 'groupSplitVerified': None,
              'unknownReviewedArticleIds': extra_reviews, 'blockingReasons': blockers,
              'trainingValidationError': training_validation_error, 'articles': report_rows,
              'releaseReady': False,
              'note': 'Metadata validation does not authenticate human reviews or rights. No model or political labels are created. Independent model-axis review remains required.'}
    return report, output_rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='Fetched article JSONL, kept locally')
    parser.add_argument('--reviews', type=Path, required=True, help='Actual human topic/origin/usage review JSON')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True, help='New metadata-only report path')
    parser.add_argument('--export', type=Path, help='Explicit local JSONL output including article text')
    args = parser.parse_args()
    paths = [args.report] + ([args.export] if args.export else [])
    if len({p.resolve() for p in paths}) != len(paths) or any(p.exists() for p in paths):
        parser.error('Output paths must be distinct and new; existing reviews or articles are never overwritten')
    if args.export and not str(args.export).endswith('.local.jsonl'):
        parser.error('Article text export must use a .local.jsonl path and stay outside Git')
    try:
        articles = [json.loads(line) for line in args.input.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
        reviews = json.loads(args.reviews.read_text(encoding='utf-8-sig'))
        manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        report, rows = prepare(articles, reviews, manifest)
    except (ValueError, TypeError):
        parser.error('Invalid input metadata; no article content is printed')
    with args.report.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
    if args.export:
        if report['status'] != 'train_input_ready':
            parser.error('Preparation is incomplete; metadata report saved, article text export refused')
        with args.export.open('x', encoding='utf-8') as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n')
    print(json.dumps({'status': report['status'], 'articleCount': report['articleCount'],
                      'reviewedArticleCount': report['reviewedArticleCount'], 'releaseReady': False}))


if __name__ == '__main__':
    main()
