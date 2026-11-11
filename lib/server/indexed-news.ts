import type {NewsResult} from '../news-contract';
import {searchQuerySchema} from '../contracts';
import {containsContactInfo} from '../privacy';
import type {RuntimeConfig} from './config';
import {searchArticleIndex, articleIndexHosts, articleIndexStatus} from './article-search-index';

/** Metadata candidates can be listed before a publisher is enabled for body retrieval. */
export function searchIndexedNews(query: string, config: RuntimeConfig, requireRetrievable = false): NewsResult | null {
  const parsed = searchQuerySchema.safeParse(query);
  if (!parsed.success || containsContactInfo(parsed.data)) return null;
  const hosts = requireRetrievable
    ? (config.ALLOWED_RETRIEVAL_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean)
    : articleIndexHosts();
  const articles = searchArticleIndex(parsed.data, hosts);
  if (!articles.length) return null;
  const status = articleIndexStatus();
  return {provider:'local_index',query:parsed.data,status:'success',articles,searchedAt:new Date().toISOString(),
    scopeNote:`수집 기사 ${status.indexedArticleCount.toLocaleString()}건의 메타데이터에서 최근 30일·핵심어가 맞는 후보를 찾았습니다. 발행일은 기사별로 표시합니다. 본문과 입장은 자료 대조에서 확인하며, 본문 취득에는 별도 허용 출처 설정이 적용됩니다.`};
}
