import type {Analysis, Reference} from './contracts';
import type {ResearchVerification} from './research-contract';
import {normalizeSourceUrl} from './source-quality';
import type {EvidenceObservation} from './source-reliability';

type CurrentAnalysis = Pick<Analysis, 'analysisId' | 'mode' | 'claims'>;

function validPublicReference(ref: Reference): {host: string; canonicalUrl: string} | null {
  if (ref.provenance !== 'web_fetched') return null;
  const normalized = normalizeSourceUrl(ref.url);
  if (normalized.status !== 'ok' || !normalized.host || !normalized.url) return null;
  return {host: normalized.host, canonicalUrl: normalized.url};
}

function validRelation(ref: Reference, relation: ResearchVerification['checks'][number]['relations'][number]): boolean {
  return Number.isInteger(relation.start) && Number.isInteger(relation.end)
    && relation.start >= 0 && relation.end > relation.start && relation.end <= ref.text.length
    && !!relation.quote.trim() && ref.text.slice(relation.start, relation.end) === relation.quote;
}

/** A digest is considered full-text identity only when the fetch record says it was complete. */
function trustedOriginId(ref: Reference, canonicalUrl: string): string {
  const fullDigest = ref.contentDigest;
  if (typeof fullDigest === 'string' && /^[A-Za-z0-9_-]{43}$/.test(fullDigest)
    && ref.retrievedTruncated === false && Number.isInteger(ref.retrievedTextLength)
    && ref.retrievedTextLength! > 0 && ref.fullTextLength === ref.retrievedTextLength) {
    return `sha256:${fullDigest}`;
  }
  return `url:${canonicalUrl}`;
}

/**
 * Converts only current, live, fetched claim checks into source evidence observations.
 * The function is data-only: it performs no I/O and never invents weights or outcomes.
 */
export function observationsFromResearch(
  analysis: CurrentAnalysis,
  verifications: readonly ResearchVerification[],
): EvidenceObservation[] {
  if (analysis.mode !== 'live' || !analysis.analysisId) return [];
  const factualClaimIds = new Set(analysis.claims.filter(c => c.kind === 'factual').map(c => c.id));
  const output = new Map<string, EvidenceObservation>();

  for (const verification of verifications) {
    if (verification.mode !== 'live' || verification.parentAnalysisId !== analysis.analysisId) continue;
    for (const check of verification.checks) {
      if (!factualClaimIds.has(check.claimId) || check.execution !== 'completed' || check.temporalFit !== 'matched') continue;
      // A bundle may carry references retrieved for other claims. Attribute only
      // sources the current check explicitly cited.
      const citedReferenceIds = new Set(check.relations.map(relation => relation.referenceId));
      for (const ref of verification.references) {
        if (!citedReferenceIds.has(ref.id)) continue;
        const publicRef = validPublicReference(ref);
        if (!publicRef) continue;
        const referencedRelations = check.relations.filter(r => r.referenceId === ref.id);
        const relations = referencedRelations.filter(r => validRelation(ref, r));
        // Malformed quotes are not evidence observations. Insufficient is reserved
        // for a valid context-only citation.
        if (!relations.length) continue;
        const evidenceRelations = new Set(relations.map(r => r.relation).filter(r => r === 'supports' || r === 'contradicts'));
        const outcome: EvidenceObservation['outcome'] = evidenceRelations.size > 1 ? 'conflicting'
          : evidenceRelations.has('supports') ? 'supports'
            : evidenceRelations.has('contradicts') ? 'contradicts' : 'insufficient';
        const originId = trustedOriginId(ref, publicRef.canonicalUrl);
        const articleId = publicRef.canonicalUrl;
        const key = JSON.stringify([check.claimId, articleId]);
        const next: EvidenceObservation = {claimId: check.claimId, articleId, originId, publisher: publicRef.host, outcome};
        const previous = output.get(key);
        if (!previous) output.set(key, next);
        else {
          const sameOutcome = previous.outcome === outcome;
          const mergedOutcome: EvidenceObservation['outcome'] = sameOutcome ? outcome
            : previous.outcome === 'insufficient' ? outcome
              : outcome === 'insufficient' ? previous.outcome : 'conflicting';
          output.set(key, {...previous, outcome: mergedOutcome,
            originId: previous.originId === originId ? originId : `url:${articleId}`});
        }
      }
    }
  }
  return [...output.values()];
}
