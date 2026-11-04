import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import * as configuration from '../lib/server/config';
import type {RuntimeConfig} from '../lib/server/config';
import {allowedUrl} from '../lib/server/retrieval';
import {searchNews} from '../lib/server/news';
import {releaseSearch,reserveSearch,isSearchLockBusy} from '../lib/server/search-budget';
import {AppError} from '../lib/server/errors';
import {POST as newsRoute} from '../app/api/news/route';

let mf:Miniflare;let db:D1Database;
beforeAll(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});db=await mf.getD1Database('DB') as unknown as D1Database;for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();});
beforeEach(async()=>{await db.prepare('DELETE FROM provider_backoff').run();await db.prepare('DELETE FROM research_search_budget').run();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
afterAll(async()=>{await mf?.dispose();});

const req=(ip:string)=>new Request('https://site.test/api/news',{headers:{'cf-connecting-ip':ip,'user-agent':'guard-test'}});
const searchConfig=():RuntimeConfig=>({IP_HASH_SECRET:'synthetic-local-guard-secret',NEWS_PROVIDER:'gdelt',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',DB:db});
const rows=async()=>(await db.prepare('SELECT COUNT(*) AS n FROM research_search_budget').first<{n:number}>())!.n;
const holdLock=()=>db.prepare(`INSERT INTO provider_backoff (id,until_at) VALUES ('gdelt',?)`).bind(Date.now()+600000).run();
const newsRequest=(ip='route-user')=>new Request('https://site.test/api/news',{method:'POST',headers:{'Content-Type':'application/json','cf-connecting-ip':ip,'user-agent':'guard-test'},body:JSON.stringify({query:'도서관 운영 시간',searchConsent:true})});

describe('allowedUrl HTTPS 전용',()=>{
 it('허용 호스트라도 HTTP는 거부하고 HTTPS로 암묵 승격하지 않는다',()=>{
  expect(allowedUrl('http://example.com/a',['example.com'])).toBeNull();
  expect(allowedUrl('https://example.com/a',['example.com'])?.href).toBe('https://example.com/a');
 });
 it('기존 credential·port·유사 도메인·로컬·IP 차단을 유지한다',()=>{
  for(const url of ['https://user:pw@example.com/a','https://example.com:8443/a','https://example.com.evil.test/a','https://localhost/a','https://127.0.0.1/a','https://example.com./a','ftp://example.com/a'])expect(allowedUrl(url,['example.com'])).toBeNull();
 });
});

describe('releaseSearch',()=>{
 it('id와 actor가 모두 일치하는 예약 행만 삭제한다',async()=>{
  const now=Date.now();
  await reserveSearch(req('owner'),searchConfig(),'shared-id',now);
  await reserveSearch(req('owner'),searchConfig(),'other-id',now);
  await releaseSearch(req('intruder'),searchConfig(),'shared-id');
  expect(await rows()).toBe(2);
  await releaseSearch(req('owner'),searchConfig(),'shared-id');
  expect(await rows()).toBe(1);
  expect(await db.prepare(`SELECT id FROM research_search_budget`).first<{id:string}>()).toMatchObject({id:'other-id'});
 });
});

describe('GDELT 전역 잠금',()=>{
 it('네트워크 전송 전 잠금 실패만 SEARCH_LOCK_BUSY로 구분한다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await holdLock();
  const error=await searchNews('도서관 운영 시간',searchConfig(),new AbortController().signal).catch(e=>e);
  expect(error).toBeInstanceOf(AppError);expect(error.code).toBe('SEARCH_LOCK_BUSY');expect(isSearchLockBusy(error)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
 });
 it('외부 429는 SEARCH_RATE_LIMITED이며 잠금 오류로 분류하지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('',{status:429}));vi.stubGlobal('fetch',fetch);
  const error=await searchNews('도서관 운영 시간',searchConfig(),new AbortController().signal).catch(e=>e);
  expect(error.code).toBe('SEARCH_RATE_LIMITED');expect(isSearchLockBusy(error)).toBe(false);expect(fetch).toHaveBeenCalledTimes(1);
 });
});

describe('/api/news 예약 처리',()=>{
 it('검색 제공자 미준비면 예약 전에 거부해 할당량을 차감하지 않는다',async()=>{
  vi.spyOn(configuration,'runtimeConfig').mockResolvedValue({...searchConfig(),NEWS_PROVIDER:'firecrawl'});
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const response=await newsRoute(newsRequest());
  expect(response.status).toBe(503);expect(await rows()).toBe(0);expect(fetch).not.toHaveBeenCalled();
 });
 it('개인정보 검사는 준비 검사보다 먼저 실행된다',async()=>{
  const spy=vi.spyOn(configuration,'runtimeConfig').mockResolvedValue(searchConfig());
  const response=await newsRoute(new Request('https://site.test/api/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:'연락처 010-1234-5678',searchConsent:true})}));
  expect(response.status).toBe(422);expect(spy).not.toHaveBeenCalled();expect(await rows()).toBe(0);
 });
 it('SEARCH_LOCK_BUSY이면 해당 예약만 해제하고 자동 재시도하지 않는다',async()=>{
  vi.spyOn(configuration,'runtimeConfig').mockResolvedValue(searchConfig());
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);await holdLock();
  const response=await newsRoute(newsRequest());
  expect(response.status).toBe(429);expect((await response.json() as {error:{code:string}}).error.code).toBe('SEARCH_LOCK_BUSY');
  expect(await rows()).toBe(0);expect(fetch).not.toHaveBeenCalled();
 });
 it('외부 429와 네트워크 실패는 예약을 유지한다',async()=>{
  vi.spyOn(configuration,'runtimeConfig').mockResolvedValue(searchConfig());
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:429})));
  expect((await newsRoute(newsRequest('keep-a'))).status).toBe(429);expect(await rows()).toBe(1);
  await db.prepare('DELETE FROM provider_backoff').run();
  const fetch=vi.fn().mockRejectedValue(new TypeError('network'));vi.stubGlobal('fetch',fetch);
  expect((await newsRoute(newsRequest('keep-b'))).status).toBe(503);expect(await rows()).toBe(2);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
