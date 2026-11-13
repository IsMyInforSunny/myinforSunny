"""Sentence voice SVM: topic-specific direction, speaker and sub-issue heads.

Prepared input uses the site's sentence-3.1 natural sentences and UTF-16 offsets.
Labels are AI teacher drafts; held-out agreement is never human accuracy.
All candidate weights, quotations and split identities remain local.
"""
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path
import re

from train_stance import ROOT, digest, normalize, read_rows

DEFINITION = json.loads((ROOT / 'lib/data/voice-issues.json').read_text(encoding='utf-8'))
VERSION = DEFINITION['version']
CLASSES = ['neutral', 'oppose', 'support']
TRAINER_VERSION = 'sentence-voice-trainer-1.2'
TRAINING_CONFIG = {'analyzer': 'char', 'ngramRange': [2, 4], 'lowercase': False,
                   'sublinearTf': True, 'norm': 'l2', 'maxFeatures': 12000,
                   'C': 1., 'classWeight': 'balanced', 'maxIterations': 20000,
                   'minimumMarginGap': .15, 'minimumIndependentFlipPairs': 10,
                   'encoderVersion': 'voice-context-1.0', 'contextSentences': 1, 'currentRepeats': 2}


def model_text(text):
    return normalize(re.sub(r'데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)', '', text, flags=re.I))


def feature_text(text, previous='', following=''):
    """Fixed context, chosen for attribution/antecedents, never by heldout tuning.

    The label still belongs to the current sentence. No neighbouring labels
    are used and the window never crosses an article or the 2000-char scope.
    """
    return model_text('[PREVIOUS] ' + previous + '\n[CURRENT] ' + text
                      + '\n[CURRENT] ' + text + '\n[NEXT] ' + following)


def utf16_slice(text, start, end):
    return text.encode('utf-16-le')[start * 2:end * 2].decode('utf-16-le')


def validate(corpus, annotations):
    by_id = {row['id']: row for row in corpus}
    if len(by_id) != len(corpus):
        raise ValueError('Duplicate articles')
    rows, seen, teacher = [], set(), None
    for annotation in annotations:
        article_id = annotation.get('articleId')
        article = by_id.get(article_id)
        if article is None or article_id in seen:
            raise ValueError('Unknown or duplicate article annotation')
        seen.add(article_id)
        topic = article.get('topicId')
        if (topic not in DEFINITION['topics'] or annotation.get('topic') != topic
                or annotation.get('version') != VERSION or article.get('voiceVersion') != VERSION
                or article.get('segmenter') != 'sentence-3.1' or annotation.get('segmenter') != 'sentence-3.1'
                or article.get('scopeCharacters') != 2000 or annotation.get('scopeCharacters') != 2000):
            raise ValueError('Incompatible sentence/topic scope')
        author = annotation.get('annotator', {})
        if author.get('kind') != 'ai' or not author.get('model') or not author.get('version'):
            raise ValueError('Missing actual AI teacher provenance')
        identity = (author['kind'], author['model'], author['version'])
        teacher = teacher or identity
        if teacher != identity:
            raise ValueError('Do not mix annotation versions')
        units = article.get('sentences', [])
        labels = annotation.get('labels', [])
        by_sentence = {label.get('sentenceId'): label for label in labels}
        if (not units or len(by_sentence) != len(labels) or len(labels) != len(units)
                or set(by_sentence) != {unit['sentenceId'] for unit in units}):
            raise ValueError('Labels must cover every natural sentence exactly once')
        article_hash = hashlib.sha256(normalize(article['text']).encode()).hexdigest()
        if annotation.get('articleHash') != article_hash:
            raise ValueError('Annotation belongs to a different article body')
        last = 0
        for unit_index, unit in enumerate(units):
            start, end = unit['start'], unit['end']
            if (type(start) is not int or type(end) is not int or start < last or end <= start
                    or end > 2000 or utf16_slice(article['text'], start, end) != unit['text']):
                raise ValueError('Sentence does not match original UTF-16 range')
            last = end
            label = by_sentence[unit['sentenceId']]
            if (label.get('direction') not in CLASSES + ['uncertain']
                    or label.get('speaker') not in ['journalist', 'source', 'mixed', 'unknown']
                    or label.get('issue') not in list(DEFINITION['topics'][topic]['issues']) + ['none', 'unknown']):
                raise ValueError('Invalid voice label')
            if label['direction'] in ['support', 'oppose'] and label['issue'] in ['none', 'unknown']:
                raise ValueError('Direction needs a single defined sub-issue')
            if label['direction'] == 'uncertain' or label['speaker'] in ['mixed', 'unknown'] or label['issue'] == 'unknown':
                continue
            rows.append({'article': article, 'hash': article_hash, 'text': unit['text'],
                         'previous': units[unit_index - 1]['text'] if unit_index else '',
                         'following': units[unit_index + 1]['text'] if unit_index + 1 < len(units) else '',
                         'sentenceId': unit['sentenceId'], 'topic': topic,
                         'direction': label['direction'], 'speaker': label['speaker'], 'issue': label['issue']})
    return rows, teacher


def connected_groups(rows, events=None):
    """Every article, original, duplicate sentence, event and date bucket stays together."""
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    identities = {}
    for i, row in enumerate(rows):
        article = row['article']
        keys = [('article', article['id']), ('body', row['hash'])]
        sentence = model_text(row['text'])
        if sentence:
            keys.append(('sentence', sentence))
        day = date.fromisoformat(article['publishedAt'][:10]).toordinal() // 6
        keys.append(('date', row['topic'], day))
        event = (events or {}).get(article['id']) or article.get('eventId')
        if event:
            keys.append(('event', event))
        if article.get('sourceGroupId'):
            keys.append(('original', article['sourceGroupId']))
        for key in keys:
            if key in identities:
                parent[find(i)] = find(identities[key])
            else:
                identities[key] = i
    return [find(i) for i in range(len(rows))]


def serialize_head(classifier):
    weights, intercepts = classifier.coef_.tolist(), classifier.intercept_.tolist()
    # sklearn's binary decision is one signed row; runtime uses a row per class.
    if len(classifier.classes_) == 2:
        weights, intercepts = [[-x for x in weights[0]], weights[0]], [-intercepts[0], intercepts[0]]
    return {'classes': classifier.classes_.tolist(), 'coefficients': weights, 'intercepts': intercepts}


def selective_predict(head, features, minimum_gap=TRAINING_CONFIG['minimumMarginGap']):
    """Mirror exported row-per-class runtime decisions, including binary gap x2.

    Input is already L2-normalized by the shared TF-IDF encoder. An empty row,
    a non-finite margin or an insufficient first/second gap is unresolved.
    """
    import numpy as np
    from scipy.sparse import issparse
    scores = np.asarray(features @ np.asarray(head['coefficients']).T) + np.asarray(head['intercepts'])
    present = (np.asarray(features.getnnz(axis=1)).ravel() > 0 if issparse(features)
               else np.any(np.asarray(features) != 0, axis=1))
    predictions = []
    for values, recognized in zip(scores, present):
        if not recognized or not np.all(np.isfinite(values)):
            predictions.append(None)
            continue
        order = np.argsort(-values, kind='stable')
        predictions.append(head['classes'][order[0]] if values[order[0]] - values[order[1]] >= minimum_gap else None)
    return predictions


def runtime_evaluation(rows, heads, features):
    """Count abstentions as missed labels; also report coverage of usable triples."""
    from sklearn.metrics import f1_score, recall_score
    names = ['direction', 'speaker', 'issue']
    predictions = {name: selective_predict(heads[name], features) for name in names}
    usable = [all(predictions[name][i] is not None for name in names)
              and not (predictions['direction'][i] in ['support', 'oppose']
                       and predictions['issue'][i] == 'none') for i in range(len(rows))]
    result = {'minimumMarginGap': TRAINING_CONFIG['minimumMarginGap'], 'count': len(rows),
              'jointUsableCount': sum(usable), 'jointCoverage': sum(usable) / len(rows), 'heads': {}}
    for name in names:
        target = [row[name] for row in rows]
        actual = [value if value is not None else '__unresolved__' for value in predictions[name]]
        joint = [value if usable[i] else '__unresolved__' for i, value in enumerate(actual)]
        classes = heads[name]['classes']
        accepted = sum(value is not None for value in predictions[name])
        result['heads'][name] = {'acceptedCount': accepted, 'abstainedCount': len(rows) - accepted,
            'coverage': accepted / len(rows),
            'macroF1': float(f1_score(target, actual, labels=classes, average='macro', zero_division=0)),
            'jointMacroF1': float(f1_score(target, joint, labels=classes, average='macro', zero_division=0))}
        if name == 'direction':
            recalls = recall_score(target, joint, labels=CLASSES, average=None, zero_division=0)
            result.update({'macroF1': result['heads'][name]['jointMacroF1'],
                           'supportRecall': float(recalls[CLASSES.index('support')]),
                           'opposeRecall': float(recalls[CLASSES.index('oppose')])})
    correct = sum(usable[i] and all(predictions[name][i] == row[name] for name in names)
                  for i, row in enumerate(rows))
    result.update({'jointCorrectCount': correct, 'jointAccuracy': correct / sum(usable) if any(usable) else None})
    return result


def independent_flip_pairs(challenge, topic, excluded_texts):
    """A repeated pair or reused sentence cannot count as independent evidence."""
    if not isinstance(challenge, dict) or challenge.get('version') != VERSION:
        return []
    seen, pairs = set(excluded_texts), []
    for pair in challenge.get('pairs', []):
        if (not isinstance(pair, dict) or pair.get('topic') != topic
                or pair.get('issue') not in DEFINITION['topics'][topic]['issues']
                or not all(isinstance(pair.get(label), str) for label in ['support', 'oppose'])):
            continue
        support, oppose = model_text(pair['support']), model_text(pair['oppose'])
        if not support or not oppose or support == oppose or support in seen or oppose in seen:
            continue
        seen.update([support, oppose])
        pairs.append({**pair, 'support': support, 'oppose': oppose})
    return pairs


def flip_evaluation(head, features):
    """Each adjacent support/opposition pair must have BOTH answers correct."""
    prediction = selective_predict(head, features)
    if not prediction or len(prediction) % 2:
        raise ValueError('Flip challenge needs complete support/opposition pairs')
    correct = [prediction[i] == 'support' and prediction[i + 1] == 'oppose'
               for i in range(0, len(prediction), 2)]
    return {'pairAccuracy': sum(correct) / len(correct), 'pairCount': len(correct),
            'itemAccuracy': sum(value == ('support' if i % 2 == 0 else 'oppose')
                                for i, value in enumerate(prediction)) / len(prediction),
            'abstainedCount': sum(value is None for value in prediction)}


def train(corpus, annotations, seed=42, event_groups=None, challenge=None):
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics import f1_score, recall_score
    from sklearn.model_selection import GroupShuffleSplit
    from sklearn.svm import LinearSVC
    accepted, teacher = validate(corpus, annotations)
    report = {'schemaVersion': 'sentence-voice-report-1.0', 'version': VERSION,
              'teacher': list(teacher) if teacher else None, 'humanEvaluationCount': 0,
              'annotatedArticles': len(annotations), 'usableSentences': len(accepted),
              'ready': False, 'blockers': [], 'topics': {}}
    models, training_hashes = {}, set()
    for topic in sorted({article['topicId'] for article in corpus}):
        rows = [row for row in accepted if row['topic'] == topic]
        counts = Counter(row['direction'] for row in rows)
        result = {'ready': False, 'classCounts': dict(counts), 'blockers': []}
        groups = connected_groups(rows, event_groups)
        # Aggregate diagnostics show which label needs genuinely independent
        # articles; repeated sentences are not additional evaluation events.
        result['labelCoverage'] = {name: {label: {
            'sentences': sum(row[name] == label for row in rows),
            'articles': len({row['article']['id'] for row in rows if row[name] == label}),
            'groups': len({groups[i] for i, row in enumerate(rows) if row[name] == label})}
            for label in sorted({row[name] for row in rows})}
            for name in ['direction', 'speaker', 'issue']}
        report['topics'][topic] = result
        result['blockers'] += ['insufficient_class:' + label for label in CLASSES if counts[label] < 10]
        if any(counts[label] < 2 for label in CLASSES):
            continue
        target = np.array([row['direction'] for row in rows])
        split = None
        if len(set(groups)) < 2:
            result['blockers'].append('independent_group_split_unavailable')
            continue
        for training, evaluation in GroupShuffleSplit(n_splits=64, test_size=.3, random_state=seed).split(rows, target, groups):
            # Choose by coverage alone, never pick the best-scoring split.
            if all(set(rows[i][name] for i in training) == set(rows[i][name] for i in evaluation)
                   and len(set(rows[i][name] for i in training)) >= 2 for name in ['direction', 'speaker', 'issue']):
                split = training, evaluation
                break
        if split is None:
            result['blockers'].append('independent_group_split_unavailable')
            continue
        training, evaluation = split
        vectorizer = TfidfVectorizer(analyzer=TRAINING_CONFIG['analyzer'], ngram_range=tuple(TRAINING_CONFIG['ngramRange']),
                                     lowercase=TRAINING_CONFIG['lowercase'], norm=TRAINING_CONFIG['norm'],
                                     sublinear_tf=TRAINING_CONFIG['sublinearTf'], max_features=TRAINING_CONFIG['maxFeatures'])
        train_text = [feature_text(rows[i]['text'], rows[i]['previous'], rows[i]['following']) for i in training]
        test_text = [feature_text(rows[i]['text'], rows[i]['previous'], rows[i]['following']) for i in evaluation]
        train_x, test_x = vectorizer.fit_transform(train_text), vectorizer.transform(test_text)
        classifiers, heads = {}, {}
        for name in ['direction', 'speaker', 'issue']:
            classifier = LinearSVC(C=TRAINING_CONFIG['C'], class_weight=TRAINING_CONFIG['classWeight'],
                                   random_state=seed, max_iter=TRAINING_CONFIG['maxIterations'])
            classifier.fit(train_x, [rows[i][name] for i in training])
            classifiers[name] = classifier
            heads[name] = serialize_head(classifier)
        classifier = classifiers['direction']
        prediction = classifier.predict(test_x)
        macro = float(f1_score(target[evaluation], prediction, labels=CLASSES, average='macro', zero_division=0))
        recalls = recall_score(target[evaluation], prediction, labels=CLASSES, average=None, zero_division=0)
        majority = Counter(target[training]).most_common(1)[0][0]
        majority_macro = float(f1_score(target[evaluation], [majority]*len(evaluation), labels=CLASSES, average='macro', zero_division=0))
        other = {name: float(f1_score([rows[i][name] for i in evaluation], classifiers[name].predict(test_x),
                                    average='macro', zero_division=0)) for name in ['speaker', 'issue']}
        runtime = runtime_evaluation([rows[i] for i in evaluation], heads, test_x)
        # Replace source names in held-out sentences; the transform must remove them.
        masked_x = vectorizer.transform([model_text('데일리안 ' + text + ' 프레시안') for text in test_text])
        masking = float(np.mean(classifier.predict(masked_x) == prediction))
        flip_accuracy = None
        flip_result = None
        # Independent, exact opposite pairs are supplied, not inferred from swapping a substring.
        # Held-out examples cannot also be counted as an independent challenge.
        valid_flips = independent_flip_pairs(challenge, topic, [model_text(row['text']) for row in rows])
        if len(valid_flips) >= TRAINING_CONFIG['minimumIndependentFlipPairs']:
            flip_text = [feature_text(pair[label]) for pair in valid_flips for label in ['support', 'oppose']]
            flip_result = flip_evaluation(heads['direction'], vectorizer.transform(flip_text))
            flip_accuracy = flip_result['pairAccuracy']
        evaluation_report = {'ready': False, 'groupOverlap': len(set(groups[i] for i in training) & set(groups[i] for i in evaluation)),
            'heldoutArticleCount': len({rows[i]['article']['id'] for i in evaluation}),
            'macroF1': macro, 'majorityMacroF1': majority_macro,
            'supportRecall': float(recalls[CLASSES.index('support')]), 'opposeRecall': float(recalls[CLASSES.index('oppose')]),
            'speakerMacroF1': other['speaker'], 'issueMacroF1': other['issue'],
            'maskingAgreement': masking, 'flipAccuracy': flip_accuracy, 'flipChallenge': flip_result,
            'independentFlipPairCount': len(valid_flips), 'runtime': runtime, 'classCounts': dict(counts)}
        if macro < .6 or macro <= majority_macro:
            result['blockers'].append('teacher_agreement_below_threshold')
        if min(evaluation_report['supportRecall'], evaluation_report['opposeRecall']) < .5:
            result['blockers'].append('direction_recall_below_threshold')
        if min(other.values()) < .6:
            result['blockers'].append('speaker_or_issue_below_threshold')
        if runtime['macroF1'] < .6 or runtime['macroF1'] <= majority_macro:
            result['blockers'].append('runtime_teacher_agreement_below_threshold')
        if min(runtime['supportRecall'], runtime['opposeRecall']) < .5:
            result['blockers'].append('runtime_direction_recall_below_threshold')
        if min(runtime['heads'][name]['jointMacroF1'] for name in ['speaker', 'issue']) < .6:
            result['blockers'].append('runtime_speaker_or_issue_below_threshold')
        if masking < .95:
            result['blockers'].append('masking_failed')
        if flip_accuracy is None or flip_accuracy < .5:
            result['blockers'].append('flip_challenge_missing_or_failed')
        if evaluation_report['groupOverlap'] or evaluation_report['heldoutArticleCount'] < 2:
            result['blockers'].append('independent_group_split_unavailable')
        if not all(row['article'].get('usage', {}).get('trainingAllowed') is True
                   and row['article'].get('usage', {}).get('modelDistributionAllowed') is True for row in rows):
            result['blockers'].append('usage_review_pending')
        result.update(evaluation_report)
        result['trainingSentences'], result['heldoutSentences'] = len(training), len(evaluation)
        result['ready'] = not result['blockers']
        evaluation_report['ready'] = result['ready']
        result['splitId'] = digest({'training': sorted({rows[i]['hash'] for i in training}),
                                    'evaluation': sorted({rows[i]['hash'] for i in evaluation})})
        models[topic] = {'vectorizer': {'vocabulary': {k: int(v) for k, v in vectorizer.vocabulary_.items()},
                                      'idf': vectorizer.idf_.tolist()}, **heads, 'evaluation': evaluation_report}
        training_hashes.update(rows[i]['hash'] for i in training)
    report['blockers'] = [topic + ':' + blocker for topic, result in report['topics'].items() for blocker in result['blockers']]
    if not models:
        report['blockers'].append('no_trainable_topic')
    report['ready'] = bool(models) and not report['blockers']
    model = {'schemaVersion': 'sentence-voice-svm-1.0', 'version': digest({'corpus': corpus, 'labels': annotations,
             'events': event_groups, 'challenge': challenge, 'seed': seed, 'trainerVersion': TRAINER_VERSION,
             'trainingConfig': TRAINING_CONFIG, 'definition': DEFINITION,
             'trainerCodeDigest': hashlib.sha256(Path(__file__).read_text(encoding='utf-8').encode()).hexdigest()})[:24],
             'trainerVersion': TRAINER_VERSION, 'trainingConfig': TRAINING_CONFIG,
             'status': 'ready' if report['ready'] else 'research', 'definitionVersion': VERSION,
             'segmenter': 'sentence-3.1', 'scopeCharacters': 2000, 'topics': models,
             'trainingArticleHashes': sorted(training_hashes)}
    return model, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['corpus', 'labels', 'output', 'report']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--event-groups')
    parser.add_argument('--challenge')
    parser.add_argument('--status-output', help='Write aggregate readiness only; never release weights')
    args = parser.parse_args()
    paths = [Path(args.output).resolve(), Path(args.report).resolve()]
    if any(not path.is_relative_to(ROOT / '.sites-runtime') for path in paths):
        raise ValueError('Research models/reports must stay local beneath .sites-runtime')
    load = lambda path: json.loads(Path(path).read_text(encoding='utf-8-sig')) if path else None
    events = load(args.event_groups)
    if events and 'articleGroups' in events:
        events = events['articleGroups']
    model, report = train(read_rows(args.corpus), read_rows(args.labels), event_groups=events, challenge=load(args.challenge))
    for path, value in zip(paths, [model, report]):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    if args.status_output:
        status_path = Path(args.status_output).resolve()
        if status_path != (ROOT / 'lib/data/voice-model-status.json').resolve():
            raise ValueError('Aggregate status destination must be lib/data/voice-model-status.json')
        status_path.write_text(json.dumps({'schemaVersion': 'sentence-voice-training-status-1.0',
            'ready': False, 'candidateReady': report['ready'], 'version': model['version'],
            'annotatedArticleCount': report['annotatedArticles'], 'usableSentenceCount': report['usableSentences'],
            'humanEvaluationCount': 0, 'teacher': report['teacher'], 'blockers': report['blockers'],
            'topics': report['topics']}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
