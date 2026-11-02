/** Evidence weighting helpers. This module never assigns or learns publisher weights. */
export const SOURCE_RELIABILITY_VERSION = 'source-reliability-1.1';

export type PublisherWeight = {
  publisher: string;
  /** Externally established positive weight in (0, 1]. */
  value: number;
  /** Publicly reviewable rationale or dataset reference for this weight. */
  evidence: string;
};

export type PublisherWeightSet = {
  version: string;
  /** Non-empty description of the method/dataset and its scope. */
  methodology: string;
  weights: readonly PublisherWeight[];
};

export type EvidenceObservation = {
  claimId: string;
  articleId: string;
  /** Stable publication identity allows syndications to be counted once. */
  originId?: string;
  publisher: string;
  outcome: 'supports' | 'contradicts' | 'conflicting' | 'insufficient';
};

export type PublisherEvidenceCount = {
  publisher: string;
  observedArticleCount: number;
  usableArticleCount: number;
  insufficientArticleCount: number;
};

export type WeightUsed = {
  publisher: string;
  value: number;
  evidence: string;
  version: string;
};

export type WeightedClaimEvidence = {
  claimId: string;
  status: 'weighted_evidence_available' | 'weight_missing' | 'insufficient_publishers' | 'insufficient_evidence_groups' | 'no_eligible_evidence';
  /** Weighted shares among support/contradiction/conflict observations, not truth probabilities. */
  shares: {supports: number; contradicts: number; conflicting: number} | null;
  /** Sum of effective publisher groups and shared-origin groups used as denominator. */
  weightSum: number;
  eligiblePublisherCount: number;
  eligibleArticleCount: number;
  eligibleEvidenceGroupCount: number;
  insufficientEvidenceCount: number;
  missingWeightPublishers: string[];
  publisherCounts: PublisherEvidenceCount[];
  weightsUsed: WeightUsed[];
};

export type SourceReliabilityAssessment = {
  version: typeof SOURCE_RELIABILITY_VERSION;
  status: 'ready' | 'pending_weights' | 'pending_evidence';
  methodologyVersion: string | null;
  methodology: string | null;
  claims: WeightedClaimEvidence[];
  note: string;
};

const clean = (s: unknown): s is string => typeof s === 'string' && !!s.trim();
/** Case/space/www normalization is shared by weight and observation lookup. */
const publisherKey = (value: string) => value.trim().toLowerCase().replace(/^www\./, '');

/**
 * Applies caller-supplied, documented source weights to claim-level evidence.
 * Each publisher's weight is divided across its unique origin groups. Shared
 * origins across publishers are one group using the mean participant allocation,
 * so article volume or syndication cannot multiply influence.
 * Shares describe the weighted mix of reviewed evidence, never publisher reliability
 * or the probability that a claim is true.
 */
export function assessWeightedClaimEvidence(
  observations: readonly EvidenceObservation[],
  weightSet: PublisherWeightSet | null | undefined,
  claimIds?: readonly string[],
): SourceReliabilityAssessment {
  const normalizedWeightKeys = weightSet?.weights.map(w => publisherKey(w.publisher)) ?? [];
  const validSet = !!weightSet && clean(weightSet.version) && clean(weightSet.methodology)
    && Array.isArray(weightSet.weights) && weightSet.weights.length > 0
    && weightSet.weights.every(w => clean(w.publisher) && clean(w.evidence)
      && Number.isFinite(w.value) && w.value > 0 && w.value <= 1)
    && new Set(normalizedWeightKeys).size === normalizedWeightKeys.length;
  const byPublisher = new Map<string, PublisherWeight>();
  if (validSet && weightSet) for (const w of weightSet.weights) byPublisher.set(publisherKey(w.publisher), w);

  const ids = [...new Set(claimIds ?? observations.map(o => o.claimId).filter(clean))];
  const claims: WeightedClaimEvidence[] = ids.map(claimId => {
    const perPublisher = new Map<string, {display: string; articles: Map<string, EvidenceObservation['outcome']>}>();
    const originGroups = new Map<string, EvidenceObservation[]>();
    for (const o of observations) {
      if (o.claimId !== claimId || !clean(o.articleId) || !clean(o.publisher)
        || !['supports', 'contradicts', 'conflicting', 'insufficient'].includes(o.outcome)) continue;
      const key = publisherKey(o.publisher);
      const publisher = perPublisher.get(key) ?? {display: o.publisher.trim(), articles: new Map()};
      const previous = publisher.articles.get(o.articleId);
      publisher.articles.set(o.articleId, previous && previous !== o.outcome ? 'conflicting' : o.outcome);
      perPublisher.set(key, publisher);
      const originKey = clean(o.originId) ? `origin:${o.originId.trim()}` : `article:${key}:${o.articleId}`;
      originGroups.set(originKey, [...(originGroups.get(originKey) ?? []), o]);
    }

    const missingKeys = [...perPublisher.keys()].filter(k => !byPublisher.has(k)).sort();
    const missingWeightPublishers = missingKeys.map(k => perPublisher.get(k)!.display);
    const publisherCounts: PublisherEvidenceCount[] = [...perPublisher].map(([key, item]) => {
      const outcomes = [...item.articles.values()];
      return {
        publisher: item.display,
        observedArticleCount: outcomes.length,
        usableArticleCount: outcomes.filter(x => x !== 'insufficient').length,
        insufficientArticleCount: outcomes.filter(x => x === 'insufficient').length,
      };
    }).sort((a, b) => publisherKey(a.publisher).localeCompare(publisherKey(b.publisher)));

    const weightsUsed: WeightUsed[] = [...perPublisher.keys()].flatMap(key => {
      const weight = byPublisher.get(key);
      return weight ? [{publisher: perPublisher.get(key)!.display, value: weight.value,
        evidence: weight.evidence.trim(), version: weightSet!.version.trim()}] : [];
    }).sort((a, b) => publisherKey(a.publisher).localeCompare(publisherKey(b.publisher)));

    const weighted = {supports: 0, contradicts: 0, conflicting: 0};
    let weightSum = 0;
    let eligibleArticleCount = 0;
    let eligibleEvidenceGroupCount = 0;
    const eligiblePublishers = new Set<string>();
    let insufficientEvidenceCount = 0;
    const originCountByPublisher = new Map<string, number>();
    for (const group of originGroups.values()) {
      for (const publisher of new Set(group.map(o => publisherKey(o.publisher)))) {
        originCountByPublisher.set(publisher, (originCountByPublisher.get(publisher) ?? 0) + 1);
      }
    }
    const usableOrigins = new Map<string, {outcome: 'supports' | 'contradicts' | 'conflicting'; publishers: Set<string>}>();
    for (const [originKey, group] of originGroups) {
      const publisherKeys = [...new Set(group.map(o => publisherKey(o.publisher)))];
      const usableOutcomes = group.map(o => o.outcome).filter((x): x is 'supports' | 'contradicts' | 'conflicting' => x !== 'insufficient');
      if (!usableOutcomes.length) { insufficientEvidenceCount++; continue; }
      // Any disagreement across reports of the same origin is explicitly conflicting.
      const outcome: 'supports' | 'contradicts' | 'conflicting' = new Set(usableOutcomes).size > 1 ? 'conflicting' : usableOutcomes[0]!;
      if (publisherKeys.some(k => !byPublisher.has(k))) continue;
      usableOrigins.set(originKey, {outcome, publishers: new Set(publisherKeys)});
    }
    // Allocate each publisher's weight over every origin it observed, including
    // insufficient groups. A shared origin is counted once with the mean of the
    // participants' allocated portions, capping each publisher's total contribution.
    for (const origin of usableOrigins.values()) {
      const allocations = [...origin.publishers].map(publisher => {
        const weight = byPublisher.get(publisher)?.value;
        const originCount = originCountByPublisher.get(publisher) ?? 0;
        return weight !== undefined && originCount > 0 ? weight / originCount : null;
      });
      if (allocations.some(value => value === null)) continue;
      const groupWeight = allocations.reduce<number>((sum, value) => sum + (value ?? 0), 0) / allocations.length;
      if (!(groupWeight > 0)) continue;
      weighted[origin.outcome] += groupWeight;
      weightSum += groupWeight;
      eligibleEvidenceGroupCount++;
      eligibleArticleCount++;
      for (const publisher of origin.publishers) eligiblePublishers.add(publisher);
    }
    const enoughPublishers = eligiblePublishers.size >= 2;
    const enoughEvidenceGroups = eligibleEvidenceGroupCount >= 2;
    const hasMissing = !validSet || missingWeightPublishers.length > 0;
    const complete = !hasMissing && enoughPublishers && enoughEvidenceGroups && weightSum > 0;
    return {
      claimId,
      status: hasMissing ? 'weight_missing' : complete ? 'weighted_evidence_available'
        : eligibleArticleCount && !enoughPublishers ? 'insufficient_publishers'
          : eligibleArticleCount ? 'insufficient_evidence_groups' : 'no_eligible_evidence',
      // Never expose a partial share if a publisher weight is absent or fewer than two
      // positive-weight publishers and two independent origins contribute evidence.
      shares: complete ? {
        supports: weighted.supports / weightSum,
        contradicts: weighted.contradicts / weightSum,
        conflicting: weighted.conflicting / weightSum,
      } : null,
      weightSum,
      eligiblePublisherCount: eligiblePublishers.size,
      eligibleArticleCount,
      eligibleEvidenceGroupCount,
      insufficientEvidenceCount,
      missingWeightPublishers,
      publisherCounts,
      weightsUsed,
    };
  });
  const status = claims.some(c => c.status === 'weight_missing') ? 'pending_weights'
    : claims.some(c => c.status !== 'weighted_evidence_available') ? 'pending_evidence'
      : claims.length ? 'ready' : 'pending_evidence';
  return {
    version: SOURCE_RELIABILITY_VERSION,
    status,
    methodologyVersion: validSet ? weightSet!.version.trim() : null,
    methodology: validSet ? weightSet!.methodology.trim() : null,
    claims,
    note: '출처별 가중치는 제공된 근거·방법 버전으로만 적용합니다. 비율은 검토된 근거의 가중 구성이지 언론사 등급, 사실의 참일 확률 또는 기사 전체의 신뢰 점수가 아닙니다. 모든 관측 출처의 가중치, 적격 출처 2곳 이상, 독립 증거 집단 2개 이상일 때만 비율을 표시합니다.',
  };
}
