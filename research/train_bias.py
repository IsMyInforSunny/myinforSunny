"""Offline publisher classifier and exploratory relative-coordinate export.

Publisher identity is the supervised target; political orientation never trains
the SVM. A separate human axis review is required before product activation.
No network, downloads, raw-text exports, or credentials are used.
"""
import argparse
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

VERSION = 'publisher-coordinate-svm-1'
MIN_SAMPLES = 3
EVALUATION_FRACTION = .4
MIN_AXIS_REVIEW_ORIGINALS = 40


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def normalize(text):
    return re.sub(r'\s+', ' ', text).strip()


def content_hash(text):
    return hashlib.sha256(normalize(text).encode('utf-8')).hexdigest()


def reviewed_axis(review, model_version):
    """Validate review metadata without accepting truthy or malformed values."""
    if not isinstance(review, dict):
        return False
    for field in ('reviewedBy', 'evidence', 'reviewedModelVersion'):
        if not isinstance(review.get(field), str) or not review[field].strip():
            return False
    reviewers = review.get('reviewers')
    if (not isinstance(reviewers, list)
            or not all(isinstance(r, str) and r.strip() for r in reviewers)
            or len({r.strip() for r in reviewers}) < 2):
        return False
    count, agreement = review.get('sampleCount'), review.get('interReviewerAgreement')
    return (review.get('status') == 'approved' and review['reviewedModelVersion'] == model_version
            and type(count) is int and count >= MIN_AXIS_REVIEW_ORIGINALS
            and type(agreement) in (int, float) and math.isfinite(agreement) and 0 <= agreement <= 1)


def validate(rows, manifest, synthetic=False, cross_topic=False):
    if not rows or not isinstance(manifest.get('profiles'), list):
        raise ValueError('Need rows and orientation profiles')
    profiles = {p['publisherId']: p['orientation'] for p in manifest['profiles']}
    if len(profiles) != len(manifest['profiles']) or not manifest.get('axisId'):
        raise ValueError('Invalid orientation manifest')
    if any(value not in {'left', 'right', 'unspecified', 'excluded'} for value in profiles.values()):
        raise ValueError('Invalid orientation profile value')
    if not {'left', 'right'}.issubset(profiles.values()):
        raise ValueError('Both orientation anchors are required for validation')
    ids, text_groups, urls, groups = set(), {}, set(), {}
    comparison = set()
    for row in rows:
        for field in ('id', 'publisherId', 'text', 'sourceGroupId', 'comparisonGroup', 'url', 'publishedAt'):
            if not isinstance(row.get(field), str) or not row[field].strip():
                raise ValueError(f'Missing {field}')
        if len(row['comparisonGroup']) > 160:
            raise ValueError('Comparison topic must be at most 160 characters')
        if row['id'] in ids or row['url'] in urls:
            raise ValueError('Duplicate article ID or URL')
        ids.add(row['id']); urls.add(row['url'])
        if row['publisherId'] not in profiles or profiles[row['publisherId']] == 'excluded':
            raise ValueError('Publisher is missing or excluded in orientation manifest')
        parsed = urlparse(row['url'])
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('Need public HTTPS source URLs without credentials')
        if not (parsed.hostname == row['publisherId'] or parsed.hostname.endswith('.' + row['publisherId'])):
            raise ValueError('Source URL does not match publisher identity')
        datetime.fromisoformat(row['publishedAt'].replace('Z', '+00:00'))
        text_hash = content_hash(row['text'])
        if text_groups.setdefault(text_hash, row['sourceGroupId']) != row['sourceGroupId']:
            raise ValueError('Duplicate text must share its original-source group')
        if (row['publisherId'], row['sourceGroupId']) in groups:
            raise ValueError('Repeated publisher/original group is not an independent sample')
        groups[row['publisherId'], row['sourceGroupId']] = True
        usage = row.get('usage', {})
        if synthetic:
            if row.get('provenance') != 'synthetic':
                raise ValueError('Synthetic mode requires explicitly synthetic rows')
        elif (row.get('provenance') != 'public_article' or usage.get('trainingAllowed') is not True
              or usage.get('modelDistributionAllowed') is not True or not usage.get('basisUrl')
              or not usage.get('reviewedBy') or not usage.get('reviewedAt')):
            raise ValueError('Document training and model-distribution permissions for every article')
        comparison.add(row['comparisonGroup'])
    if cross_topic and len(comparison) < 5:
        raise ValueError('Cross-topic training needs at least five reviewed topics')
    if not cross_topic and len(comparison) != 1:
        raise ValueError('Train one comparable proposition/topic per artifact')
    counts = Counter(r['publisherId'] for r in rows)
    if len(counts) < 2 or min(counts.values()) < 2 * MIN_SAMPLES:
        raise ValueError('Need at least two publishers and six independent articles per publisher')
    return profiles


def grouped_split(rows, seed=42):
    from sklearn.model_selection import GroupShuffleSplit
    labels = [r['publisherId'] for r in rows]
    groups = [r['sourceGroupId'] for r in rows]
    publishers = set(labels)
    for train, test in GroupShuffleSplit(n_splits=256, test_size=EVALUATION_FRACTION, random_state=seed).split(rows, labels, groups):
        if all(Counter(labels[i] for i in part)[p] >= MIN_SAMPLES
               for part in (train, test) for p in publishers):
            return train, test
    raise ValueError('Cannot form group-disjoint train/evaluation sets with three samples per publisher each')


def grouped_topic_split(rows, seed=42):
    """Hold out complete topics and any originals linking several topics.

    A topic is the reviewed comparisonGroup, never a model-generated label.
    Connected topics move together when a shared original spans topics, so
    neither original-source groups nor topics can leak across the split.
    """
    from sklearn.model_selection import GroupShuffleSplit
    topics = {r['comparisonGroup'] for r in rows}
    parents = {topic: topic for topic in topics}

    def root(topic):
        while parents[topic] != topic:
            parents[topic] = parents[parents[topic]]
            topic = parents[topic]
        return topic

    first_topic = {}
    for row in rows:
        topic = row['comparisonGroup']
        previous = first_topic.setdefault(row['sourceGroupId'], topic)
        a, b = root(previous), root(topic)
        if a != b:
            parents[max(a, b)] = min(a, b)
    components = [root(row['comparisonGroup']) for row in rows]
    if len(set(components)) < 2:
        raise ValueError('Shared originals prevent a topic-disjoint evaluation split')
    labels = [r['publisherId'] for r in rows]
    publishers = set(labels)
    for train, test in GroupShuffleSplit(n_splits=512, test_size=EVALUATION_FRACTION,
                                         random_state=seed).split(rows, labels, components):
        training_topics = {rows[i]['comparisonGroup'] for i in train}
        evaluation_topics = {rows[i]['comparisonGroup'] for i in test}
        if len(training_topics) < 3 or len(evaluation_topics) < 2:
            continue
        if not all(Counter(labels[i] for i in part)[publisher] >= MIN_SAMPLES
                   and len({rows[i]['comparisonGroup'] for i in part
                            if labels[i] == publisher}) >= 2
                   for part in (train, test) for publisher in publishers):
            continue
        if ({rows[i]['sourceGroupId'] for i in train}
                & {rows[i]['sourceGroupId'] for i in test}):
            raise ValueError('Original-source group leaked across topic split')
        return train, test
    raise ValueError('Cannot form a topic-disjoint split with three training topics, two evaluation topics, '
                     'two topics per publisher in each split, and three samples per publisher each')


def train_model(rows, manifest, synthetic=False, seed=42, cross_topic=False):
    profiles = validate(rows, manifest, synthetic, cross_topic)
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.svm import LinearSVC
    train, test = grouped_topic_split(rows, seed) if cross_topic else grouped_split(rows, seed)
    scope = {'mode': 'cross_topic',
             'trainingTopics': sorted({rows[i]['comparisonGroup'] for i in train}),
             'evaluationTopics': sorted({rows[i]['comparisonGroup'] for i in test})} if cross_topic else None
    texts = [normalize(r['text']) for r in rows]
    vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                 sublinear_tf=True, norm='l2', max_features=20000)
    x_train = vectorizer.fit_transform([texts[i] for i in train])
    x_test = vectorizer.transform([texts[i] for i in test])
    labels = np.array([r['publisherId'] for r in rows])
    svm = LinearSVC(C=1.0, class_weight='balanced', random_state=seed, max_iter=10000)
    svm.fit(x_train, labels[train])
    # SVD of the publisher classifier's learned feature weights. No anchor
    # labels enter vectorization, fitting, or selection of the first component.
    coefficients = np.linalg.svd(svm.coef_, full_matrices=False)[2][0]
    raw_train = np.asarray(x_train @ coefficients).reshape(-1)
    centroids = {p: float(np.mean(raw_train[labels[train] == p])) for p in svm.classes_}
    offset = -float(np.mean(list(centroids.values())))
    scale = float(np.max(np.abs(raw_train + offset)))
    if not math.isfinite(scale) or scale <= 1e-10:
        raise ValueError('Degenerate coordinate axis')
    coordinate = lambda x: np.clip((np.asarray(x @ coefficients).reshape(-1) + offset) / scale, -1, 1)
    training_coordinates, evaluation_coordinates = coordinate(x_train), coordinate(x_test)
    publisher_centroids = {p: float(np.mean(training_coordinates[labels[train] == p])) for p in svm.classes_}
    left = [publisher_centroids[p] for p in publisher_centroids if profiles[p] == 'left']
    right = [publisher_centroids[p] for p in publisher_centroids if profiles[p] == 'right']
    if not left or not right:
        raise ValueError('Both anchor groups must occur in the training set')
    sign = 1 if np.mean(left) < np.mean(right) else -1
    coefficients *= sign; offset *= sign
    training_coordinates *= sign; evaluation_coordinates *= sign
    publisher_centroids = {p: c * sign for p, c in publisher_centroids.items()}
    evaluation_centroids = {p: float(np.mean(evaluation_coordinates[labels[test] == p])) for p in svm.classes_}
    left = [evaluation_centroids[p] for p in evaluation_centroids if profiles[p] == 'left']
    right = [evaluation_centroids[p] for p in evaluation_centroids if profiles[p] == 'right']
    anchors = {p for p, orientation in profiles.items() if orientation in {'left', 'right'}}
    axis_separated = bool(anchors.issubset(evaluation_centroids) and max(left) < min(right))
    predictions = svm.predict(x_test)
    metrics = [{'publisherId': p, 'sampleCount': int(sum(labels[test] == p)),
                'coordinateMae': float(np.mean(np.abs(evaluation_coordinates[labels[test] == p] - publisher_centroids[p]))),
                'publisherAccuracy': float(np.mean(predictions[labels[test] == p] == p))}
               for p in svm.classes_]
    training_groups = sorted({rows[i]['sourceGroupId'] for i in train})
    evaluation_groups = sorted({rows[i]['sourceGroupId'] for i in test})
    lineage = [{'articleId': r['id'], 'publisherId': r['publisherId'], 'url': r['url'],
                'publishedAt': r['publishedAt'], 'sourceGroupId': r['sourceGroupId'],
                'contentHash': content_hash(texts[i]), 'usage': r.get('usage'),
                'split': 'training' if i in train else 'evaluation'} for i, r in enumerate(rows)]
    if cross_topic:
        for source, entry in zip(rows, lineage):
            entry['comparisonGroup'] = source['comparisonGroup']
    version_input = {'lineage': lineage, 'seed': seed, 'version': VERSION,
                     'axisId': manifest['axisId'], 'profiles': manifest['profiles'],
                     'coefficients': coefficients.tolist(), 'offset': offset, 'scale': scale}
    if scope:
        version_input['topicScope'] = scope
    model_version = digest(version_input)[:20]
    evidence = {'axisId': manifest['axisId'], 'coordinateSpace': f'{VERSION}:{model_version}',
                'modelId': 'publisher-char-tfidf-linear-svm', 'modelVersion': model_version,
                'task': 'publisher_identity_relative_coordinate',
                'trainingDataId': 'train:' + digest([r for r in lineage if r['split'] == 'training']),
                'evaluationDataId': 'evaluation:' + digest([r for r in lineage if r['split'] == 'evaluation']),
                'evaluation': {'split': 'held_out_articles', 'heldOutUnit': 'original_source_group',
                               'groupSplitId': digest([training_groups, evaluation_groups]),
                               'trainingPublisherIds': svm.classes_.tolist(), 'evaluationPublisherIds': svm.classes_.tolist(),
                               'trainingSourceGroupIds': training_groups, 'evaluationSourceGroupIds': evaluation_groups,
                               'metrics': metrics}}
    review = manifest.get('humanAxisReview', {})
    human_reviewed = (reviewed_axis(review, model_version)
                      and review['sampleCount'] <= len(evaluation_groups)
                      and review['sampleCount'] <= len({content_hash(texts[i]) for i in test}))
    # Evaluation articles are reference samples; they never trained the model.
    references = [{'articleId': rows[i]['id'], 'publisherId': rows[i]['publisherId'],
                   'comparisonGroup': rows[i]['comparisonGroup'],
                   'classifier': {**evidence, 'coordinate': float(c)}} for i, c in zip(test, evaluation_coordinates)]
    comparison_group = '여러 주제 매체 문체 모델' if cross_topic else rows[0]['comparisonGroup']
    artifact = {'schemaVersion': VERSION, 'synthetic': synthetic, 'dataKind': 'synthetic' if synthetic else 'real',
            'status': 'validated' if human_reviewed and axis_separated and not synthetic else 'research_only',
            'comparisonGroup': comparison_group, 'classifierEvidence': evidence,
            'vectorizer': {'analyzer': 'char', 'ngramRange': [2, 4], 'lowercase': False,
                           'whitespace': 'collapse', 'norm': 'l2', 'sublinearTf': True,
                           'vocabulary': {k: int(v) for k, v in vectorizer.vocabulary_.items()},
                           'idf': vectorizer.idf_.tolist()},
            'projection': {'coefficients': coefficients.tolist(), 'offset': offset, 'scale': scale},
            'validation': {'heldoutAnchorSeparation': axis_separated, 'humanAxisReview': review,
                           'coordinateMaeMeaning': 'heldout deviation from training publisher centroid; not human political-label error',
                           'publisherAccuracyMeaning': 'heldout publisher identity accuracy; not political bias accuracy'},
            'corpus': {'articleCount': len(rows), 'publisherCounts': dict(sorted(Counter(labels).items())),
                       'publishedDates': sorted({r['publishedAt'] for r in rows}),
                       'contentHashAlgorithm': 'sha256-normalized-utf8',
                       'comparisonGroup': comparison_group},
            'references': references, 'lineage': lineage}
    if scope:
        artifact['topicScope'] = scope
    return artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, action='append',
                        help='Prepared local article JSONL; repeat to combine reviewed topic corpora')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--synthetic', action='store_true')
    parser.add_argument('--cross-topic', action='store_true',
                        help='Hold out complete topics as well as original groups; requires at least five reviewed topics')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    rows = [json.loads(line) for source in args.input
            for line in source.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    manifest = json.loads(args.manifest.read_text(encoding='utf-8-sig'))
    artifact = train_model(rows, manifest, args.synthetic, args.seed, args.cross_topic)
    args.output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'status': artifact['status'], 'modelVersion': artifact['classifierEvidence']['modelVersion'],
                      'referenceCount': len(artifact['references'])}))


if __name__ == '__main__':
    main()
