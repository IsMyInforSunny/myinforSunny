"""Training-group CV of conditional voice heads. Never reads outer labels.

Research only: no provider calls, model export, release or threshold search.
The proposed contract retains confidently neutral direction independently of
speaker/issue. Directional claims still require both speaker and issue.
"""
import argparse
from collections import Counter
import hashlib
import json

import numpy as np
from sklearn.model_selection import GroupKFold
from sklearn.svm import LinearSVC
from sklearn.metrics import f1_score

from prepare_voice_embeddings import local_path, MODEL
from train_stance import digest
from train_voice import serialize_head, selective_predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--vectors', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    inputs = [local_path(value) for value in [args.input, args.vectors, args.output]]
    if len(set(inputs)) != 3 or inputs[2].exists():
        raise ValueError('Preserve source inputs and previous reports')
    prepared, vectors = [json.loads(path.read_text(encoding='utf-8-sig')) for path in inputs[:2]]
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('inputDigest') != digest(payload) or vectors.get('inputDigest') != prepared['inputDigest']:
        raise ValueError('Input/vector digest mismatch')
    if vectors.get('model') != MODEL or vectors.get('dimensions') != 2048:
        raise ValueError('Wrong encoder')
    # The only labels/features selected here belong to the training partition.
    rows = prepared['sets']['train']
    records = {row['key']: row for row in prepared['records']}
    matrix = []
    for row in rows:
        record = records[row['key']]
        if record['partition'] != 'train' or hashlib.sha256(record['text'].encode()).hexdigest() != row['key']:
            raise ValueError('Training partition identity mismatch')
        vector = np.asarray(vectors['vectors'][row['key']], dtype=np.float64)
        norm = np.hypot.reduce(vector)
        if vector.shape != (2048,) or not np.isfinite(vector).all() or not np.isfinite(norm) or norm <= 0:
            raise ValueError('Invalid vector')
        matrix.append(vector / norm)
    features = np.vstack(matrix)
    groups = np.asarray([row['group'] for row in rows])
    if len(set(groups)) < 5:
        raise ValueError('Five independent training groups required')
    results = {name: {'predictions': [None] * len(rows), 'directionalIssueErrors': 0,
                     'directionalSpeakerErrors': 0, 'acceptedDirectional': 0} for name in ['joint', 'neutral_independent', 'conditional']}
    folds = []
    for fold, (train, validation) in enumerate(GroupKFold(n_splits=5).split(features, groups=groups)):
        if set(groups[train]) & set(groups[validation]):
            raise ValueError('Group leakage')
        directional = np.asarray([rows[i]['direction'] != 'neutral' for i in train])
        directional_indices = train[directional]
        if set(rows[i]['direction'] for i in train) != {'neutral', 'support', 'oppose'}:
            raise ValueError('Fold lacks direction classes')
        folds.append({'fold': fold, 'trainCount': len(train), 'validationCount': len(validation), 'groupOverlap': 0})
        for mode in results:
            heads = {}
            for name in ['directionality', 'polarity', 'speaker', 'issue']:
                indices = directional_indices if name == 'polarity' or mode == 'conditional' and name == 'issue' else train
                targets = [('neutral' if rows[i]['direction'] == 'neutral' else 'directional') if name == 'directionality'
                           else rows[i]['direction' if name == 'polarity' else name] for i in indices]
                if len(set(targets)) < 2:
                    raise ValueError('Fold head lacks classes')
                classifier = LinearSVC(C=1., class_weight='balanced', random_state=42, max_iter=20000)
                classifier.fit(features[indices], targets)
                heads[name] = serialize_head(classifier)
            predicted = selective_predictions(heads, features[validation])
            for j, index in enumerate(validation):
                direction, issue, speaker = [predicted[name][j] for name in ['direction', 'issue', 'speaker']]
                neutral = mode != 'joint' and direction == 'neutral'
                complete = direction is not None and issue is not None and speaker is not None
                if neutral or complete and not (direction != 'neutral' and issue == 'none'):
                    results[mode]['predictions'][index] = direction
                    if direction in ['support', 'oppose']:
                        results[mode]['acceptedDirectional'] += 1
                        results[mode]['directionalIssueErrors'] += issue != rows[index]['issue']
                        results[mode]['directionalSpeakerErrors'] += speaker != rows[index]['speaker']
    target = [row['direction'] for row in rows]
    metrics = {}
    for mode, result in results.items():
        predictions = result.pop('predictions')
        accepted = sum(value is not None for value in predictions)
        metrics[mode] = {**result, 'accepted': accepted, 'count': len(rows), 'coverage': accepted / len(rows),
                        'directionMacroF1': float(f1_score(target, [value or '__unresolved__' for value in predictions],
                                                         labels=['neutral', 'oppose', 'support'], average='macro', zero_division=0))}
    report = {'schemaVersion': 'voice-dependency-cv-1.0', 'inputDigest': prepared['inputDigest'],
              'partition': 'train-only', 'outerEvaluated': False, 'apiCalls': 0, 'releaseReady': False,
              'configuration': {'folds': 5, 'C': 1., 'classWeight': 'balanced', 'minimumMarginGap': .15,
                                'modes': {'joint': 'All three heads required',
                                          'neutral_independent': 'Neutral direction independent; heads unchanged',
                                          'conditional': 'Neutral independent; issue trained on directional rows only'}},
              'trainingCount': len(rows), 'trainingGroups': len(set(groups)), 'classes': dict(Counter(target)),
              'folds': folds, 'metrics': metrics,
              'meaning': 'Training-group model development only; not independent article accuracy or final bias readiness.'}
    inputs[2].parent.mkdir(parents=True, exist_ok=True)
    inputs[2].write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
