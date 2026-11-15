import {afterEach, describe, expect, it, vi} from 'vitest';
import {demoAnalysis, demoVerification} from '../lib/fixtures';
import type {ResearchInput} from '../lib/research-contract';
import {runResearch} from '../lib/research-runner';
import {planResearch} from '../lib/server/research';
import * as language from '../lib/server/language';
import type {RuntimeConfig} from '../lib/server/config';

function input(): ResearchInput {
  const analysis = demoAnalysis('supported');
  return {sources: analysis.sources, claims: analysis.claims.filter(claim => claim.kind === 'factual').slice(0, 1), transmissionConsent: true, researchConsent: true};
}

afterEach(() => vi.restoreAllMocks());

describe('provider-specific research model spacing', () => {
  it('rechecks stale hints without a provider retry and waits for the original rolling search slots',async()=>{
    let now=0,plans=0;const waits:number[]=[],cacheChecks:number[]=[],dispatches:{index:number;at:number}[]=[];
    await runResearch(input(),new AbortController().signal,{
      now:()=>now,modelIntervalMs:0,wait:async ms=>{waits.push(ms);now+=ms;},
      post:async<T,>(body:unknown)=>{
        const operation=body as {operation:string;queryIndex:number;cacheOnly?:boolean};
        if(operation.operation==='plan'){plans++;return {token:'plan',queries:Array.from({length:4},(_,index)=>({label:String(index),purpose:'fact_check'})),cachedQueryIndexes:[1,3],nextModelCallAt:new Date(0).toISOString()} as T;}
        if(operation.cacheOnly){cacheChecks.push(operation.queryIndex);throw Object.assign(new Error('Cache expired'),{code:'SEARCH_CACHE_MISS'});}
        dispatches.push({index:operation.queryIndex,at:now});return {token:'evidence',references:[]} as T;
      },
    },()=>{},()=>{});
    expect(plans).toBe(1);expect(cacheChecks).toEqual([1,3]);
    expect(dispatches).toEqual([{index:0,at:0},{index:1,at:7000},{index:2,at:14000},{index:3,at:61000}]);
    expect(waits).toEqual([7000,7000,47000]);
  });
  it.each(['SEARCH_RATE_LIMITED','SEARCH_CACHE_MISS'])('never repeats a provider failure or more than one cache fallback (%s)',async code=>{
    const operations:{operation:string;cacheOnly?:boolean}[]=[];
    await expect(runResearch(input(),new AbortController().signal,{
      now:()=>0,modelIntervalMs:0,wait:async()=>{},
      post:async<T,>(body:unknown)=>{
        const operation=body as {operation:string;cacheOnly?:boolean};operations.push(operation);
        if(operation.operation==='plan')return {token:'plan',queries:[{label:'one'}],cachedQueryIndexes:[0],nextModelCallAt:new Date(0).toISOString()} as T;
        throw Object.assign(new Error('Stopped'),{code});
      },
    },()=>{},()=>{})).rejects.toThrow('Stopped');
    expect(operations).toHaveLength(code==='SEARCH_CACHE_MISS'?3:2);
    expect(operations[1].cacheOnly).toBe(true);
    if(code==='SEARCH_CACHE_MISS')expect(operations[2].cacheOnly).toBeUndefined();
  });
  it('compares a perspective first and cached searches do not consume search spacing',async()=>{
    let now=0;const waits:number[]=[],queryOrder:number[]=[],compared:number[]=[];
    const value=input(),verification=demoVerification('supported');
    await runResearch(value,new AbortController().signal,{
      now:()=>now,modelIntervalMs:0,wait:async ms=>{waits.push(ms);now+=ms;},
      post:async<T,>(body:unknown)=>{
        const operation=body as {operation:string;queryIndex:number};
        if(operation.operation==='plan')return {token:'plan',queries:[{label:'fact',purpose:'fact_check'},{label:'perspective',purpose:'perspective'},{label:'another fact',purpose:'fact_check'}],cachedQueryIndexes:[0,1],nextModelCallAt:new Date(0).toISOString(),evidenceUsesModel:false} as T;
        if(operation.operation==='discover'){queryOrder.push(operation.queryIndex);return {token:'evidence',references:[{text:'Fetched evidence'}]} as T;}
        compared.push(now);return verification as T;
      },
    },()=>{},()=>{});
    expect(queryOrder).toEqual([1,0,2]);expect(compared).toEqual([0,0,0]);expect(waits).toEqual([]);
  });
  it.each([
    {modelIntervalMs: undefined, planDelay: 61000, compareTimes: [61000, 122000], waits: [61000, 61000]},
    {modelIntervalMs: 0, planDelay: 0, compareTimes: [0, 7000], waits: [7000]},
  ])('uses $modelIntervalMs while preserving sequential comparisons', async ({modelIntervalMs, planDelay, compareTimes, waits}) => {
    const value = input();
    const observedWaits: number[] = [];
    const observedComparisons: number[] = [];
    let now = 0;
    const result = demoVerification('supported');
    result.checks = result.checks.slice(0, 1);
    result.checks[0].claimId = value.claims[0].id;
    await runResearch(value, new AbortController().signal, {
      now: () => now,
      modelIntervalMs,
      wait: async ms => { observedWaits.push(ms); now += ms; },
      post: async <T,>(body: unknown) => {
        const operation = (body as {operation: string}).operation;
        if (operation === 'plan') return {token: 'plan', queries: [{label: 'first'}, {label: 'second'}], nextModelCallAt: new Date(planDelay).toISOString()} as T;
        if (operation === 'discover') return {token: 'evidence', references: [{text: 'public synthetic evidence'}]} as T;
        observedComparisons.push(now);
        return result as T;
      },
    }, () => {}, () => {});
    expect(observedComparisons).toEqual(compareTimes);
    expect(observedWaits).toEqual(waits);
  });

  it('retains search intervals and the rolling three-search limit when model spacing is zero', async () => {
    let now = 0;
    const searches: number[] = [];
    const waits: number[] = [];
    await runResearch(input(), new AbortController().signal, {
      now: () => now,
      modelIntervalMs: 0,
      wait: async ms => { waits.push(ms); now += ms; },
      post: async <T,>(body: unknown) => {
        if ((body as {operation: string}).operation === 'plan') return {token: 'plan', queries: Array.from({length: 4}, () => ({label: 'query'})), nextModelCallAt: new Date(0).toISOString()} as T;
        searches.push(now);
        return {token: 'evidence', references: []} as T;
      },
    }, () => {}, () => {});
    expect(searches).toEqual([0, 7000, 14000, 61000]);
    expect(waits).toEqual([7000, 7000, 47000]);
  });

  it.each([['groq', 61000], ['nvidia', 0]] as const)('publishes the %s planning deadline with %sms model spacing', async (provider, interval) => {
    const now = 100000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const value = input();
    vi.spyOn(language, 'structured').mockResolvedValue({queries: [{claimId: value.claims[0].id, label: '도서관 운영', query: '공개 도서관 운영 시간', purpose: 'fact_check'}]});
    const config: RuntimeConfig = {
      AI_PROVIDER: provider, ENABLE_LIVE_ANALYSIS: 'true',
      GROQ_API_KEY: 'synthetic-key', GROQ_MODEL: 'openai/gpt-oss-120b',
      GROQ_ELIGIBILITY_CONFIRMED: 'true', GROQ_FREE_PLAN_CONFIRMED: 'true',
      GROQ_CONSOLE_LIMITS_CONFIRMED: 'true', GROQ_CONSOLE_RPD: '1000', GROQ_CONSOLE_TPD: '200000',
      NVIDIA_API_KEY: 'synthetic-key',
      ENABLE_NEWS_SEARCH: 'true', NEWS_TERMS_APPROVED: 'true',
      ALLOWED_RETRIEVAL_HOSTS: 'news.example', DB: {} as D1Database,
    };
    const plan = await planResearch(new Request('https://site.test/api/research'), value, config, AbortSignal.timeout(3000));
    expect(Date.parse(plan.nextModelCallAt)).toBe(now + interval);
  });
});
