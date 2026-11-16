import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {cachedPublicUrlAnalysis,type BackgroundScheduler} from '../lib/server/analysis-cache';
import type {RuntimeConfig} from '../lib/server/config';
import {AppError} from '../lib/server/errors';
import type {Analysis} from '../lib/contracts';

const config:RuntimeConfig={ENABLE_LIVE_ANALYSIS:'true',AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',NVIDIA_MODEL:'nvidia/nemotron-3.5-lightning-30b-a3b',ENABLE_DIRECT_FETCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
const request=(actor='one')=>new Request('https://site.test/api/analyze',{headers:{'cf-connecting-ip':actor}});
function setup(name:string){
 const input={kind:'url' as const,url:`https://news.example/${name}`,comments:[],transmissionConsent:true as const};
 let hash='original';const tasks:Array<()=>Promise<void>>=[];
 const schedule:BackgroundScheduler=task=>{tasks.push(task);};
 const prepare=vi.fn(async(_signal:AbortSignal)=>({input:{kind:'text' as const,body:'Test-only cache lifecycle fixture.',comments:[] as Array<{id:string;text:string}>,transmissionConsent:true as const},
  article:{url:input.url,title:undefined as string|undefined,fetchedAt:new Date().toISOString(),fullTextLength:40,analyzedCharacters:40,truncated:false,retrieval:{mode:'allowlisted' as 'allowlisted'|'open',host:'news.example',extractionMethod:'semantic'}},articleHash:hash}));
 const action=vi.fn(async(prepared:{article:NonNullable<Analysis['article']>})=>({...demoAnalysis('no_comments'),mode:'live' as const,status:'success' as const,article:prepared.article}));
 const call=(actor='one')=>cachedPublicUrlAnalysis(request(actor),input,config,crypto.randomUUID(),prepare,action,schedule);
 return {input,tasks,prepare,action,call,schedule,change:()=>{hash='revised';}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('public URL immediate response and scheduled revalidation',()=>{
 it('returns cached analysis without fetching the publisher and exposes the last successful check',async()=>{
  vi.stubGlobal('caches',undefined);const s=setup('immediate');const first=await s.call();
  const second=await s.call('other-user');
  expect(second.cache).toBe('hit');expect(s.prepare).toHaveBeenCalledTimes(1);expect(s.action).toHaveBeenCalledTimes(1);
  expect(second.analysis.cacheCheckedAt).toBe(first.analysis.cacheCheckedAt);expect(s.tasks).toHaveLength(1);
  await s.tasks[0]();expect(s.prepare).toHaveBeenCalledTimes(2);expect(s.action).toHaveBeenCalledTimes(1);
 });
 it('invalidates a changed body after delivery and warns on the next fresh analysis',async()=>{
  const s=setup('changed');await s.call();const old=await s.call();s.change();
  expect(old.cache).toBe('hit');expect(s.action).toHaveBeenCalledTimes(1);await s.tasks[0]();
  const next=await s.call();expect(next.cache).toBe('miss');expect(s.action).toHaveBeenCalledTimes(2);
  expect(next.analysis.warnings.some(w=>w.code==='ARTICLE_CHANGED')).toBe(true);
  const saved=await s.call();expect(saved.cache).toBe('hit');expect(saved.analysis.warnings.some(w=>w.code==='ARTICLE_CHANGED')).toBe(false);
  await s.tasks.at(-1)!();
 });
 it('shares one background check across repeated hits',async()=>{
  const s=setup('one-check');await s.call();await s.call();await s.call('second');
  expect(s.tasks).toHaveLength(1);expect(s.prepare).toHaveBeenCalledTimes(1);await s.tasks[0]();
 });
 it('does not pretend a failed background fetch confirmed the body',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});const s=setup('unavailable');
  const first=await s.call();await s.call();s.prepare.mockRejectedValueOnce(new Error('publisher offline'));
  await s.tasks[0]();const next=await s.call();expect(next.analysis.cacheCheckedAt).toBe(first.analysis.cacheCheckedAt);
  expect(log).toHaveBeenCalledWith(JSON.stringify({type:'article_cache_revalidation',status:'unavailable'}));await s.tasks.at(-1)!();
 });
 it('requires an actual scheduler instead of dropping background work',async()=>{
  const s=setup('missing-context');await s.call();
  await expect(cachedPublicUrlAnalysis(request(),s.input,config,'missing',s.prepare,s.action,()=>{throw Error('no request context');})).rejects.toThrow('no request context');
  await s.call();expect(s.tasks).toHaveLength(1);await s.tasks[0]();
 });
 it.each(['ARTICLE_BODY_UNAVAILABLE','PRIVACY_INPUT_REJECTED'])('forces a fresh check after a restricted background retrieval: %s',async code=>{
  vi.spyOn(console,'info').mockImplementation(()=>{});const s=setup(`restricted-${code}`);
  await s.call();await s.call();s.prepare.mockRejectedValueOnce(new AppError(422,code,'Restricted source'));
  await s.tasks[0]();s.prepare.mockRejectedValueOnce(new AppError(422,code,'Still restricted'));
  await expect(s.call()).rejects.toMatchObject({code});expect(s.action).toHaveBeenCalledTimes(1);
 });
 it('keeps private comments actor-isolated and outside background public storage',async()=>{
  const s=setup('private');const input={...s.input,comments:[{id:'c1',text:'Private test-only comment'}]};
  await cachedPublicUrlAnalysis(request(),input,config,'one',s.prepare,s.action,s.schedule);
  await cachedPublicUrlAnalysis(request('two'),input,config,'two',s.prepare,s.action,s.schedule);
  expect(s.action).toHaveBeenCalledTimes(2);expect(s.tasks).toHaveLength(0);
 });
});
