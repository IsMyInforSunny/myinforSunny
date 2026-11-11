import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import type {RuntimeConfig} from '../lib/server/config';
import {cachedAnalysis} from '../lib/server/analysis-cache';

const config:RuntimeConfig={ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-cache-test',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_DIRECT_FETCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
const request=(actor='one')=>new Request('https://site.test/api/analyze',{headers:{'cf-connecting-ip':actor}});
const input=(body:string)=>({kind:'text' as const,body,comments:[],transmissionConsent:true as const});
const result=()=>({...demoAnalysis('no_comments'),mode:'live' as const,status:'success' as const});
beforeEach(()=>{vi.stubGlobal('caches',undefined);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('short-lived analysis reuse',()=>{
 it('reuses an identical input without another model budget reservation and renews response identity',async()=>{
  const action=vi.fn(async()=>result());
  const first=await cachedAnalysis(request(),input('same article'),config,'first',action);
  const second=await cachedAnalysis(request(),input('same article'),config,'second',action);
  expect(action).toHaveBeenCalledTimes(1);
  expect(first.cache).toBe('miss');expect(second.cache).toBe('hit');
  expect(second.analysis.requestId).toBe('second');
  expect(second.analysis.analysisId).not.toBe(first.analysis.analysisId);
  expect(second.analysis.warnings.some(w=>w.code==='CACHED_ANALYSIS')).toBe(true);
  expect(first.analysis.warnings.some(w=>w.code==='CACHED_ANALYSIS')).toBe(false);
 });
 it('keeps manually entered text isolated between actors and different propositions',async()=>{
  const action=vi.fn(async()=>result());const text=input('actor isolated text');
  await cachedAnalysis(request(),text,config,'1',action);
  await cachedAnalysis(request('two'),text,config,'2',action);
  await cachedAnalysis(request(),{...text,proposition:'different proposition'},config,'3',action);
  expect(action).toHaveBeenCalledTimes(3);
 });
 it('expires memory entries after ten minutes',async()=>{
  vi.useFakeTimers();const action=vi.fn(async()=>result());const text=input('expiry text');
  await cachedAnalysis(request(),text,config,'1',action);
  vi.setSystemTime(Date.now()+601000);
  await cachedAnalysis(request(),text,config,'2',action);
  expect(action).toHaveBeenCalledTimes(2);
 });
 it('never reuses partial or failed analysis',async()=>{
  const action=vi.fn(async()=>({...result(),status:'partial' as const}));const text=input('partial text');
  await cachedAnalysis(request(),text,config,'1',action);
  await cachedAnalysis(request(),text,config,'2',action);
  expect(action).toHaveBeenCalledTimes(2);
 });
 it('checks feature availability before reuse',async()=>{
  const action=vi.fn(async()=>result());const text=input('disabled later');
  await cachedAnalysis(request(),text,config,'1',action);
  await expect(cachedAnalysis(request(),text,{...config,ENABLE_LIVE_ANALYSIS:'false'},'2',async()=>{throw new Error('disabled');})).rejects.toThrow('disabled');
 });
 it('does not share comments or custom propositions through edge storage',async()=>{
  const open=vi.fn();vi.stubGlobal('caches',{open});
  const action=vi.fn(async()=>result());
  await cachedAnalysis(request(),{kind:'url',url:'https://news.example/article1',comments:[{id:'c1',text:'comment'}],transmissionConsent:true},config,'1',action);
  await cachedAnalysis(request(),{kind:'url',url:'https://news.example/article2',comments:[],proposition:'custom',transmissionConsent:true},config,'2',action);
  expect(open).not.toHaveBeenCalled();
 });
 it('continues fresh analysis when edge cache fails',async()=>{
  vi.stubGlobal('caches',{open:async()=>{throw new Error('cache offline');}});
  const action=vi.fn(async()=>result());
  const response=await cachedAnalysis(request(),{kind:'url',url:'https://news.example/article3',comments:[],transmissionConsent:true},config,'1',action);
  expect(response.cache).toBe('miss');expect(action).toHaveBeenCalledOnce();
 });
});
