"""Train and export a calibrated binary SVM head over fixed embeddings.

This is an experimental expression head, not a completed three-axis product.
No remote inference, user submission collection, or model download occurs here.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC

LABELS = ['clear', 'flagged']
SPLITS = {'train', 'calibration', 'dev', 'test'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate(rows, synthetic=False):
    if not rows:
        raise ValueError('Empty dataset')
    ids, groups, texts, versions, dimensions = set(), {}, {}, set(), set()
    for r in rows:
        if r['id'] in ids or not r['group'] or not r['text'].strip():
            raise ValueError('Duplicate ID, empty group, or empty text')
        ids.add(r['id'])
        if r['split'] not in SPLITS or r['label'] not in LABELS:
            raise ValueError('Invalid split or label')
        if groups.setdefault(r['group'], r['split']) != r['split']:
            raise ValueError('Group leakage across splits')
        if texts.setdefault(' '.join(r['text'].split()), r['split']) != r['split']:
            raise ValueError('Duplicate text leakage across splits')
        if synthetic:
            if r.get('provenance') != 'synthetic':
                raise ValueError('Synthetic mode only accepts explicit synthetic data')
        elif (r.get('annotationStatus') not in {'reviewed', 'adjudicated'}
              or len(set(r.get('reviewers', []))) < 2
              or not r.get('license') or not r.get('provenance')
              or r.get('provenance') == 'synthetic'):
            raise ValueError('Need documented rights and two genuine independent human reviews')
        vector = np.asarray(r['embedding'], dtype=float)
        if vector.ndim != 1 or not 0 < vector.size <= 4096 or not np.isfinite(vector).all():
            raise ValueError('Invalid embedding')
        dimensions.add(vector.size)
        versions.add(r.get('embeddingVersion'))
    if len(dimensions) != 1 or len(versions) != 1 or None in versions or '' in versions:
        raise ValueError('Encoder versions and dimensions must match')
    return rows


def matrix(rows):
    return np.asarray([r['embedding'] for r in rows], dtype=float)


def predict(artifact, vectors):
    x = np.asarray(vectors, dtype=float)
    if x.ndim != 2 or x.shape[1] != artifact['dimension'] or not np.isfinite(x).all():
        raise ValueError('Feature dimension or finite check failed')
    scaled = (x - artifact['scaler']['mean']) / artifact['scaler']['scale']
    margin = scaled @ np.asarray(artifact['linear']['weights']) + artifact['linear']['bias']
    z = np.clip(margin * artifact['calibration']['weight'] + artifact['calibration']['bias'], -700, 700)
    return margin, 1 / (1 + np.exp(-z))


def report(artifact, rows):
    if not rows:
        raise ValueError('Empty evaluation split')
    if any(r['embeddingVersion'] != artifact['encoderVersion'] for r in rows):
        raise ValueError('Encoder version mismatch')
    _, probabilities = predict(artifact, matrix(rows))
    truth = np.asarray([LABELS.index(r['label']) for r in rows])
    predictions = (probabilities >= .5).astype(int)
    low, high = artifact['abstain']['low'], artifact['abstain']['high']
    accepted = (probabilities <= low) | (probabilities >= high)
    # Fixed bins; report sample count because ECE is unreliable on tiny data.
    ece = 0.0
    for lower, upper in zip(np.linspace(0, 1, 11)[:-1], np.linspace(0, 1, 11)[1:]):
        selected = (probabilities >= lower) & ((probabilities < upper) if upper < 1 else (probabilities <= upper))
        if selected.any():
            ece += selected.mean() * abs(probabilities[selected].mean() - truth[selected].mean())
    return {'count': len(rows), 'coverage': float(accepted.mean()), 'abstained': int((~accepted).sum()),
            'all_items': classification_report(truth, predictions, labels=[0, 1], target_names=LABELS, output_dict=True, zero_division=0),
            'accepted_items': classification_report(truth[accepted], predictions[accepted], labels=[0, 1], target_names=LABELS, output_dict=True, zero_division=0) if accepted.any() else None,
            'confusion_matrix': confusion_matrix(truth, predictions, labels=[0, 1]).tolist(),
            'brier': float(brier_score_loss(truth, probabilities)), 'ece_10_equal_width_bins': float(ece)}


def train(rows, low=.35, high=.65, synthetic=False):
    validate(rows, synthetic=synthetic)
    if not 0 <= low < .5 < high <= 1:
        raise ValueError('Invalid abstention thresholds')
    splits = {name: [r for r in rows if r['split'] == name] for name in SPLITS}
    for name in ['train', 'calibration', 'dev']:
        if {r['label'] for r in splits[name]} != set(LABELS):
            raise ValueError(f'{name} requires both classes')
    fit = splits['train']
    scaler = StandardScaler().fit(matrix(fit))
    head = LinearSVC(C=1.0, class_weight='balanced', random_state=42, max_iter=10000)
    head.fit(scaler.transform(matrix(fit)), [LABELS.index(r['label']) for r in fit])
    calibration = splits['calibration']
    margins = head.decision_function(scaler.transform(matrix(calibration))).reshape(-1, 1)
    sigmoid = LogisticRegression(C=1.0, random_state=42).fit(margins, [LABELS.index(r['label']) for r in calibration])
    # Test labels/vectors do not affect either fitting or selection output.
    used = [r for r in rows if r['split'] in {'train', 'calibration', 'dev'}]
    artifact = {'schemaVersion': 'svm-head-1.0', 'task': 'expression_binary', 'labels': LABELS,
                'releaseStatus': 'synthetic-test-only' if synthetic else 'experimental-not-approved',
                'encoderVersion': fit[0]['embeddingVersion'], 'dimension': len(fit[0]['embedding']),
                'scaler': {'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist()},
                'linear': {'weights': head.coef_[0].tolist(), 'bias': float(head.intercept_[0])},
                'calibration': {'method': 'held-out-logistic-sigmoid', 'weight': float(sigmoid.coef_[0, 0]), 'bias': float(sigmoid.intercept_[0])},
                'abstain': {'low': low, 'high': high}, 'trainingDataHash': digest(used),
                'splitHashes': {name: digest(splits[name]) for name in ['train', 'calibration', 'dev']},
                'configuration': {'C': 1.0, 'class_weight': 'balanced', 'random_state': 42},
                'limitations': ['Binary expression head only', 'No product accuracy established', 'Abstention thresholds require dev selection', 'Human review provenance must be independently audited']}
    return artifact, report(artifact, splits['dev'])


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    fit = commands.add_parser('train')
    fit.add_argument('--data', required=True); fit.add_argument('--output-dir', required=True)
    fit.add_argument('--synthetic', action='store_true')
    fit.add_argument('--low', type=float, default=.35); fit.add_argument('--high', type=float, default=.65)
    evaluate = commands.add_parser('evaluate-test')
    evaluate.add_argument('--data', required=True); evaluate.add_argument('--frozen-artifact', required=True)
    evaluate.add_argument('--output', required=True); evaluate.add_argument('--synthetic', action='store_true')
    args = parser.parse_args()
    rows = [json.loads(line) for line in Path(args.data).read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    if args.command == 'train':
        artifact, dev = train(rows, args.low, args.high, args.synthetic)
        output = Path(args.output_dir); output.mkdir(parents=True, exist_ok=True)
        for name, data in [('head.json', artifact), ('dev-report.json', dev)]:
            (output / name).write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        print('Experimental head and dev report saved. Not a production release.')
    else:
        validate(rows, args.synthetic)
        artifact = json.loads(Path(args.frozen_artifact).read_text(encoding='utf-8'))
        used = [r for r in rows if r['split'] in {'train', 'calibration', 'dev'}]
        if digest(used) != artifact['trainingDataHash']:
            raise ValueError('Dataset differs from the frozen artifact')
        result = {'artifactHash': digest(artifact), 'split': 'test', 'metrics': report(artifact, [r for r in rows if r['split'] == 'test']), 'releaseStatus': artifact['releaseStatus']}
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Frozen test report saved. Do not tune on this test result.')


if __name__ == '__main__':
    main()
