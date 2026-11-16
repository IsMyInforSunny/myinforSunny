import {afterEach,describe,expect,it,vi} from 'vitest';
import {extractDaumPortalArticle,articleAmpUrl} from '../lib/server/article-extraction';
import {isFetchDenylistedHost,isPublicHttpsHostname,openFetchEnabled} from '../lib/server/open-retrieval';
import {robotsDisallowed} from '../lib/server/retrieval';
import {retrieveDetailed} from '../lib/server/retrieval';
import type {RuntimeConfig} from '../lib/server/config';
afterEach(()=>vi.unstubAllGlobals());

describe('open retrieval policy helpers',()=>{
 it('fails closed on private, local, IP-literal and malformed hosts',()=>{
  for(const host of ['127.0.0.1','2130706433','0x7f000001','[::1]','localhost','news.local','intranet','example.com:443'])expect(isPublicHttpsHostname(host)).toBe(false);
  expect(isPublicHttpsHostname('www.pressian.com')).toBe(true);
 });
 it('requires a separate local opt-in',()=>{
  expect(openFetchEnabled({ENABLE_OPEN_FETCH:'true'},'local')).toBe(false);
  expect(openFetchEnabled({ENABLE_OPEN_FETCH:'true',ALLOW_LOCAL_OPEN_FETCH:'true'},'local')).toBe(true);
  expect(openFetchEnabled({ENABLE_OPEN_FETCH:'true'},'remote')).toBe(true);
  expect(openFetchEnabled({},'remote')).toBe(false);
 });
 it('applies denylist roots to subdomains',()=>{
  expect(isFetchDenylistedHost('www.chosun.com')).toBe(true);
  expect(isFetchDenylistedHost('pressian.com')).toBe(false);
 });
 it('uses the product group or wildcard robots rules and detects AI-wide restrictions',()=>{
  expect(robotsDisallowed('User-agent: *\nDisallow: /','/article')).toBe('ROBOTS_DISALLOWED');
  expect(robotsDisallowed('User-agent: NaeinfoClear\nDisallow: /private\nAllow: /private/public','/private/public/story')).toBeNull();
  expect(robotsDisallowed('User-agent: GPTBot\nDisallow: /','/article')).toBe('ROBOTS_AI_RESTRICTED');
  expect(robotsDisallowed('User-agent: ExampleBot\nDisallow: /','/article')).toBeNull();
 });
 it('extracts Daum portal content and an external original article URL from synthetic markup',()=>{
  const body='가상 공개 기사 내용을 설명하는 문장입니다. '.repeat(16);
  const html=`<meta property="og:title" content="가상 포털 기사"><div class="article_view"><p>${body}</p></div><a href="https://pressian.com/news/1">기사원문</a>`;
  expect(extractDaumPortalArticle(html,'https://v.daum.net/v/123')).toMatchObject({text:body.trim(),sourceUrl:'https://pressian.com/news/1',publisherHost:'pressian.com'});
 });
 it('reads an AMP link as data without executing page scripts',()=>{
  expect(articleAmpUrl('<link rel="amphtml" href="/amp/story"><script>throw 1</script>','https://news.example/article')).toBe('https://news.example/amp/story');
  expect(articleAmpUrl('<link rel="amphtml" href="http://news.example/amp">','https://news.example/article')).toBeUndefined();
 });
 it('tries same-registrable-domain AMP content within the shared three-destination-request cap',async()=>{
  const short='초기 HTML 본문입니다. '.repeat(7),long='AMP 본문은 정책의 배경과 조건을 상세히 설명합니다. '.repeat(12);
  const fetch=vi.fn()
   .mockResolvedValueOnce(new Response(`<link rel="amphtml" href="https://amp.news.example/story"><article>${short}</article>`,{headers:{'content-type':'text/html'}}))
   .mockResolvedValueOnce(new Response(null,{status:404}))
   .mockResolvedValueOnce(new Response(`<article>${long}</article>`,{headers:{'content-type':'text/html'}}));
  vi.stubGlobal('fetch',fetch);
  const config={ALLOWED_RETRIEVAL_HOSTS:'news.example'} as RuntimeConfig;
  const result=await retrieveDetailed('https://news.example/story','probe',config,new AbortController().signal);
  expect(result).toMatchObject({ok:true,metadata:{extractionMethod:'amp'}});if(result.ok)expect(result.reference.text).toContain('AMP 본문');
  expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('blocks Naver before page retrieval and handles Daum robots 404 as permitted',async()=>{
  const fetch=vi.fn()
   .mockResolvedValueOnce(new Response(null,{status:404}))
   .mockResolvedValueOnce(new Response(`<div class="article_view"><p>${'다음 포털 가상 기사 본문을 설명합니다. '.repeat(14)}</p></div><a href="https://pressian.com/a/1">기사원문</a>`,{headers:{'content-type':'text/html'}}));
  vi.stubGlobal('fetch',fetch);
  expect(await retrieveDetailed('https://n.news.naver.com/mnews/article/001/1','naver',{} as RuntimeConfig,new AbortController().signal)).toMatchObject({ok:false,reason:'ROBOTS_DISALLOWED'});
  expect(fetch).not.toHaveBeenCalled();
  const daum=await retrieveDetailed('https://v.daum.net/v/1','daum',{} as RuntimeConfig,new AbortController().signal);
  expect(daum).toMatchObject({ok:true,metadata:{mode:'allowlisted',host:'pressian.com',extractionMethod:'daum_portal',publisherUrl:'https://pressian.com/a/1'}});
  expect(fetch).toHaveBeenCalledTimes(2);
 });
});
