"""Plan article collection from existing SVM constraints, without fetching or approval.

Counts are planning lower bounds, not promised model accuracy or completion dates.
Optional progress uses only a preparation report's reviewed metadata, never text.
"""
import argparse
import json
import math
import re
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
from urllib.parse import urlparse

from prepare_bias_corpus import canonical_publisher_host, canonical_url, nonempty, public_url
from train_bias import EVALUATION_FRACTION, MIN_AXIS_REVIEW_ORIGINALS, MIN_SAMPLES


def minimum_originals(publisher_count, review_samples):
    """Global group bound; one group may contain articles from several publishers."""
    if type(publisher_count) is not int or publisher_count < 2:
        raise ValueError('Need at least two participating publishers')
    fraction = Fraction(str(EVALUATION_FRACTION))
    required_evaluation = max(review_samples, MIN_SAMPLES)
    count = max(MIN_SAMPLES * 2,
                math.floor(Fraction(required_evaluation - 1) / fraction) + 1)
    while count - math.ceil(count * fraction) < MIN_SAMPLES:
        count += 1
    return count


def collection_plan(manifest, preparation_report=None, review_samples=MIN_AXIS_REVIEW_ORIGINALS):
    if type(review_samples) is not int or review_samples < MIN_AXIS_REVIEW_ORIGINALS:
        raise ValueError('Do not lower the independent human-review minimum')
    if not isinstance(manifest, dict) or not nonempty(manifest.get('axisId')):
        raise ValueError('Need an orientation manifest with an axis ID')
    profiles = manifest.get('profiles')
    if not isinstance(profiles, list) or not profiles:
        raise ValueError('Need orientation profiles')
    orientations = {}
    for profile in profiles:
        if (not isinstance(profile, dict) or not nonempty(profile.get('publisherId'))
                or profile.get('orientation') not in ('left', 'right', 'unspecified', 'excluded')):
            raise ValueError('Invalid orientation profile')
        publisher = canonical_publisher_host(profile['publisherId'])
        if (not public_url('https://' + publisher + '/')
                or urlparse('https://' + publisher).hostname != publisher or publisher in orientations):
            raise ValueError('Publisher identities must be valid and canonically unique')
        orientations[publisher] = profile['orientation']
    if not {'left', 'right'}.issubset(orientations.values()):
        raise ValueError('Both unchanged orientation anchor groups are required')
    anchors = sorted(p for p, orientation in orientations.items() if orientation in ('left', 'right'))
    by_publisher, original_groups = defaultdict(set), set()
    observed = preparation_report is not None
    comparison = None
    blockers = None
    if observed:
        if (not isinstance(preparation_report, dict)
                or preparation_report.get('schemaVersion') != 'bias-corpus-preparation-1'
                or not isinstance(preparation_report.get('articles'), list)
                or not nonempty(preparation_report.get('comparisonGroup'))
                or not isinstance(preparation_report.get('blockingReasons'), list)):
            raise ValueError('Need an existing corpus-preparation metadata report')
        comparison = preparation_report['comparisonGroup']
        # Do not echo free-form input, body, URL, reviewer identity, or error strings.
        blockers = len(preparation_report['blockingReasons'])
        ids, urls, hash_groups = set(), set(), {}
        for row in preparation_report['articles']:
            if not isinstance(row, dict) or not isinstance(row.get('issues'), list):
                raise ValueError('Malformed preparation report row')
            if row['issues']:
                continue
            if any(not nonempty(row.get(key)) for key in ('articleId', 'publisherId', 'sourceGroupId', 'contentHash', 'url')):
                raise ValueError('Reviewed row lacks original-source metadata')
            publisher = canonical_publisher_host(row['publisherId'])
            url = canonical_url(row['url'])
            if (publisher not in orientations or orientations[publisher] == 'excluded' or not url
                    or canonical_publisher_host(urlparse(url).hostname) != publisher
                    or not re.fullmatch(r'[a-f0-9]{64}', row['contentHash'])
                    or row['articleId'] in ids or url in urls):
                raise ValueError('Inconsistent reviewed article metadata')
            group = row['sourceGroupId'].strip()
            if hash_groups.setdefault(row['contentHash'], group) != group:
                raise ValueError('Identical article content cannot count as independent originals')
            ids.add(row['articleId']); urls.add(url)
            by_publisher[publisher].add(group)
            original_groups.add(group)
    participating = sorted(set(anchors) | {p for p, groups in by_publisher.items() if groups})
    lower_bound = minimum_originals(len(participating), review_samples)
    balanced_target = max(MIN_SAMPLES * 2, (lower_bound + len(participating) - 1) // len(participating))
    fraction = Fraction(str(EVALUATION_FRACTION))
    # This conservative allocation assumes a different original for every article.
    # It must leave at least three train and evaluation slots per participant.
    while True:
        total = balanced_target * len(participating)
        evaluation_slots = math.ceil(total * fraction)
        if min(evaluation_slots, total - evaluation_slots) >= MIN_SAMPLES * len(participating):
            break
        balanced_target += 1
    targets = []
    for publisher in participating:
        count = len(by_publisher[publisher]) if observed else None
        targets.append({'publisherId': publisher, 'isRequiredAnchor': publisher in anchors,
                        'minimumBeforeGroupSplit': MIN_SAMPLES * 2,
                        'balancedCollectionTarget': balanced_target,
                        'observedReviewedOriginals': count,
                        'missingForMinimum': max(0, MIN_SAMPLES * 2 - count) if observed else None,
                        'missingForBalancedTarget': max(0, balanced_target - count) if observed else None})
    return {'schemaVersion': 'bias-collection-plan-1', 'status': 'planning_only',
            'axisId': manifest['axisId'], 'sameComparisonGroupRequired': True,
            'comparisonGroup': comparison, 'anchorPublisherCount': len(anchors),
            'participatingPublisherCount': len(participating),
            'minimumTrainArticlesPerPublisher': MIN_SAMPLES,
            'minimumEvaluationArticlesPerPublisher': MIN_SAMPLES,
            'evaluationGroupFraction': EVALUATION_FRACTION,
            'humanReview': {'independentReviewers': 2, 'minimumCommonDeterminateOriginals': review_samples,
                            'minimumLabelDecisions': 2 * review_samples},
            'evaluationSplitOriginalLowerBound': lower_bound,
            'balancedAnchorOriginalTarget': balanced_target * len(anchors),
            'balancedPublisherArticleTarget': balanced_target * len(participating),
            'balancedPlanAssumesDistinctOriginalsAcrossPublishers': True,
            'balancedPlanEvaluationSlots': math.ceil(balanced_target * len(participating) * fraction),
            'publisherTargets': targets,
            'optionalPublishers': sorted(p for p, o in orientations.items() if o == 'unspecified'),
            'excludedPublishers': sorted(p for p, o in orientations.items() if o == 'excluded'),
            'observedReviewedOriginalGroups': len(original_groups) if observed else None,
            'originalGroupsMissingForSplitLowerBound': max(0, lower_bound - len(original_groups)) if observed else None,
            'preparationBlockerCount': blockers,
            'groupSplitVerified': None, 'eligibleHeldoutOriginals': None, 'releaseReady': False,
            'note': 'Planning bounds only. More articles may be required for publisher balance, usable split, determinate human reviews, and axis quality. Rights, topic, origin, actual model and release review remain required. No completion date or accuracy is estimated.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--preparation-report', type=Path)
    parser.add_argument('--review-samples', type=int, default=MIN_AXIS_REVIEW_ORIGINALS)
    parser.add_argument('--output', type=Path, help='New metadata-only JSON plan, never overwritten')
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
        report = json.loads(args.preparation_report.read_text(encoding='utf-8-sig')) if args.preparation_report else None
        result = collection_plan(manifest, report, args.review_samples)
        output = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
        if args.output:
            with args.output.open('x', encoding='utf-8') as stream:
                stream.write(output + '\n')
        else:
            print(output)
    except (ValueError, TypeError, OSError):
        parser.error('Invalid inputs or output path; no article content is printed and existing files are not overwritten')


if __name__ == '__main__':
    main()
