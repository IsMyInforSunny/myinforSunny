import storedIndex from '../data/article-search-index.json';
import type {RelatedArticle} from '../news-contract';

export type IndexedArticle = {
  id: string;
  title: string;
  url: string;
  publisherDomain: string;
  publishedAt: string;
  usageStatus: 'approved' | 'unapproved';
  keywords: [string, number][];
};
export type ArticleSearchIndex = {
  schemaVersion: string;
  generatedAt: string;
  sourceArticleCount: number;
  indexedArticleCount: number;
  articles: IndexedArticle[];
};
export type IndexSearchOptions = {
  now?: number;
  maxAgeDays?: number;
  limit?: number;
  index?: ArticleSearchIndex;
};

const STOP_WORDS = new Set('그리고 그러나 하지만 또는 대한 대해 위해 통해 관련 이번 지난 올해 기자 기사 뉴스 보도 따르면 밝혔다 말했다 한다 있다 있는 것으로 것이다 이다 입니다 합니다 등의 것을 같이 부터 까지 정책 정부 국민 우리 위해서 대한 것에 대해 the and for with from this that have has was were are not into more will said news http https www com org kr'.split(' '));
const corpus = storedIndex as unknown as ArticleSearchIndex;
const indexedHosts = [...new Set(corpus.articles.map(article => new URL(article.url).hostname))];

export function articleIndexHosts() {
  return [...indexedHosts];
}

export function articleIndexStatus() {
  return {indexedArticleCount: corpus.indexedArticleCount, generatedAt: corpus.generatedAt};
}

/** Fast candidate discovery only. Body, quotes and stance still require validation. */
export function searchArticleIndex(query: string, allowedHosts: string[], options: IndexSearchOptions = {}): RelatedArticle[] {
  const tokens = [...new Set((query.normalize('NFC').toLowerCase().match(/[가-힣a-z0-9]{2,30}/g) ?? [])
    .filter(token => !STOP_WORDS.has(token) && !/^\d+$/.test(token)))];
  if (!tokens.length || tokens.length > 12 || query.length > 100) return [];
  const hosts = new Set(allowedHosts.map(host => host.trim().toLowerCase()).filter(Boolean));
  if (!hosts.size) return [];
  const now = options.now ?? Date.now();
  const maxAge = Math.max(1, Math.min(options.maxAgeDays ?? 30, 1095)) * 86400000;
  const limit = Math.max(0, Math.min(Math.floor(options.limit ?? 5), 10));
  if (!limit || !Number.isFinite(now) || !Number.isFinite(maxAge)) return [];
  const required = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.6));
  const matches: {article: IndexedArticle; url: URL; score: number; published: number}[] = [];
  for (const article of (options.index ?? corpus).articles) {
    let url: URL;
    try {url = new URL(article.url);} catch {continue;}
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname.toLowerCase())) continue;
    const published = Date.parse(article.publishedAt);
    if (!Number.isFinite(published) || published > now || now - published > maxAge) continue;
    const keywords = new Map(article.keywords);
    let score = 0, count = 0;
    for (const token of tokens) {
      const weight = keywords.get(token);
      if (weight !== undefined && Number.isFinite(weight) && weight > 0) {score += weight; count++;}
    }
    if (count >= required) matches.push({article, url, score: score * (count / tokens.length), published});
  }
  matches.sort((a, b) => b.score - a.score || b.published - a.published || a.article.id.localeCompare(b.article.id));
  const result: RelatedArticle[] = [], seen = new Set<string>(), publisherCounts = new Map<string, number>();
  for (const match of matches) {
    const identity = match.url.href;
    const domain = match.url.hostname.replace(/^www\./, '');
    if (seen.has(identity) || (publisherCounts.get(domain) ?? 0) >= 2) continue;
    seen.add(identity);
    publisherCounts.set(domain, (publisherCounts.get(domain) ?? 0) + 1);
    const candidate: RelatedArticle & {publishedAt: string} = {id: match.article.id, title: match.article.title, url: identity, publisherDomain: domain,
      indexedAt: (options.index ?? corpus).generatedAt, publishedAt: match.article.publishedAt,
      language: 'Korean', provenance: 'search_result', stance: 'not_checked'};
    result.push(candidate);
    if (result.length === limit) break;
  }
  return result;
}
