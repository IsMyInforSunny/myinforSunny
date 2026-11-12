import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseHTML} from 'linkedom';
import CollectedArticles, {CollectedArticleCards} from '../components/collected-articles';
import {POST} from '../app/api/article-index/route';
import {searchIndexedNews} from '../lib/server/indexed-news';
import {articleIndexHosts} from '../lib/server/article-search-index';
import {demoAnalysis} from '../lib/fixtures';
import type {Analysis} from '../lib/contracts';
import type {NewsResult, RelatedArticle} from '../lib/news-contract';

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const fixedNow = () => {vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T12:00:00+09:00'));};
const request = (body: unknown, origin?: string) => new Request('https://site.example/api/article-index', {
  method: 'POST', headers: {'Content-Type': 'application/json', ...(origin ? {Origin: origin} : {})}, body: JSON.stringify(body),
});
const candidate: RelatedArticle = {id:'collected_one',title:'공개 수집 기사',url:'https://www.pressian.com/pages/articles/one',
  publisherDomain:'pressian.com',publishedAt:'2026-11-05T09:00:00+09:00',language:'Korean',provenance:'search_result',stance:'not_checked'};
function analysis(id: string): Analysis {
  return {...structuredClone(demoAnalysis('supported')),analysisId:id,mode:'live',searchSuggestions:[{label:'최저임금',query:'최저임금'}]};
}
function mount() {
  const {window} = parseHTML('<html><body><div id="app"></div></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = window.document.getElementById('app')!;
  root = createRoot(container);
  return container;
}

describe('collected article metadata candidates', () => {
  it('withholds bundled metadata until reuse is approved', async () => {
    fixedNow();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    expect(articleIndexHosts()).toContain('www.pressian.com');
    expect(searchIndexedNews('최저임금', {})).toBeNull();
    expect(searchIndexedNews('최저임금', {}, true)).toBeNull();
    const response = await POST(request({query:'최저임금'}));
    const result = await response.json() as NewsResult;
    expect(response.status).toBe(200);
    expect(result.provider).toBe('local_index');
    expect(result.status).toBe('empty');
    expect(result.articles).toEqual([]);
    expect(result.scopeNote).toContain('이용 승인 검토');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns an honest empty result without external fallback', async () => {
    fixedNow();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
    const response = await POST(request({query:'존재하지않는초전도양자주제'}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({provider:'local_index',status:'empty',articles:[]});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates request shape, contacts and request origin', async () => {
    expect((await POST(request({query:'최저임금',extra:true}))).status).toBe(422);
    expect((await POST(request({query:'01012345678'}))).status).toBe(422);
    expect((await POST(request({query:'최저임금'}, 'https://other.example'))).status).toBe(403);
    expect((await POST(new Request('https://site.example/api/article-index', {method:'POST',body:'{}'}))).status).toBe(415);
  });

  it('shows at most three labelled candidates with dates and no stance labels', () => {
    const articles = Array.from({length:4},(_,index)=>({...candidate,id:`row_${index}`,url:`https://www.pressian.com/pages/articles/${index}`}));
    const html = renderToStaticMarkup(createElement(CollectedArticleCards,{articles,message:'검색 중'}));
    expect(html.match(/class="studio-article-card"/g)).toHaveLength(3);
    expect(html).toContain('관련 기사 후보 · 본문 대조 전');
    expect(html).toContain('dateTime="2026-11-05T09:00:00+09:00"');
    expect(html).not.toContain('같은 관점');
    expect(html).not.toContain('다른 관점');
  });

  it('fetches once after live analysis and displays collected candidates', async () => {
    const fetchSpy = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({provider:'local_index',articles:[candidate]}));
    const container = mount();
    const current = analysis('first');
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:current,stale:false})));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/article-index');
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({query:'최저임금'});
    expect(container.textContent).toContain('공개 수집 기사');
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:current,stale:false})));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts and resets when the analysis changes or becomes stale', async () => {
    const signals: AbortSignal[] = [];
    const pending: ((response: Response) => void)[] = [];
    const fetchSpy = vi.spyOn(globalThis,'fetch').mockImplementation((_url, init) => {
      signals.push(init!.signal as AbortSignal);
      return new Promise<Response>(resolve => pending.push(resolve));
    });
    const container = mount();
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:analysis('first'),stale:false})));
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:analysis('second'),stale:false})));
    expect(signals[0].aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:analysis('second'),stale:true})));
    expect(signals[1].aborted).toBe(true);
    await act(async () => pending[0](Response.json({provider:'local_index',articles:[candidate]})));
    expect(container.textContent).not.toContain('공개 수집 기사');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not search demos or analyses without suggested search terms', async () => {
    const fetchSpy = vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({provider:'local_index',articles:[]}));
    mount();
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:demoAnalysis('supported'),stale:false})));
    await act(async () => root!.render(createElement(CollectedArticles,{analysis:{...analysis('first'),searchSuggestions:[]},stale:false})));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
