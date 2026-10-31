import copy
import numpy as np
import pytest
from engine import predict, report, train, validate


def data():
    rows = []
    for split in ['train', 'calibration', 'dev', 'test']:
        for i, number in enumerate([-3., -2., 2., 3.]):
            rows.append({'id': f'{split}-{i}', 'group': f'{split}-{i}', 'text': f'synthetic {split} {i}',
                         'split': split, 'label': 'flagged' if number > 0 else 'clear',
                         'provenance': 'synthetic', 'embeddingVersion': 'synthetic-2d-v1',
                         'embedding': [number, number * .1]})
    return rows


def test_real_training_export_and_calibrated_prediction():
    artifact, dev = train(data(), synthetic=True)
    margins, probabilities = predict(artifact, [[-3., -.3], [3., .3]])
    assert margins[0] < 0 < margins[1]
    assert 0 < probabilities[0] < .5 < probabilities[1] < 1
    assert artifact['releaseStatus'] == 'synthetic-test-only'
    assert dev['count'] == 4 and 'brier' in dev


def test_test_vectors_do_not_change_the_trained_artifact():
    rows = data(); changed = copy.deepcopy(rows)
    for row in changed:
        if row['split'] == 'test': row['embedding'] = [999., -999.]; row['label'] = 'clear'
    assert train(rows, synthetic=True)[0] == train(changed, synthetic=True)[0]


def test_group_leakage_is_rejected():
    rows = data(); rows[-1]['group'] = rows[0]['group']
    with pytest.raises(ValueError, match='leakage'): validate(rows, synthetic=True)


def test_synthetic_labels_cannot_be_used_as_human_reviewed_data():
    with pytest.raises(ValueError, match='human'): train(data())


def test_dimension_nan_and_encoder_mismatch_rejected():
    artifact, _ = train(data(), synthetic=True)
    for vectors in [[[1.]], [[float('nan'), 1.]]]:
        with pytest.raises(ValueError): predict(artifact, vectors)
    rows = data(); rows[0]['embeddingVersion'] = 'different'
    with pytest.raises(ValueError): validate(rows, synthetic=True)


def test_abstention_and_zero_coverage_are_explicit():
    artifact, _ = train(data(), synthetic=True)
    artifact['abstain'] = {'low': 0., 'high': 1.}
    result = report(artifact, data()[-4:])
    assert result['coverage'] == 0 and result['accepted_items'] is None


def test_exported_math_matches_svm_form():
    artifact, _ = train(data(), synthetic=True)
    margin, _ = predict(artifact, [[1., .1]])
    expected = sum((v - m) / s * w for v, m, s, w in zip([1., .1], artifact['scaler']['mean'], artifact['scaler']['scale'], artifact['linear']['weights'])) + artifact['linear']['bias']
    assert np.isclose(margin[0], expected, atol=1e-10)
