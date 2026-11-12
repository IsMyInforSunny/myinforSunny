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


def model_text(text):
    return normalize(re.sub(r'데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)', '', text, flags=re.I))


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
        for unit in units:
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
        keys = [('article', article['id']), ('body', row['hash']),
                ('sentence', model_text(row['text']))]
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
        report['topics'][topic] = result
        result['blockers'] += ['insufficient_class:' + label for label in CLASSES if counts[label] < 10]
        if any(counts[label] < 2 for label in CLASSES):
            continue
        groups = connected_groups(rows, event_groups)
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
        vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                     norm='l2', sublinear_tf=True, max_features=12000)
        train_text = [model_text(rows[i]['text']) for i in training]
        test_text = [model_text(rows[i]['text']) for i in evaluation]
        train_x, test_x = vectorizer.fit_transform(train_text), vectorizer.transform(test_text)
        classifiers, heads = {}, {}
        for name in ['direction', 'speaker', 'issue']:
            classifier = LinearSVC(C=1., class_weight='balanced', random_state=seed, max_iter=20000)
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
        # Replace source names in held-out sentences; the transform must remove them.
        masked_x = vectorizer.transform([model_text('데일리안 ' + text + ' 프레시안') for text in test_text])
        masking = float(np.mean(classifier.predict(masked_x) == prediction))
        flips = (challenge or {}).get('pairs', [])
        flips = [pair for pair in flips if pair.get('topic') == topic]
        flip_accuracy = None
        # Independent, exact opposite pairs are supplied, not inferred from swapping a substring.
        valid_flips = [pair for pair in flips if pair.get('issue') in DEFINITION['topics'][topic]['issues']
                       and isinstance(pair.get('support'), str) and isinstance(pair.get('oppose'), str)
                       and pair['support'].strip() and pair['oppose'].strip() and pair['support'] != pair['oppose']
                       and all(model_text(pair[label]) not in train_text for label in ['support', 'oppose'])]
        if len(valid_flips) >= 10 and (challenge or {}).get('version') == VERSION:
            flip_text = [model_text(pair[label]) for pair in valid_flips for label in ['support', 'oppose']]
            flip_target = ['support', 'oppose'] * len(valid_flips)
            flip_accuracy = float(np.mean(classifier.predict(vectorizer.transform(flip_text)) == flip_target))
        evaluation_report = {'ready': False, 'groupOverlap': len(set(groups[i] for i in training) & set(groups[i] for i in evaluation)),
            'heldoutArticleCount': len({rows[i]['article']['id'] for i in evaluation}),
            'macroF1': macro, 'majorityMacroF1': majority_macro,
            'supportRecall': float(recalls[CLASSES.index('support')]), 'opposeRecall': float(recalls[CLASSES.index('oppose')]),
            'speakerMacroF1': other['speaker'], 'issueMacroF1': other['issue'],
            'maskingAgreement': masking, 'flipAccuracy': flip_accuracy, 'classCounts': dict(counts)}
        if macro < .6 or macro <= majority_macro:
            result['blockers'].append('teacher_agreement_below_threshold')
        if min(evaluation_report['supportRecall'], evaluation_report['opposeRecall']) < .5:
            result['blockers'].append('direction_recall_below_threshold')
        if min(other.values()) < .6:
            result['blockers'].append('speaker_or_issue_below_threshold')
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
             'events': event_groups, 'challenge': challenge, 'seed': seed})[:24],
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
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
