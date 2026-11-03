import {describe, expect, it} from 'vitest';
import {demoAnalysis, demoVerification} from '../lib/fixtures';
import {buildReviewExport} from '../lib/review-export';
import {makeSources} from '../lib/domain';
import type {Check} from '../lib/contracts';
import {reliabilityReview} from '../lib/reliability';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CanvaDashboard from '../components/canva-dashboard';

const analysis = demoAnalysis('supported');
const result = {...demoVerification('supported'), parentAnalysisId: analysis.analysisId};
const input = {analysis, checks: [], feedback: '', includeRaw: false, includeRefs: false,
  verifications: [result], researchResults: [result], researchStage: 'cancelled' as const};

describe('review export', () => {
  it('exports sourcing counts by default and attribution quotes only with raw-input opt-in', () => {
    const body='통계청에 따르면 2025년 조사에서 인구가 10% 증가했다.';
    const sourced=structuredClone(analysis);
    sourced.sources=makeSources({kind:'text',body,comments:[]});
    const sentence=sourced.sources[0].sentences[0];
    sourced.claims=[{id:'c1',text:'인구가 10% 증가했다.',kind:'factual',origin:[{sourceId:sourced.sources[0].id,sentenceId:sentence.id,start:0,end:body.length,quote:body}]}];
    const normal=buildReviewExport({...input,analysis:sourced});
    expect(normal.sourcing?.summary).toMatchObject({factualClaims:1,traceable_primary:1});
    expect(normal).not.toHaveProperty('citedSources');
    expect(JSON.stringify(normal)).not.toContain('통계청');
    const referencesOnly=buildReviewExport({...input,analysis:sourced,includeRefs:true});
    expect(referencesOnly).not.toHaveProperty('citedSources');
    const raw=buildReviewExport({...input,analysis:sourced,includeRaw:true});
    expect(raw.citedSources?.sources[0]).toMatchObject({name:'통계청',quote:'통계청에 따르면'});
    expect(buildReviewExport({...input,analysis:null,includeRaw:true})).toMatchObject({sourcing:null,citedSources:null});
  });
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
    const rejected = [
      {...result, parentAnalysisId: undefined}, {...result, parentAnalysisId: 'old'}, {...result, mode: 'live'},
    ] as typeof result[];
    const out = buildReviewExport({...input, includeRefs: true, researchResults: rejected, verifications: rejected});
    expect(out.research.resultCount).toBe(0);
    expect(out.research.completedClaims).toBe(0);
    expect(out.research.results).toEqual([]);
    expect(out.verifications).toEqual([]);
  });
  it('clears research on reset and retains raw input opt-in separately', () => {
    expect(buildReviewExport({...input, analysis: null}).research.stage).toBe('not_started');
    expect(buildReviewExport({...input, analysis: null}).research.resultCount).toBe(0);
    expect(buildReviewExport({...input, includeRaw: true}).analysis).toEqual(analysis);
  });
  it('uses natural sentences rather than processing fragments for exported expression counts', () => {
    const long = demoAnalysis('no_comments');
    long.sources = makeSources({kind: 'text', body: '가'.repeat(1100) + '다.', comments: []});
    long.expressions = long.sources[0].sentences.map(unit => ({sentenceId: unit.id, sourceId: 'body',
      status: 'flagged', criteria: [], context: 'direct', evidence: []}));
    long.coverage.totalSentences = long.sources[0].sentences.length;
    expect(long.coverage.totalSentences).toBeGreaterThan(1);
    expect(buildReviewExport({...input, analysis: long}).summary).toMatchObject({sentences: 1, flagged: 1});
  });
  it('does not inflate completion with duplicate checks, unrelated IDs or non-factual claims', () => {
    const mixed = structuredClone(analysis);
    mixed.claims.push({...mixed.claims[0], id: 'opinion', kind: 'opinion'});
    const completed = result.checks[0];
    const checks: Check[] = [completed, completed, {...completed, claimId: 'old_claim'}, {...completed, claimId: 'opinion'}];
    const out = buildReviewExport({...input, analysis: mixed, checks, researchResults: [{...result, checks}]});
    expect(out.summary?.completedChecks).toBe(1);
    expect(out.research.completedClaims).toBe(1);
  });
  it('a later failed or skipped attempt supersedes an earlier completion in both summaries', () => {
    const completed = result.checks[0];
    for (const execution of ['failed', 'skipped'] as const) {
      const latest = {...completed, execution};
      const out = buildReviewExport({...input, checks: [completed, latest],
        researchResults: [result, {...result, checks: [latest]}]});
      expect(out.summary?.completedChecks).toBe(0);
      expect(out.research.completedClaims).toBe(0);
    }
  });
  it('does not leak lingering reference results when the current analysis has been reset', () => {
    const out = buildReviewExport({...input, analysis: null, includeRaw: true, includeRefs: true,
      checks: result.checks, researchStage: 'completed'});
    expect(out.summary).toBeNull();
    expect(out.analysis).toBeNull();
    expect(out.research).toMatchObject({stage: 'not_started', resultCount: 0, completedClaims: 0, results: []});
    expect(out.verifications).toEqual([]);
  });
  it('keeps live automatic completion consistent with the on-screen external review', () => {
    const live = {...analysis, mode: 'live' as const};
    const provided = {...result, mode: 'live' as const};
    const fetched = {...provided, references: provided.references.map(r => ({...r,
      provenance: 'web_fetched' as const, url: 'https://news.example/synthetic-library'}))};
    for (const researchResults of [[provided], [fetched], [fetched, provided]]) {
      const out = buildReviewExport({...input, analysis: live, researchResults});
      expect(out.research.completedClaims).toBe(reliabilityReview(live, researchResults, input.researchStage).completedClaims);
    }
    expect(buildReviewExport({...input, analysis: live, researchResults: [provided]}).research.completedClaims).toBe(0);
    expect(buildReviewExport({...input, analysis: live, researchResults: [fetched]}).research.completedClaims).toBe(1);
  });
  it('keeps claim-review counts separate from the bias gauge', () => {
    const live = {...analysis, mode: 'live' as const};
    const fetched = {...result, mode: 'live' as const, references: result.references.map(r => ({...r,
      provenance: 'web_fetched' as const, url: 'https://news.example/synthetic-library'}))};
    const failed = {...fetched, references: [], checks: fetched.checks.map(c => ({...c,
      execution: 'failed' as const, relations: []}))};
    for (const [checks, researchResults, count] of [
      [[], [fetched], 1],
      [result.checks, [fetched], 1],
      [result.checks, [fetched, failed], 0],
      [[], [{...fetched, parentAnalysisId: 'old'}], 0],
    ] as const) {
      const out = buildReviewExport({...input, analysis: live, checks: [...checks], researchResults: [...researchResults]});
      expect(out.summary?.completedChecks).toBe(count);
      const html = renderToStaticMarkup(createElement(CanvaDashboard, {analysis: live,
        checks: [...checks], researchResults: [...researchResults], onEvidence: () => {}, onArticles: () => {}}));
      expect(html).toContain('편향 정도 계산 대기');
      expect(html).not.toContain(`사실 주장 1개 중 ${count}개 대조 완료`);
      expect(JSON.stringify(out)).not.toContain(fetched.references[0].text);
    }
  });
});
