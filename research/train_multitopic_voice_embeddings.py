"""Fit frozen topic-specific semantic SVM research heads without provider calls."""
import argparse
from collections import Counter
import hashlib
import json

import numpy as np
from sklearn.svm import LinearSVC
from sklearn.metrics import f1_score, recall_score, confusion_matrix

from train_stance import digest
from train_voice import DEFINITION, serialize_head, runtime_evaluation
from prepare_voice_embeddings import local_path, MODEL, OPTIONS
from prepare_multitopic_voice_embeddings import load_json

POLICY = 'voice-neutral-independent-1.0'
CONFIGURATION = {'embeddingModel': MODEL, 'dimensions': 2048, 'normalization': 'l2', 'C': 1.,
    'classWeight': 'balanced', 'minimumMarginGap': .15, 'directionStrategy': 'hierarchical',
    'decisionPolicy': POLICY, 'selection': 'Fixed C=1 and margin .15 before all outer evaluation; no model search'}


def checked_input(prepared):
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('schemaVersion') != 'voice-embedding-input-1.0' or prepared.get('inputDigest') != digest(payload):
        raise ValueError('Embedding input digest mismatch')
    if prepared.get('embedding') != OPTIONS:
        raise ValueError('Unexpected semantic encoder options')
    records = prepared.get('records', [])
    if len({row['key'] for row in records}) != len(records):
        raise ValueError('Duplicate semantic input key')
    for row in records:
        if hashlib.sha256(row['text'].encode()).hexdigest() != row['key']:
            raise ValueError('Semantic text hash mismatch')
    return {row['key'] for row in records}


def read_vectors(prepared, cache_inputs, vector_files):
    required = checked_input(prepared)
    vectors = {}
    provenance = []
    for source, values in zip(cache_inputs, vector_files):
        allowed = checked_input(source)
        if (values.get('schemaVersion') != 'voice-embeddings-1.0' or values.get('inputDigest') != source['inputDigest']
                or values.get('model') != MODEL or values.get('dimensions') != 2048):
            raise ValueError('Vector cache provenance mismatch')
        for key, raw in values.get('vectors', {}).items():
            if key not in allowed:
                raise ValueError('Cache contains an unrequested semantic input')
            vector = np.asarray(raw, dtype=np.float64)
            if vector.shape != (2048,) or not np.all(np.isfinite(vector)):
                raise ValueError('Nonfinite or incompatible semantic vector')
            norm = np.hypot.reduce(vector)
            if not np.isfinite(norm) or norm <= 0:
                raise ValueError('Zero or invalid semantic norm')
            vector = vector / norm
            if key in vectors and not np.allclose(vectors[key], vector, rtol=0, atol=1e-8):
                raise ValueError('Conflicting semantic caches')
            if key in required:
                vectors[key] = vector
        provenance.append({'inputDigest': source['inputDigest'], 'vectorsDigest': digest(values)})
    return vectors, provenance


def train_topic(topic, training, evaluation, vectors):
    report = {'ready': False, 'researchOnly': True, 'humanEvaluationCount': 0,
        'trainingCount': len(training), 'heldoutCount': len(evaluation), 'groupOverlap': 0, 'blockers': []}
    for name, rows in [('training', training), ('heldout', evaluation)]:
        report[name + 'DirectionCounts'] = dict(Counter(row['direction'] for row in rows))
    if not training or not evaluation:
        report['blockers'].append('independent_training_or_evaluation_missing')
        return None, report
    if {row['group'] for row in training} & {row['group'] for row in evaluation}:
        raise ValueError('Frozen training and heldout groups overlap')
    missing = {row['key'] for row in training + evaluation} - set(vectors)
    if missing:
        report.update(missingEmbeddingCount=len(missing))
        report['blockers'].append('embeddings_incomplete')
        return None, report
    for name in ['direction', 'speaker', 'issue']:
        actual = {row[name] for row in training}
        expected = ({'neutral', 'support', 'oppose'} if name == 'direction' else {'journalist', 'source'}
                    if name == 'speaker' else set(DEFINITION['topics'][topic]['issues']) | {'none'})
        missing_classes = sorted(expected - actual)
        if missing_classes:
            report[name + 'UntrainedClasses'] = missing_classes
            report['blockers'].append(name + '_class_coverage_incomplete')
        unevaluated = sorted(expected - {row[name] for row in evaluation})
        if unevaluated:
            report[name + 'UnevaluatedClasses'] = unevaluated
            report['blockers'].append(name + '_evaluation_class_coverage_incomplete')
        if len(actual) < 2 or name == 'direction' and actual != expected:
            report['blockers'].append(name + '_head_untrainable')
            return None, report
        unseen = {row[name] for row in evaluation} - actual
        if unseen:
            report[name + 'UnseenHeldoutClasses'] = sorted(unseen)
    matrix = np.vstack([vectors[row['key']] for row in training])
    heldout = np.vstack([vectors[row['key']] for row in evaluation])
    targets = {name: [row[name] for row in training] for name in ['direction', 'speaker', 'issue']}
    directional = np.asarray([label != 'neutral' for label in targets['direction']])
    classifiers, heads = {}, {}
    for name in ['speaker', 'issue', 'directionality', 'polarity']:
        classifier = LinearSVC(C=1., class_weight='balanced', random_state=42, max_iter=20000)
        if name == 'directionality':
            classifier.fit(matrix, ['neutral' if label == 'neutral' else 'directional' for label in targets['direction']])
        elif name == 'polarity':
            classifier.fit(matrix[directional], [label for label in targets['direction'] if label != 'neutral'])
        else:
            classifier.fit(matrix, targets[name])
        classifiers[name], heads[name] = classifier, serialize_head(classifier)
    runtime = runtime_evaluation(evaluation, heads, heldout, POLICY)
    gate, polarity = classifiers['directionality'].predict(heldout), classifiers['polarity'].predict(heldout)
    prediction = ['neutral' if label == 'neutral' else value for label, value in zip(gate, polarity)]
    actual = [row['direction'] for row in evaluation]
    classes = ['neutral', 'oppose', 'support']
    majority = Counter(targets['direction']).most_common(1)[0][0]
    raw_f1 = float(f1_score(actual, prediction, labels=classes, average='macro', zero_division=0))
    majority_f1 = float(f1_score(actual, [majority] * len(actual), labels=classes, average='macro', zero_division=0))
    recalls = dict(zip(classes, map(float, recall_score(actual, prediction, labels=classes, average=None, zero_division=0))))
    head_scores = {name: float(f1_score([row[name] for row in evaluation], classifiers[name].predict(heldout),
                  average='macro', zero_division=0)) for name in ['speaker', 'issue']}
    if raw_f1 < .6 or raw_f1 <= majority_f1:
        report['blockers'].append('teacher_agreement_below_threshold')
    if min(recalls['support'], recalls['oppose']) < .5:
        report['blockers'].append('direction_recall_below_threshold')
    if min(head_scores.values()) < .6:
        report['blockers'].append('speaker_or_issue_below_threshold')
    if runtime['macroF1'] < .6 or runtime['macroF1'] <= majority_f1:
        report['blockers'].append('runtime_teacher_agreement_below_threshold')
    if min(runtime['supportRecall'], runtime['opposeRecall']) < .5:
        report['blockers'].append('runtime_direction_recall_below_threshold')
    if min(runtime['heads'][name]['jointMacroF1'] for name in ['speaker', 'issue']) < .6:
        report['blockers'].append('runtime_speaker_or_issue_below_threshold')
    decision = runtime['directionDecision']
    if decision['macroF1'] < .6 or decision['macroF1'] <= majority_f1 or min(decision['supportRecall'], decision['opposeRecall']) < .5:
        report['blockers'].append('independent_direction_below_threshold')
    for label in classes:
        if sum(row['direction'] == label for row in training + evaluation) < 10:
            report['blockers'].append('insufficient_class:' + label)
    if len({row['articleId'] for row in evaluation}) < 2:
        report['blockers'].append('independent_evaluation_articles_insufficient')
    report.update(configuration=CONFIGURATION, rawMacroF1=raw_f1, majorityMacroF1=majority_f1,
        rawRecall=recalls, rawConfusion=confusion_matrix(actual, prediction, labels=classes).tolist(),
        speakerMacroF1=head_scores['speaker'], issueMacroF1=head_scores['issue'], runtime=runtime,
        measuredPerformanceGatesPassed=not report['blockers'])
    report['blockers'] += ['independent_flip_challenge_pending', 'publisher_masking_not_evaluated', 'usage_review_pending']
    model = {'heads': heads, 'evaluation': report, 'trainedIssueClasses': heads['issue']['classes'],
        'trainingArticleHashes': sorted({row['articleHash'] for row in training})}
    return model, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--vectors', action='append', required=True)
    parser.add_argument('--cache-input', action='append')
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    prepared = load_json(args.input)
    sources = [load_json(value) for value in args.cache_input] if args.cache_input else [prepared] * len(args.vectors)
    if len(sources) != len(args.vectors):
        raise ValueError('Supply one provenance input for each vector cache')
    vectors, provenance = read_vectors(prepared, sources, [load_json(value) for value in args.vectors])
    training, evaluation = prepared['sets']['train'], prepared['sets']['evaluation']
    if {row['key'] for row in training} & {row['key'] for row in evaluation}:
        raise ValueError('Semantic texts cross frozen partitions')
    models, reports = {}, {}
    for topic in prepared['preparation']['topics']:
        rows_train = [row for row in training if row['topic'] == topic]
        rows_evaluation = [row for row in evaluation if row['topic'] == topic]
        model, report = train_topic(topic, rows_train, rows_evaluation, vectors)
        report['teacher'] = prepared.get('teachersByTopic', {}).get(topic, prepared.get('teacher'))
        report['preparation'] = prepared['preparation']['topics'][topic]
        reports[topic] = report
        if model:
            models[topic] = model
    version = digest({'inputDigest': prepared['inputDigest'], 'configuration': CONFIGURATION,
                      'heads': {topic: value['heads'] for topic, value in models.items()}})[:24]
    report = {'schemaVersion': 'voice-multitopic-embedding-evaluation-1.0', 'modelVersion': version,
        'inputDigest': prepared['inputDigest'], 'researchOnly': True, 'usageReviewed': False,
        'ready': False, 'humanEvaluationCount': 0, 'configuration': CONFIGURATION, 'topics': reports,
        'vectorsProvenance': provenance, 'meaning': 'Retained news AI-teacher agreement; human evaluation pending'}
    candidate = {'schemaVersion': 'voice-multitopic-embedding-svm-research-1.0', 'version': version,
        'status': 'research', 'researchOnly': True, 'usageReviewed': False, 'humanEvaluationCount': 0,
        'definitionVersion': DEFINITION['version'], 'segmenter': 'sentence-3.1', 'scopeCharacters': 2000,
        'decisionPolicy': POLICY, 'inputDigest': prepared['inputDigest'], 'configuration': CONFIGURATION,
        'encoder': {'version': 'voice-semantic-1.0', 'provider': 'nvidia', 'model': MODEL,
                    'dimensions': 2048, 'inputType': 'passage', 'normalization': 'l2'},
        'topics': models, 'trainingArticleHashes': sorted({value for model in models.values() for value in model['trainingArticleHashes']}),
        'evaluation': report}
    paths = [local_path(args.candidate), local_path(args.report)]
    if len(set(paths)) != 2 or any(path.exists() for path in paths):
        raise ValueError('Preserve prior outputs and use separate new candidate/report paths')
    for path, value in zip(paths, [candidate, report]):
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
    print(json.dumps({'version': version, 'trainedTopics': list(models), 'reports': reports}, ensure_ascii=True))


if __name__ == '__main__':
    main()
