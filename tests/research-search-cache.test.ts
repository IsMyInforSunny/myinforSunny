import {afterEach,describe,expect,it,vi} from 'vitest';
import * as news from '../lib/server/news';
import {cachedResearchSearch,clearResearchSearchCache,isResearchSearchCached} from '../lib/server/search-cache';
import type {RuntimeConfig} from '../lib/server/config';
import type {NewsResult} from '../lib/news-contract';
import {AppError} from '../lib/server/errors';

const config:RuntimeConfig={NEWS_PROVIDER:'gdelt',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',DB:{} as D1Database,ALLOWED_RETRIEVAL_HOSTS:'news.example'};
const result=():NewsResult=>({provider:'gdelt',query:'public article query',status:'success',articles:[{id:'n1',title:'Public search result',url:'https://news.example/a',publisherDomain:'news.example',language:'Korean',provenance:'search_result',stance:'not_checked'}],searchedAt:new Date().toISOString(),scopeNote:'Search metadata only.'});
const signal=()=>new AbortController().signal;
afterEach(()=>{clearResearchSearchCache();vi.restoreAllMocks();vi.useRealTimers();});

describe('actor-scoped research search reuse',()=>{
 it('a stale cache-only hint fails before reservation and the normal path dispatches once',async()=>{
  const provider=vi.spyOn(news,'searchNews').mockResolvedValue(result()),reserve=vi.fn(async()=>{}),release=vi.fn(async()=>{});
  await expect(cachedResearchSearch('expired query',config,signal(),'actor',reserve,release,{cacheOnly:true})).rejects.toMatchObject({code:'SEARCH_CACHE_MISS'});
  expect(reserve).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();
  await cachedResearchSearch('expired query',config,signal(),'actor',reserve,release);
  expect(reserve).toHaveBeenCalledTimes(1);expect(provider).toHaveBeenCalledTimes(1);
  await cachedResearchSearch('expired query',config,signal(),'actor',reserve,release,{cacheOnly:true});
  expect(provider).toHaveBeenCalledTimes(1);
 });
 it('reuses provider output for ten minutes without another reservation and clones returned results',async()=>{
  const provider=vi.spyOn(news,'searchNews').mockResolvedValue(result()),reserve=vi.fn(async()=>{}),release=vi.fn(async()=>{});
  const first=await cachedResearchSearch('public article query',config,signal(),'actor',reserve,release);
  first.articles.length=0;
  const second=await cachedResearchSearch('public article query',config,signal(),'actor',reserve,release);
  expect(second.articles).toHaveLength(1);expect(provider).toHaveBeenCalledTimes(1);expect(reserve).toHaveBeenCalledTimes(1);
  expect(await isResearchSearchCached('public article query',config,'actor')).toBe(true);expect(release).not.toHaveBeenCalled();
 });
 it('keeps actors and source settings separate and checks feature approval before cache reuse',async()=>{
  const provider=vi.spyOn(news,'searchNews').mockResolvedValue(result()),reserve=async()=>{},release=async()=>{};
  await cachedResearchSearch('query',config,signal(),'one',reserve,release);
  await cachedResearchSearch('query',config,signal(),'two',reserve,release);
  await cachedResearchSearch('query',{...config,ALLOWED_RETRIEVAL_HOSTS:'other.example'},signal(),'one',reserve,release);
  expect(provider).toHaveBeenCalledTimes(3);
  await expect(cachedResearchSearch('query',{...config,NEWS_TERMS_APPROVED:'false'},signal(),'one',reserve,release)).rejects.toMatchObject({code:'SEARCH_UNAVAILABLE'});
 });
 it('expires a cached search and never stores a failed search',async()=>{
  const now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
  const provider=vi.spyOn(news,'searchNews').mockRejectedValueOnce(new Error('provider failed')).mockImplementation(async()=>result());
  const reserve=vi.fn(async()=>{}),release=async()=>{};
  await expect(cachedResearchSearch('query',config,signal(),'actor',reserve,release)).rejects.toThrow('provider failed');
  expect(await isResearchSearchCached('query',config,'actor')).toBe(false);
  await cachedResearchSearch('query',config,signal(),'actor',reserve,release);
  clock.mockReturnValue(now+600001);
  await cachedResearchSearch('query',config,signal(),'actor',reserve,release);
  expect(provider).toHaveBeenCalledTimes(3);expect(reserve).toHaveBeenCalledTimes(3);
 });
 it('coalesces dispatch and one cancellation cannot cancel another waiting caller',async()=>{
  let resolve!:(value:NewsResult)=>void,upstream:AbortSignal|undefined;
  const provider=vi.spyOn(news,'searchNews').mockImplementation(async(_query,_config,requestSignal)=>{upstream=requestSignal;return new Promise(done=>{resolve=done;});});
  const reserve=vi.fn(async()=>{}),release=vi.fn(async()=>{}),one=new AbortController();
  const first=cachedResearchSearch('query',config,one.signal,'actor',reserve,release);
  const firstOutcome=first.catch(error=>error);
  const second=cachedResearchSearch('query',config,signal(),'actor',reserve,release);
  await vi.waitFor(()=>expect(provider).toHaveBeenCalledTimes(1));
  one.abort();expect((await firstOutcome).name).toBe('AbortError');expect(upstream?.aborted).toBe(false);
  resolve(result());expect((await second).status).toBe('success');expect(reserve).toHaveBeenCalledTimes(1);
 });
 it('releases a coalesced pre-dispatch provider lock once and retains other failures',async()=>{
  let rejectProvider!:(error:Error)=>void;
  const provider=vi.spyOn(news,'searchNews').mockImplementation(()=>new Promise((_resolve,reject)=>{rejectProvider=reject;}));
  const reserve=vi.fn(async()=>{}),release=vi.fn(async()=>{});
  const requests=Promise.allSettled([cachedResearchSearch('query',config,signal(),'actor',reserve,release),cachedResearchSearch('query',config,signal(),'actor',reserve,release)]);
  await vi.waitFor(()=>expect(provider).toHaveBeenCalledTimes(1));
  rejectProvider(new AppError(429,'SEARCH_LOCK_BUSY','Busy'));await requests;
  expect(reserve).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  provider.mockRejectedValue(new AppError(429,'SEARCH_RATE_LIMITED','Rate limited'));
  await expect(cachedResearchSearch('query',config,signal(),'actor',reserve,release)).rejects.toMatchObject({code:'SEARCH_RATE_LIMITED'});
  expect(release).toHaveBeenCalledTimes(1);
 });
});
