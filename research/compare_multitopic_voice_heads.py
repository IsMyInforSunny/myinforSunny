"""Training-only group CV of two prespecified dense-head sharing strategies.

Uses retained training sentences only. No outer labels, provider calls, model
export, threshold search, encoder changes or production activation.
"""
import argparse
from collections import Counter
import hashlib
import json

import numpy as np
from sklearn.metrics import f1_score
from sklearn.model_selection import GroupKFold
from sklearn.svm import LinearSVC

from prepare_voice_embeddings import local_path, MODEL
from train_stance import digest
from train_voice import DEFINITION, serialize_head, selective_predict

DIRECTIONS = ['neutral', 'oppose', 'support']
HEADS = ['directionality', 'polarity', 'speaker', 'issue']
STRATEGIES = ['per_topic', 'shared_direction_speaker']


def fit_head(rows, matrix, indices, name):
    if name == 'polarity':
        indices = np.asarray([index for index in indices if rows[index]['direction'] != 'neutral'], dtype=int)
    targets = [('neutral' if rows[index]['direction'] == 'neutral' else 'directional') if name == 'directionality'
               else rows[index]['direction' if name == 'polarity' else name] for index in indices]
    counts = dict(Counter(targets))
    if len(counts) < 2:
        return None, {'count': len(targets), 'classCounts': counts, 'status': 'insufficient_classes'}
    classifier = LinearSVC(C=1., class_weight='balanced', random_state=42, max_iter=20000)
    classifier.fit(matrix[indices], targets)
    return serialize_head(classifier), {'count': len(targets), 'classCounts': counts, 'status': 'fitted'}


def predictions(head, matrix, selective=True):
    if head is None:
        return [None] * len(matrix)
    if selective:
        return selective_predict(head, matrix)
    scores = matrix @ np.asarray(head['coefficients']).T + np.asarray(head['intercepts'])
    return [head['classes'][int(index)] for index in np.argmax(scores, axis=1)]


def append_predictions(result, heads, matrix, indices):
    selective = {name: predictions(heads[name], matrix) for name in HEADS}
    raw = {name: predictions(heads[name], matrix, False) for name in ['directionality', 'polarity']}
    for position, index in enumerate(indices):
        gate, polarity = selective['directionality'][position], selective['polarity'][position]
        direction = None if gate is None else 'neutral' if gate == 'neutral' else polarity
        issue, speaker = selective['issue'][position], selective['speaker'][position]
        joint = direction is not None and issue is not None and speaker is not None
        joint = joint and not (direction in ['support', 'oppose'] and issue == 'none')
        decision = direction if direction == 'neutral' or joint else None
        raw_gate = raw['directionality'][position]
        raw_direction = None if raw_gate is None else 'neutral' if raw_gate == 'neutral' else raw['polarity'][position]
        result[index] = {'raw': raw_direction, 'direction': direction, 'decision': decision,
                         'speaker': speaker, 'issue': issue, 'joint': joint}


def metrics(rows, result, indices, topic):
    target = [rows[index]['direction'] for index in indices]
    selected = [result[index] for index in indices]
    def labels(name):
        return [row[name] if row[name] is not None else '__unresolved__' for row in selected]
    issue_target = [rows[index]['issue'] for index in indices]
    issue_classes = sorted(set(DEFINITION['topics'][topic]['issues']) | {'none'})
    return {'count': len(indices), 'articleCount': len({rows[index]['articleId'] for index in indices}),
        'groupCount': len({rows[index]['group'] for index in indices}),
        'directionCounts': dict(Counter(target)), 'issueCounts': dict(Counter(issue_target)),
        'rawDirectionMacroF1': float(f1_score(target, labels('raw'), labels=DIRECTIONS, average='macro', zero_division=0)),
        'decisionMacroF1': float(f1_score(target, labels('decision'), labels=DIRECTIONS, average='macro', zero_division=0)),
        'decisionWeightedF1': float(f1_score(target, labels('decision'), labels=DIRECTIONS, average='weighted', zero_division=0)),
        'decisionCoverage': sum(row['decision'] is not None for row in selected) / len(indices),
        'directionHeadCoverage': sum(row['direction'] is not None for row in selected) / len(indices),
        'jointCoverage': sum(row['joint'] for row in selected) / len(indices),
        'acceptedDirectional': sum(row['decision'] in ['support', 'oppose'] for row in selected),
        'speakerMacroF1': float(f1_score([rows[index]['speaker'] for index in indices], labels('speaker'),
                                       labels=['journalist', 'source'], average='macro', zero_division=0)),
        'speakerCoverage': sum(row['speaker'] is not None for row in selected) / len(indices),
        'issueMacroF1': float(f1_score(issue_target, labels('issue'), labels=issue_classes, average='macro', zero_division=0)),
        'observedIssueMacroF1': float(f1_score(issue_target, labels('issue'), labels=sorted(set(issue_target)),
                                             average='macro', zero_division=0)),
        'issueCoverage': sum(row['issue'] is not None for row in selected) / len(indices),
        'issueClassesWithoutTrainingCvTargets': sorted(set(issue_classes) - set(issue_target))}


def compare(rows, matrix):
    groups = np.asarray([row['group'] for row in rows])
    if len(set(groups)) < 3:
        raise ValueError('Three independent training groups are required')
    topics = sorted({row['topic'] for row in rows})
    results = {strategy: [None] * len(rows) for strategy in STRATEGIES}
    folds = []
    for fold, (training, validation) in enumerate(GroupKFold(n_splits=3).split(matrix, groups=groups)):
        if set(groups[training]) & set(groups[validation]):
            raise ValueError('Training group leaked into CV validation')
        shared, shared_diagnostics = {}, {}
        for name in ['directionality', 'polarity', 'speaker']:
            shared[name], shared_diagnostics[name] = fit_head(rows, matrix, training, name)
        topic_diagnostics = {}
        for topic in topics:
            train = np.asarray([index for index in training if rows[index]['topic'] == topic], dtype=int)
            test = np.asarray([index for index in validation if rows[index]['topic'] == topic], dtype=int)
            if not len(test):
                continue
            local, diagnostics = {}, {}
            for name in HEADS:
                local[name], diagnostics[name] = fit_head(rows, matrix, train, name)
            topic_diagnostics[topic] = {'trainingCount': len(train), 'validationCount': len(test),
                'trainingArticles': len({rows[index]['articleId'] for index in train}),
                'validationArticles': len({rows[index]['articleId'] for index in test}), 'heads': diagnostics,
                'issueClassesAbsentFromFoldTraining': sorted({rows[index]['issue'] for index in test}
                                                             - {rows[index]['issue'] for index in train})}
            append_predictions(results['per_topic'], local, matrix[test], test)
            append_predictions(results['shared_direction_speaker'], {**shared, 'issue': local['issue']}, matrix[test], test)
        folds.append({'fold': fold, 'trainingCount': len(training), 'validationCount': len(validation),
                      'groupOverlap': 0, 'sharedHeads': shared_diagnostics, 'topics': topic_diagnostics})
    report = {}
    for strategy, values in results.items():
        if any(value is None for value in values):
            raise ValueError('CV did not cover every training row exactly once')
        per_topic = {topic: metrics(rows, values, [index for index, row in enumerate(rows) if row['topic'] == topic], topic)
                     for topic in topics}
        report[strategy] = {'topics': per_topic,
            'topicCountWeightedMacroF1': sum(value['count'] * value['decisionMacroF1'] for value in per_topic.values()) / len(rows),
            'equalTopicMacroF1': sum(value['decisionMacroF1'] for value in per_topic.values()) / len(topics),
            'rawTopicCountWeightedMacroF1': sum(value['count'] * value['rawDirectionMacroF1'] for value in per_topic.values()) / len(rows),
            'neutralIndependentCoverage': sum(value['decision'] is not None for value in values) / len(rows)}
    report['issuePredictionsIdentical'] = all(left['issue'] == right['issue']
        for left, right in zip(results['per_topic'], results['shared_direction_speaker']))
    return report, folds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--vectors', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    paths = [local_path(value) for value in [args.input, args.vectors, args.output]]
    if len(set(paths)) != 3 or paths[2].exists():
        raise ValueError('Preserve inputs and previous diagnostic reports')
    prepared, vectors = [json.loads(path.read_text(encoding='utf-8-sig')) for path in paths[:2]]
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('inputDigest') != digest(payload) or vectors.get('inputDigest') != prepared['inputDigest']:
        raise ValueError('Input and vector provenance mismatch')
    if vectors.get('model') != MODEL or vectors.get('dimensions') != 2048:
        raise ValueError('Wrong semantic encoder')
    # Do not select any rows, features, labels or counts from sets.evaluation.
    rows = prepared['sets']['train']
    records = {record['key']: record for record in prepared['records'] if record['partition'] == 'train'}
    features = []
    for row in rows:
        record = records.get(row['key'])
        if record is None or hashlib.sha256(record['text'].encode()).hexdigest() != row['key']:
            raise ValueError('Training semantic input identity mismatch')
        vector = np.asarray(vectors['vectors'][row['key']], dtype=np.float64)
        if vector.shape != (2048,) or not np.isfinite(vector).all():
            raise ValueError('Invalid training semantic vector')
        norm = np.hypot.reduce(vector)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError('Invalid semantic vector norm')
        features.append(vector / norm)
    results, folds = compare(rows, np.vstack(features))
    report = {'schemaVersion': 'multitopic-head-sharing-training-cv-1.0', 'researchOnly': True,
        'inputDigest': prepared['inputDigest'], 'trainingRowsDigest': digest(rows),
        'outerUsed': False, 'apiCalls': 0, 'humanEvaluationCount': 0,
        'trainingCount': len(rows), 'groupCount': len({row['group'] for row in rows}),
        'teachersByTopic': prepared.get('teachersByTopic'),
        'configuration': {'folds': 3, 'split': 'GroupKFold', 'C': 1., 'classWeight': 'balanced',
            'minimumMarginGap': .15, 'randomState': 42, 'dimensions': 2048,
            'decisionPolicy': 'voice-neutral-independent-1.0', 'strategiesFixedBeforeCv': STRATEGIES,
            'selection': 'Training group CV only; no outer-based tuning or representation search'},
        'metricDefinitions': {'topicCountWeightedMacroF1': 'Topic direction-decision macro F1 weighted by training sentence count',
            'equalTopicMacroF1': 'Unweighted mean of topic direction-decision macro F1',
            'issueMacroF1': 'All three declared topic issues plus none, with abstentions counted as missed labels',
            'observedIssueMacroF1': 'Only issues actually present among this training CV target set'},
        'folds': folds, 'results': results,
        'meaning': 'Training development diagnostic on actual AI labels; not independent article accuracy'}
    paths[2].parent.mkdir(parents=True, exist_ok=True)
    with paths[2].open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'trainingCount': len(rows), 'groupCount': report['groupCount'], 'results': results}, ensure_ascii=True))


if __name__ == '__main__':
    main()
