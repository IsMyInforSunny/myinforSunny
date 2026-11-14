"""Freeze topic-specific retained-news splits before embedding or model fitting."""
import argparse
from collections import Counter
import hashlib
import json

from train_stance import digest, read_rows
from train_voice import DEFINITION, validate, connected_groups, choose_split
from prepare_voice_embeddings import local_path, natural_text, neutral_sample, request_batches, OPTIONS


def load_json(value):
    return json.loads(local_path(value).read_text(encoding='utf-8-sig'))


def research_split(rows, groups, manifest=None):
    split, diagnostics = choose_split(rows, groups, split_manifest=manifest)
    if split is not None or len(set(groups)) < 2:
        return split, diagnostics
    def structurally_eligible(training, evaluation):
        return (all({rows[int(index)]['direction'] for index in indices} == {'neutral', 'support', 'oppose'}
                    and {rows[int(index)]['speaker'] for index in indices} == {'journalist', 'source'}
                    for indices in [training, evaluation])
                and len({rows[int(index)]['issue'] for index in training}) >= 2)
    reason = 'rare_issue_class_coverage_unavailable'
    if manifest is not None:
        # Only a previously declared research split may reuse this policy.
        # Existing registered outer sets never receive a fresh fallback split.
        if manifest.get('researchSplitPolicy') != reason:
            return None, diagnostics
        evaluation_ids = set(manifest['evaluationArticleIds'])
        evaluation = [index for index, row in enumerate(rows) if row['article']['id'] in evaluation_ids]
        evaluation_groups = {groups[index] for index in evaluation}
        training = [index for index, row in enumerate(rows)
                    if row['article']['id'] not in evaluation_ids and groups[index] not in evaluation_groups]
        if structurally_eligible(training, evaluation):
            return (training, evaluation), {**diagnostics, 'researchFallback': reason, 'frozenResearchSplit': True}
        return None, diagnostics
    from sklearn.model_selection import GroupShuffleSplit
    # A rare issue in one connected group cannot appear on both sides. Preserve
    # direction/speaker coverage while freezing the first structural split.
    candidates = GroupShuffleSplit(n_splits=64, test_size=.3, random_state=42).split(rows, groups=groups)
    for training, evaluation in candidates:
        if structurally_eligible(training, evaluation):
            return (training, evaluation), {**diagnostics,
                'researchFallback': reason,
                'selection': 'First structurally eligible group split before embedding or fitting; no score-based selection'}
    return None, diagnostics


def prepare(corpus, annotations, events=None, frozen=None):
    topics = sorted({article['topicId'] for article in corpus})
    article_topics = {article['id']: article['topicId'] for article in corpus}
    if len(article_topics) != len(corpus):
        raise ValueError('Duplicate articles across topic corpora')
    if any(annotation.get('articleId') not in article_topics
           or article_topics[annotation['articleId']] != annotation.get('topic') for annotation in annotations):
        raise ValueError('Annotation belongs to an unknown article or different topic')
    rows, teachers_by_topic = [], {}
    for topic in topics:
        topic_rows, topic_teacher = validate(
            [article for article in corpus if article['topicId'] == topic],
            [annotation for annotation in annotations if annotation['topic'] == topic])
        rows.extend(topic_rows)
        teachers_by_topic[topic] = list(topic_teacher) if topic_teacher else None
    teachers = {tuple(value) for value in teachers_by_topic.values() if value}
    teacher = list(next(iter(teachers))) if len(teachers) == 1 and all(teachers_by_topic.values()) else None
    groups = connected_groups(rows, events)
    if frozen and frozen.get('schemaVersion') != 'voice-multitopic-split-1.0':
        raise ValueError('Expected a voice-multitopic-split-1.0 manifest')
    chosen, reports, evaluation_groups = {}, {}, set()
    for topic in topics:
        indices = [index for index, row in enumerate(rows) if row['topic'] == topic]
        topic_rows = [rows[index] for index in indices]
        topic_groups = [groups[index] for index in indices]
        counts = Counter(row['direction'] for row in topic_rows)
        reports[topic] = {'usableSentences': len(indices), 'directionCounts': dict(counts),
                         'teacher': teachers_by_topic[topic], 'blockers': []}
        if not indices:
            reports[topic]['blockers'].append('no_usable_sentence_labels')
            continue
        if any(counts[label] < 2 for label in ['neutral', 'support', 'oppose']):
            reports[topic]['blockers'].append('insufficient_direction_class_coverage')
            continue
        topic_manifest = frozen.get('topics', {}).get(topic) if frozen else None
        if frozen and topic_manifest is None:
            reports[topic]['blockers'].append('topic_missing_from_frozen_manifest')
            continue
        if topic_manifest:
            hashes = topic_manifest.get('articleHashes', {})
            for row in topic_rows:
                article_id = row['article']['id']
                if article_id in hashes and hashes[article_id] != row['hash']:
                    raise ValueError('Frozen article body changed')
        split, diagnostics = research_split(topic_rows, topic_groups, topic_manifest)
        reports[topic]['splitDiagnostics'] = diagnostics
        if split is None:
            reports[topic]['blockers'].append('independent_group_split_unavailable')
            continue
        training, evaluation = split
        reports[topic]['trainingIssueCounts'] = dict(Counter(topic_rows[int(index)]['issue'] for index in training))
        reports[topic]['evaluationIssueCounts'] = dict(Counter(topic_rows[int(index)]['issue'] for index in evaluation))
        chosen[topic] = ([indices[int(index)] for index in training], [indices[int(index)] for index in evaluation])
        evaluation_groups.update(groups[index] for index in chosen[topic][1])

    records, sets, manifest_topics = {}, {'train': [], 'evaluation': [], 'challenge': []}, {}
    for topic, (training, evaluation) in chosen.items():
        # A sentence or connected original held out in any topic stays out of every training set.
        retained = [index for index in training if groups[index] not in evaluation_groups]
        reports[topic]['crossTopicConnectedTrainingExcluded'] = len(training) - len(retained)
        if any(not any(rows[index]['direction'] == label for index in retained)
               for label in ['neutral', 'support', 'oppose']):
            reports[topic]['blockers'].append('direction_class_lost_after_global_group_exclusion')
            continue
        directional = [index for index in retained if rows[index]['direction'] != 'neutral']
        neutral_count = sum(rows[index]['direction'] == 'neutral' for index in retained)
        sampled = directional + neutral_sample(rows, retained, groups, min(len(directional), neutral_count))
        train_ids = sorted({rows[index]['article']['id'] for index in retained})
        evaluation_ids = sorted({rows[index]['article']['id'] for index in evaluation})
        manifest_topics[topic] = {'schemaVersion': 'voice-split-1.0', 'trainingArticleIds': train_ids,
            'evaluationArticleIds': evaluation_ids,
            'articleHashes': {rows[index]['article']['id']: rows[index]['hash'] for index in retained + evaluation}}
        fallback = reports[topic]['splitDiagnostics'].get('researchFallback')
        if fallback:
            manifest_topics[topic]['researchSplitPolicy'] = fallback
        for partition, indices in [('train', sampled), ('evaluation', evaluation)]:
            for index in indices:
                row = rows[index]
                text = natural_text(row['text'])
                if not text:
                    raise ValueError('Empty semantic input')
                key = hashlib.sha256(text.encode()).hexdigest()
                if key in records and records[key]['partition'] != partition:
                    raise ValueError('Semantic input crosses frozen partitions')
                record = records.setdefault(key, {'key': key, 'text': text, 'partition': partition, 'sourceIDs': []})
                source = {'articleId': row['article']['id'], 'sentenceId': row['sentenceId'], 'topic': topic}
                if source not in record['sourceIDs']:
                    record['sourceIDs'].append(source)
                sets[partition].append({'key': key, **source, 'group': int(groups[index]),
                    'articleHash': row['hash'], **{name: row[name] for name in ['direction', 'speaker', 'issue']}})
        reports[topic].update(trainingCount=len(sampled), evaluationCount=len(evaluation),
            trainingArticleCount=len(train_ids), evaluationArticleCount=len(evaluation_ids))
    manifest = {'schemaVersion': 'voice-multitopic-split-1.0', 'topics': manifest_topics}
    unique = sorted(records.values(), key=lambda row: row['key'])
    batches = request_batches(unique)
    preparation = {'annotatedArticles': len(annotations), 'usableRowsBeforeSampling': len(rows),
        'uniqueTexts': len(unique), 'plannedCalls': len(batches), 'reservedTokensRequired': len(batches) * 6500,
        'setCounts': {name: len(values) for name, values in sets.items()}, 'topics': reports,
        'sampling': 'all training directional + at most equal neutral group/article round-robin; all heldout rows',
        'selection': 'Seed 42 group split frozen before embedding and fitting; no outer-performance selection'}
    payload = {'schemaVersion': 'voice-embedding-input-1.0', 'embedding': OPTIONS, 'records': unique,
        'sets': sets, 'pairs': [], 'preparation': preparation, 'splitManifest': manifest,
        'definitionVersion': DEFINITION['version'], 'teacher': teacher, 'teachersByTopic': teachers_by_topic,
        'researchOnly': True, 'usageReviewed': False, 'humanEvaluationCount': 0,
        'sourceDigests': {'corpus': digest(corpus), 'labels': digest(annotations), 'events': digest(events),
                          'split': digest(manifest)}}
    payload['inputDigest'] = digest(payload)
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus', action='append', required=True)
    parser.add_argument('--labels', action='append', required=True)
    parser.add_argument('--events')
    parser.add_argument('--split-manifest')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    corpus = [row for value in args.corpus for row in read_rows(local_path(value))]
    labels = [row for value in args.labels for row in read_rows(local_path(value))]
    events = load_json(args.events) if args.events else None
    if events and 'articleGroups' in events:
        events = events['articleGroups']
    frozen = load_json(args.split_manifest) if args.split_manifest else None
    payload = prepare(corpus, labels, events, frozen)
    destination = local_path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('x', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'inputDigest': payload['inputDigest'], **payload['preparation']}, ensure_ascii=True))


if __name__ == '__main__':
    main()
