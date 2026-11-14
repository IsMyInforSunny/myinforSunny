"""Ground AI-reviewed challenge pairs in local articles, without judging semantics.

This checks provenance and split independence, never rights or human accuracy.
"""
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path

from train_stance import normalize


DEFINITION = json.loads((Path(__file__).resolve().parent.parent /
                         'lib/data/voice-issues.json').read_text(encoding='utf-8'))


def _hash(text):
    return hashlib.sha256(normalize(text).encode('utf-8')).hexdigest()


def _overlap(left, right):
    # Equality always leaks, including short units. Containment only counts when
    # the entire shared fragment has >=40 Unicode characters: shorter retained
    # tails can be common names rather than a copied meaningful passage.
    if not left or not right:
        return False
    return left == right or (min(len(left), len(right)) >= 40 and
                             (left in right or right in left))


def ground_challenge(challenge, corpus, excluded_article_ids, events=None):
    """Return original grounded pairs and deterministic first-rejection counts.

    Metadata used to form corpus-wide transitive groups must be well formed;
    otherwise a clear ValueError prevents silently incomplete leakage checks.
    Source sentence/body checks apply to referenced and excluded articles only.
    """
    rejected = Counter()
    if challenge is None:
        return {'pairs': [], 'rejectedCounts': {'missing': 1}, 'candidatePairCount': 0}
    if not isinstance(challenge, dict) or not isinstance(challenge.get('pairs'), list):
        return {'pairs': [], 'rejectedCounts': {'invalid_challenge': 1}, 'candidatePairCount': 0}
    candidates = challenge['pairs']
    if challenge.get('version') != DEFINITION['version']:
        return {'pairs': [], 'rejectedCounts': {'invalid_version': max(1, len(candidates))},
                'candidatePairCount': len(candidates)}

    by_id, parents, keys, hashes = {}, {}, {}, {}

    def find(article_id):
        while parents[article_id] != article_id:
            parents[article_id] = parents[parents[article_id]]
            article_id = parents[article_id]
        return article_id

    for article in corpus:
        if not isinstance(article, dict):
            raise ValueError('Challenge corpus article must be an object')
        article_id = article.get('id')
        if not isinstance(article_id, str) or not article_id or article_id in by_id:
            raise ValueError('Challenge corpus has missing or duplicate article IDs')
        if not isinstance(article.get('text'), str) or not isinstance(article.get('topicId'), str):
            raise ValueError('Challenge corpus grouping requires article text and topic')
        try:
            day = date.fromisoformat(article['publishedAt'][:10]).toordinal() // 6
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError('Challenge corpus grouping requires valid article dates') from exc
        by_id[article_id] = article
        parents[article_id] = article_id
        hashes[article_id] = _hash(article['text'])
        group_keys = [('date', article['topicId'], day), ('hash', hashes[article_id])]
        for event in [article.get('eventId'), (events or {}).get(article_id)]:
            if event:
                group_keys.append(('event', event))
        if article.get('sourceGroupId'):
            group_keys.append(('source', article['sourceGroupId']))
        for key in group_keys:
            try:
                if key in keys:
                    parents[find(article_id)] = find(keys[key])
                else:
                    keys[key] = article_id
            except TypeError as exc:
                raise ValueError('Challenge corpus grouping IDs must be hashable') from exc

    excluded = set(excluded_article_ids)
    if excluded - by_id.keys():
        raise ValueError('Excluded challenge articles must exist in the corpus')
    excluded_groups = {find(article_id) for article_id in excluded}
    excluded_texts = []
    for article_id in excluded:
        units = by_id[article_id].get('sentences')
        if not isinstance(units, list) or any(not isinstance(u, dict) or
                not isinstance(u.get('text'), str) for u in units):
            raise ValueError('Excluded challenge articles require source sentences')
        excluded_texts.extend(normalize(u['text']) for u in units if normalize(u['text']))

    def source(pair, side):
        proof, quote = pair.get(side + 'Source'), pair.get(side)
        if not isinstance(proof, dict) or not all(isinstance(proof.get(k), str) and proof[k]
                for k in ['articleId', 'sentenceId', 'articleHash']):
            return None, 'missing_source_proof'
        article = by_id.get(proof['articleId'])
        if article is None:
            return None, 'unknown_source'
        if (article.get('voiceVersion') != DEFINITION['version'] or
                article.get('segmenter') != 'sentence-3.1' or
                type(article.get('scopeCharacters')) is not int or article['scopeCharacters'] != 2000):
            return None, 'invalid_source_version'
        if article.get('topicId') != pair['topic']:
            return None, 'source_topic_mismatch'
        if (proof['articleHash'] != hashes[article['id']] or
                article.get('voiceHash') != hashes[article['id']]):
            return None, 'source_hash_mismatch'
        units = article.get('sentences')
        if not isinstance(units, list) or any(not isinstance(u, dict) for u in units):
            return None, 'invalid_source_sentences'
        matches = [u for u in units if u.get('sentenceId') == proof['sentenceId']]
        if len(matches) != 1:
            return None, 'unknown_or_duplicate_sentence'
        unit = matches[0]
        if not isinstance(quote, str) or not normalize(quote) or quote != unit.get('text'):
            return None, 'quote_mismatch'
        start, end = unit.get('start'), unit.get('end')
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= 2000:
            return None, 'invalid_sentence_range'
        try:
            body = article['text'].encode('utf-16-le')
            if (len(body) > 4000 or end * 2 > len(body) or
                    body[start * 2:end * 2].decode('utf-16-le') != quote):
                return None, 'invalid_sentence_range'
        except UnicodeError:
            return None, 'invalid_sentence_range'
        return (article['id'], find(article['id']), normalize(quote)), None

    accepted, used_articles, used_groups, used_texts = [], set(), set(), []
    for pair in candidates:
        if not isinstance(pair, dict):
            rejected['invalid_pair'] += 1
            continue
        topic = pair.get('topic')
        if (not isinstance(topic, str) or topic not in DEFINITION['topics'] or
                not isinstance(pair.get('issue'), str) or pair['issue'] not in DEFINITION['topics'][topic]['issues']):
            rejected['invalid_topic_or_issue'] += 1
            continue
        support, reason = source(pair, 'support')
        oppose, other_reason = source(pair, 'oppose')
        reason = reason or other_reason
        if not reason:
            articles = {support[0], oppose[0]}
            groups = {support[1], oppose[1]}
            texts = [support[2], oppose[2]]
            if len(articles) != 2:
                reason = 'same_article'
            elif articles & used_articles:
                reason = 'reused_article'
            elif articles & excluded:
                reason = 'excluded_article'
            elif groups & excluded_groups:
                reason = 'excluded_connected_group'
            elif len(groups) != 2:
                reason = 'same_connected_group'
            elif groups & used_groups:
                reason = 'reused_connected_group'
            elif _overlap(*texts) or any(_overlap(t, old) for t in texts for old in used_texts):
                reason = 'reused_text'
            elif any(_overlap(t, old) for t in texts for old in excluded_texts):
                reason = 'excluded_text_overlap'
        if reason:
            rejected[reason] += 1
            continue
        accepted.append(pair)
        used_articles.update(articles)
        used_groups.update(groups)
        used_texts.extend(texts)
    return {'pairs': accepted, 'rejectedCounts': dict(rejected),
            'candidatePairCount': len(candidates)}
