import { describe, expect, it } from 'vitest';
import { analyzeBiasCoordinate, type BiasArticleCoordinate, type BiasClassifierEvidence, type BiasOrientationSet } from '../lib/bias-analysis';
import { CLAUDE_MEDIA_ORIENTATION_SET } from '../lib/bias-profile-set';

// Entirely synthetic fixtures; they are not real publisher articles or measured SVM results.
const orientationSet: BiasOrientationSet = {
  axisId: 'synthetic-relative-axis', version: 'synthetic-orientation-v1', source: 'synthetic fixture', note: 'synthetic left/right sign convention',
  profiles: [{ publisherId: 'left.test', orientation: 'left' }, { publisherId: 'right.test', orientation: 'right' }, { publisherId: 'middle.test', orientation: 'unspecified' }],
};
const metrics = [
  { publisherId: 'left.test', sampleCount: 4, coordinateMae: 0.1, publisherAccuracy: 0.8 },
  { publisherId: 'right.test', sampleCount: 4, coordinateMae: 0.2, publisherAccuracy: 0.75 },
  { publisherId: 'left2.test', sampleCount: 4, coordinateMae: 0.12, publisherAccuracy: 0.78 },
  { publisherId: 'right2.test', sampleCount: 4, coordinateMae: 0.18, publisherAccuracy: 0.76 },
  { publisherId: 'middle.test', sampleCount: 4, coordinateMae: 0.15, publisherAccuracy: 0.7 },
];
function evidence(value: number): BiasClassifierEvidence {
  return { coordinate: value, axisId: orientationSet.axisId, coordinateSpace: 'synthetic-1d-v1', modelId: 'synthetic-publisher-svm', modelVersion: 'fixture-v1', task: 'publisher-identity-coordinate', trainingDataId: 'synthetic-train', evaluationDataId: 'synthetic-test', evaluation: { split: 'held_out_articles', heldOutUnit: 'original_source_group', groupSplitId: 'synthetic-group-split', trainingPublisherIds: ['left.test', 'right.test', 'middle.test', 'left2.test', 'right2.test'], evaluationPublisherIds: ['left.test', 'right.test', 'middle.test', 'left2.test', 'right2.test'], trainingSourceGroupIds: ['synthetic-source-train'], evaluationSourceGroupIds: ['synthetic-source-test'], metrics } };
}
function article(articleId: string, publisherId: string, value: number, comparisonGroup = 'synthetic-claim-a'): BiasArticleCoordinate {
  return { articleId, publisherId, comparisonGroup, classifier: evidence(value) };
}
const sample = [
  article('target', 'left.test', -0.8), article('l1', 'left.test', -0.6), article('l2', 'left.test', -0.5), article('l3', 'left.test', -0.4),
  article('r1', 'right.test', 0.4), article('r2', 'right.test', 0.5), article('r3', 'right.test', 0.6),
];

describe('analyzeBiasCoordinate', () => {
  it('orients the SVM coordinate, then compares with equal-weight publisher centroids', () => {
    const result = analyzeBiasCoordinate(sample, orientationSet, 'target');
    expect(result.status).toBe('ready');
    expect(result.direction).toBe('left');
    expect(result.directionLabel).toBe('좌익 쪽');
    expect(result.referenceCoordinate).toBe(0);
    expect(result.magnitude).toBe(0.8);
    expect(result.coordinateUncertainty).toBe(0.2);
    expect(result.eligiblePublisherIds).toEqual(['left.test', 'right.test']);
    expect(result.selectedExclusion).toEqual({ excludedFromReference: true, reason: 'target_article_not_reference_sample' });
  });

  it('excludes selected article and requires three other unique articles per publisher', () => {
    const result = analyzeBiasCoordinate(sample.slice(0, 6), orientationSet, 'target');
    expect(result.status).toBe('pending');
    expect(result.reason).toBe('insufficient_publisher_samples');
    expect(result.eligiblePublisherIds).toEqual(['left.test']);
  });

  it('abstains when no real validated SVM prediction exists', () => {
    const data = sample.map(row => row.articleId === 'target' ? { ...row, classifier: null } : row);
    expect(analyzeBiasCoordinate(data, orientationSet, 'target').reason).toBe('model_not_validated');
  });

  it('requires distinct training and article-held-out evaluation data from the same coordinate model', () => {
    const bad = sample.map(row => row.articleId === 'target' ? { ...row, classifier: { ...evidence(-0.8), evaluationDataId: 'synthetic-train' } } : row);
    expect(analyzeBiasCoordinate(bad, orientationSet, 'target').reason).toBe('model_coordinate_mismatch');
  });

  it('keeps publisher classes in both article splits but disjoins original-source groups', () => {
    const overlap = sample.map(row => row.articleId === 'target' ? { ...row, classifier: { ...evidence(-0.8), evaluation: { ...evidence(-0.8).evaluation, evaluationSourceGroupIds: ['synthetic-source-train'] } } } : row);
    expect(analyzeBiasCoordinate(overlap, orientationSet, 'target').reason).toBe('model_coordinate_mismatch');
    const missingTrainingClass = sample.map(row => row.articleId === 'target' ? { ...row, classifier: { ...evidence(-0.8), evaluation: { ...evidence(-0.8).evaluation, trainingPublisherIds: ['right.test'] } } } : row);
    expect(analyzeBiasCoordinate(missingTrainingClass, orientationSet, 'target').reason).toBe('model_coordinate_mismatch');
  });

  it('withholds direction when deviation is within held-out coordinate uncertainty', () => {
    const data = sample.map(row => row.articleId === 'target' ? { ...row, classifier: evidence(0.1) } : row);
    const result = analyzeBiasCoordinate(data, orientationSet, 'target');
    expect(result.reason).toBe('within_uncertainty');
    expect(result.direction).toBeNull();
    expect(result.directionLabel).toBeNull();
  });

  it('reverses an arbitrary SVM sign for a separable one-left/one-right fixture', () => {
    const reversed = sample.map(row => ({ ...row, classifier: evidence(-row.classifier!.coordinate) }));
    const result = analyzeBiasCoordinate(reversed, orientationSet, 'target');
    expect(result.status).toBe('ready');
    expect(result.classifierAxisSign).toBe(-1);
    expect(result.direction).toBe('left');
  });

  it('rejects genuinely overlapping centroids with at least two publishers on each oriented side', () => {
    const fourOutletSet: BiasOrientationSet = { ...orientationSet, profiles: [
      { publisherId: 'left.test', orientation: 'left' }, { publisherId: 'left2.test', orientation: 'left' },
      { publisherId: 'right.test', orientation: 'right' }, { publisherId: 'right2.test', orientation: 'right' },
    ] };
    const overlapping = [
      article('target', 'left.test', 0.6), article('l1', 'left.test', 0.4), article('l2', 'left.test', 0.6), article('l3', 'left.test', 0.8),
      article('ll1', 'left2.test', 0.8), article('ll2', 'left2.test', 0.8), article('ll3', 'left2.test', 0.8),
      article('r1', 'right.test', 0.4), article('r2', 'right.test', 0.5), article('r3', 'right.test', 0.6),
      article('rr1', 'right2.test', 0.7), article('rr2', 'right2.test', 0.75), article('rr3', 'right2.test', 0.8),
    ];
    expect(analyzeBiasCoordinate(overlapping, fourOutletSet, 'target').reason).toBe('axis_orientation_validation_failed');
  });

  it('excludes unrelated proposition groups from sample counts and midpoint', () => {
    const unrelated = ['u1', 'u2', 'u3'].map(id => article(id, 'middle.test', 1, 'synthetic-other-claim'));
    const result = analyzeBiasCoordinate([...sample, ...unrelated], orientationSet, 'target');
    expect(result.status).toBe('ready');
    expect(result.outOfScopeCount).toBe(3);
    expect(result.uniqueArticleCount).toBe(7);
  });

  it('keeps Claude orientation data versioned and excludes specialist outlets', () => {
    expect(CLAUDE_MEDIA_ORIENTATION_SET.version).toBe('media-orientation-claude-v0.1');
    expect(CLAUDE_MEDIA_ORIENTATION_SET.profiles.filter(p => p.orientation === 'left')).toHaveLength(4);
    expect(CLAUDE_MEDIA_ORIENTATION_SET.profiles.filter(p => p.orientation === 'right')).toHaveLength(3);
    expect(CLAUDE_MEDIA_ORIENTATION_SET.profiles.filter(p => p.orientation === 'excluded')).toHaveLength(2);
    expect(analyzeBiasCoordinate([], CLAUDE_MEDIA_ORIENTATION_SET, 'target').status).toBe('pending');
  });
});
