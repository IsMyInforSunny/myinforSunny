"""Math and evaluation boundary fixtures; these do not measure news accuracy."""
from types import SimpleNamespace

import numpy as np
import pytest
from scipy.sparse import csr_matrix

from train_voice import (VERSION, connected_groups, flip_evaluation,
                         independent_flip_pairs, runtime_evaluation,
                         selective_predict, serialize_head)


def test_binary_export_gap_is_twice_sklearn_signed_decision():
    classifier = SimpleNamespace(classes_=np.array(['oppose', 'support']),
                                 coef_=np.array([[.1]]), intercept_=np.array([0.]))
    head = serialize_head(classifier)
    # +/- .1 signed sklearn decisions become a .2 exported margin gap.
    assert selective_predict(head, csr_matrix([[1.], [-1.], [.5]])) == ['support', 'oppose', None]


def test_empty_and_nonfinite_margins_are_unresolved_despite_strong_intercepts():
    head = {'classes': ['oppose', 'support'], 'coefficients': [[-1.], [1.]], 'intercepts': [0., 10.]}
    assert selective_predict(head, csr_matrix([[0.]])) == [None]
    with np.errstate(invalid='ignore', over='ignore'):
        assert selective_predict(head, csr_matrix([[float('nan')], [float('inf')]])) == [None, None]


def heads():
    return {
        'direction': {'classes': ['neutral', 'oppose', 'support'],
                      'coefficients': [[0., 0.], [-1., 0.], [1., 0.]], 'intercepts': [.2, 0., 0.]},
        'speaker': {'classes': ['journalist', 'source'],
                    'coefficients': [[1., 0.], [-1., 0.]], 'intercepts': [0., 0.]},
        'issue': {'classes': ['none', 'expansion'],
                  'coefficients': [[0., 1.], [0., 0.]], 'intercepts': [0., 1.]},
    }


def test_joint_metrics_count_a_missing_head_as_a_missed_label():
    rows = [{'direction': 'support', 'speaker': 'journalist', 'issue': 'expansion'},
            {'direction': 'oppose', 'speaker': 'source', 'issue': 'expansion'},
            {'direction': 'neutral', 'speaker': 'journalist', 'issue': 'none'}]
    report = runtime_evaluation(rows, heads(), csr_matrix([[1., 0.], [-1., 0.], [0., 1.]]))
    assert report['heads']['direction']['acceptedCount'] == 3
    assert report['heads']['direction']['macroF1'] == 1.
    assert report['heads']['speaker']['abstainedCount'] == 1
    assert report['heads']['issue']['abstainedCount'] == 1
    assert report['jointUsableCount'] == 2
    assert report['jointCoverage'] == pytest.approx(2 / 3)
    # Neutral was missed after the other heads abstained; it is not dropped
    # from the denominator to manufacture a perfect shipped score.
    assert report['macroF1'] == pytest.approx(2 / 3)
    assert report['jointAccuracy'] == 1.
    assert report['supportRecall'] == report['opposeRecall'] == 1.


def test_direction_with_none_issue_is_not_a_usable_classification():
    classifiers = heads()
    classifiers['issue']['coefficients'] = [[0., 0.], [0., 0.]]
    classifiers['issue']['intercepts'] = [1., 0.]
    report = runtime_evaluation([{'direction': 'support', 'speaker': 'journalist', 'issue': 'expansion'}],
                                classifiers, csr_matrix([[1., 0.]]))
    assert report['jointUsableCount'] == 0
    assert report['jointAccuracy'] is None
    assert report['supportRecall'] == 0.


def challenge(pairs):
    return {'version': VERSION, 'pairs': pairs}


def pair(support='independent support', oppose='independent opposition'):
    return {'topic': 'nuclear_energy', 'issue': 'expansion', 'support': support, 'oppose': oppose}


def test_duplicate_and_reused_challenge_sentences_cannot_supply_ten_pairs():
    assert len(independent_flip_pairs(challenge([pair()] * 10), 'nuclear_energy', [])) == 1
    reused = [pair(oppose=f'opposition {i}') for i in range(10)]
    assert len(independent_flip_pairs(challenge(reused), 'nuclear_energy', [])) == 1
    assert independent_flip_pairs(challenge([pair()]), 'nuclear_energy', ['independent support']) == []


def test_challenge_requires_defined_issue_version_and_distinct_normalized_text():
    assert independent_flip_pairs({'version': 'old', 'pairs': [pair()]}, 'nuclear_energy', []) == []
    assert independent_flip_pairs(challenge([{**pair(), 'issue': 'unregistered'}]), 'nuclear_energy', []) == []
    assert independent_flip_pairs(challenge([pair('same', '데일리안 same')]), 'nuclear_energy', []) == []
    assert independent_flip_pairs(challenge([pair('프레시안', 'different')]), 'nuclear_energy', []) == []


def test_constant_direction_cannot_pass_opposite_pair_challenge():
    constant = {'classes': ['oppose', 'support'], 'coefficients': [[0.], [0.]], 'intercepts': [0., 1.]}
    result = flip_evaluation(constant, csr_matrix([[1.], [1.]] * 10))
    assert result['itemAccuracy'] == .5
    assert result['pairAccuracy'] == 0.
    assert result['pairCount'] == 10


def test_pair_challenge_uses_runtime_abstention_and_requires_complete_pairs():
    directional = {'classes': ['oppose', 'support'], 'coefficients': [[-1.], [1.]], 'intercepts': [0., 0.]}
    assert flip_evaluation(directional, csr_matrix([[1.], [-1.]]))['pairAccuracy'] == 1.
    result = flip_evaluation(directional, csr_matrix([[.01], [-.01]]))
    assert result['pairAccuracy'] == 0.
    assert result['abstainedCount'] == 2
    with pytest.raises(ValueError, match='complete'):
        flip_evaluation(directional, csr_matrix([[1.]]))


def grouping_rows(texts):
    return [{'article': {'id': f'article-{i}', 'publishedAt': f'2026-0{i + 1}-01'},
             'hash': f'hash-{i}', 'text': text, 'topic': 'nuclear_energy'} for i, text in enumerate(texts)]


def test_empty_publisher_masked_sentence_does_not_join_unrelated_articles():
    groups = connected_groups(grouping_rows(['데일리안', '프레시안']))
    assert len(set(groups)) == 2
    # Real identical nonempty sentences and shared source/event IDs still join.
    assert len(set(connected_groups(grouping_rows(['same sentence', 'same sentence'])))) == 1
    rows = grouping_rows(['first', 'second'])
    assert len(set(connected_groups(rows, {'article-0': 'event', 'article-1': 'event'}))) == 1
    for row in rows:
        row['article']['sourceGroupId'] = 'shared-original'
    assert len(set(connected_groups(rows))) == 1
