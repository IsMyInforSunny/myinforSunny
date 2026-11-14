"""Data boundary fixtures only; model quality uses actual retained articles."""
import copy
import hashlib

import numpy as np
import pytest

from crossvalidate_voice_context import training_features, context_texts
from train_stance import digest
from prepare_voice_embeddings import MODEL


def fixture():
    texts = ['previous fixture', 'current fixture', 'following fixture']
    keys = [hashlib.sha256(text.encode()).hexdigest() for text in texts]
    records = [{'key': key, 'text': text, 'partition': 'train',
                'sourceIDs': [{'articleId': 'a', 'sentenceId': str(i)}]} for i, (key, text) in enumerate(zip(keys, texts))]
    row = {'articleId': 'a', 'sentenceId': '1', 'key': keys[1], 'direction': 'neutral', 'issue': 'none', 'speaker': 'journalist', 'group': 1}
    prepared = {'records': records, 'sets': {'train': [row], 'evaluation': [{'doNotRead': True}]}}
    prepared['inputDigest'] = digest(prepared)
    vector = [1.] + [0.] * 2047
    vectors = {'inputDigest': prepared['inputDigest'], 'model': MODEL, 'dimensions': 2048,
               'vectors': {key: vector for key in keys}}
    corpus = [{'id': 'a', 'voiceVersion': 'sentence-voice-1.0', 'segmenter': 'sentence-3.1',
               'sentences': [{'sentenceId': str(i), 'text': text} for i, text in enumerate(texts)]},
              {'id': 'outer-article-never-read', 'sentences': None}]
    return prepared, vectors, corpus


def test_context_uses_source_grounded_train_neighbors_and_never_outer_vectors():
    prepared, vectors, corpus = fixture()
    vectors['vectors']['outer-poisoned-vector'] = [float('nan')]
    rows, current, context, counts = training_features(prepared, vectors, corpus)
    assert counts == {'previous': 1, 'following': 1, 'missing': 0}
    assert current.shape == (1, 2048)
    assert context.shape == (1, 6146)
    assert np.linalg.norm(context[0]) == pytest.approx(1.)
    assert context_texts(rows, corpus) == ['previous fixture current fixture following fixture']


def test_wrong_article_cannot_donate_a_neighbor_vector():
    prepared, vectors, corpus = fixture()
    prepared['records'][0]['sourceIDs'][0]['articleId'] = 'other'
    prepared['inputDigest'] = digest({key: value for key, value in prepared.items() if key != 'inputDigest'})
    vectors['inputDigest'] = prepared['inputDigest']
    _, _, context, counts = training_features(prepared, vectors, corpus)
    assert counts == {'previous': 0, 'following': 1, 'missing': 1}
    assert np.count_nonzero(context[0, 2048:4096]) == 0


def test_outer_partition_neighbor_is_ignored_and_current_identity_cannot_be_changed():
    prepared, vectors, corpus = fixture()
    prepared['records'][0]['partition'] = 'evaluation'
    prepared['inputDigest'] = digest({key: value for key, value in prepared.items() if key != 'inputDigest'})
    vectors['inputDigest'] = prepared['inputDigest']
    assert training_features(prepared, vectors, corpus)[3]['previous'] == 0
    tampered = copy.deepcopy(corpus)
    tampered[0]['sentences'][1]['text'] = 'modified'
    with pytest.raises(ValueError, match='grounding mismatch'):
        training_features(prepared, vectors, tampered)
