"""One frozen evaluation of pretrained embedding + fixed hierarchical SVM.

Research-only AI-teacher agreement. No provider calls or production activation.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np
from sklearn.svm import LinearSVC
from sklearn.metrics import f1_score, recall_score, confusion_matrix

from train_stance import ROOT, digest
from train_voice import serialize_head, selective_predictions, runtime_evaluation, flip_evaluation
from prepare_voice_embeddings import local_path, MODEL


def read(path):
    return json.loads(local_path(path).read_text(encoding='utf-8-sig'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base = ROOT / '.sites-runtime/svm-improvement-20261114'
    parser.add_argument('--input', default=str(base / 'embedding-input.local.json'))
    parser.add_argument('--vectors', default=str(base / 'embedding-vectors.local.json'))
    parser.add_argument('--report', default=str(base / 'embedding-evaluation.local.json'))
    parser.add_argument('--candidate', default=str(base / 'embedding-candidate.local.json'))
    args = parser.parse_args()
    report_path, candidate_path = local_path(args.report), local_path(args.candidate)
    if report_path.exists() or candidate_path.exists():
        raise ValueError('Preserve the single frozen evaluation; output already exists')
    prepared, vectors = read(args.input), read(args.vectors)
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('schemaVersion') != 'voice-embedding-input-1.0' or prepared.get('inputDigest') != digest(payload):
        raise ValueError('Prepared input digest mismatch')
    if (vectors.get('schemaVersion') != 'voice-embeddings-1.0' or vectors.get('inputDigest') != prepared['inputDigest']
            or vectors.get('model') != MODEL or vectors.get('dimensions') != 2048):
        raise ValueError('Vectors belong to another experiment/model')
    required = {record['key'] for record in prepared['records']}
    if set(vectors.get('vectors', {})) != required:
        raise ValueError('Embeddings are incomplete or contain unrequested records; evaluation was not run')
    matrix = {}
    for key, values in vectors['vectors'].items():
        value = np.array(values, dtype=np.float64)
        if value.shape != (2048,) or not np.all(np.isfinite(value)):
            raise ValueError('Invalid embedding dimensions or nonfinite values')
        norm = np.hypot.reduce(value)
        if not np.isfinite(norm) or norm <= 0:
            raise ValueError('Embedding cannot be normalized')
        matrix[key] = value / norm
    sets = prepared['sets']
    if len(sets['evaluation']) != 149 or len(prepared['pairs']) != 10 or len(sets['challenge']) != 20:
        raise ValueError('Frozen outer/challenge membership changed')
    key_sets = {name: {row['key'] for row in rows} for name, rows in sets.items()}
    if any(key_sets[a] & key_sets[b] for a, b in [('train', 'evaluation'), ('train', 'challenge'), ('evaluation', 'challenge')]):
        raise ValueError('Embedding sentence keys cross experiment partitions')
    train, evaluation = sets['train'], sets['evaluation']
    if {row['group'] for row in train} & {row['group'] for row in evaluation}:
        raise ValueError('Frozen article groups overlap')
    train_x = np.vstack([matrix[row['key']] for row in train])
    outer_x = np.vstack([matrix[row['key']] for row in evaluation])
    targets = {name: [row[name] for row in train] for name in ['direction', 'speaker', 'issue']}
    if set(targets['direction']) != {'neutral', 'support', 'oppose'}:
        raise ValueError('Training lacks one direction class')
    directional = np.array([label != 'neutral' for label in targets['direction']])
    models, heads = {}, {}
    for name in ['speaker', 'issue', 'directionality', 'polarity']:
        classifier = LinearSVC(C=1., class_weight='balanced', random_state=42, max_iter=20000)
        if name == 'directionality':
            classifier.fit(train_x, ['neutral' if label == 'neutral' else 'directional' for label in targets['direction']])
        elif name == 'polarity':
            classifier.fit(train_x[directional], [label for label in targets['direction'] if label != 'neutral'])
        else:
            classifier.fit(train_x, targets[name])
        models[name], heads[name] = classifier, serialize_head(classifier)
    # All settings were fixed before accessing these frozen outer vectors.
    gate = models['directionality'].predict(outer_x)
    polarity = models['polarity'].predict(outer_x)
    raw = ['neutral' if label == 'neutral' else value for label, value in zip(gate, polarity)]
    actual = [row['direction'] for row in evaluation]
    classes = ['neutral', 'oppose', 'support']
    majority = Counter(targets['direction']).most_common(1)[0][0]
    raw_macro = float(f1_score(actual, raw, labels=classes, average='macro', zero_division=0))
    majority_macro = float(f1_score(actual, [majority] * len(actual), labels=classes, average='macro', zero_division=0))
    recalls = dict(zip(classes, map(float, recall_score(actual, raw, labels=classes, average=None, zero_division=0))))
    other = {name: float(f1_score([row[name] for row in evaluation], models[name].predict(outer_x), average='macro', zero_division=0)) for name in ['speaker', 'issue']}
    runtime = runtime_evaluation(evaluation, heads, outer_x)
    pair_x = np.vstack([matrix[pair[side + 'Key']] for pair in prepared['pairs'] for side in ['support', 'oppose']])
    flips = flip_evaluation(heads, pair_x)
    blockers = []
    if raw_macro < .6 or raw_macro <= majority_macro:
        blockers.append('teacher_agreement_below_threshold')
    if min(recalls['support'], recalls['oppose']) < .5:
        blockers.append('direction_recall_below_threshold')
    if min(other.values()) < .6:
        blockers.append('speaker_or_issue_below_threshold')
    if runtime['macroF1'] < .6 or runtime['macroF1'] <= majority_macro:
        blockers.append('runtime_teacher_agreement_below_threshold')
    if min(runtime['supportRecall'], runtime['opposeRecall']) < .5:
        blockers.append('runtime_direction_recall_below_threshold')
    if min(runtime['heads'][name]['jointMacroF1'] for name in ['speaker', 'issue']) < .6:
        blockers.append('runtime_speaker_or_issue_below_threshold')
    if flips['pairAccuracy'] < .5:
        blockers.append('flip_challenge_failed')
    # Embedding experiment does not perform a publisher-masking API challenge,
    # legal review or human evaluation, and cannot satisfy release by itself.
    measured_blockers = list(blockers)
    blockers += ['publisher_masking_not_evaluated', 'usage_review_pending', 'embedding_runtime_not_integrated']
    config = {'embeddingModel': MODEL, 'dimensions': 2048, 'normalization': 'l2',
        'C': 1., 'classWeight': 'balanced', 'minimumMarginGap': .15, 'directionStrategy': 'hierarchical',
        'selection': 'Fixed before outer evaluation; no hyperparameter search'}
    report = {'schemaVersion': 'voice-embedding-evaluation-1.0', 'inputDigest': prepared['inputDigest'],
        'humanEvaluationCount': 0, 'ready': False, 'measuredPerformanceGatesPassed': not measured_blockers,
        'blockers': blockers, 'configuration': config, 'trainingCount': len(train), 'heldoutCount': len(evaluation),
        'trainingDirectionCounts': dict(Counter(targets['direction'])), 'heldoutDirectionCounts': dict(Counter(actual)),
        'groupOverlap': 0, 'rawMacroF1': raw_macro, 'majorityMacroF1': majority_macro, 'rawRecall': recalls,
        'rawConfusion': confusion_matrix(actual, raw, labels=classes).tolist(),
        'speakerMacroF1': other['speaker'], 'issueMacroF1': other['issue'], 'runtime': runtime,
        'flipChallenge': flips, 'meaning': 'Actual retained news AI-teacher agreement; not human accuracy or release approval.'}
    candidate = {'schemaVersion': 'voice-embedding-svm-research-1.0', 'status': 'research',
        'version': digest({'inputDigest': prepared['inputDigest'], 'config': config, 'heads': heads})[:24],
        'inputDigest': prepared['inputDigest'], 'configuration': config, 'heads': heads, 'evaluation': report}
    for path, value in [(candidate_path, candidate), (report_path, report)]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
