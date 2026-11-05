import {afterEach,describe,expect,it,vi} from 'vitest';
import {extractArticle} from '../lib/server/article-extraction';
import {searchTavily} from '../lib/server/tavily-search';
import {parsePublisherFeed,searchPublisherFeeds} from '../lib/server/publisher-feeds';
import {runResearch,researchBatches} from '../lib/research-runner';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {RuntimeConfig} from '../lib/server/config';
import type {ResearchInput,ResearchVerification} from '../lib/research-contract';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const rss=(host:string,title='공개 도서관 운영 시간',path='/news/a')=>`<?xml version="1.0"?><rss><channel><item><title><![CDATA[${title}]]></title><link>https://${host}${path}</link><description>검색 발췌는 근거가 아닙니다.</description><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
const signal=()=>new AbortController().signal;
const input=():ResearchInput=>{const a=demoAnalysis('supported');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};};

describe('원사이트 본문 추출 복구 — 합성 HTML만 사용',()=>{
 it('공개 ASP.NET 기사에서 명시된 div 본문만 보존하고 주변 기자·후원 UI를 제외한다',()=>{
  const body='가상 본문의 공개 정책 설명입니다. '.repeat(6).trim();
  const found=extractArticle(`<form id="aspnetForm" name="aspnetForm"><main><article class="newswrap"><header>제목과 공유</header><div class="at_contents"><p>${body}</p></div><section>후원하기 기자 소개</section></article></main></form>`,'https://www.ohmynews.com/NWS_Web/View/at_pg.aspx?CNTN_CD=A0000000000');
  expect(found?.text).toBe(body);expect(found?.text).not.toContain('후원하기');
 });
 it('여러 article 중 짧은 카드 대신 가장 긴 본문 한 개만 취득한다',()=>{
  const body='공개 가상 본문의 근거와 조사 방법을 설명하는 문장입니다. '.repeat(5).trim();
  const found=extractArticle(`<article>짧은 요약 카드</article><article><p>${body}</p></article>`,'https://news.example/a');
  expect(found?.text).toBe(body);expect(found?.text).not.toContain('짧은 요약 카드');
 });
 it('일반 div 기사에서 메뉴를 빼고 본문을 복원한다',()=>{
  const paragraph='공개 도서관이 운영 시간을 안내했다. 자료에는 운영 대상과 기간을 설명하고 시민의 이용 방법을 구체적으로 알렸다. ';
  const result=extractArticle(`<html><head><title>공개 도서관 안내</title></head><body><nav>제외할 메뉴</nav><div id="content">${Array.from({length:5},()=>`<p>${paragraph}</p>`).join('')}</div><footer>제외할 꼬리말</footer></body></html>`,'https://news.example/a');
  expect(result?.text).toContain(paragraph.trim());expect(result?.text).not.toContain('제외할');expect(result?.extractionVersion).toBe('readability-text-1.1');
 });
 it.each(['<meta name="robots" content="noai">','<meta name="googlebot" content="nosnippet">','<script type="application/ld+json">{"@graph":[{"isAccessibleForFree":false}]}</script>'])('접근 제한이 명시적 본문이나 보조 추출로 되살아나지 않는다 (%s)',restriction=>{
  expect(extractArticle(`<head>${restriction}</head><article itemprop="articleBody">공개 기사처럼 보이는 제한 자료.</article>`,'https://news.example/a')).toBeNull();
 });
 it('기존 ASP.NET 기사 본문은 보존하고 메뉴만 있는 페이지는 거부한다',()=>{
  expect(extractArticle('<form name="aspnetForm" id="aspnetForm"><article class="article_body">공개 본문.<form>댓글.</form>끝 문장.</article></form>','https://news.example/a')?.text).toBe('공개 본문. 끝 문장.');
  expect(extractArticle('<main>메뉴 검색 로그인</main>','https://news.example/a')).toBeNull();
 });
});

describe('키 없는 최근 공식 기사 제목 찾기 — 모의 RSS',()=>{
 it('정확한 매체 HTTPS만 수용하고 RSS 설명·날짜를 검증 근거로 승격하지 않는다',()=>{
  const result=parsePublisherFeed(rss('news.sbs.co.kr'),'sbs');
  expect(result).toHaveLength(1);expect(result[0]).toMatchObject({provenance:'search_result',stance:'not_checked'});
  expect(result[0]).not.toHaveProperty('text');expect(result[0]).not.toHaveProperty('indexedAt');
  expect(parsePublisherFeed(rss('news.sbs.co.kr.evil.test'),'sbs')).toEqual([]);
  expect(()=>parsePublisherFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "https://private.test/">]>'+rss('news.sbs.co.kr'),'sbs')).toThrow();
 });
 it('두 공식 피드의 관련 제목만 찾고 무관한 기사로 빈 결과를 채우지 않는다',async()=>{
  const fetch=vi.fn().mockImplementation(async(url:string)=>new Response(rss(url.includes('sbs')?'news.sbs.co.kr':'www.donga.com'),{headers:{'content-type':'application/xml'}}));vi.stubGlobal('fetch',fetch);
  const config:RuntimeConfig={NEWS_PROVIDER:'publisher_feeds',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',DB:{} as D1Database};
  const found=await searchPublisherFeeds('도서관 운영',config,signal());expect(found.articles).toHaveLength(2);expect(found.provider).toBe('publisher_feeds');
  expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  const empty=await searchPublisherFeeds('관련없는 우주탐사',config,signal());expect(empty.status).toBe('empty');expect(empty.articles).toEqual([]);
 });
 it('미승인 설정은 네트워크 전에 막는다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(searchPublisherFeeds('도서관',{},signal())).rejects.toMatchObject({code:'SEARCH_UNAVAILABLE'});expect(fetch).not.toHaveBeenCalled();
 });
});

describe('원사이트의 선택형 한국어 검색 복구 — 모의 Tavily',()=>{
 const config=(changes=1):RuntimeConfig=>({NEWS_PROVIDER:'tavily',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',TAVILY_API_KEY:'synthetic-only',TAVILY_FREE_PLAN_CONFIRMED:'true',TAVILY_ELIGIBILITY_CONFIRMED:'true',TAVILY_MONTHLY_CREDITS_CONFIRMED:'true',TAVILY_MONTHLY_CREDITS:'1000',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{prepare:()=>({bind:()=>({run:async()=>({meta:{changes}})})})} as unknown as D1Database});
 it('기본 검색 1회만 보내고 키·전체 본문·자동 업그레이드를 요청 본문에 넣지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({results:[{title:'공개 기사',url:'https://news.example/a'}],usage:{credits:1}}));vi.stubGlobal('fetch',fetch);
  const found=await searchTavily('도서관 운영',config(),signal());expect(found.provider).toBe('tavily');expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].redirect).toBe('manual');
  const body=JSON.parse(fetch.mock.calls[0][1].body);expect(body).toMatchObject({language:'ko',filter_by_language:true,search_depth:'basic',auto_parameters:false,include_raw_content:false});expect(JSON.stringify(body)).not.toContain('synthetic-only');
 });
 it('인증 정보를 가진 검색 요청의 이동을 따라가지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{Location:'https://other.example/'}}));vi.stubGlobal('fetch',fetch);
  await expect(searchTavily('도서관 운영',config(),signal())).rejects.toMatchObject({code:'SEARCH_UNEXPECTED_REDIRECT'});
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].redirect).toBe('manual');
 });
 it('무료 월간 예약이 실패하면 외부 호출이나 다른 제공자 전환을 하지 않는다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(searchTavily('도서관 운영',config(0),signal())).rejects.toMatchObject({code:'SEARCH_QUOTA_EXHAUSTED'});expect(fetch).not.toHaveBeenCalled();
 });
});

describe('현재 화면의 분석 전체를 요청 상한 안에서 대조',()=>{
 it('8개 주장 전체를 5+3으로 처리하고 뒤 묶음을 조용히 버리지 않는다',async()=>{
  const i=input();i.claims=Array.from({length:8},(_,n)=>({...i.claims[0],id:`claim_${n}`}));
  expect(researchBatches(i).map(b=>b.claims.length)).toEqual([5,3]);
  let now=0;const results:ResearchVerification[]=[],progress:{completed:number;total:number;stage:string}[]=[];
  await runResearch(i,signal(),{now:()=>now,wait:async ms=>{now+=ms;},post:async<T,>(body:unknown)=>{
   const data=body as {operation:string;input:ResearchInput;queryIndex:number;evidenceToken?:string};
   if(data.operation==='plan')return {token:'p',nextModelCallAt:new Date(now+61000).toISOString(),queries:data.input.claims.map(c=>({claimId:c.id,label:'공개 자료'}))} as T;
   if(data.operation==='discover')return {token:data.input.claims[data.queryIndex].id,claimId:data.input.claims[data.queryIndex].id,references:[{text:'공개 합성 근거'}]} as T;
   const v=demoVerification('supported');return {...v,status:'success',checks:[{...v.checks[0],claimId:data.evidenceToken,execution:'completed'}]} as T;
  }},p=>progress.push(p),v=>results.push(v));
  expect(results).toHaveLength(8);expect(progress.at(-1)).toMatchObject({completed:8,total:8,stage:'completed'});
 });
 it('본문 분석 직후에는 첫 조사 계획도 무료 호출 간격을 기다린다',async()=>{
  const post=vi.fn(),c=new AbortController();
  await expect(runResearch(input(),c.signal,{post,now:()=>1000,firstModelCallAt:62000,wait:async ms=>{expect(ms).toBe(61000);c.abort();}},()=>{},()=>{})).rejects.toMatchObject({name:'AbortError'});
  expect(post).not.toHaveBeenCalled();
 });
});
