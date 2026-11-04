import type {RuntimeConfig} from './config';
import {actorHash} from './budget';
import {AppError} from './errors';
// Site safety caps, not a claim about the search provider's published allowance.
export const SEARCH_REQUESTS_PER_MINUTE=3,SEARCH_REQUESTS_PER_HOUR=20,SEARCH_REQUESTS_PER_DAY=200;
export async function reserveSearch(request:Request,config:RuntimeConfig,id:string,now=Date.now(),purpose:'search'|'fetch'='search'){
 if(!config.DB||(purpose==='fetch'?config.ENABLE_DIRECT_FETCH:config.ENABLE_NEWS_SEARCH)!=='true'||config.NEWS_TERMS_APPROVED!=='true')throw new AppError(503,'SEARCH_UNAVAILABLE','관련 기사 검색은 연결 준비 중입니다.');
 const db=config.DB,actor=await actorHash(request,config),day=new Date(now).toISOString().slice(0,10);
 await db.prepare('DELETE FROM research_search_budget WHERE created_at<?').bind(now-2*86400000).run();
 const result=await db.prepare(`INSERT OR IGNORE INTO research_search_budget (id,actor,day,created_at)
 SELECT ?,?,?,? WHERE
 (SELECT COUNT(*) FROM research_search_budget WHERE actor=? AND created_at>?)<${SEARCH_REQUESTS_PER_MINUTE} AND
 (SELECT COUNT(*) FROM research_search_budget WHERE actor=? AND created_at>?)<${SEARCH_REQUESTS_PER_HOUR} AND
 (SELECT COUNT(*) FROM research_search_budget WHERE day=?)<${SEARCH_REQUESTS_PER_DAY}`)
 .bind(id,actor,day,now,actor,now-60000,actor,now-3600000,day).run();
 if(!result.meta.changes)throw new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 요청 한도에 도달했거나 이미 처리한 조사입니다. 잠시 후 다시 시작해 주세요.',true);
}
/** Undo one reservation only when no provider request was dispatched (SEARCH_LOCK_BUSY).
 * Both id and actor must match so one actor cannot free another actor's row. Never retries. */
export async function releaseSearch(request:Request,config:RuntimeConfig,id:string){
 if(!config.DB)return;
 const actor=await actorHash(request,config);
 await config.DB.prepare('DELETE FROM research_search_budget WHERE id=? AND actor=?').bind(id,actor).run();
}
export function isSearchLockBusy(error:unknown){return error instanceof AppError&&error.code==='SEARCH_LOCK_BUSY';}
