"""Math and evaluation boundary fixtures; these do not measure news accuracy."""
from types import SimpleNamespace

import numpy as np
import pytest
from scipy.sparse import csr_matrix

from train_voice import (VERSION, connected_groups, flip_evaluation,
                         independent_flip_pairs, runtime_evaluation,
                         selective_predict, selective_predictions, serialize_head,
                         feature_text, choose_split, validate)
from voice_features import is_boilerplate, model_text, FEATURES_VERSION


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


def test_neutral_independent_evaluation_preserves_joint_metrics_and_reports_separate_decisions():
    rows = [{'direction': 'support', 'speaker': 'journalist', 'issue': 'expansion'},
            {'direction': 'oppose', 'speaker': 'source', 'issue': 'expansion'},
            {'direction': 'neutral', 'speaker': 'journalist', 'issue': 'none'}]
    features = csr_matrix([[1., 0.], [-1., 0.], [0., 1.]])
    old = runtime_evaluation(rows, heads(), features)
    new = runtime_evaluation(rows, heads(), features, 'voice-neutral-independent-1.0')
    decision = new.pop('directionDecision')
    assert new == old
    assert decision['acceptedCount'] == 3
    assert decision['abstainedCount'] == 0
    assert decision['macroF1'] == decision['coverage'] == 1.
    with pytest.raises(ValueError, match='Unknown voice decision policy'):
        runtime_evaluation(rows, heads(), features, 'unknown')


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


def hierarchical_heads():
    result = heads()
    result.pop('direction')
    result['directionality'] = {'classes': ['directional', 'neutral'],
        'coefficients': [[1., 0.], [-1., 0.]], 'intercepts': [0., 0.]}
    result['polarity'] = {'classes': ['oppose', 'support'],
        'coefficients': [[0., -1.], [0., 1.]], 'intercepts': [0., 0.]}
    return result


def test_hierarchy_neutral_gate_does_not_require_polarity_but_uncertain_gate_abstains():
    result = selective_predictions(hierarchical_heads(), csr_matrix([
        [1., 1.], [1., -1.], [-1., 0.], [.01, 1.], [1., .01]]))
    assert result['direction'] == ['support', 'oppose', 'neutral', None, None]


def test_hierarchical_flip_requires_both_directionality_and_polarity_to_pass():
    result = flip_evaluation(hierarchical_heads(), csr_matrix([[1., 1.], [1., -1.]]))
    assert result['pairAccuracy'] == 1.
    # Both polarity labels are confident, but the first directionality gate is not.
    result = flip_evaluation(hierarchical_heads(), csr_matrix([[.01, 1.], [1., -1.]]))
    assert result['pairAccuracy'] == 0.
    assert result['abstainedCount'] == 1


def test_current_only_feature_encoder_ignores_neighboring_sentence_polarity():
    assert feature_text('current sentence', 'support demand', 'opposition demand') == 'current sentence'
    assert feature_text('current sentence') == feature_text('current sentence', 'opposition demand', 'support demand')
    assert FEATURES_VERSION == 'voice-features-1.0'


def test_shared_boilerplate_rules_do_not_drop_prose_containing_ad_or_a_hashtag():
    assert is_boilerplate('AD')
    assert is_boilerplate('#AD119')
    assert is_boilerplate(' #tag #other ')
    assert is_boilerplate('ⓒ publisher')
    assert not is_boilerplate('AD business policy was discussed.')
    assert not is_boilerplate('Policy #tag was debated.')
    assert model_text('데일리안 nuclear 123') == 'nuclear 0'


def test_boilerplate_excluded_from_training_still_requires_complete_valid_annotations():
    import hashlib
    body = 'AD'
    article = {'id': 'boilerplate-test-only', 'text': body, 'topicId': 'nuclear_energy',
        'voiceVersion': VERSION, 'segmenter': 'sentence-3.1', 'scopeCharacters': 2000,
        'sentences': [{'sentenceId': 'body_s0', 'start': 0, 'end': 2, 'text': body}]}
    annotation = {'articleId': article['id'], 'articleHash': hashlib.sha256(body.encode()).hexdigest(),
        'topic': 'nuclear_energy', 'version': VERSION, 'segmenter': 'sentence-3.1', 'scopeCharacters': 2000,
        'annotator': {'kind': 'ai', 'model': 'fixture-only', 'version': 'fixture-only'},
        'labels': [{'sentenceId': 'body_s0', 'issue': 'none', 'direction': 'neutral', 'speaker': 'journalist'}]}
    assert validate([article], [annotation])[0] == []
    with pytest.raises(ValueError, match='cover every'):
        validate([article], [{**annotation, 'labels': []}])
    with pytest.raises(ValueError, match='Invalid voice label'):
        validate([article], [{**annotation, 'labels': [{**annotation['labels'][0], 'direction': 'bad'}]}])


def split_rows():
    values = [('neutral', 'journalist', 'none'), ('support', 'source', 'expansion'),
              ('oppose', 'journalist', 'expansion')]
    rows = []
    for population in ['training', 'evaluation']:
        rows.extend({'article': {'id': f'{population}-{i}'}, 'direction': direction,
                     'speaker': speaker, 'issue': issue} for i, (direction, speaker, issue) in enumerate(values))
    manifest = {'schemaVersion': 'voice-split-1.0',
        'trainingArticleIds': [f'training-{i}' for i in range(3)],
        'evaluationArticleIds': [f'evaluation-{i}' for i in range(3)]}
    return rows, manifest


def test_frozen_split_holds_out_new_connected_rows_without_moving_evaluation():
    rows, manifest = split_rows()
    rows.extend([{**rows[0], 'article': {'id': 'new-linked'}}, {**rows[1], 'article': {'id': 'new-independent'}}])
    split, diagnostics = choose_split(rows, [0, 1, 2, 3, 4, 5, 3, 7], split_manifest=manifest)
    training, evaluation = split
    assert evaluation.tolist() == [3, 4, 5]
    assert training.tolist() == [0, 1, 2, 7]
    assert diagnostics['excludedNewTrainingSentences'] == 1
    assert diagnostics['excludedOriginalTrainingSentences'] == 0


def test_new_duplicate_bridge_cannot_leak_old_training_rows_into_frozen_evaluation():
    rows, manifest = split_rows()
    rows.append({**rows[0], 'article': {'id': 'new-independent-neutral'}})
    split, diagnostics = choose_split(rows, [3, 1, 2, 3, 4, 5, 7], split_manifest=manifest)
    training, evaluation = split
    assert 0 not in training
    assert evaluation.tolist() == [3, 4, 5]
    assert diagnostics['excludedOriginalTrainingSentences'] == 1


def test_frozen_manifest_rejects_overlap_duplicates_missing_evaluation_and_bad_version():
    rows, manifest = split_rows()
    bad = [{**manifest, 'schemaVersion': 'old'},
           {**manifest, 'evaluationArticleIds': ['evaluation-0', 'evaluation-0']},
           {**manifest, 'evaluationArticleIds': ['evaluation-0', 'training-0']},
           {**manifest, 'evaluationArticleIds': ['evaluation-0', 'missing']}]
    for value in bad:
        with pytest.raises(ValueError):
            choose_split(rows, list(range(6)), split_manifest=value)
