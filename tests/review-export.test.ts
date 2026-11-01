import {describe, expect, it} from 'vitest';
import {demoAnalysis, demoVerification} from '../lib/fixtures';
import {buildReviewExport} from '../lib/review-export';

const analysis = demoAnalysis('supported');
const result = {...demoVerification('supported'), parentAnalysisId: analysis.analysisId};
const input = {analysis, checks: [], feedback: '', includeRaw: false, includeRefs: false,
  verifications: [result], researchResults: [result], researchStage: 'cancelled' as const};

describe('review export', () => {
  it('includes partial research counts but no source text by default', () => {
    const out = buildReviewExport(input);
    expect(out.research.stage).toBe('cancelled');
    expect(out.research.resultCount).toBe(1);
    expect(out.research.completedClaims).toBe(1);
    expect(out).not.toHaveProperty('analysis');
    expect(out).not.toHaveProperty('verifications');
    expect(out.research).not.toHaveProperty('results');
    expect(JSON.stringify(out)).not.toContain(result.references[0].text);
  });
  it('exports source data only on opt-in and does not forward signed tokens', () => {
    const withToken = {...result, token: 'private-plan-token'};
    const out = buildReviewExport({...input, includeRefs: true, researchResults: [withToken]});
    expect(out.research.results?.[0].references).toEqual(result.references);
    expect(JSON.stringify(out)).not.toContain('private-plan-token');
  });
  it('rejects unbound, stale and cross-mode results', () => {
    const out = buildReviewExport({...input, includeRefs: true, researchResults: [
      {...result, parentAnalysisId: undefined}, {...result, parentAnalysisId: 'old'}, {...result, mode: 'live'},
    ]});
    expect(out.research.resultCount).toBe(0);
    expect(out.research.completedClaims).toBe(0);
    expect(out.research.results).toEqual([]);
  });
  it('clears research on reset and retains raw input opt-in separately', () => {
    expect(buildReviewExport({...input, analysis: null}).research.stage).toBe('not_started');
    expect(buildReviewExport({...input, analysis: null}).research.resultCount).toBe(0);
    expect(buildReviewExport({...input, includeRaw: true}).analysis).toEqual(analysis);
  });
});
