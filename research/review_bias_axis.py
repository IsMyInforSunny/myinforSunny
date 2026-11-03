"""Prepare blind offline article review and report measured reviewer agreement.

The program never supplies article labels, reviewer identities or approvals.
Agreement alone cannot approve the model's political interpretation.
"""
import argparse
import csv
import hashlib
import json
import math
import warnings
from collections import Counter
from pathlib import Path

from train_bias import digest

LABELS = ('left', 'center', 'right', 'undetermined')
FIELDS = ('modelVersion', 'reviewSetId', 'articleId', 'url', 'publicationDate', 'reviewerId', 'label')


def text(value):
    return isinstance(value, str) and bool(value.strip())


def review_corpus(artifact):
    """Choose independent heldout originals; fail closed on train/test leakage."""
    if not isinstance(artifact, dict) or artifact.get('schemaVersion') != 'publisher-coordinate-svm-1':
        raise ValueError('Need a publisher-coordinate SVM artifact')
    if artifact.get('status') not in ('research_only', 'validated'):
        raise ValueError('Unknown artifact status')
    is_real = artifact.get('dataKind') == 'real' and artifact.get('synthetic') is False
    evidence = artifact.get('classifierEvidence', {})
    version, evaluation = evidence.get('modelVersion'), evidence.get('evaluation', {})
    if (not text(version) or evaluation.get('heldOutUnit') != 'original_source_group'
            or evaluation.get('split') != 'held_out_articles'):
        raise ValueError('Need model version and original-group evaluation metadata')
    lineage = artifact.get('lineage')
    if not isinstance(lineage, list) or not lineage:
        raise ValueError('Need nonempty article lineage')
    train_groups, evaluation_groups = set(), set()
    train_hashes, evaluation_hashes = set(), set()
    ids, urls = set(), set()
    for row in lineage:
        if not isinstance(row, dict) or any(not text(row.get(f)) for f in (
                'articleId', 'url', 'publishedAt', 'publisherId', 'sourceGroupId', 'contentHash')):
            raise ValueError('Incomplete lineage row')
        if row['articleId'] in ids or row['url'] in urls:
            raise ValueError('Duplicate lineage article ID or URL')
        ids.add(row['articleId']); urls.add(row['url'])
        if is_real:
            usage = row.get('usage')
            if (not isinstance(usage, dict) or usage.get('trainingAllowed') is not True
                    or usage.get('modelDistributionAllowed') is not True
                    or any(not text(usage.get(k)) for k in ('basisUrl', 'reviewedBy', 'reviewedAt'))):
                raise ValueError('Real lineage needs documented article usage review')
        if row.get('split') == 'training':
            train_groups.add(row['sourceGroupId']); train_hashes.add(row['contentHash'])
        elif row.get('split') == 'evaluation':
            evaluation_groups.add(row['sourceGroupId']); evaluation_hashes.add(row['contentHash'])
        else:
            raise ValueError('Unknown lineage split')
    if train_groups & evaluation_groups or train_hashes & evaluation_hashes:
        raise ValueError('Training/evaluation group or content leakage')
    if (not train_groups or not evaluation_groups
            or set(evaluation.get('trainingSourceGroupIds', [])) != train_groups
            or set(evaluation.get('evaluationSourceGroupIds', [])) != evaluation_groups):
        raise ValueError('Lineage differs from declared evaluation groups')
    ordered = sorted((r for r in lineage if r['split'] == 'evaluation'),
                     key=lambda r: digest([version, r['articleId']]))
    # One vote per original publication group and exact text, including syndication.
    seen_groups, seen_hashes, eligible = set(), set(), []
    for row in ordered:
        if row['sourceGroupId'] in seen_groups or row['contentHash'] in seen_hashes:
            continue
        seen_groups.add(row['sourceGroupId']); seen_hashes.add(row['contentHash'])
        eligible.append(row)
    set_id = digest({'version': version, 'axisId': evidence.get('axisId'),
                     'lineage': sorted(lineage, key=lambda r: r['articleId'])})
    return version, set_id, eligible


def prepare(artifact, output_one, output_two, sample_count=40):
    if type(sample_count) is not int or sample_count < 1:
        raise ValueError('Sample count must be a positive integer')
    if Path(output_one).resolve() == Path(output_two).resolve():
        raise ValueError('Reviewer template paths must differ')
    if Path(output_one).exists() or Path(output_two).exists():
        raise FileExistsError('Reviewer output paths must both be new')
    version, set_id, eligible = review_corpus(artifact)
    rows = [{'modelVersion': version, 'reviewSetId': set_id, 'articleId': r['articleId'],
             'url': r['url'], 'publicationDate': r['publishedAt'], 'reviewerId': '', 'label': ''}
            for r in eligible[:sample_count]]
    for path in (output_one, output_two):
        # Never overwrite filled reviews or templates without an explicit new path.
        with Path(path).open('x', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=FIELDS)
            writer.writeheader(); writer.writerows(rows)
    return {'modelVersion': version, 'reviewSetId': set_id, 'eligibleArticleCount': len(eligible),
            'templateArticleCount': len(rows), 'minimumForRelease': 40}


def read_review(path, version, set_id, eligible):
    lookup = {r['articleId']: r for r in eligible}
    submitted, reviewer_ids = {}, set()
    with Path(path).open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != list(FIELDS):
            raise ValueError('Review CSV must retain the exact template columns')
        for row in reader:
            article_id = row['articleId']
            if article_id not in lookup or article_id in submitted:
                raise ValueError('Unknown or duplicate review article')
            original = lookup[article_id]
            if (row['modelVersion'] != version or row['reviewSetId'] != set_id
                    or row['url'] != original['url'] or row['publicationDate'] != original['publishedAt']):
                raise ValueError('Review model version, review set or article metadata changed')
            reviewer, label = row['reviewerId'].strip(), row['label'].strip()
            if reviewer:
                reviewer_ids.add(reviewer)
            if label and (label not in LABELS or not reviewer):
                raise ValueError('Need explicit reviewer ID and a supported article label')
            submitted[article_id] = label
    if len(reviewer_ids) != 1:
        raise ValueError('Each review CSV must identify exactly one reviewer')
    return next(iter(reviewer_ids)), submitted


def agreement(a, b):
    if not a:
        return {'sampleCount': 0, 'observedAgreement': None, 'cohensKappa': None,
                'undefinedReason': 'no_common_labels'}
    observed = sum(x == y for x, y in zip(a, b)) / len(a)
    # Cohen kappa is undefined when both reviewers use only the same one label.
    if len(set(a) | set(b)) == 1:
        return {'sampleCount': len(a), 'observedAgreement': observed, 'cohensKappa': None,
                'undefinedReason': 'single_shared_category'}
    from sklearn.metrics import cohen_kappa_score
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)
        measured = float(cohen_kappa_score(a, b, labels=list(LABELS)))
    return {'sampleCount': len(a), 'observedAgreement': observed,
            'cohensKappa': measured if math.isfinite(measured) else None,
            'undefinedReason': None if math.isfinite(measured) else 'undefined_expected_agreement'}


def explicit_decision(decision, version, reviewers):
    if not isinstance(decision, dict):
        return False
    if (decision.get('reviewedModelVersion') != version or not text(decision.get('reviewedBy'))
            or not text(decision.get('evidence'))):
        return False
    entries = decision.get('reviewers')
    if not isinstance(entries, list) or len(entries) != 2 or any(not isinstance(e, dict) for e in entries):
        return False
    if any(not text(e.get('reviewerId')) for e in entries):
        return False
    return ({e.get('reviewerId') for e in entries} == set(reviewers)
            and all(e.get('axisApproved') is True and e.get('independentReview') is True
                    and text(e.get('evidence')) for e in entries))


def build_report(artifact, path_one, path_two, decision=None):
    version, set_id, eligible = review_corpus(artifact)
    reviewer_one, labels_one = read_review(path_one, version, set_id, eligible)
    reviewer_two, labels_two = read_review(path_two, version, set_id, eligible)
    if reviewer_one == reviewer_two:
        raise ValueError('Two distinct independent reviewer IDs are required')
    common = sorted(i for i in labels_one.keys() & labels_two.keys() if labels_one[i] and labels_two[i])
    determinate = [i for i in common if labels_one[i] != 'undetermined' and labels_two[i] != 'undetermined']
    all_agreement = agreement([labels_one[i] for i in common], [labels_two[i] for i in common])
    known_agreement = agreement([labels_one[i] for i in determinate], [labels_two[i] for i in determinate])
    reasons = []
    real = artifact.get('dataKind') == 'real' and artifact.get('synthetic') is False
    if not real:
        reasons.append('synthetic_or_unconfirmed_data_kind')
    if len(determinate) < 40:
        reasons.append('fewer_than_40_common_determinate_originals')
    kappa = known_agreement['cohensKappa']
    if kappa is None or not 0 <= kappa <= 1:
        reasons.append('undefined_or_negative_determinate_kappa')
    if artifact.get('validation', {}).get('heldoutAnchorSeparation') is not True:
        reasons.append('model_anchor_validation_incomplete')
    reviewers = [reviewer_one, reviewer_two]
    if not explicit_decision(decision, version, reviewers):
        reasons.append('explicit_independent_axis_approvals_missing')
    metadata = None
    if not reasons:
        metadata = {'status': 'approved', 'reviewedBy': decision['reviewedBy'].strip(),
                    'reviewers': reviewers, 'sampleCount': len(determinate), 'evidence': decision['evidence'].strip(),
                    'reviewedModelVersion': version, 'interReviewerAgreement': kappa}
    eligible_count = len(eligible)
    def coverage(labels):
        marked = sum(bool(value) for value in labels.values())
        return {'submittedRows': len(labels), 'labeledRows': marked,
                'labelCounts': dict(sorted(Counter(v for v in labels.values() if v).items())),
                'eligibleCorpusCoverage': marked / eligible_count if eligible_count else 0}
    return {'schemaVersion': 'bias-axis-human-review-1', 'modelVersion': version, 'reviewSetId': set_id,
            'dataKind': artifact.get('dataKind'), 'status': 'human_review_ready' if metadata else 'research_only',
            'minimumCommonDeterminateSamples': 40, 'eligibleArticleCount': eligible_count,
            'commonArticleCount': len(common), 'commonDeterminateArticleCount': len(determinate),
            'commonArticleIds': common, 'commonDeterminateArticleIds': determinate,
            'reviewFileHashes': [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (path_one, path_two)],
            'commonEligibleCorpusCoverage': len(common) / eligible_count if eligible_count else 0,
            'reviewers': [{'reviewerId': reviewer_one, **coverage(labels_one)},
                          {'reviewerId': reviewer_two, **coverage(labels_two)}],
            'agreementAllCommon': all_agreement, 'agreementDeterminate': known_agreement,
            'humanAxisReview': metadata, 'blockingReasons': reasons,
            'note': 'Agreement is between human article labels; it is not model accuracy. Explicit axis review is separate. No model or manifest is changed.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    make = commands.add_parser('prepare')
    make.add_argument('--artifact', required=True, type=Path)
    make.add_argument('--reviewer-one', required=True, type=Path)
    make.add_argument('--reviewer-two', required=True, type=Path)
    make.add_argument('--sample-count', type=int, default=40)
    report = commands.add_parser('report')
    report.add_argument('--artifact', required=True, type=Path)
    report.add_argument('--reviewer-one', required=True, type=Path)
    report.add_argument('--reviewer-two', required=True, type=Path)
    report.add_argument('--decision', type=Path)
    report.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    artifact = json.loads(args.artifact.read_text(encoding='utf-8-sig'))
    if args.command == 'prepare':
        result = prepare(artifact, args.reviewer_one, args.reviewer_two, args.sample_count)
        print(json.dumps(result, ensure_ascii=False))
    else:
        decision = json.loads(args.decision.read_text(encoding='utf-8-sig')) if args.decision else None
        result = build_report(artifact, args.reviewer_one, args.reviewer_two, decision)
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        print(json.dumps({'status': result['status'], 'commonDeterminateArticleCount': result['commonDeterminateArticleCount'],
                          'blockingReasons': result['blockingReasons']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
