import {describe, expect, it} from 'vitest';
import {assessWeightedClaimEvidence, type PublisherWeightSet} from '../lib/source-reliability';

const weights: PublisherWeightSet = {
  version: 'reviewed-2026-01',
  methodology: 'Publicly documented evaluation rubric, version reviewed-2026-01',
  weights: [
    {publisher: 'alpha.example', value: 0.75, evidence: 'rubric record A'},
    {publisher: 'beta.example', value: 0.25, evidence: 'rubric record B'},
  ],
};

describe('assessWeightedClaimEvidence', () => {
  it('weights each publisher once and reports weighted evidence shares, not a reliability score', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'a1', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'a2', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'b1', publisher: 'beta.example', outcome: 'contradicts'},
    ], weights);
    expect(result.status).toBe('ready');
    expect(result.methodologyVersion).toBe('reviewed-2026-01');
    expect(result.claims[0]).toMatchObject({status: 'weighted_evidence_available', eligiblePublisherCount: 2, eligibleArticleCount: 3, eligibleEvidenceGroupCount: 3});
    expect(result.claims[0].shares).toEqual({supports: 0.75, contradicts: 0.25, conflicting: 0});
    expect(result.claims[0].weightSum).toBe(1);
    expect(result.claims[0].publisherCounts).toEqual([
      {publisher: 'alpha.example', observedArticleCount: 2, usableArticleCount: 2, insufficientArticleCount: 0},
      {publisher: 'beta.example', observedArticleCount: 1, usableArticleCount: 1, insufficientArticleCount: 0},
    ]);
    expect(result.claims[0].weightsUsed).toHaveLength(2);
    expect(result.claims[0].weightsUsed[0]).toMatchObject({evidence: 'rubric record A', version: 'reviewed-2026-01'});
    expect(result.note).toContain('사실의 참일 확률');
  });

  it('returns pending when any observed publisher lacks a documented weight', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'x1', publisher: 'unknown.example', outcome: 'contradicts'},
    ], weights);
    expect(result.status).toBe('pending_weights');
    expect(result.claims[0].status).toBe('weight_missing');
    expect(result.claims[0].missingWeightPublishers).toEqual(['unknown.example']);
    expect(result.claims[0].shares).toBeNull();
  });

  it('does not invent results when no valid weight set is provided', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', publisher: 'alpha.example', outcome: 'supports'},
    ], null);
    expect(result.status).toBe('pending_weights');
    expect(result.methodology).toBeNull();
    expect(result.claims[0].shares).toBeNull();
  });

  it('rejects undocumented, duplicate, or out-of-range weight sets', () => {
    const invalid = {...weights, weights: [
      {publisher: 'alpha.example', value: 1.2, evidence: ''},
      {publisher: 'ALPHA.EXAMPLE', value: 0.5, evidence: 'duplicate'},
    ]};
    expect(assessWeightedClaimEvidence([], invalid, ['c1']).status).toBe('pending_weights');
    const zero = {...weights, weights: [{publisher: 'alpha.example', value: 0, evidence: 'zero'}]};
    expect(assessWeightedClaimEvidence([], zero, ['c1']).status).toBe('pending_weights');
  });

  it('ignores insufficient evidence and abstains when no weighted usable evidence remains', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', publisher: 'alpha.example', outcome: 'insufficient'},
    ], weights);
    expect(result.status).toBe('pending_evidence');
    expect(result.claims[0].shares).toBeNull();
  });

  it('keeps requested claims with no observations visible', () => {
    const result = assessWeightedClaimEvidence([], weights, ['empty']);
    expect(result.status).toBe('pending_evidence');
    expect(result.claims[0]).toMatchObject({claimId: 'empty', status: 'no_eligible_evidence', shares: null});
  });

  it('requires two positive-weight publishers with usable evidence before exposing shares', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', publisher: 'www.alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'a2', publisher: 'alpha.example', outcome: 'supports'},
    ], weights);
    expect(result.status).toBe('pending_evidence');
    expect(result.claims[0]).toMatchObject({status: 'insufficient_publishers', eligiblePublisherCount: 1, shares: null});
  });

  it('collapses cross-publisher copies of the same origin and exposes denominator and counts', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a1', originId: 'wire-story-7', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'b1', originId: 'wire-story-7', publisher: 'beta.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'a2', originId: 'origin-a2', publisher: 'alpha.example', outcome: 'insufficient'},
    ], weights);
    expect(result.status).toBe('pending_evidence');
    expect(result.claims[0]).toMatchObject({
      status: 'insufficient_evidence_groups', weightSum: 0.3125, eligiblePublisherCount: 2,
      eligibleEvidenceGroupCount: 1,
      eligibleArticleCount: 1, insufficientEvidenceCount: 1,
      shares: null,
    });
    expect(result.claims[0].publisherCounts).toEqual([
      {publisher: 'alpha.example', observedArticleCount: 2, usableArticleCount: 1, insufficientArticleCount: 1},
      {publisher: 'beta.example', observedArticleCount: 1, usableArticleCount: 1, insufficientArticleCount: 0},
    ]);
  });

  it('caps each publisher at its configured weight across shared and independent origins', () => {
    const result = assessWeightedClaimEvidence([
      {claimId: 'c1', articleId: 'a-shared', originId: 'wire-1', publisher: 'alpha.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'b-shared', originId: 'wire-1', publisher: 'beta.example', outcome: 'supports'},
      {claimId: 'c1', articleId: 'a-own', originId: 'alpha-own', publisher: 'alpha.example', outcome: 'contradicts'},
    ], weights);
    const claim = result.claims[0];
    expect(result.status).toBe('ready');
    expect(claim).toMatchObject({
      status: 'weighted_evidence_available', eligiblePublisherCount: 2,
      eligibleEvidenceGroupCount: 2, eligibleArticleCount: 2,
    });
    // Alpha allocates .75 / 2 across its two origins; beta allocates .25 / 1.
    // The shared origin is averaged once: (.375 + .25) / 2 = .3125.
    // Alpha's independent origin contributes .375. Total stays below .75 + .25.
    expect(claim.weightSum).toBeCloseTo(0.6875);
    expect(claim.weightSum).toBeLessThanOrEqual(weights.weights.reduce((sum, w) => sum + w.value, 0));
    expect(claim.shares?.supports).toBeCloseTo(5 / 11);
    expect(claim.shares?.contradicts).toBeCloseTo(6 / 11);
  });
});
