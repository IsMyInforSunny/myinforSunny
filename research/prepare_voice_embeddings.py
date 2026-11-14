"""Prepare actual retained sentences for a bounded embedding-SVM experiment.

No requests, new collection, invented examples or production activation.
"""
import argparse
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

from train_stance import ROOT, normalize, read_rows, digest
from train_voice import validate, connected_groups, choose_split
from voice_features import PUBLISHERS
from voice_challenge import ground_challenge

MODEL = 'nvidia/nemotron-3.5-embed-1b'
OPTIONS = {'model': MODEL, 'input_type': 'passage', 'encoding_format': 'float', 'truncate': 'NONE', 'dimensions': 2048}


def local_path(value):
    path = Path(value).resolve()
    if not path.is_relative_to((ROOT / '.sites-runtime').resolve()):
        raise ValueError('Embedding experiment files must stay beneath .sites-runtime')
    return path


def natural_text(value):
    # Semantic encoder retains aliases and numbers; it is NOT char-SVM text.
    return normalize(PUBLISHERS.sub('', value))


def neutral_sample(rows, indices, groups, count):
    buckets = defaultdict(lambda: defaultdict(list))
    for index in indices:
        if rows[index]['direction'] == 'neutral':
            row = rows[index]
            buckets[groups[index]][row['article']['id']].append(index)
    queues = {}
    for group, articles in buckets.items():
        per_article = {article: deque(sorted(values, key=lambda i: digest([rows[i]['article']['id'], rows[i]['sentenceId'], rows[i]['text']])))
                       for article, values in articles.items()}
        article_order = sorted(articles, key=lambda value: digest(value))
        queue = []
        while any(per_article.values()):
            for article in article_order:
                if per_article[article]:
                    queue.append(per_article[article].popleft())
        queues[group] = deque(queue)
    group_order = sorted(queues, key=lambda group: digest(sorted(buckets[group])))
    result = []
    while len(result) < count and any(queues.values()):
        for group in group_order:
            if queues[group] and len(result) < count:
                result.append(queues[group].popleft())
    if len(result) != count:
        raise ValueError('Not enough distinct neutral rows to balance directional rows')
    return result


def request_batches(records):
    batches, current = [], []
    for record in records:
        candidate = current + [record]
        body = json.dumps({**OPTIONS, 'input': [item['text'] for item in candidate]}, ensure_ascii=False, separators=(',', ':')).encode()
        if len(candidate) > 32 or len(body) > 6000:
            if not current:
                raise ValueError('One actual sentence exceeds the fixed 6000-byte request ceiling')
            batches.append(current)
            current = [record]
        else:
            current = candidate
        single = json.dumps({**OPTIONS, 'input': [item['text'] for item in current]}, ensure_ascii=False, separators=(',', ':')).encode()
        if len(single) > 6000:
            raise ValueError('One actual sentence exceeds the request ceiling')
    if current:
        batches.append(current)
    return batches


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base = ROOT / '.sites-runtime/svm-improvement-20261114'
    parser.add_argument('--corpus', default=str(base / 'nuclear-all.local.jsonl'))
    parser.add_argument('--labels', default=str(base / 'review-all46.local.jsonl'))
    parser.add_argument('--events', default=str(ROOT / '.sites-runtime/relative-baseline-step23/article-events.local.json'))
    parser.add_argument('--split-manifest', default=str(base / 'frozen-split.local.json'))
    parser.add_argument('--challenge', default=str(base / 'frozen-challenge.local.json'))
    parser.add_argument('--output', default=str(base / 'embedding-input.local.json'))
    args = parser.parse_args()
    load = lambda value: json.loads(local_path(value).read_text(encoding='utf-8-sig'))
    corpus, labels = read_rows(local_path(args.corpus)), read_rows(local_path(args.labels))
    events, manifest, challenge = load(args.events), load(args.split_manifest), load(args.challenge)
    events = events.get('articleGroups', events)
    hashes = manifest.get('articleHashes', {})
    by_id = {article['id']: article for article in corpus}
    for article_id in manifest.get('trainingArticleIds', []) + manifest.get('evaluationArticleIds', []):
        if article_id not in by_id or hashes.get(article_id) != hashlib.sha256(normalize(by_id[article_id]['text']).encode()).hexdigest():
            raise ValueError('Frozen article body hash changed or is missing')
    grounded = ground_challenge(challenge, corpus, {label['articleId'] for label in labels}, events)
    if len(grounded['pairs']) != 10 or grounded['rejectedCounts']:
        raise ValueError('Exactly ten fully grounded, independent frozen pairs are required')
    rows, teacher = validate(corpus, labels)
    groups = connected_groups(rows, events)
    split, split_info = choose_split(rows, groups, split_manifest=manifest)
    if split is None:
        raise ValueError('Frozen split has insufficient label coverage')
    train, evaluation = split
    directional = [int(i) for i in train if rows[i]['direction'] != 'neutral']
    selected = directional + neutral_sample(rows, train, groups, len(directional))
    records, sets = {}, {'train': [], 'evaluation': [], 'challenge': []}

    def add(partition, text, source, labels_for_unit):
        text = natural_text(text)
        if not text:
            raise ValueError('Empty actual sentence after publisher removal')
        key = hashlib.sha256(text.encode()).hexdigest()
        if key in records and records[key]['partition'] != partition:
            raise ValueError('Same sentence cannot cross frozen partitions')
        record = records.setdefault(key, {'key': key, 'text': text, 'partition': partition, 'sourceIDs': []})
        if source not in record['sourceIDs']:
            record['sourceIDs'].append(source)
        sets[partition].append({'key': key, **source, **labels_for_unit})
        return key

    for partition, indices in [('train', selected), ('evaluation', evaluation)]:
        for i in indices:
            row = rows[int(i)]
            add(partition, row['text'], {'articleId': row['article']['id'], 'sentenceId': row['sentenceId']},
                {name: row[name] for name in ['direction', 'speaker', 'issue']} | {'group': int(groups[int(i)])})
    pairs = []
    for pair in grounded['pairs']:
        mapped = {'issue': pair['issue'], 'topic': pair['topic']}
        for side in ['support', 'oppose']:
            proof = pair[side + 'Source']
            mapped[side + 'Key'] = add('challenge', pair[side], {'articleId': proof['articleId'], 'sentenceId': proof['sentenceId']},
                                     {'direction': side, 'speaker': proof.get('speaker', 'unknown'), 'issue': pair['issue']})
        pairs.append(mapped)
    unique = sorted(records.values(), key=lambda item: item['key'])
    batches = request_batches(unique)
    batch_bytes = [len(json.dumps({**OPTIONS, 'input': [item['text'] for item in batch]}, ensure_ascii=False, separators=(',', ':')).encode()) for batch in batches]
    preparation = {'annotatedArticles': len(labels), 'usableRowsBeforeSampling': len(rows),
        'fullTrainingRows': len(train), 'directionalTrainingRows': len(directional), 'sampledNeutralRows': len(directional),
        'setCounts': {key: len(value) for key, value in sets.items()}, 'uniqueTexts': len(unique),
        'textUtf8Bytes': sum(len(item['text'].encode()) for item in unique), 'plannedCalls': len(batches),
        'requestUtf8Bytes': sum(batch_bytes), 'largestRequestBytes': max(batch_bytes),
        'reservedTokensRequired': len(batches) * 6500, 'dailyBudget': 117000,
        'callsPerFullBudgetDay': 117000 // 6500, 'sampling': 'all training directional + same-count deterministic neutral group/article round-robin',
        'trainingDirectionCounts': dict(Counter(row['direction'] for row in sets['train'])), 'split': split_info}
    payload = {'schemaVersion': 'voice-embedding-input-1.0', 'embedding': OPTIONS, 'records': unique,
        'sets': sets, 'pairs': pairs, 'preparation': preparation, 'humanEvaluationCount': 0,
        'sourceDigests': {'corpus': digest(corpus), 'labels': digest(labels), 'split': digest(manifest), 'challenge': digest(challenge)}}
    payload['inputDigest'] = digest(payload)
    output = local_path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and json.loads(output.read_text(encoding='utf-8'))['inputDigest'] != payload['inputDigest']:
        raise ValueError('Existing embedding input differs; preserve it and select a new local output path')
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'inputDigest': payload['inputDigest'], **preparation}, ensure_ascii=True))


if __name__ == '__main__':
    main()
