import {afterEach,describe,expect,it,vi} from 'vitest';
import {decodeArticleDocument,extractArticleDocument,ARTICLE_EXTRACTION_VERSION} from '../lib/server/article-document';
import {retrieve} from '../lib/server/retrieval';

const utf8=(text:string)=>new TextEncoder().encode(text);
afterEach(()=>vi.unstubAllGlobals());

describe('허용 출처의 문서 해독과 본문 추출 — 모의 응답만 사용',()=>{
 it('HTTP charset과 HTML 선언에 있는 한국어 레거시 인코딩을 해독한다',()=>{
  const korean=Uint8Array.from([0xbe,0xc8,0xb3,0xe7]); // 공개 합성 문구: 안녕
  expect(decodeArticleDocument(korean,'text/plain; charset=EUC-KR')).toBe('안녕');
  const prefix=utf8('<meta http-equiv="Content-Type" content="text/html; charset=euc-kr"><article>');
  const suffix=utf8('</article>');const data=new Uint8Array(prefix.length+korean.length+suffix.length);
  data.set(prefix);data.set(korean,prefix.length);data.set(suffix,prefix.length+korean.length);
  expect(extractArticleDocument(decodeArticleDocument(data,'text/html')!,true).text).toBe('안녕');
 });
 it('BOM을 우선하며 선언이 없거나 잘못된 UTF-8을 임의로 복구하지 않는다',()=>{
  const text=utf8('\ufeff공개 기사');expect(decodeArticleDocument(text,'text/plain; charset=euc-kr')).toBe('공개 기사');
  expect(decodeArticleDocument(Uint8Array.from([0xbe,0xc8]),'text/html')).toBeNull();
  expect(decodeArticleDocument(utf8('public'),'text/plain; charset=not-an-encoding')).toBeNull();
 });
 it('주석·스크립트 문자열의 가짜 charset을 실제 문서 선언으로 읽지 않는다',()=>{
  const document='<!-- <meta charset="not-an-encoding"> --><script>const template=`<meta charset="euc-kr">`;</script><meta charset="utf-8"><article>공개 합성 기사다.</article>';
  expect(decodeArticleDocument(utf8(document),'text/html')).toBe(document);
  // The bounded prefix can cut through a script/comment; it must not use its fake meta tag.
  for(const opening of ['<script>','<!--']){
   const cut=opening+'<meta charset="not-an-encoding">'+' '.repeat(2100);
   expect(decodeArticleDocument(utf8(cut),'text/html')).toBe(cut);
  }
 });
 it('본문 밖 메뉴·다른 기사·댓글을 섞지 않고 제목·발행일 메타데이터를 분리한다',()=>{
  const document=`<html><head><title>포털 제목</title><meta property="og:title" content="가상 도서관 &amp; 정원"><meta content="2026-11-02T08:00:00+09:00" property="article:published_time"></head><body><nav>전체 메뉴</nav><main><p>다른 기사 목록</p><article><header>중복 제목</header><p>도서관은 &#x39;시에 연다.</p><aside>추천 광고</aside><p>공개 자료 &quot;안내&quot;다.</p><script>private()</script><style>.x{}</style></article><section>댓글 영역</section></main><footer>이용약관</footer></body></html>`;
  expect(extractArticleDocument(document,true)).toEqual({text:'도서관은 9시에 연다. 공개 자료 "안내"다.',title:'가상 도서관 & 정원',publishedAt:'2026-11-01T23:00:00.000Z'});
 });
 it('주석·스크립트 속 기사 템플릿의 제목·발행일·본문을 자료에 섞지 않는다',()=>{
  const document='<head><!-- <meta property="og:title" content="주석 제목"><meta name="date" content="2020-01-01"> --><script>const template=`<meta property="og:title" content="스크립트 제목"><meta name="date" content="2021-01-01"><article>가짜 본문</article>`;</script><title>공개 합성 제목</title><meta name="date" content="2026-11-02"></head><article>공개 합성 본문이다.</article>';
  expect(extractArticleDocument(document,true)).toEqual({title:'공개 합성 제목',publishedAt:'2026-11-02',text:'공개 합성 본문이다.'});
 });
 it('article이 없으면 main을 사용하고 여러 기사 조각을 한 기사로 합치지 않는다',()=>{
  expect(extractArticleDocument('<nav>menu</nav><main><p>학교의 공개 공지다.</p></main><footer>footer</footer>',true).text).toBe('학교의 공개 공지다.');
  expect(extractArticleDocument('<article>짧은 카드</article><article><p>첫째 문장이다.</p><article>둘째 문장이다.</article><p>셋째 문장이다.</p></article>',true).text).toBe('첫째 문장이다. 둘째 문장이다. 셋째 문장이다.');
 });
 it('ASP.NET 문서용 form 안의 명시적 기사 본문을 보존하되 댓글 form은 제외한다',()=>{
  const html='<form name="aspnetForm" id="aspnetForm" method="post"><nav>메뉴</nav><main><header>제목</header><article class="article_body at_contents article_view" itemprop="articleBody"><p>공개 합성 기사 첫 문장.</p><form id="comments"><label>댓글 개인정보</label><input value="private"></form><p>공개 합성 기사 마지막 문장.</p></article><aside>추천 목록</aside></main></form>';
  expect(extractArticleDocument(html,true).text).toBe('공개 합성 기사 첫 문장. 공개 합성 기사 마지막 문장.');
  expect(extractArticleDocument('<form name="aspnetForm" id="aspnetForm"><label>입력 양식</label></form><main>공개 본문.</main>',true).text).toBe('공개 본문.');
  expect(extractArticleDocument('<form><article itemprop="articleBody">댓글 양식의 가짜 기사.</article></form><main>실제 본문.</main>',true).text).toBe('실제 본문.');
 });
 it('명시적 news_view 본문을 다른 article 카드보다 우선하고 중첩 section을 보존한다',()=>{
  const html='<main><article>다른 기사 카드.</article><section class="news_view"><p>공개 보도 본문이다.</p><section>본문의 추가 설명이다.</section><aside>광고</aside><p>보도 마지막 문장이다.</p></section><article>추천 기사 카드.</article></main>';
  expect(extractArticleDocument(html,true).text).toBe('공개 보도 본문이다. 본문의 추가 설명이다. 보도 마지막 문장이다.');
  expect(extractArticleDocument('<div class="news_viewer">메뉴</div><main>실제 본문.</main>',true).text).toBe('실제 본문.');
  expect(extractArticleDocument('<article-view class="news_view">커스텀 카드</article-view><main>실제 본문.</main>',true).text).toBe('실제 본문.');
 });
 it('스크립트 속 본문 표시자나 제거된 광고의 표시자를 기사로 복구하지 않는다',()=>{
  const html='<script>const fake=`<article itemprop="articleBody">가짜</article>`;</script><form name="aspnetForm" id="aspnetForm">입력 양식</form><aside><section class="news_view">광고 문구</section></aside><main>공개 본문.</main>';
  expect(extractArticleDocument(html,true).text).toBe('공개 본문.');
  expect(extractArticleDocument('<section class="news_view">닫히지 않은 본문<div>다른 글</div>',true).text).toBe('');
 });
 it('본문 속 날짜를 발행일로 추정하거나 수정일을 발행일로 바꾸지 않는다',()=>{
  expect(extractArticleDocument('<meta property="article:modified_time" content="2026-11-02"><article>2024년 운영 안내다.</article>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta property="article:published_time" content="2026-02-30"><main>공개 자료</main>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta property="article:published_time" content="2026-02-30T09:00:00+09:00"><main>공개 자료</main>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta name="date" content="2026-11-02"><main>공개 자료</main>',true).publishedAt).toBe('2026-11-02');
 });
 it('스크립트로만 본문을 제공하는 빈 HTML 껍데기를 취득 근거로 인정하지 않는다',async()=>{
  const html='<!DOCTYPE html><html><head><title>공개 기사</title></head><body><script>window.article={text:"실행하면 안 되는 본문"}</script></body></html>';
  expect(extractArticleDocument(html,true).text).toBe('');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(html,{headers:{'content-type':'text/html'}})));
  expect(await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toBeNull();
 });
 it('중첩된 동명 ASP.NET form을 댓글 제외 규칙의 우회로로 쓰지 않는다',()=>{
  const html='<form name="aspnetForm" id="aspnetForm"><article itemprop="articleBody">공개 본문.<form name="aspnetForm" id="aspnetForm">제외할 댓글.</form>끝 문장.</article></form>';
  expect(extractArticleDocument(html,true).text).toBe('공개 본문. 끝 문장.');
 });
 it('일반 텍스트는 HTML이나 문자 엔티티로 재해석하지 않는다',()=>{
  expect(extractArticleDocument('  공개 문구 <예시> &amp;\n둘째 줄  ',false)).toEqual({text:'공개 문구 <예시> &amp;\n둘째 줄',title:undefined,publishedAt:undefined});
 });
 it('일반 텍스트의 meta 문구를 인코딩 선언으로 사용하지 않고 BOM·HTTP 선언만 따른다',()=>{
  const literal='공개 문구 <meta charset="not-an-encoding">다.';
  expect(decodeArticleDocument(utf8(literal),'text/plain')).toBe(literal);
  expect(decodeArticleDocument(utf8('\ufeff'+literal),'text/plain; charset=euc-kr')).toBe(literal);
  expect(decodeArticleDocument(Uint8Array.from([0xbe,0xc8,0xb3,0xe7]),'text/plain; charset=euc-kr')).toBe('안녕');
 });
 it('article·main 접두어를 쓰는 커스텀 태그를 본문 영역으로 오인하지 않는다',()=>{
  expect(extractArticleDocument('<article-summary>다른 기사 카드.</article-summary><main>실제 기사 본문.</main>',true).text).toBe('실제 기사 본문.');
  expect(extractArticleDocument('<main-menu>메뉴 카드.</main-menu><main class="body">실제 본문.</main>',true).text).toBe('실제 본문.');
  expect(extractArticleDocument('<script-template>공개 템플릿.</script-template><article>실제 기사.</article>',true).text).toBe('실제 기사.');
 });
 it('중첩 광고·메뉴는 내부 닫기 태그 뒤까지 제거하고 본문을 보존한다',()=>{
  const html='<nav>바깥 메뉴<nav>내부 메뉴</nav>남은 메뉴</nav><article>본문 시작.<aside><aside>내부 광고</aside>남은 광고<nav>추천 메뉴</nav></aside>본문 끝.</article>';
  expect(extractArticleDocument(html,true).text).toBe('본문 시작. 본문 끝.');
  expect(extractArticleDocument('<article>본문.<aside>닫히지 않은 광고',true).text).toBe('본문.');
 });
 it('head 닫기 태그가 생략되어도 명백한 본문 시작 뒤의 기사를 보존한다',()=>{
  for(const body of ['<body><article>공개 기사.</article></body>','<article>공개 기사.</article>','<main>공개 기사.</main>']){
   expect(extractArticleDocument(`<html><head><title>공개 제목</title>${body}</html>`,true)).toEqual({title:'공개 제목',publishedAt:undefined,text:'공개 기사.'});
  }
 });
 it('태그 속성의 가짜 본문 시작으로 head를 조기 해제하거나 미닫힌 광고를 복구하지 않는다',()=>{
  const html='<head><meta name="example" content="<body><article>가짜 본문</article>"><meta name=\'other\' content=\'<main>가짜 영역</main>\'>표시하면 안 되는 머리글<body><article>공개 기사.</article></body>';
  expect(extractArticleDocument(html,true).text).toBe('공개 기사.');
  expect(extractArticleDocument('<article>본문.<aside>광고<body>광고 계속<main>추천 기사</main>',true).text).toBe('본문.');
 });
 it('따옴표 속 꺾쇠괄호를 실제 태그 경계로 오인하지 않는다',()=>{
  const fakeArticle='<main><div data-tpl="<article>가짜</article>">카드</div>도서관은 운영 시간을 안내한다.</main>';
  expect(extractArticleDocument(fakeArticle,true).text).toBe('카드 도서관은 운영 시간을 안내한다.');
  expect(extractArticleDocument('<article data-x="a>b">도서관은 연다.</article>',true).text).toBe('도서관은 연다.');
  expect(extractArticleDocument('<meta property="og:title" content="속보 > 정치 > 도서관 연장"><main><img alt="그래프 a>b" src="x.png">끝 문장.</main>',true)).toMatchObject({title:'속보 > 정치 > 도서관 연장',text:'끝 문장.'});
  const bytes=utf8('<meta charset="utf-8" content="분류 > 기사">');
  expect(decodeArticleDocument(bytes,'text/html') ).toBe('<meta charset="utf-8" content="분류 > 기사">');
 });
 it('대소문자가 다른 HTML MIME도 본문으로 추출하고 길이·잘림을 정확히 기록한다',async()=>{
  const text='가상기사 본문 '.repeat(1200);const call=vi.fn().mockResolvedValue(new Response(`<article>${text}</article>`,{headers:{'content-type':'Text/HTML; Charset=UTF-8'}}));vi.stubGlobal('fetch',call);
  const ref=await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal);
  expect(ref).toMatchObject({provenance:'web_fetched',truncated:true,fullTextLength:text.trim().length,extractionVersion:ARTICLE_EXTRACTION_VERSION});
  expect(ref!.text).toHaveLength(8000);expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0][1].redirect).toBe('manual');
  expect(call.mock.calls[0][1].headers['User-Agent']).toBe('NaeinfoClear/0.1 (article analysis; user-requested fetch)');
 });
 it('취득 상한과 제목 상한의 이모지를 반으로 자르지 않고 원래 전체 길이를 기록한다',async()=>{
  const body='가'.repeat(7999)+'😀끝',title='나'.repeat(249)+'😀제목';
  const call=vi.fn().mockResolvedValue(new Response(`<head><title>${title}</title></head><article>${body}</article>`,{headers:{'content-type':'text/html; charset=utf-8'}}));vi.stubGlobal('fetch',call);
  const ref=await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal);
  expect(ref).toMatchObject({text:'가'.repeat(7999),title:'나'.repeat(249),truncated:true,fullTextLength:body.length,extractionVersion:ARTICLE_EXTRACTION_VERSION});
  // If the pair fits exactly, preserve it instead of stripping every boundary emoji.
  call.mockResolvedValue(new Response('가'.repeat(7998)+'😀',{headers:{'content-type':'text/plain'}}));
  expect(await retrieve('https://news.example/a','r2',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toMatchObject({text:'가'.repeat(7998)+'😀',truncated:false,fullTextLength:8000});
 });
 it('알 수 없는 인코딩·HTML이 아닌 응답·빈 본문은 취득 자료로 승격하지 않는다',async()=>{
  for(const response of [new Response(Uint8Array.from([0xbe,0xc8]),{headers:{'content-type':'text/html'}}),new Response('{}',{headers:{'content-type':'application/json'}}),new Response('<article><script>onlyScript()</script></article>',{headers:{'content-type':'text/html'}})]){
   vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));expect(await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toBeNull();
  }
 });
 it('허용되지 않은 주소를 새 디코더 도입 뒤에도 요청하지 않는다',async()=>{
  const call=vi.fn();vi.stubGlobal('fetch',call);
  for(const url of ['https://other.example/a','http://127.0.0.1/a','https://user:secret@news.example/a'])expect(await retrieve(url,'r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toBeNull();
  expect(call).not.toHaveBeenCalled();
 });
 it('같은 HTTPS 출처의 정식 기사 주소 이동을 제한적으로 허용하고 최종 URL을 기록한다',async()=>{
  const call=vi.fn().mockResolvedValueOnce(new Response('',{status:301,headers:{Location:'/a/title'}}))
   .mockResolvedValueOnce(new Response('본문 확인',{headers:{'content-type':'text/plain'}}));vi.stubGlobal('fetch',call);
  expect(await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toMatchObject({url:'https://news.example/a/title',text:'본문 확인'});
  expect(call).toHaveBeenCalledTimes(2);
 });
 it.each(['https://other.example/a','http://news.example/a','https://user:secret@news.example/a','/a'])('안전하지 않은 이동이나 반복을 차단한다: %s',async location=>{
  const call=vi.fn().mockResolvedValue(new Response('',{status:302,headers:{Location:location}}));vi.stubGlobal('fetch',call);
  expect(await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example,other.example'},new AbortController().signal)).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
 });
 it('주소 이동을 두 번까지만 따라간다',async()=>{
  const call=vi.fn().mockImplementation(async()=>new Response('',{status:301,headers:{Location:`/next-${call.mock.calls.length}`}}));vi.stubGlobal('fetch',call);
  expect(await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal)).toBeNull();
  expect(call).toHaveBeenCalledTimes(3);
 });
});
