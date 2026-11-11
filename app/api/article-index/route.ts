import {z} from 'zod/v4';
import {searchQuerySchema} from '@/lib/contracts';
import {containsContactInfo} from '@/lib/privacy';
import {articleIndexStatus} from '@/lib/server/article-search-index';
import {searchIndexedNews} from '@/lib/server/indexed-news';
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
    return json({provider: 'local_index', query: parsed.data.query, status: 'empty', articles: [],
      searchedAt: new Date().toISOString(),
      scopeNote: `수집 기사 ${articleIndexStatus().indexedArticleCount.toLocaleString()}건의 최근 30일 메타데이터에서 검색어에 맞는 후보를 찾지 못했습니다.`});
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
