import type {RuntimeConfig} from './config';
import {AppError} from './errors';
export function searchProvider(c:RuntimeConfig){return c.NEWS_PROVIDER??'gdelt';}
export function searchProviderReady(c:RuntimeConfig){
 if(['gdelt','publisher_feeds'].includes(searchProvider(c)))return true;
 const credits=Number(c.TAVILY_MONTHLY_CREDITS);
 return searchProvider(c)==='tavily'&&!!c.TAVILY_API_KEY&&!!c.DB&&!!c.ALLOWED_RETRIEVAL_HOSTS?.trim()&&c.TAVILY_FREE_PLAN_CONFIRMED==='true'&&c.TAVILY_ELIGIBILITY_CONFIRMED==='true'&&c.TAVILY_MONTHLY_CREDITS_CONFIRMED==='true'&&Number.isSafeInteger(credits)&&credits>0;
}
export function monthlySearchLimit(c:RuntimeConfig){const n=Number(c.TAVILY_MONTHLY_CREDITS);return searchProvider(c)==='tavily'&&searchProviderReady(c)?Math.min(800,Math.floor(n*0.8)):0;}
/** One basic search reserved atomically before dispatch; unknown costs stay reserved. */
export async function reserveTavilyCredit(c:RuntimeConfig,now=Date.now()){
 const limit=monthlySearchLimit(c);if(!limit||!c.DB)throw new AppError(503,'SEARCH_UNAVAILABLE','한국어 기사 검색의 무료 계정·한도 설정을 확인해 주세요.');
 const id=`tavily:${new Date(now).toISOString().slice(0,7)}`;
 const result=await c.DB.prepare('INSERT INTO search_monthly_budget (id,reserved) SELECT ?,1 WHERE ?>=1 ON CONFLICT(id) DO UPDATE SET reserved=reserved+1 WHERE reserved+1<=?').bind(id,limit,limit).run();
 if(!result.meta.changes)throw new AppError(429,'SEARCH_QUOTA_EXHAUSTED','이번 달 기사 검색 무료 한도에 도달했습니다. 본문 분석이나 직접 기사 주소 연결을 이용해 주세요.');
 return id;
}
