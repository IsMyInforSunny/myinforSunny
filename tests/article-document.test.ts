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
 it('본문 속 날짜를 발행일로 추정하거나 수정일을 발행일로 바꾸지 않는다',()=>{
  expect(extractArticleDocument('<meta property="article:modified_time" content="2026-11-02"><article>2024년 운영 안내다.</article>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta property="article:published_time" content="2026-02-30"><main>공개 자료</main>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta property="article:published_time" content="2026-02-30T09:00:00+09:00"><main>공개 자료</main>',true).publishedAt).toBeUndefined();
  expect(extractArticleDocument('<meta name="date" content="2026-11-02"><main>공개 자료</main>',true).publishedAt).toBe('2026-11-02');
 });
 it('일반 텍스트는 HTML이나 문자 엔티티로 재해석하지 않는다',()=>{
  expect(extractArticleDocument('  공개 문구 <예시> &amp;\n둘째 줄  ',false)).toEqual({text:'공개 문구 <예시> &amp;\n둘째 줄',title:undefined,publishedAt:undefined});
 });
 it('대소문자가 다른 HTML MIME도 본문으로 추출하고 길이·잘림을 정확히 기록한다',async()=>{
  const text='가상기사 본문 '.repeat(1200);const call=vi.fn().mockResolvedValue(new Response(`<article>${text}</article>`,{headers:{'content-type':'Text/HTML; Charset=UTF-8'}}));vi.stubGlobal('fetch',call);
  const ref=await retrieve('https://news.example/a','r1',{ALLOWED_RETRIEVAL_HOSTS:'news.example'},new AbortController().signal);
  expect(ref).toMatchObject({provenance:'web_fetched',truncated:true,fullTextLength:text.trim().length,extractionVersion:ARTICLE_EXTRACTION_VERSION});
  expect(ref!.text).toHaveLength(8000);expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0][1].redirect).toBe('manual');
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
});
