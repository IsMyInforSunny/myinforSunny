import {z} from 'zod/v4';
import {searchQuerySchema} from '@/lib/contracts';
import {containsContactInfo} from '@/lib/privacy';
import {articleIndexStatus} from '@/lib/server/article-search-index';
import {searchIndexedNews} from '@/lib/server/indexed-news';
import {runtimeConfig,capabilities} from '@/lib/server/config';
import {searchPublisherFeeds} from '@/lib/server/publisher-feeds';
import {AppError, errorResponse, json, readJson} from '@/lib/server/errors';

const requestSchema = z.object({query: searchQuerySchema}).strict();

/** Searches bundled public metadata without provider, model or budget requests. */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError(422, 'VALIDATION_ERROR', '검색할 핵심어 3~100자를 확인해 주세요.');
    if (containsContactInfo(parsed.data.query)) throw new AppError(422, 'PRIVACY_INPUT_REJECTED', '개인 연락처를 검색어로 사용할 수 없습니다.');
    const result = searchIndexedNews(parsed.data.query, {});
    if (result) return json(result);
    const config=await runtimeConfig();
    // RSS endpoints are fixed: no article text or search terms are sent to a
    // third-party search service by this automatic candidate-discovery route.
    if(config.NEWS_PROVIDER==='publisher_feeds'&&capabilities(config).webSearch)return json(await searchPublisherFeeds(parsed.data.query,config,request.signal));
    return json({provider: 'local_index', query: parsed.data.query, status: 'empty', articles: [],
      searchedAt: new Date().toISOString(),
      scopeNote: `수집 기사 ${articleIndexStatus().indexedArticleCount.toLocaleString()}건은 검색했지만, 현재 모든 자료의 이용 승인 검토가 끝나지 않아 후보를 추천하지 않았습니다.`});
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
