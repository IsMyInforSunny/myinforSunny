"""Train content stance, never publisher identity, from grounded AI annotations.

All bodies, labels, split identities and experimental weights stay local.
Held-out agreement measures reproduction of the AI teacher, not human accuracy.
No network, API keys, new collection, publisher rankings or political labels.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re

PROPOSITIONS = {
    'medical_school_quota': '의과대학 입학 정원을 확대해야 한다.',
    'pension_reform': '국민연금 보험료율을 인상해야 한다.',
    'minimum_wage': '최저임금을 인상해야 한다.',
    'electricity_prices': '전기요금을 인상해야 한다.',
    'housing_supply': '주택 공급을 확대해야 한다.',
    'nuclear_energy': '원자력 발전을 확대해야 한다.',
}
LABELS = {'support', 'oppose', 'mixed', 'not_expressed', 'undetermined'}
CLASSES = ['non_directional', 'oppose', 'support']
SCOPE = 2000
VERSION = 'content-stance-svm-1.0'
ROOT = Path(__file__).resolve().parent.parent
MIN_CLASS_SAMPLES = 10
MIN_TEACHER_AGREEMENT = .60
MIN_DIRECTION_RECALL = .50


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def article_prefix(text):
    return text.encode('utf-16-le')[:SCOPE * 2].decode('utf-16-le', errors='ignore')


def normalize(text):
    return re.sub(r'[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+', ' ', text).strip(' ')


def model_text(text, topic):
    # The canonical proposition conditions the classifier. Publication identity
    # is never a feature or a target, and common publisher footer names are masked.
    body = re.sub(r'데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)', '', article_prefix(text), flags=re.I)
    return normalize(PROPOSITIONS[topic] + '\n' + body)


def validate_labels(corpus, annotations):
    by_id = {row['id']: row for row in corpus}
    if len(by_id) != len(corpus):
        raise ValueError('Duplicate article ids in corpus')
    seen, accepted, counts = set(), [], Counter()
    teacher = None
    for label in annotations:
        article_id = label.get('articleId')
        row = by_id.get(article_id)
        if not row or article_id in seen:
            raise ValueError('Unknown or repeated annotation article')
        seen.add(article_id)
        topic = label.get('topicId')
        annotator = label.get('annotator', {})
        if (topic not in PROPOSITIONS or row.get('topicId') != topic
                or label.get('proposition') != PROPOSITIONS[topic]
                or label.get('label') not in LABELS or label.get('scopeCharacters') != SCOPE
                or type(label.get('topicRelevant')) is not bool
                or annotator.get('kind') != 'ai' or not annotator.get('model')
                or not annotator.get('version')):
            raise ValueError('Invalid annotation scope, proposition or AI provenance')
        identity = (annotator['kind'], annotator['model'], annotator['version'])
        teacher = teacher or identity
        if identity != teacher:
            raise ValueError('Do not combine different teacher versions')
        text = article_prefix(row['text'])
        evidence = label.get('evidence')
        if not isinstance(evidence, list) or not evidence:
            raise ValueError('Every annotation needs actual body evidence')
        for span in evidence:
            start, end, quote = span.get('start'), span.get('end'), span.get('quote')
            if (type(start) is not int or type(end) is not int or start < 0
                    or end <= start or end > len(text) or not isinstance(quote, str)
                    or not quote.strip() or len(quote) > 200 or text[start:end] != quote):
                raise ValueError('Annotation quote does not match actual article')
        counts['annotated'] += 1
        counts['label:' + label['label']] += 1
        if not label['topicRelevant']:
            counts['off_proposition'] += 1
            continue
        if label['label'] == 'undetermined':
            counts['undetermined'] += 1
            continue
        if label.get('uncertain') is True:
            counts['uncertain'] += 1
            continue
        target = label['label'] if label['label'] in {'support', 'oppose'} else 'non_directional'
        # Date/topic grouping is conservative: articles in the same six-day
        # bucket cannot leak between splits. Event IDs can merge further below.
        day = str(row.get('publishedAt', ''))[:10]
        from datetime import date
        bucket = date.fromisoformat(day).toordinal() // 6
        accepted.append({'article': row, 'annotation': label, 'target': target,
                         'group': f'{topic}:{bucket}',
                         'hash': hashlib.sha256(normalize(text).encode()).hexdigest()})
    return accepted, dict(counts), teacher


def train(corpus, annotations, seed=42, event_groups=None):
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score, recall_score
    from sklearn.model_selection import GroupShuffleSplit
    from sklearn.svm import LinearSVC
    rows, counts, teacher = validate_labels(corpus, annotations)
    class_counts = Counter(row['target'] for row in rows)
    report = {'schemaVersion': 'stance-training-report-1.0', 'task': 'article_stance_toward_proposition',
              'scopeCharacters': SCOPE, 'teacher': list(teacher) if teacher else None,
              'humanEvaluationCount': 0, 'counts': counts, 'classCounts': dict(class_counts),
              'trainingArticleCount': len(rows), 'publisherIdentityUsedAsLabel': False,
              'politicalLabelsCreated': 0, 'ready': False, 'blockers': []}
    for label in CLASSES:
        if class_counts[label] < MIN_CLASS_SAMPLES:
            report['blockers'].append('insufficient_class:' + label)
    if any(class_counts[label] < 2 for label in CLASSES):
        return None, report
    # Merge event IDs, date buckets and exact originals into connected groups.
    parent = list(range(len(rows)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    identities = {}
    for i, row in enumerate(rows):
        keys = [('date', row['group']), ('body', row['hash'])]
        event = (event_groups or {}).get(row['article']['id'])
        if event:
            keys.append(('event', event))
        source = row['article'].get('sourceGroupId')
        if source:
            keys.append(('original', source))
        for key in keys:
            if key in identities:
                parent[find(i)] = find(identities[key])
            else:
                identities[key] = i
    groups = [find(i) for i in range(len(rows))]
    target = np.array([row['target'] for row in rows])
    split = None
    # Only class coverage chooses the split. No outcome metric is inspected.
    for a, b in GroupShuffleSplit(n_splits=64, test_size=.30, random_state=seed).split(rows, target, groups):
        if all(Counter(target[i] for i in a)[label] >= 1
               and Counter(target[i] for i in b)[label] >= 1 for label in CLASSES):
            split = (a, b)
            break
    if split is None:
        report['blockers'].append('independent_group_split_unavailable')
        return None, report
    training, evaluation = split
    texts = [model_text(row['article']['text'], row['article']['topicId']) for row in rows]
    vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                 norm='l2', sublinear_tf=True, max_features=12000)
    train_x = vectorizer.fit_transform([texts[i] for i in training])
    test_x = vectorizer.transform([texts[i] for i in evaluation])
    classifier = LinearSVC(C=1.0, class_weight='balanced', random_state=seed, max_iter=20000)
    classifier.fit(train_x, target[training])
    train_decisions = classifier.decision_function(train_x)
    classes = classifier.classes_.tolist()
    contrasts = train_decisions[:, classes.index('support')] - train_decisions[:, classes.index('oppose')]
    coordinate_scale = max(float(np.quantile(np.abs(contrasts), .95)), 1e-6)
    predictions = classifier.predict(test_x)
    macro = float(f1_score(target[evaluation], predictions, labels=CLASSES, average='macro', zero_division=0))
    recalls = recall_score(target[evaluation], predictions, labels=CLASSES, average=None, zero_division=0)
    majority = Counter(target[training]).most_common(1)[0][0]
    majority_macro = float(f1_score(target[evaluation], [majority]*len(evaluation), labels=CLASSES, average='macro', zero_division=0))
    report.update({'trainingCount': len(training), 'heldoutCount': len(evaluation),
                   'heldoutGroupCount': len(set(groups[i] for i in evaluation)),
                   'groupOverlap': len(set(groups[i] for i in training) & set(groups[i] for i in evaluation)),
                   'splitId': digest({'training': sorted(rows[i]['hash'] for i in training),
                                      'evaluation': sorted(rows[i]['hash'] for i in evaluation)}),
                   'aiTeacherAgreement': {'macroF1': macro, 'balancedAccuracy': float(balanced_accuracy_score(target[evaluation], predictions)),
                                          'majorityMacroF1': majority_macro,
                                          'recall': dict(zip(CLASSES, map(float, recalls))),
                                          'confusion': confusion_matrix(target[evaluation], predictions, labels=CLASSES).tolist()},
                   'thresholds': {'macroF1': MIN_TEACHER_AGREEMENT, 'directionRecall': MIN_DIRECTION_RECALL},
                   'features': len(vectorizer.vocabulary_)})
    if macro < MIN_TEACHER_AGREEMENT or macro <= majority_macro:
        report['blockers'].append('teacher_agreement_below_threshold')
    if recalls[CLASSES.index('support')] < MIN_DIRECTION_RECALL or recalls[CLASSES.index('oppose')] < MIN_DIRECTION_RECALL:
        report['blockers'].append('direction_recall_below_threshold')
    if report['groupOverlap']:
        raise ValueError('Source/event group leakage')
    # A passing automatic test is not an independent human evaluation or a
    # grant of rights for the article corpus or public model distribution.
    usage = all(row['article'].get('usage', {}).get('trainingAllowed') is True
                and row['article'].get('usage', {}).get('modelDistributionAllowed') is True for row in rows)
    if not usage:
        report['blockers'].append('usage_review_pending')
    report['automaticChecksPassed'] = not any(b != 'usage_review_pending' for b in report['blockers'])
    report['ready'] = not report['blockers']
    model = {'schemaVersion': VERSION, 'version': digest({'split': report['splitId'], 'labels': annotations, 'seed': seed})[:24],
             'task': report['task'], 'status': 'ready' if report['ready'] else 'research',
             'scopeCharacters': SCOPE, 'propositions': PROPOSITIONS, 'classes': classifier.classes_.tolist(),
             'vectorizer': {'vocabulary': {key: int(value) for key, value in vectorizer.vocabulary_.items()},
                            'idf': vectorizer.idf_.tolist()},
             'coefficients': classifier.coef_.tolist(), 'intercepts': classifier.intercept_.tolist(),
             'coordinateScale': coordinate_scale,
             'evaluation': report, 'trainingHashes': sorted(rows[i]['hash'] for i in training)}
    return model, report


def read_rows(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def public_status(report):
    agreement = report.get('aiTeacherAgreement')
    return {'schemaVersion': 'stance-training-status-1.0', 'ready': bool(report.get('ready')),
            'version': report.get('teacher', [None, None, None])[2] if report.get('teacher') else None,
            'annotatedArticleCount': report.get('counts', {}).get('annotated', 0),
            'relevantArticleCount': (report.get('counts', {}).get('annotated', 0)
                                     - report.get('counts', {}).get('off_proposition', 0)),
            'classCounts': report.get('classCounts', {}),
            'blockers': report.get('blockers', []),
            'aiTeacherAgreement': ({'macroF1': agreement['macroF1'],
                                   'majorityMacroF1': agreement['majorityMacroF1'],
                                   'recall': agreement['recall']} if agreement else None),
            'humanEvaluationCount': report.get('humanEvaluationCount', 0)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', required=True)
    parser.add_argument('--labels', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--event-groups')
    parser.add_argument('--status-output', help='Write aggregate readiness only to lib/data/stance-model-status.json')
    args = parser.parse_args()
    # Experimental weights and labels cannot be accidentally written to source.
    output = Path(args.output).resolve()
    if not output.is_relative_to(ROOT / '.sites-runtime'):
        raise ValueError('Research model output must stay beneath .sites-runtime')
    events = json.loads(Path(args.event_groups).read_text(encoding='utf-8')) if args.event_groups else None
    if events and 'articleGroups' in events:
        events = events['articleGroups']
    model, report = train(read_rows(args.corpus), read_rows(args.labels), event_groups=events)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(model, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    destination = Path(args.report)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    if args.status_output:
        status_path = Path(args.status_output).resolve()
        if status_path != (ROOT / 'lib/data/stance-model-status.json').resolve():
            raise ValueError('Aggregate readiness output is restricted to lib/data/stance-model-status.json')
        status_path.write_text(json.dumps(public_status(report), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
