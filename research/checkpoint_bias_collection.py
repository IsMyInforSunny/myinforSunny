"""Offline cumulative article quality and SVM checkpoints through 3,000 rows.

All article bodies, holdout identities and experimental weights remain ignored
local research artifacts. These measurements classify publisher identity, not
political bias or factual truth. No production model or approval is produced.
"""
import argparse
import contextlib
import hashlib
import io
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.svm import LinearSVC

from audit_collected_articles import TOPICS, PROMOTIONAL_TITLE, article_identity, audit, content_hash
from corpus_dates import COLLECTION_END, COLLECTION_START, publication_day_kst
from diagnose_publisher_corpus import diagnose, masked_text
from train_bias import grouped_topic_split

CHECKPOINTS = (300, 600, 900, 1000, 1200, 1500, 1800, 2000, 2100, 2400, 2700, 3000)
BAD_FLAGS = {'outside_collection_period', 'missing_or_invalid_publication_date',
             'topic_needs_review', 'short_body_needs_review', 'promotional_genre_review'}


def dump(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def intake(path):
    rows, excluded = [], Counter()
    identities, hashes, ids = set(), set(), set()
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if PROMOTIONAL_TITLE.search(str(row.get('title', ''))):
            excluded['promotional_genre_review'] += 1
            continue
        text = row.get('text', row.get('body'))
        if not isinstance(text, str) or len(text.strip()) < 300:
            excluded['missing_or_short_body'] += 1
            continue
        try:
            day = publication_day_kst(row.get('publishedAt'))
            if not COLLECTION_START <= day <= COLLECTION_END:
                raise ValueError('outside date range')
        except (TypeError, ValueError):
            excluded['missing_or_outside_publication_date'] += 1
            continue
        acquisition = row.get('acquisition') or {}
        restrictions = ' '.join(str(acquisition.get(k, '')) for k in
                                ('pageMetaRobots', 'xRobotsTag', 'robotsMeta'))
        if re.search(r'\b(?:noai|nosnippet|noarchive)\b', restrictions, re.I):
            excluded['explicit_page_restriction'] += 1
            continue
        if row.get('topicId') not in TOPICS:
            excluded['unknown_topic'] += 1
            continue
        parsed = urlparse(row.get('url', ''))
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            excluded['unsafe_or_missing_source_url'] += 1
            continue
        row['text'] = text
        identity = article_identity(row)
        dailian = re.search(r'/news/view/(\d+)', parsed.path)
        if parsed.hostname.endswith('dailian.co.kr') and dailian:
            identity = 'dailian.co.kr:' + dailian[1]
        digest = content_hash(text)
        identifier = row.get('id') or 'article_' + hashlib.sha256(identity.encode()).hexdigest()[:20]
        if identity in identities or digest in hashes or identifier in ids:
            excluded['duplicate_url_body_or_id'] += 1
            continue
        row['id'], row['contentHash'] = identifier, digest
        rows.append(row)
        identities.add(identity)
        hashes.add(digest)
        ids.add(identifier)
    return rows, dict(excluded)


def components(rows, pairs):
    parents = {row['id']: row['id'] for row in rows}

    def find(key):
        while parents[key] != key:
            parents[key] = parents[parents[key]]
            key = parents[key]
        return key

    for pair in pairs:
        left, right = find(pair['leftId']), find(pair['rightId'])
        if left != right:
            parents[right] = left
    return {key: find(key) for key in parents}


def candidate_rows(rows):
    usable = []
    for row in rows:
        if BAD_FLAGS.intersection(row['collectionAudit']['flags']):
            continue
        host = row['sourceEditionHost'].removeprefix('www.').removeprefix('m.')
        usable.append({**row, 'publisherId': host, 'comparisonGroup': row['topicId'],
                       'sourceGroupId': 'candidate:' + row['contentHash']})
    counts = Counter(r['publisherId'] for r in usable)
    eligible = {p for p, count in counts.items() if count >= 6
                and len({r['topicId'] for r in usable if r['publisherId'] == p}) >= 4}
    return [r for r in usable if r['publisherId'] in eligible]


def unique_components(rows, groups):
    seen, out = set(), []
    for row in rows:
        group = groups[row['id']]
        if group not in seen:
            out.append(row)
            seen.add(group)
    return out


def freeze_holdout(base, rows, groups):
    path = base / 'frozen-evaluation.local.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    eligible = candidate_rows(unique_components(rows, groups))
    train, test = grouped_topic_split(eligible, seed=42)
    value = {'schemaVersion': 'collection-frozen-evaluation-1', 'seed': 42,
             'sourceCheckpoint': 300, 'classes': sorted({r['publisherId'] for r in eligible}),
             'trainingTopics': sorted({eligible[i]['topicId'] for i in train}),
             'evaluationTopics': sorted({eligible[i]['topicId'] for i in test}),
             'heldout': [{'id': eligible[i]['id'], 'contentHash': eligible[i]['contentHash'],
                          'publisherId': eligible[i]['publisherId']} for i in test],
             'politicalAxisApproved': False, 'releaseReady': False}
    dump(path, value)
    return value


def fixed_benchmark(rows, groups, frozen):
    usable = candidate_rows(rows)
    by_id = {r['id']: r for r in usable}
    heldout = []
    for record in frozen['heldout']:
        row = by_id.get(record['id'])
        if row is None or row['contentHash'] != record['contentHash'] or row['publisherId'] != record['publisherId']:
            raise ValueError('Frozen evaluation article changed, disappeared or became ineligible')
        heldout.append(row)
    forbidden_groups = {groups[r['id']] for r in heldout}
    train_candidates = [r for r in usable if r['publisherId'] in frozen['classes']
                        and r['topicId'] in frozen['trainingTopics']]
    train = unique_components([r for r in train_candidates if groups[r['id']] not in forbidden_groups], groups)
    if {r['publisherId'] for r in train} != set(frozen['classes']):
        raise ValueError('Fixed benchmark missing training class after duplicate withholding')
    train_counts = Counter(r['publisherId'] for r in train)
    test_counts = Counter(r['publisherId'] for r in heldout)
    majority = sorted(train_counts, key=lambda p: (-train_counts[p], p))[0]
    result = {'task': 'publisher_identity_not_political_bias', 'seed': 42,
              'trainingRows': len(train), 'evaluationRows': len(heldout),
              'trainingTopics': frozen['trainingTopics'], 'evaluationTopics': frozen['evaluationTopics'],
              'fixedEvaluationIdsDigest': hashlib.sha256('\n'.join(r['id'] for r in heldout).encode()).hexdigest(),
              'classes': frozen['classes'], 'trainingByPublisher': dict(train_counts),
              'evaluationByPublisher': dict(test_counts),
              'majorityClassBaseline': {'trainingMajorityPublisher': majority,
                                       'accuracy': test_counts[majority] / len(heldout)},
              'crossSplitNearDuplicateTrainingRowsWithheld': sum(groups[r['id']] in forbidden_groups for r in train_candidates),
              'otherEvaluationTopicRowsWithheld': sum(r['topicId'] in frozen['evaluationTopics']
                                                     and r['id'] not in {t['id'] for t in heldout} for r in usable),
              'exactContentHashOverlap': bool({r['contentHash'] for r in train} & {r['contentHash'] for r in heldout}),
              'nearDuplicateThreshold': .92, 'variants': {}, 'releaseReady': False,
              'limitations': ['source_independence_unreviewed', 'article_usage_unapproved',
                             'topic_and_genre_review_pending', 'fixed_evaluation_reused_not_final_blind_test']}
    for variant in ('raw', 'publisher_markers_removed'):
        transform = (lambda text: text) if variant == 'raw' else masked_text
        vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                     sublinear_tf=True, norm='l2', max_features=20000)
        x_train = vectorizer.fit_transform([transform(r['text']) for r in train])
        x_test = vectorizer.transform([transform(r['text']) for r in heldout])
        labels = [r['publisherId'] for r in heldout]
        model = LinearSVC(C=1.0, class_weight='balanced', random_state=42, max_iter=10000)
        model.fit(x_train, [r['publisherId'] for r in train])
        prediction = model.predict(x_test)
        result['variants'][variant] = {'publisherAccuracy': float(accuracy_score(labels, prediction)),
            'publisherMacroF1': float(f1_score(labels, prediction, labels=frozen['classes'], average='macro', zero_division=0)),
            'confusionMatrix': confusion_matrix(labels, prediction, labels=frozen['classes']).tolist(),
            'featureCount': len(vectorizer.vocabulary_),
            'perPublisherAccuracy': {p: float(np.mean(prediction[np.array(labels) == p] == p)) for p in frozen['classes']}}
    return result


def run(base, requested=None):
    rows, excluded = intake(base / 'articles.local.jsonl')
    reached = [n for n in CHECKPOINTS if n <= len(rows) and (requested is None or n == requested)]
    if requested and requested not in reached:
        raise ValueError(f'Checkpoint {requested} has not been reached: {len(rows)} accepted unique articles')
    if requested and requested > 300 and not (base / 'frozen-evaluation.local.json').exists():
        raise ValueError('Run checkpoint 300 first to freeze evaluation before later checkpoints')
    summaries = []
    for size in reached:
        output = base / f'checkpoint-{size}'
        signature = hashlib.sha256('\n'.join(r['contentHash'] for r in rows[:size]).encode()).hexdigest()
        summary_path = output / 'summary.local.json'
        if summary_path.exists():
            summary = json.loads(summary_path.read_text(encoding='utf-8'))
            if summary['inputSignature'] != signature:
                raise ValueError(f'Existing checkpoint {size} input changed; refusing overwrite')
            summaries.append(summary)
            continue
        output.mkdir(exist_ok=True)
        input_path = output / 'articles.local.jsonl'
        input_path.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows[:size]), encoding='utf-8')
        audited, quality = audit([input_path])
        dump(output / 'quality.local.json', quality)
        groups = components(audited, quality['nearDuplicateCandidates'])
        diagnostic_rows = unique_components(audited, groups)
        experiment = output / 'topic-heldout-diagnostic'
        experiment.mkdir(exist_ok=True)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                diagnostic = diagnose(diagnostic_rows, experiment)
            diagnostic_summary = {'status': 'measured', 'trainingRows': diagnostic['trainingRows'],
                'evaluationRows': diagnostic['evaluationRows'], 'variants': {
                    k: {field: v[field] for field in ('publisherAccuracy', 'publisherMacroF1')}
                    for k, v in diagnostic['variants'].items()}}
        except ValueError as error:
            # A newly sampled sparse publisher can make the variable-class
            # experiment infeasible. Preserve that failure without suppressing
            # the independent, fixed-class learning-curve measurement.
            diagnostic_summary = {'status': 'insufficient_data', 'reason': str(error)}
        frozen = freeze_holdout(base, audited, groups)
        fixed = fixed_benchmark(audited, groups, frozen)
        dump(output / 'fixed-evaluation.local.json', fixed)
        summary = {'checkpoint': size, 'inputSignature': signature, 'acceptedUniqueArticles': size,
                   'intakeExclusionsAcrossAvailableInput': excluded,
                   'byPublisher': quality['byPublisher'], 'byPublisherTopic': quality['byPublisherTopic'],
                   'qualityFlags': quality['flagCounts'], 'nearDuplicatePairs': len(quality['nearDuplicateCandidates']),
                   'nearDuplicateRowsWithheldFromTopicDiagnostic': size - len(diagnostic_rows),
                   'topicHeldoutDiagnostic': {**diagnostic_summary,
                       'comparisonWarning': 'Evaluation rows change across checkpoints; use fixedEvaluation for learning curve.'},
                   'fixedEvaluation': fixed, 'politicalAxisApproved': False, 'releaseReady': False}
        dump(summary_path, summary)
        summaries.append(summary)
        print(json.dumps({'checkpoint': size, 'articles': size,
              'trainingRows': fixed['trainingRows'], 'fixedEvaluationRows': fixed['evaluationRows'],
              'publisherAccuracy': fixed['variants']['publisher_markers_removed']['publisherAccuracy'],
              'publisherMacroF1': fixed['variants']['publisher_markers_removed']['publisherMacroF1'],
              'majorityBaseline': fixed['majorityClassBaseline']['accuracy'], 'releaseReady': False}))
    completed, stale = [], []
    for size in CHECKPOINTS:
        path = base / f'checkpoint-{size}' / 'summary.local.json'
        if not path.exists():
            continue
        summary = json.loads(path.read_text(encoding='utf-8'))
        signature = hashlib.sha256('\n'.join(r['contentHash'] for r in rows[:size]).encode()).hexdigest()
        if len(rows) < size or summary.get('inputSignature') != signature:
            stale.append(size)
            continue
        completed.append(summary)
    dump(base / 'checkpoint-summary.local.json', {'availableAcceptedUniqueArticles': len(rows),
         'intakeExclusions': excluded, 'completedCheckpoints': [s['checkpoint'] for s in completed],
         'staleCheckpointSummariesExcluded': stale,
         'metrics': [{'checkpoint': s['checkpoint'], 'fixedEvaluation': s['fixedEvaluation']} for s in completed],
         'releaseReady': False})
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, default=Path('.sites-runtime/collection-1000-20261105'))
    parser.add_argument('--checkpoint', type=int, choices=CHECKPOINTS)
    args = parser.parse_args()
    base = args.base.resolve()
    if Path('.sites-runtime').resolve() not in base.parents:
        parser.error('Outputs must remain inside ignored .sites-runtime')
    run(base, args.checkpoint)


if __name__ == '__main__':
    main()
