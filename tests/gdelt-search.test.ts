import {afterEach,describe,expect,it,vi} from 'vitest';
import {gdeltRequestUrl,gdeltTextFailure,searchNews} from '../lib/server/news';
import type {RuntimeConfig} from '../lib/server/config';

// Synthetic responses only; fetch is always stubbed and no network request is made.
afterEach(()=>vi.unstubAllGlobals());

type Statement={args:unknown[];bind:(...args:unknown[])=>Statement;run:()=>Promise<{meta:{changes:number}}>};
function fakeDb(){
 const runs:{sql:string;args:unknown[]}[]=[];
 const prepare=(sql:string):Statement=>{const statement:Statement={args:[],bind:(...args)=>{statement.args=args;return statement;},run:async()=>{runs.push({sql,args:statement.args});return {meta:{changes:1}};}};return statement;};
 return {db:{prepare} as unknown as D1Database,runs};
}
const config=(db:D1Database):RuntimeConfig=>({NEWS_PROVIDER:'gdelt',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',DB:db});
const run=async(response:Response|(()=>Promise<Response>),signal=new AbortController().signal)=>{
 const {db,runs}=fakeDb();
 const fetch=vi.fn(async(_input:unknown,_init?:RequestInit)=>typeof response==='function'?response():response);vi.stubGlobal('fetch',fetch);
 let value:Awaited<ReturnType<typeof searchNews>>|undefined;let error:unknown;
 try{value=await searchNews('도서관 운영 시간',config(db),signal);}catch(e){error=e;}
 return {value,error,fetch,runs};
};
const article={title:'가상 기사',url:'https://news.example/a',language:'Korean',seendate:'20261030T010000Z'};

describe('GDELT 요청 구성',()=>{
 it('Cloudflare workerd가 거부하는 redirect:error 대신 manual을 사용한다',async()=>{
  // workerd: 'Invalid redirect value, must be one of "follow" or "manual"' — thrown before dispatch.
  const {fetch}=await run(Response.json({articles:[article]}));
  const init=fetch.mock.calls[0][1] as RequestInit;
  expect(init.redirect).toBe('manual');
 });
 it('고정된 GDELT DOC 2.0 주소와 문서화된 매개변수만 보낸다',()=>{
  const url=gdeltRequestUrl('도서관 운영 시간');
  expect(url.origin+url.pathname).toBe('https://api.gdeltproject.org/api/v2/doc/doc');
  expect(Object.fromEntries(url.searchParams)).toEqual({query:'도서관 운영 시간 sourcelang:korean',mode:'artlist',format:'json',maxrecords:'20',timespan:'30d',sort:'HybridRel'});
 });
});

describe('GDELT 응답 해석',()=>{
 it('정상 기사 목록을 success로 반환한다',async()=>{
  const {value}=await run(Response.json({articles:[article]}));
  expect(value).toMatchObject({provider:'gdelt',status:'success',articles:[{url:'https://news.example/a',stance:'not_checked'}]});
 });
 it('결과가 없을 때 GDELT가 보내는 {}를 오류가 아닌 empty로 처리한다',async()=>{
  const {value,error}=await run(new Response('{}',{headers:{'Content-Type':'application/json'}}));
  expect(error).toBeUndefined();expect(value).toMatchObject({status:'empty',articles:[]});
 });
 it('서비스 오류 객체를 빈 검색 결과로 바꾸지 않는다',async()=>{
  const {error}=await run(Response.json({error:'upstream unavailable'}));
  expect(error).toMatchObject({status:502,code:'SEARCH_INVALID_RESPONSE'});
 });
 it('BOM과 공백이 붙은 JSON도 해석한다',async()=>{
  const {value}=await run(new Response('﻿  '+JSON.stringify({articles:[article]})+'\n'));
  expect(value?.status).toBe('success');
 });
 it('HTTP 200 평문 요청 제한 안내를 429로 분류하고 1분 대기를 기록한다',async()=>{
  const {error,runs}=await run(new Response('Please limit requests to one every 5 seconds or contact us for larger queries.',{headers:{'Content-Type':'text/html'}}));
  expect(error).toMatchObject({status:429,code:'SEARCH_RATE_LIMITED',retryable:true});
  expect(runs.some(r=>r.sql.includes('UPDATE provider_backoff'))).toBe(true);
 });
 it.each(['The specified phrase is too short.','Your search contained a keyword that was too short or too common.'])('HTTP 200 평문 검색어 거부를 422로 분류하고 원문을 노출하지 않는다: %s',async text=>{
  const {error}=await run(new Response(text,{headers:{'Content-Type':'text/html'}}));
  expect(error).toMatchObject({status:422,code:'SEARCH_QUERY_REJECTED',retryable:false});
  expect((error as Error).message).not.toContain(text);
 });
 it('알 수 없는 평문·배열·깨진 JSON은 502 SEARCH_INVALID_RESPONSE다',async()=>{
  for(const body of ['<html>maintenance</html>','[]','{"articles":'])expect((await run(new Response(body))).error).toMatchObject({status:502,code:'SEARCH_INVALID_RESPONSE'});
 });
 it('gdeltTextFailure는 순수 분류 함수다',()=>{
  expect(gdeltTextFailure('Too many requests').code).toBe('SEARCH_RATE_LIMITED');
  expect(gdeltTextFailure('').code).toBe('SEARCH_INVALID_RESPONSE');
 });
});

describe('GDELT 오류 분류',()=>{
 it('3xx는 따라가지 않고 SEARCH_UNEXPECTED_REDIRECT로 구분한다',async()=>{
  const {error,fetch}=await run(new Response(null,{status:302,headers:{Location:'https://elsewhere.example/'}}));
  expect(error).toMatchObject({status:502,code:'SEARCH_UNEXPECTED_REDIRECT',retryable:false});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('5xx는 재시도 가능한 503, 4xx는 요청 형식 오류로 구분한다',async()=>{
  expect((await run(new Response('',{status:502}))).error).toMatchObject({status:503,code:'SEARCH_UNAVAILABLE',retryable:true});
  expect((await run(new Response('',{status:400}))).error).toMatchObject({status:502,code:'SEARCH_REQUEST_INVALID',retryable:false});
 });
 it('HTTP 429는 기존처럼 SEARCH_RATE_LIMITED와 대기 기록을 유지한다',async()=>{
  const {error,runs}=await run(new Response('',{status:429}));
  expect(error).toMatchObject({status:429,code:'SEARCH_RATE_LIMITED'});expect(runs.filter(r=>r.sql.includes('UPDATE provider_backoff'))).toHaveLength(1);
 });
 it('제한 시간 초과만 504 SEARCH_TIMEOUT으로 분류한다',async()=>{
  const {error}=await run(async()=>{throw new DOMException('The operation timed out.','TimeoutError');});
  expect(error).toMatchObject({status:504,code:'SEARCH_TIMEOUT',retryable:true});
 });
 it('런타임·네트워크 TypeError는 시간 초과로 오인하지 않고 503 SEARCH_UNAVAILABLE이다',async()=>{
  const {error}=await run(async()=>{throw new TypeError('Network connection lost.');});
  expect(error).toMatchObject({status:503,code:'SEARCH_UNAVAILABLE'});
 });
 it('호출자가 취소하면 SEARCH_CANCELLED로 구분한다',async()=>{
  const ac=new AbortController();
  const {error}=await run(async()=>{ac.abort();throw new DOMException('aborted','AbortError');},ac.signal);
  expect(error).toMatchObject({code:'SEARCH_CANCELLED',retryable:false});
 });
 it('응답 본문을 읽는 중 시간 초과도 504로 분류한다',async()=>{
  const body=new ReadableStream({pull(controller){controller.error(new DOMException('The operation timed out.','TimeoutError'));}});
  const {error}=await run(new Response(body));
  expect(error).toMatchObject({status:504,code:'SEARCH_TIMEOUT'});
 });
 it('256KB 초과 응답은 기존처럼 거부한다',async()=>{
  const {error}=await run(new Response('{"articles":['+'1,'.repeat(130000)+'1]}'));
  expect(error).toMatchObject({status:502,code:'SEARCH_INVALID_RESPONSE'});
 });
});
