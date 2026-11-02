/** Relative outlet-trained bias coordinates. This module consumes validated model output; it never trains an SVM. */
export const BIAS_METHOD_VERSION = 'publisher-relative-centroid-0.4' as const;
export const MIN_BIAS_ARTICLES_PER_PUBLISHER = 3;
export const MIN_BIAS_ELIGIBLE_PUBLISHERS = 2;

export type PublisherOrientation = 'left' | 'right' | 'unspecified' | 'excluded';
export type BiasDirection = 'left' | 'right';
export type BiasPendingReason = 'no_selected_article' | 'selected_article_missing' | 'selected_article_ambiguous' |
  'no_orientation_profiles' | 'invalid_orientation_profiles' | 'model_not_validated' | 'model_coordinate_mismatch' |
  'insufficient_publisher_samples' | 'axis_orientation_validation_failed';
export type BiasMediaOrientation = { publisherId: string; orientation: PublisherOrientation };
export type BiasOrientationSet = {
  axisId: string;
  version: string;
  source: string;
  note: string;
  profiles: BiasMediaOrientation[];
};
export type BiasClassifierEvidence = {
  coordinate: number;
  axisId: string;
  coordinateSpace: string;
  modelId: string;
  modelVersion: string;
  task: string;
  trainingDataId: string;
  evaluationDataId: string;
  evaluation: {
    split: 'held_out_articles';
    heldOutUnit: 'original_source_group';
    groupSplitId: string;
    trainingPublisherIds: string[];
    evaluationPublisherIds: string[];
    trainingSourceGroupIds: string[];
    evaluationSourceGroupIds: string[];
    metrics: { publisherId: string; sampleCount: number; coordinateMae: number; publisherAccuracy: number }[];
  };
};
export type BiasArticleCoordinate = { articleId: string; publisherId: string; comparisonGroup: string; classifier: BiasClassifierEvidence | null };
export type BiasAnalysisResult = {
  method: typeof BIAS_METHOD_VERSION;
  status: 'ready' | 'pending';
  reason: BiasPendingReason | 'ok' | 'within_uncertainty';
  direction: BiasDirection | null;
  directionLabel: string | null;
  magnitude: number | null;
  gaugePercent: number | null;
  coordinateUncertainty: number | null;
  classifierAxisSign: 1 | -1 | null;
  leftCentroidMean: number | null;
  rightCentroidMean: number | null;
  selectedCoordinate: number | null;
  referenceCoordinate: number | null;
  selectedArticleId: string | null;
  selectedExclusion: { excludedFromReference: boolean; reason: 'target_article_not_reference_sample' | 'not_applicable' };
  comparisonGroup: string | null;
  axisId: string | null;
  orientationSetVersion: string | null;
  eligiblePublisherIds: string[];
  eligiblePublisherCount: number;
  minArticlesPerPublisher: number;
  minEligiblePublishers: number;
  articleCount: number;
  uniqueArticleCount: number;
  excludedCount: number;
  outOfScopeCount: number;
  modelIds: string[];
  modelVersions: string[];
  trainingDataIds: string[];
  evaluationDataIds: string[];
  publisherAccuracy: number | null;
  note: string;
};

const baseNote = '매체 기사 SVM 상대 좌표의 적격 매체 centroid 동일가중 중간지점과 비교합니다. 매체·기사의 고정 성향 또는 진실성 점수가 아닙니다.';
const norm = (v: string) => v.trim().replace(/\s+/g, ' ');
const validCoordinate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1;

function pending(reason: BiasPendingReason, selectedId: string | null, group: string | null, orientationSet: BiasOrientationSet | null, counts: { articleCount?: number; unique?: number; excluded?: number; outOfScope?: number } = {}): BiasAnalysisResult {
  return { method: BIAS_METHOD_VERSION, status: 'pending', reason, direction: null, directionLabel: null, magnitude: null, gaugePercent: null,
    coordinateUncertainty: null, classifierAxisSign: null, leftCentroidMean: null, rightCentroidMean: null, selectedCoordinate: null, referenceCoordinate: null,
    selectedArticleId: selectedId, selectedExclusion: { excludedFromReference: false, reason: 'not_applicable' }, comparisonGroup: group,
    axisId: orientationSet?.axisId ?? null, orientationSetVersion: orientationSet?.version ?? null,
    eligiblePublisherIds: [], eligiblePublisherCount: 0, minArticlesPerPublisher: MIN_BIAS_ARTICLES_PER_PUBLISHER,
    minEligiblePublishers: MIN_BIAS_ELIGIBLE_PUBLISHERS, articleCount: counts.articleCount ?? 0,
    uniqueArticleCount: counts.unique ?? 0, excludedCount: counts.excluded ?? 0, outOfScopeCount: counts.outOfScope ?? 0,
    modelIds: [], modelVersions: [], trainingDataIds: [], evaluationDataIds: [], publisherAccuracy: null, note: baseNote };
}

function validOrientationSet(set: BiasOrientationSet | null | undefined): set is BiasOrientationSet {
  return !!set && !!set.axisId?.trim() && !!set.version?.trim() && !!set.source?.trim() && !!set.note?.trim() &&
    Array.isArray(set.profiles) && set.profiles.length > 0 && set.profiles.every(p => !!p.publisherId?.trim() &&
      ['left', 'right', 'unspecified', 'excluded'].includes(p.orientation)) &&
    new Set(set.profiles.map(p => norm(p.publisherId))).size === set.profiles.length &&
    set.profiles.some(p => p.orientation === 'left') && set.profiles.some(p => p.orientation === 'right');
}

function validEvidence(e: BiasClassifierEvidence, axisId: string): boolean {
  return validCoordinate(e.coordinate) && e.axisId === axisId && !!e.coordinateSpace?.trim() && !!e.modelId?.trim() &&
    !!e.modelVersion?.trim() && !!e.task?.trim() && !!e.trainingDataId?.trim() && !!e.evaluationDataId?.trim() &&
    e.trainingDataId !== e.evaluationDataId && e.evaluation?.split === 'held_out_articles' && e.evaluation.heldOutUnit === 'original_source_group' &&
    !!e.evaluation.groupSplitId?.trim() && Array.isArray(e.evaluation.metrics) && e.evaluation.metrics.length > 0 &&
    Array.isArray(e.evaluation.trainingPublisherIds) && Array.isArray(e.evaluation.evaluationPublisherIds) &&
    Array.isArray(e.evaluation.trainingSourceGroupIds) && e.evaluation.trainingSourceGroupIds.length > 0 &&
    Array.isArray(e.evaluation.evaluationSourceGroupIds) && e.evaluation.evaluationSourceGroupIds.length > 0 &&
    e.evaluation.metrics.every(m => e.evaluation.trainingPublisherIds.map(norm).includes(norm(m.publisherId)) && e.evaluation.evaluationPublisherIds.map(norm).includes(norm(m.publisherId))) &&
    !e.evaluation.trainingSourceGroupIds.map(norm).some(id => e.evaluation.evaluationSourceGroupIds.map(norm).includes(id)) &&
    e.evaluation.metrics.every(m => !!m.publisherId?.trim() && Number.isInteger(m.sampleCount) && m.sampleCount > 0 &&
      Number.isFinite(m.coordinateMae) && m.coordinateMae >= 0 && m.coordinateMae <= 2 &&
      Number.isFinite(m.publisherAccuracy) && m.publisherAccuracy >= 0 && m.publisherAccuracy <= 1) &&
    new Set(e.evaluation.metrics.map(m => norm(m.publisherId))).size === e.evaluation.metrics.length;
}

/**
 * Use outlet articles as SVM training identities; orient the model's arbitrary sign with the
 * configured left/right outlet groups, then compare the target with the equal-weight midpoint
 * of eligible publisher centroids. The target article never contributes to that midpoint.
 */
export function analyzeBiasCoordinate(articles: BiasArticleCoordinate[], orientationSetInput: BiasOrientationSet | null, selectedArticleId?: string): BiasAnalysisResult {
  const rows = Array.isArray(articles) ? articles : [];
  const selectedId = selectedArticleId ? norm(selectedArticleId) : '';
  if (!selectedId) return pending('no_selected_article', null, null, orientationSetInput, { articleCount: rows.length, outOfScope: rows.length });
  const selectedRows = rows.filter(x => norm(x?.articleId ?? '') === selectedId);
  if (!selectedRows.length) return pending('selected_article_missing', selectedId, null, orientationSetInput, { articleCount: rows.length, outOfScope: rows.length });
  if (selectedRows.length !== 1) return pending('selected_article_ambiguous', selectedId, null, orientationSetInput, { articleCount: rows.length, outOfScope: rows.length });
  const group = norm(selectedRows[0].comparisonGroup ?? '') || null;
  if (!orientationSetInput?.profiles?.length) return pending('no_orientation_profiles', selectedId, group, orientationSetInput, { articleCount: rows.length });
  if (!validOrientationSet(orientationSetInput)) return pending('invalid_orientation_profiles', selectedId, group, orientationSetInput, { articleCount: rows.length });
  if (!group) return pending('model_not_validated', selectedId, group, orientationSetInput, { articleCount: rows.length });

  const orientations = new Map(orientationSetInput.profiles.map(p => [norm(p.publisherId), p.orientation]));
  const inScope = rows.filter(x => norm(x?.comparisonGroup ?? '') === group);
  const outOfScopeCount = rows.length - inScope.length;
  const compatibleRows = inScope.filter(x => x?.classifier && validEvidence(x.classifier, orientationSetInput.axisId) && orientations.has(norm(x.publisherId)) && orientations.get(norm(x.publisherId)) !== 'excluded');
  const incompatible = inScope.some(x => x?.classifier && orientations.has(norm(x.publisherId)) && orientations.get(norm(x.publisherId)) !== 'excluded' && !validEvidence(x.classifier, orientationSetInput.axisId));
  const systems = new Set(compatibleRows.map(x => JSON.stringify([x.classifier!.modelId, x.classifier!.modelVersion, x.classifier!.task, x.classifier!.axisId, x.classifier!.coordinateSpace, x.classifier!.trainingDataId, x.classifier!.evaluationDataId, x.classifier!.evaluation.groupSplitId, x.classifier!.evaluation.metrics])));
  if (incompatible || systems.size > 1) return pending('model_coordinate_mismatch', selectedId, group, orientationSetInput, { articleCount: inScope.length, outOfScope: outOfScopeCount, unique: compatibleRows.length, excluded: inScope.length - compatibleRows.length });
  const selected = compatibleRows.filter(x => norm(x.articleId) === selectedId);
  if (selected.length !== 1) return pending('model_not_validated', selectedId, group, orientationSetInput, { articleCount: inScope.length, outOfScope: outOfScopeCount, unique: compatibleRows.length, excluded: inScope.length - compatibleRows.length });

  const selectedArticle = selected[0];
  const referenceSamples = compatibleRows.filter(x => x !== selectedArticle && norm(x.articleId) !== selectedId);
  const seen = new Set<string>();
  const distinct = referenceSamples.filter(x => { const key = `${norm(x.publisherId)}\u0000${norm(x.articleId)}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const byPublisher = new Map<string, BiasArticleCoordinate[]>();
  for (const x of distinct) byPublisher.set(norm(x.publisherId), [...(byPublisher.get(norm(x.publisherId)) ?? []), x]);
  const eligibleIds = [...byPublisher.entries()].filter(([id, xs]) => xs.length >= MIN_BIAS_ARTICLES_PER_PUBLISHER && orientations.has(id) && orientations.get(id) !== 'excluded').map(([id]) => id).sort();
  if (eligibleIds.length < MIN_BIAS_ELIGIBLE_PUBLISHERS) {
    const result = pending('insufficient_publisher_samples', selectedId, group, orientationSetInput, { articleCount: inScope.length, unique: distinct.length + 1, excluded: inScope.length - compatibleRows.length, outOfScope: outOfScopeCount });
    result.eligiblePublisherIds = eligibleIds; result.eligiblePublisherCount = eligibleIds.length;
    return result;
  }
  const evidence = selectedArticle.classifier!;
  const metrics = evidence.evaluation.metrics;
  if (eligibleIds.some(id => !metrics.some(m => norm(m.publisherId) === id))) return pending('model_not_validated', selectedId, group, orientationSetInput, { articleCount: inScope.length, unique: distinct.length + 1, outOfScope: outOfScopeCount });
  const centroids = eligibleIds.map(id => ({ id, orientation: orientations.get(id)!, value: byPublisher.get(id)!.reduce((sum, x) => sum + x.classifier!.coordinate, 0) / byPublisher.get(id)!.length }));
  const left = centroids.filter(x => x.orientation === 'left');
  const right = centroids.filter(x => x.orientation === 'right');
  if (!left.length || !right.length) return pending('axis_orientation_validation_failed', selectedId, group, orientationSetInput, { articleCount: inScope.length, unique: distinct.length + 1, outOfScope: outOfScopeCount });
  const sign: 1 | -1 = left.reduce((s, x) => s + x.value, 0) / left.length <= right.reduce((s, x) => s + x.value, 0) / right.length ? 1 : -1;
  const orientedCentroids = centroids.map(x => ({ ...x, value: x.value * sign }));
  const orientedLeft = orientedCentroids.filter(x => x.orientation === 'left');
  const orientedRight = orientedCentroids.filter(x => x.orientation === 'right');
  if (Math.max(...orientedLeft.map(x => x.value)) >= Math.min(...orientedRight.map(x => x.value))) return pending('axis_orientation_validation_failed', selectedId, group, orientationSetInput, { articleCount: inScope.length, unique: distinct.length + 1, outOfScope: outOfScopeCount });

  const reference = orientedCentroids.reduce((sum, x) => sum + x.value, 0) / orientedCentroids.length;
  const selectedCoordinate = selectedArticle.classifier!.coordinate * sign;
  const delta = selectedCoordinate - reference;
  const magnitude = Math.abs(delta);
  const uncertainty = Math.max(...eligibleIds.map(id => metrics.find(m => norm(m.publisherId) === id)!.coordinateMae));
  const within = magnitude <= uncertainty;
  const direction: BiasDirection | null = within ? null : delta < 0 ? 'left' : 'right';
  return {
    method: BIAS_METHOD_VERSION, status: 'ready', reason: within ? 'within_uncertainty' : 'ok', direction,
    directionLabel: direction === 'left' ? '좌익 쪽' : direction === 'right' ? '우익 쪽' : null,
    magnitude, gaugePercent: magnitude / 2 * 100, coordinateUncertainty: uncertainty, classifierAxisSign: sign,
    leftCentroidMean: orientedLeft.reduce((s, x) => s + x.value, 0) / orientedLeft.length,
    rightCentroidMean: orientedRight.reduce((s, x) => s + x.value, 0) / orientedRight.length,
    selectedCoordinate, referenceCoordinate: reference, selectedArticleId: selectedId,
    selectedExclusion: { excludedFromReference: true, reason: 'target_article_not_reference_sample' }, comparisonGroup: group,
    axisId: orientationSetInput.axisId, orientationSetVersion: orientationSetInput.version,
    eligiblePublisherIds: eligibleIds, eligiblePublisherCount: eligibleIds.length,
    minArticlesPerPublisher: MIN_BIAS_ARTICLES_PER_PUBLISHER, minEligiblePublishers: MIN_BIAS_ELIGIBLE_PUBLISHERS,
    articleCount: inScope.length, uniqueArticleCount: distinct.length + 1,
    excludedCount: inScope.length - compatibleRows.length, outOfScopeCount,
    modelIds: [evidence.modelId], modelVersions: [evidence.modelVersion], trainingDataIds: [evidence.trainingDataId],
    evaluationDataIds: [evidence.evaluationDataId],
    publisherAccuracy: eligibleIds.reduce((s, id) => s + metrics.find(m => norm(m.publisherId) === id)!.publisherAccuracy, 0) / eligibleIds.length,
    note: `${baseNote} ${orientationSetInput.note}`,
  };
}
