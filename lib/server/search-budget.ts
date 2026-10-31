import type {RuntimeConfig} from './config';
import {actorHash} from './budget';
import {AppError} from './errors';
import {monthlySearchLimit,searchProvider,searchProviderReady} from './search-settings';
// Site safety caps, not a claim about the search provider's published allowance.
export const SEARCH_REQUESTS_PER_MINUTE=3,SEARCH_REQUESTS_PER_HOUR=20,SEARCH_REQUESTS_PER_DAY=200;
export async function reserveSearch(request:Request,config:RuntimeConfig,id:string,now=Date.now()){
 if(!config.DB||config.ENABLE_NEWS_SEARCH!=='true'||config.NEWS_TERMS_APPROVED!=='true'||!searchProviderReady(config))throw new AppError(503,'SEARCH_UNAVAILABLE','관련 기사 검색은 연결 준비 중입니다.');
 const db=config.DB,actor=await actorHash(request,config),day=new Date(now).toISOString().slice(0,10);
 await db.prepare('DELETE FROM research_search_budget WHERE created_at<?').bind(now-2*86400000).run();
 const result=await db.prepare(`INSERT OR IGNORE INTO research_search_budget (id,actor,day,created_at)
 SELECT ?,?,?,? WHERE
 (SELECT COUNT(*) FROM research_search_budget WHERE actor=? AND created_at>?)<${SEARCH_REQUESTS_PER_MINUTE} AND
 (SELECT COUNT(*) FROM research_search_budget WHERE actor=? AND created_at>?)<${SEARCH_REQUESTS_PER_HOUR} AND
 (SELECT COUNT(*) FROM research_search_budget WHERE day=?)<${SEARCH_REQUESTS_PER_DAY}`)
 .bind(id,actor,day,now,actor,now-60000,actor,now-3600000,day).run();
 if(!result.meta.changes)throw new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 요청 한도에 도달했거나 이미 처리한 조사입니다. 잠시 후 다시 시작해 주세요.',true);
 if(searchProvider(config)==='tavily'){
  const month=new Date(now).toISOString().slice(0,7),limit=monthlySearchLimit(config);
  const monthly=await db.prepare(`INSERT INTO search_monthly_budget (id,reserved) SELECT ?,1 WHERE ?>=1 ON CONFLICT(id) DO UPDATE SET reserved=reserved+1 WHERE reserved+1<=?`).bind(`tavily:${month}`,limit,limit).run();
  if(!monthly.meta.changes)throw new AppError(429,'SEARCH_QUOTA_EXHAUSTED','이번 달 기사 검색 무료 한도를 다 썼어요. 본문 분석과 예시 체험을 이용해 주세요.');
 }
}
