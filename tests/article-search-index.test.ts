import {describe, expect, it} from 'vitest';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import {articleIndexStatus, searchArticleIndex, type ArticleSearchIndex, type IndexedArticle} from '../lib/server/article-search-index';

const now = Date.parse('2026-11-11T12:00:00+09:00');
const row = (id: string, host = 'news.example.com', terms: [string, number][] = [['원전', 10], ['전력', 7]], usageStatus:'approved'|'unapproved'='approved'): IndexedArticle => ({
  id, title: `원전 전력 자료 ${id}`, url: `https://${host}/articles/${id}`, publisherDomain: host,
  publishedAt: '2026-11-05T10:00:00+09:00', usageStatus, keywords: terms,
});
const index = (articles: IndexedArticle[]): ArticleSearchIndex => ({
  schemaVersion: 'article-search-index-1.0', generatedAt: '2026-11-10T00:00:00Z',
  sourceArticleCount: articles.length, indexedArticleCount: articles.length, articles,
});

describe('collected article search index', () => {
  it('excludes already fetched identities before publisher and result limits so later queries can find new articles',()=>{
    const data=index([row('a'),row('b'),row('c'),row('d')]);
    const options={now,index:data,excludeUrls:[row('a').url+'?utm_source=test',row('b').url]};
    expect(searchArticleIndex('원전',['news.example.com'],options).map(article=>article.id)).toEqual(['c','d']);
    expect(searchArticleIndex('원전',['news.example.com'],{...options,excludeUrls:data.articles.map(article=>article.url)})).toEqual([]);
  });
  it('finds candidates locally with unchanged unverified provenance', () => {
    const result = searchArticleIndex('원전 전력', ['news.example.com'], {now, index: index([row('one')])});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({title: '원전 전력 자료 one', provenance: 'search_result', stance: 'not_checked'});
    expect(result[0]).not.toHaveProperty('text');
    expect(result[0]).not.toHaveProperty('evidence');
  });

  it('never returns source candidates whose reuse status is unapproved',()=>{
    const data=index([row('approved'),row('unapproved','news.example.com',[['원전',20]],'unapproved')]);
    expect(searchArticleIndex('원전',['news.example.com'],{now,index:data}).map(article=>article.id)).toEqual(['approved']);
  });

  it('requires configured exact hosts and rejects credentials and alternate schemes', () => {
    const bad = {...row('bad'), url: 'https://user:password@news.example.com/a'};
    const insecure = {...row('http'), url: 'http://news.example.com/a'};
    const articles = [row('one'), row('other', 'sub.news.example.com'), bad, insecure];
    expect(searchArticleIndex('원전', [], {now, index: index(articles)})).toEqual([]);
    expect(searchArticleIndex('원전', ['news.example.com'], {now, index: index(articles)}).map(a => a.id)).toEqual(['one']);
  });

  it('does not fill unrelated results when a query has insufficient keyword matches', () => {
    const data = index([row('one', undefined, [['원전', 10]])]);
    expect(searchArticleIndex('원전 교육', ['news.example.com'], {now, index: data})).toEqual([]);
    expect(searchArticleIndex('기사 뉴스', ['news.example.com'], {now, index: data})).toEqual([]);
    expect(searchArticleIndex('최저임금', ['news.example.com'], {now, index: data})).toEqual([]);
  });

  it('rejects old, invalid and future publication times', () => {
    const articles = [row('one'), {...row('old'), publishedAt: '2024-01-01T00:00:00Z'},
      {...row('future'), publishedAt: '2027-01-01T00:00:00Z'}, {...row('invalid'), publishedAt: 'invalid'}];
    expect(searchArticleIndex('원전', ['news.example.com'], {now, index: index(articles)}).map(a => a.id)).toEqual(['one']);
    expect(searchArticleIndex('원전', ['news.example.com'], {now, maxAgeDays: 1095, index: index(articles)}).map(a => a.id)).toEqual(['one', 'old']);
  });

  it('ranks weighted matches and caps each host at two unique URLs', () => {
    const strong = row('strong', 'second.example.com', [['원전', 30]]);
    const duplicate = {...row('duplicate'), url: row('a').url};
    const data = index([row('a'), row('b'), row('c'), strong, duplicate]);
    const results = searchArticleIndex('원전', ['news.example.com', 'second.example.com'], {now, index: data});
    expect(results.map(a => a.id)).toEqual(['strong', 'a', 'b']);
    expect(searchArticleIndex('원전', ['news.example.com'], {now, index: data, limit: 1})).toHaveLength(1);
    expect(searchArticleIndex('원전', ['news.example.com'], {now, index: data, limit: 0})).toEqual([]);
  });

  it('exports bounded metadata for the 3000 collected articles and preserves usage status', () => {
    const data = JSON.parse(readFileSync(new URL('../lib/data/article-search-index.json', import.meta.url), 'utf8'));
    expect(articleIndexStatus().indexedArticleCount).toBeGreaterThanOrEqual(3000);
    expect(data.articles).toHaveLength(data.indexedArticleCount);
    expect(data.articles.every((article: IndexedArticle) => article.usageStatus === 'unapproved')).toBe(true);
    expect(data.articles.every((article: IndexedArticle) => article.keywords.length <= 24)).toBe(true);
    for (const article of data.articles) {
      expect(Object.keys(article).sort()).toEqual(['id', 'keywords', 'publishedAt', 'publisherDomain', 'title', 'url', 'usageStatus']);
    }
  });

  it('withholds the current local corpus because its source reuse status is unapproved', () => {
    const started = performance.now();
    const results = searchArticleIndex('최저임금', ['www.dailian.co.kr', 'www.newdaily.co.kr', 'biz.newdaily.co.kr', 'www.ohmynews.com', 'www.pressian.com'], {now, maxAgeDays: 1095});
    expect(results).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
