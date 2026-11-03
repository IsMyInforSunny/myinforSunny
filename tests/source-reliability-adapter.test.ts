import {describe, expect, it} from 'vitest';
import {observationsFromResearch} from '../lib/source-reliability-adapter';
import type {Analysis, Reference} from '../lib/contracts';
import type {ResearchVerification} from '../lib/research-contract';

const analysis = (mode: 'live' | 'demo' = 'live') => ({
  analysisId: 'analysis-current', mode, claims: [{id: 'claim-1', kind: 'factual'}],
}) as unknown as Pick<Analysis, 'analysisId' | 'mode' | 'claims'>;

function reference(overrides: Partial<Reference> = {}): Reference {
  return {
    id: 'ref-1', provenance: 'web_fetched',
    url: 'https://www.alpha.example/story?utm_source=news',
    text: 'Evidence quote.', truncated: false, fetchedAt:'2026-01-01T00:00:00.000Z',
    retrievedTruncated: false, retrievedTextLength: 15, fullTextLength: 15,
    contentDigest: 'A'.repeat(43),
    ...overrides,
  };
}

function verification(options: {
  parentAnalysisId?: string; mode?: 'live' | 'demo'; refs?: Reference[];
  execution?: 'completed' | 'failed' | 'skipped'; temporalFit?: 'matched' | 'mismatched' | 'unclear';
  outcome?:ResearchVerification['checks'][number]['outcome'];
  relations?: ResearchVerification['checks'][number]['relations']; claimId?: string; createdAt?: string;
} = {}): ResearchVerification {
  return {
    schemaVersion: '2.1', requestId: 'request-1', parentAnalysisId: options.parentAnalysisId ?? 'analysis-current',
    mode: options.mode ?? 'live', status: 'success', versions: {rubric: 'r', prompt: 'p', model: 'm', retriever: 's'},
    scope: 'retrieved_documents', references: options.refs ?? [reference()],
    checks: [{claimId: options.claimId ?? 'claim-1', outcome: options.outcome??'supported',
      execution: options.execution ?? 'completed', temporalFit: options.temporalFit ?? 'matched',
      relations: options.relations ?? [{referenceId: 'ref-1', quote: 'Evidence quote.', start: 0, end: 15, relation: 'supports', explanation: 'quoted'}],
      explanation: 'reviewed', limitations: []}],
    attempts: [], warnings: [], createdAt: options.createdAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('observationsFromResearch', () => {
  it('keeps an insufficient review out of conclusive weighted evidence even with a supportive quotation',()=>{
    const result=observationsFromResearch(analysis(),[verification({outcome:'insufficient'})]);
    expect(result).toHaveLength(1);expect(result[0].outcome).toBe('insufficient');
    for(const outcome of ['unchecked','inaccessible','not_applicable'] as const)
      expect(observationsFromResearch(analysis(),[verification({outcome})])).toEqual([]);
  });
  it('requires a real fetch timestamp and a valid verification timestamp',()=>{
    for(const fetchedAt of [undefined,'invalid-date'])expect(observationsFromResearch(analysis(),[verification({refs:[reference({fetchedAt})]})])).toEqual([]);
    expect(observationsFromResearch(analysis(),[verification({createdAt:'invalid-date'})])).toEqual([]);
  });
  it('uses only live records bound to the current analysis and factual claims', () => {
    const result = observationsFromResearch(analysis(), [
      verification(),
      verification({parentAnalysisId: 'stale'}),
      verification({mode: 'demo'}),
      verification({claimId: 'opinion-claim'}),
    ]);
    expect(result).toEqual([{
      claimId: 'claim-1', articleId: 'https://alpha.example/story', originId: `sha256:${'A'.repeat(43)}`,
      publisher: 'alpha.example', outcome: 'supports',
    }]);
  });

  it('requires completed matched checks and excludes relations with invalid quote offsets', () => {
    const badQuote = verification({relations: [{referenceId: 'ref-1', quote: 'not a quote', start: 0, end: 10, relation: 'supports', explanation: 'bad'}]});
    const badOffset = verification({relations: [{referenceId: 'ref-1', quote: 'Evidence quote.', start: 1, end: 15, relation: 'supports', explanation: 'bad'}]});
    const result = observationsFromResearch(analysis(), [
      badQuote, badOffset,
      verification({execution: 'failed'}),
      verification({temporalFit: 'unclear'}),
    ]);
    expect(result).toEqual([]);
  });

  it('uses only the latest check for a claim, so an older completed check cannot survive a newer failed or stale check', () => {
    const oldCompleted = verification({createdAt: '2026-01-01T00:00:00.000Z'});
    const newerFailed = verification({execution: 'failed', createdAt: '2026-01-02T00:00:00.000Z'});
    const newerMismatched = verification({temporalFit: 'mismatched', createdAt: '2026-01-02T00:00:00.000Z'});
    expect(observationsFromResearch(analysis(), [oldCompleted, newerFailed])).toEqual([]);
    expect(observationsFromResearch(analysis(), [oldCompleted, newerMismatched])).toEqual([]);
    expect(observationsFromResearch(analysis(), [newerFailed, oldCompleted])).toEqual([]);
  });

  it('keeps a later completed matched check after an older failed check', () => {
    const result = observationsFromResearch(analysis(), [
      verification({execution: 'failed', createdAt: '2026-01-01T00:00:00.000Z'}),
      verification({createdAt: '2026-01-02T00:00:00.000Z'}),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].outcome).toBe('supports');
  });

  it('marks disagreement between valid relations as conflicting and ignores context-only quotes', () => {
    const result = observationsFromResearch(analysis(), [verification({
      refs: [reference(), reference({id: 'ref-2', url: 'https://beta.example/story'})],
      relations: [
        {referenceId: 'ref-1', quote: 'Evidence quote.', start: 0, end: 15, relation: 'supports', explanation: 's'},
        {referenceId: 'ref-1', quote: 'Evidence quote.', start: 0, end: 15, relation: 'contradicts', explanation: 'c'},
        {referenceId: 'ref-2', quote: 'Evidence quote.', start: 0, end: 15, relation: 'context', explanation: 'context'},
      ],
    })]);
    expect(result.map(o => o.outcome).sort()).toEqual(['conflicting', 'insufficient']);
  });

  it('does not attribute unrelated fetched references that the claim check did not cite', () => {
    const result = observationsFromResearch(analysis(), [verification({
      refs: [reference(), reference({id: 'other', url: 'https://beta.example/other'})],
      relations: [{referenceId: 'ref-1', quote: 'Evidence quote.', start: 0, end: 15, relation: 'supports', explanation: 'cited'}],
    })]);
    expect(result).toHaveLength(1);
    expect(result[0].publisher).toBe('alpha.example');
  });

  it('uses canonical URL identity when the digest does not certify a complete full text', () => {
    const ref = reference({contentDigest: undefined, retrievedTruncated: true});
    const result = observationsFromResearch(analysis(), [verification({refs: [ref]})]);
    expect(result[0]).toMatchObject({articleId: 'https://alpha.example/story', originId: 'url:https://alpha.example/story'});
  });

  it('maps only verified same-brand redirect hosts and keeps other brands distinct', () => {
    const khan = observationsFromResearch(analysis(), [verification({refs: [reference({url: 'https://m.khan.co.kr/news/1'})]})]);
    const donga = observationsFromResearch(analysis(), [verification({refs: [reference({url: 'https://news.donga.com/news/1'})]})]);
    const joseonBiz = observationsFromResearch(analysis(), [verification({refs: [reference({url: 'https://biz.chosun.com/news/1'})]})]);
    expect(khan[0].publisher).toBe('khan.co.kr');
    expect(donga[0].publisher).toBe('donga.com');
    expect(joseonBiz[0].publisher).toBe('biz.chosun.com');
  });

  it('rejects non-public, provided-text, and demo-only references', () => {
    const result = observationsFromResearch(analysis(), [verification({refs: [
      reference({url: 'http://127.0.0.1/private'}),
      reference({id: 'provided', provenance: 'provided_text'}),
    ]}), verification({mode: 'demo'})]);
    expect(result).toEqual([]);
    expect(observationsFromResearch(analysis('demo'), [verification()])).toEqual([]);
  });
});
