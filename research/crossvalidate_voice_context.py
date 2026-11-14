"""Training-only context ablation using retained actual sentence vectors.

Never reads outer/challenge labels or uses their vectors. Missing neighboring
vectors are explicit zero blocks plus presence flags, not invented embeddings.
No provider calls, release, or margin/hyperparameter search.
"""
import argparse
import hashlib
import json

import numpy as np
from sklearn.metrics import f1_score
from sklearn.model_selection import GroupKFold
from sklearn.svm import LinearSVC
from sklearn.feature_extraction.text import TfidfVectorizer
from scipy.sparse import csr_matrix, hstack

from prepare_voice_embeddings import local_path, natural_text, MODEL
from train_stance import digest, read_rows
from train_voice import selective_predict, serialize_head


def unit_vector(value):
    vector = np.asarray(value, dtype=np.float64)
    if vector.shape != (2048,) or not np.isfinite(vector).all():
        raise ValueError('Invalid sentence vector')
    norm = np.hypot.reduce(vector)
    if not np.isfinite(norm) or norm <= 0:
        raise ValueError('Invalid vector norm')
    return vector / norm


def training_features(prepared, vectors, corpus):
    payload = {key: value for key, value in prepared.items() if key != 'inputDigest'}
    if prepared.get('inputDigest') != digest(payload) or vectors.get('inputDigest') != prepared['inputDigest']:
        raise ValueError('Input/vector digest mismatch')
    if vectors.get('model') != MODEL or vectors.get('dimensions') != 2048:
        raise ValueError('Wrong encoder')
    rows = prepared['sets']['train']
    records = {row['key']: row for row in prepared['records'] if row['partition'] == 'train'}
    # Only selected train articles are inspected; other corpus bodies are ignored.
    articles = {article['id']: article for article in corpus if article['id'] in {row['articleId'] for row in rows}}
    matrix, context, counts = [], [], {'previous': 0, 'following': 0, 'missing': 0}
    zero = np.zeros(2048)
    for row in rows:
        article = articles[row['articleId']]
        if article.get('voiceVersion') != 'sentence-voice-1.0' or article.get('segmenter') != 'sentence-3.1':
            raise ValueError('Incompatible article sentence identity')
        units = article['sentences']
        indices = [i for i, unit in enumerate(units) if unit['sentenceId'] == row['sentenceId']]
        if len(indices) != 1:
            raise ValueError('Training sentence must have exactly one source')
        at = indices[0]
        key = hashlib.sha256(natural_text(units[at]['text']).encode()).hexdigest()
        record = records.get(key)
        if key != row['key'] or not record or natural_text(units[at]['text']) != record['text']:
            raise ValueError('Training sentence grounding mismatch')
        current = unit_vector(vectors['vectors'][key])
        matrix.append(current)
        neighboring, present = [], []
        for name, index in [('previous', at - 1), ('following', at + 1)]:
            key = hashlib.sha256(natural_text(units[index]['text']).encode()).hexdigest() if 0 <= index < len(units) else None
            record = records.get(key)
            # A train partition key alone is insufficient: tie context to this
            # exact article/sentence so another article cannot donate context.
            grounded = record and any(source['articleId'] == row['articleId'] and source['sentenceId'] == units[index]['sentenceId']
                                      for source in record['sourceIDs'])
            available = bool(grounded and key in vectors['vectors'])
            neighboring.append(unit_vector(vectors['vectors'][key]) if available else zero)
            present.append(float(available))
            counts[name] += available
            counts['missing'] += not available
        value = np.concatenate([current, *neighboring, np.asarray(present)])
        context.append(value / np.hypot.reduce(value))
    return rows, np.vstack(matrix), np.vstack(context), counts


def context_texts(rows, corpus):
    articles = {article['id']: article for article in corpus if article['id'] in {row['articleId'] for row in rows}}
    values = []
    for row in rows:
        units = articles[row['articleId']]['sentences']
        matches = [at for at, unit in enumerate(units) if unit['sentenceId'] == row['sentenceId']]
        if len(matches) != 1:
            raise ValueError('Context sentence identity mismatch')
        at = matches[0]
        values.append(natural_text(' '.join(unit['text'] for unit in units[max(0, at - 1):at + 2])))
    return values


def evaluate(rows, matrix, lexical=None, lexical_heads=None):
    groups = np.asarray([row['group'] for row in rows])
    if len(set(groups)) < 5:
        raise ValueError('Five training event groups required')
    predictions, issue_errors, speaker_errors, directional_count = [None] * len(rows), 0, 0, 0
    folds = []
    for train, validation in GroupKFold(n_splits=5).split(matrix, groups=groups):
        if set(groups[train]) & set(groups[validation]):
            raise ValueError('Training event leakage')
        heads = {}
        model_inputs = {}
        train_x, validation_x = matrix[train], matrix[validation]
        if lexical is not None:
            # Fit vocabulary/IDF only inside each training fold. Neighboring
            # text in the validation event cannot enter learned preprocessing.
            encoder = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), max_features=12000,
                                      sublinear_tf=True, norm='l2')
            words = encoder.fit_transform([lexical[i] for i in train])
            train_x = hstack([csr_matrix(train_x), words], format='csr') / np.sqrt(2)
            validation_x = hstack([csr_matrix(validation_x), encoder.transform([lexical[i] for i in validation])], format='csr') / np.sqrt(2)
        for name in ['directionality', 'polarity', 'speaker', 'issue']:
            selected = [j for j, i in enumerate(train) if name != 'polarity' or rows[i]['direction'] != 'neutral']
            targets = [('neutral' if rows[train[j]]['direction'] == 'neutral' else 'directional') if name == 'directionality'
                       else rows[train[j]]['direction' if name == 'polarity' else name] for j in selected]
            if len(set(targets)) < 2:
                raise ValueError('Fold lacks head classes')
            classifier = LinearSVC(C=1., class_weight='balanced', random_state=42, max_iter=20000)
            use_context = lexical is not None and (lexical_heads is None or name in lexical_heads)
            classifier.fit((train_x if use_context or lexical is None else matrix[train])[selected], targets)
            heads[name] = serialize_head(classifier)
            model_inputs[name] = validation_x if use_context or lexical is None else matrix[validation]
        # Heads may use different feature widths; compose the identical margin
        # gate without concatenating incompatible coefficient arrays.
        predicted = {name: selective_predict(heads[name], model_inputs[name]) for name in heads}
        gates, polarity = predicted['directionality'], predicted['polarity']
        output = {'direction': [None if gate is None else 'neutral' if gate == 'neutral' else value for gate, value in zip(gates, polarity)],
                  'speaker': predicted['speaker'], 'issue': predicted['issue']}
        for j, index in enumerate(validation):
            direction, issue, speaker = [output[name][j] for name in ['direction', 'issue', 'speaker']]
            if direction == 'neutral' or direction is not None and issue is not None and speaker is not None and issue != 'none':
                predictions[index] = direction
                if direction in ['support', 'oppose']:
                    directional_count += 1
                    issue_errors += issue != rows[index]['issue']
                    speaker_errors += speaker != rows[index]['speaker']
        folds.append({'train': len(train), 'validation': len(validation), 'groupOverlap': 0})
    return {'count': len(rows), 'accepted': sum(value is not None for value in predictions),
            'directionMacroF1': float(f1_score([row['direction'] for row in rows], [value or '__unresolved__' for value in predictions],
                                              labels=['neutral', 'oppose', 'support'], average='macro', zero_division=0)),
            'acceptedDirectional': directional_count, 'directionalIssueErrors': int(issue_errors),
            'directionalSpeakerErrors': int(speaker_errors), 'folds': folds}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['input', 'vectors', 'corpus', 'output']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    paths = [local_path(getattr(args, name)) for name in ['input', 'vectors', 'corpus', 'output']]
    if len(set(paths)) != 4 or paths[-1].exists():
        raise ValueError('Preserve inputs and reports')
    prepared, vectors = [json.loads(path.read_text(encoding='utf-8-sig')) for path in paths[:2]]
    corpus = read_rows(paths[2])
    rows, current, context, counts = training_features(prepared, vectors, corpus)
    report = {'schemaVersion': 'voice-context-cv-1.0', 'inputDigest': prepared['inputDigest'], 'partition': 'train-only',
              'apiCalls': 0, 'outerEvaluated': False, 'releaseReady': False,
              'configuration': {'C': 1., 'minimumMarginGap': .15, 'classWeight': 'balanced', 'folds': 5,
                                'context': 'L2(current,previous,following,presenceFlags); train-record neighbors only',
                                'lexical': 'char 2..4, max12000, sublinearTF, training-fold IDF, equal L2 block weight',
                                'modes': ['current', 'context', 'lexicalContext', 'lexicalDirectionSpeaker']},
              'neighborCoverage': counts, 'current': evaluate(rows, current), 'context': evaluate(rows, context),
              'lexicalContext': evaluate(rows, current, context_texts(rows, corpus)),
              'lexicalDirectionSpeaker': evaluate(rows, current, context_texts(rows, corpus), ['directionality', 'polarity', 'speaker']),
              'meaning': 'Actual training articles only; development ablation, not independent accuracy or operational bias readiness.'}
    paths[-1].write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
