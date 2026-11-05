"""Local corpus diagnostic: publisher classification, never a released bias model.

This reports measured held-out-topic results and leaves rights, source grouping,
edition scope and political-axis review unresolved. It cannot produce the
production artifact schema or set any approval fields.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.svm import LinearSVC

from train_bias import anchor_contrast_projection, digest, grouped_topic_split


def masked_text(text):
    # Preserve raw acquisition files. This separate diagnostic view removes
    # explicit publisher names and footer markers that can reveal the label.
    lines = [line for line in text.splitlines()
             if not re.search(r'저작권자|무단\s*전재|재배포\s*금지|copyright|all rights reserved', line, re.I)]
    value = '\n'.join(lines)
    value = re.sub(r'https?://\S+|[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}', ' ', value)
    value = re.sub(r'프레시안|오마이뉴스|뉴데일리(?:경제)?|데일리안|pressian|ohmynews|newdaily|dailian', ' ', value, flags=re.I)
    return re.sub(r'\s+', ' ', value).strip()


def coordinate_diagnostic(component, x_train, x_test, labels, train, test, publishers,
                          classifier_fingerprint, method, reference_left=None, reference_right=None):
    raw_train = np.asarray(x_train @ component).reshape(-1)
    offset = -float(np.mean([np.mean(raw_train[labels[train] == p]) for p in publishers]))
    scale = float(np.max(np.abs(raw_train + offset)))
    if not np.isfinite(scale) or scale <= 1e-10:
        raise ValueError('Degenerate diagnostic coordinate projection')
    training = np.clip((raw_train + offset) / scale, -1, 1)
    heldout = np.clip((np.asarray(x_test @ component).reshape(-1) + offset) / scale, -1, 1)
    train_centroids = {p: float(np.mean(training[labels[train] == p])) for p in publishers}
    heldout_centroids = {p: float(np.mean(heldout[labels[test] == p])) for p in publishers}
    left, right = sorted(reference_left or []), sorted(reference_right or [])
    metadata = {'projectionMethod': method, 'trainingPublisherCentroids': train_centroids,
                'heldoutPublisherCentroids': heldout_centroids,
                'offset': offset, 'scale': scale,
                'interpretation': 'arbitrary_svd_sign' if method == 'svd' else 'relative_supplied_reference_hypothesis',
                'politicalAxisApproved': False, 'releaseReady': False}
    if left or right:
        def ordering(centroids):
            left_values, right_values = [centroids[p] for p in left], [centroids[p] for p in right]
            return {'leftMean': float(np.mean(left_values)), 'rightMean': float(np.mean(right_values)),
                    'meanOrdered': bool(np.mean(left_values) < np.mean(right_values)),
                    'strictlySeparated': bool(max(left_values) < min(right_values)),
                    'minimumPairGap': float(min(right_values) - max(left_values))}
        metadata['referenceGroups'] = {'status': 'unreviewed_hypotheses', 'left': left, 'right': right}
        metadata['anchorOrdering'] = {'training': ordering(train_centroids), 'heldout': ordering(heldout_centroids)}
    # Hash numeric values and preprocessing identity directly, never NPZ/ZIP
    # container bytes whose timestamps can change without changing the model.
    metadata['candidateModelVersion'] = digest({'classifierFingerprint': classifier_fingerprint,
        'projectionMethod': method, 'component': component.tolist(), 'offset': offset, 'scale': scale,
        'referenceLeft': left, 'referenceRight': right})[:20]
    return metadata, training, heldout


def diagnose(records, output, reference_left=None, reference_right=None):
    if bool(reference_left) != bool(reference_right):
        raise ValueError('Supply both left and right reference hypotheses, or neither')
    candidate = []
    for row in records:
        flags = row.get('collectionAudit', {}).get('flags', [])
        if any(flag in flags for flag in ('outside_collection_period', 'missing_or_invalid_publication_date', 'topic_needs_review', 'short_body_needs_review', 'promotional_genre_review')):
            continue
        host = row['sourceEditionHost'].removeprefix('www.').removeprefix('m.')
        # Economic editions remain distinct candidates; no political labels.
        candidate.append({**row, 'publisherId': host, 'comparisonGroup': row['topicId'],
                          'sourceGroupId': 'unreviewed-content-hash:' + row['contentHash']})
    counts = Counter(row['publisherId'] for row in candidate)
    topics = {publisher: {r['topicId'] for r in candidate if r['publisherId'] == publisher} for publisher in counts}
    eligible = {publisher for publisher, count in counts.items() if count >= 6 and len(topics[publisher]) >= 4}
    rows = [row for row in candidate if row['publisherId'] in eligible]
    if len(eligible) < 2:
        raise ValueError('Need at least two sufficiently sampled publisher candidates')
    train, test = grouped_topic_split(rows, seed=42)
    labels = np.array([row['publisherId'] for row in rows])
    data_signature = sorted([str(row.get('id', '')), row['publisherId'], row['topicId'], row['contentHash']] for row in rows)
    training_topics = sorted({rows[i]['topicId'] for i in train})
    evaluation_topics = sorted({rows[i]['topicId'] for i in test})
    results = {}
    for variant in ('raw', 'publisher_markers_removed'):
        texts = [row['text'] if variant == 'raw' else masked_text(row['text']) for row in rows]
        vectorizer = TfidfVectorizer(analyzer='char', ngram_range=(2, 4), lowercase=False,
                                     sublinear_tf=True, norm='l2', max_features=20000)
        x_train = vectorizer.fit_transform([texts[i] for i in train])
        x_test = vectorizer.transform([texts[i] for i in test])
        model = LinearSVC(C=1.0, class_weight='balanced', random_state=42, max_iter=10000)
        model.fit(x_train, labels[train])
        prediction = model.predict(x_test)
        vocabulary = {term: int(index) for term, index in vectorizer.vocabulary_.items()}
        classifier_fingerprint = digest({'coefficients': model.coef_.tolist(), 'intercept': model.intercept_.tolist(),
            'idf': vectorizer.idf_.tolist(), 'vocabulary': vocabulary, 'classes': model.classes_.tolist(),
            'preprocessing': 'raw-1' if variant == 'raw' else 'publisher-markers-removed-1',
            'trainingTopics': training_topics, 'evaluationTopics': evaluation_topics, 'inputSignature': data_signature,
            'seed': 42, 'tfidf': {'analyzer': 'char', 'ngramRange': [2, 4], 'sublinearTf': True, 'norm': 'l2', 'maxFeatures': 20000}})
        result = {'publisherAccuracy': float(accuracy_score(labels[test], prediction)),
                  'publisherMacroF1': float(f1_score(labels[test], prediction, average='macro')),
                  'featureCount': len(vectorizer.vocabulary_), 'classes': model.classes_.tolist(),
                  'classifierFingerprint': classifier_fingerprint,
                  'confusionMatrix': confusion_matrix(labels[test], prediction, labels=model.classes_).tolist(),
                  'perPublisher': {p: {'training': int(sum(labels[train] == p)), 'evaluation': int(sum(labels[test] == p)),
                                      'accuracy': float(np.mean(prediction[labels[test] == p] == p))} for p in model.classes_}}
        if variant == 'publisher_markers_removed':
            contrast = (anchor_contrast_projection(model.coef_, model.classes_, reference_left, reference_right)
                        if reference_left else None)
            component = np.linalg.svd(model.coef_, full_matrices=False)[2][0]
            if component[np.argmax(np.abs(component))] < 0:
                component *= -1
            svd_report, _, svd_heldout = coordinate_diagnostic(component, x_train, x_test, labels, train, test,
                model.classes_, classifier_fingerprint, 'svd', reference_left, reference_right)
            result['unreviewedPublisherCoordinates'] = svd_report['trainingPublisherCentroids']
            result['heldoutUnreviewedPublisherCoordinates'] = svd_report['heldoutPublisherCentroids']
            result['coordinateExperiments'] = {'svd': svd_report}
            heldout_coordinates = {'svd': svd_heldout}
            extra_weights = {}
            if reference_left:
                contrast_report, _, contrast_heldout = coordinate_diagnostic(contrast, x_train, x_test, labels, train, test,
                    model.classes_, classifier_fingerprint, 'anchor_contrast', reference_left, reference_right)
                result['coordinateExperiments']['anchor_contrast'] = contrast_report
                heldout_coordinates['anchor_contrast'] = contrast_heldout
                extra_weights = {'anchor_contrast_component': contrast,
                                 'anchor_contrast_offset': contrast_report['offset'],
                                 'anchor_contrast_scale': contrast_report['scale']}
            np.savez_compressed(output / 'publisher-classifier.local.npz', coefficients=model.coef_, intercept=model.intercept_,
                                idf=vectorizer.idf_, classes=model.classes_, component=component,
                                offset=svd_report['offset'], scale=svd_report['scale'], **extra_weights)
            (output / 'vocabulary.local.json').write_text(json.dumps(vocabulary, ensure_ascii=False), encoding='utf-8')
            references = {'schemaVersion': 'publisher-coordinate-diagnostic-references-1', 'status': 'research_only',
                'politicalAxisApproved': False, 'releaseReady': False,
                'candidateVersions': {method: details['candidateModelVersion'] for method, details in result['coordinateExperiments'].items()},
                'heldout': [{'articleId': rows[index].get('id'), 'url': rows[index].get('url'),
                    'publisherId': rows[index]['publisherId'], 'topicId': rows[index]['topicId'],
                    'publishedAt': rows[index].get('publishedAt'), 'contentHash': rows[index]['contentHash'],
                    'originalGroupStatus': 'unreviewed_content_hash_candidate',
                    'coordinates': {method: float(values[position]) for method, values in heldout_coordinates.items()}}
                    for position, index in enumerate(test)]}
            (output / 'coordinate-references.local.json').write_text(json.dumps(references, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        results[variant] = result
    report = {'schemaVersion': 'publisher-corpus-diagnostic-1', 'status': 'research_only',
              'dataKind': 'real_direct_collection', 'synthetic': False, 'releaseReady': False,
              'task': 'publisher_identity_diagnostic_not_political_bias_accuracy', 'seed': 42,
              'inputRows': len(records), 'usedRows': len(rows), 'excludedPublisherCandidates': sorted(set(counts) - eligible),
              'trainingTopics': training_topics,
              'evaluationTopics': evaluation_topics,
              'topicOverlap': False, 'exactContentHashOverlap': bool({rows[i]['contentHash'] for i in train} & {rows[i]['contentHash'] for i in test}),
              'trainingRows': len(train), 'evaluationRows': len(test), 'variants': results,
              'blockingReviews': ['article_usage_and_model_distribution', 'independent_original_groups', 'publisher_edition_scope',
                                  'time_and_genre_confounding', 'political_axis_meaning', 'actual_two_person_40_original_axis_review'],
              'referenceExperiment': {'status': 'unreviewed_hypotheses', 'left': sorted(reference_left), 'right': sorted(reference_right)} if reference_left else None,
              'note': 'Measured publisher classification only. Candidate grouping uses content hashes and topic separation, not approved independent reporting. SVD sign is arbitrary. Optional contrast sign follows supplied reference hypotheses, not approved political labels. No political interpretation or public activation.'}
    (output / 'report.local.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--reference-left', nargs='+', help='Explicit unreviewed left-reference publisher hypotheses')
    parser.add_argument('--reference-right', nargs='+', help='Explicit unreviewed right-reference publisher hypotheses')
    args = parser.parse_args()
    target = args.output_dir.resolve()
    if Path('.sites-runtime').resolve() not in target.parents:
        parser.error('Output must be a new ignored .sites-runtime directory')
    rows = [json.loads(line) for line in args.input.read_text(encoding='utf-8').splitlines() if line.strip()]
    target.mkdir()
    diagnose(rows, target, args.reference_left, args.reference_right)


if __name__ == '__main__':
    main()
