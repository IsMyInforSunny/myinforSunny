import {provider,providerReady,paidProviderAllowed,type RuntimeConfig} from './config';
import {actorHash} from './budget';
import {AppError} from './errors';
import {IP_REQUESTS_PER_MINUTE,IP_REQUESTS_PER_HOUR} from './limits';
export const MODEL_LEASE_MS=45000;
const HEARTBEAT_MS=15000;

/** User-authorized uncapped token usage; keep atomic concurrency and request controls. */
export async function withNvidiaBudget<T>(request:Request,config:RuntimeConfig,id:string,timeout:number,action:(config:RuntimeConfig,signal:AbortSignal)=>Promise<T>,providerId:'nvidia'|'deepseek'='nvidia'):Promise<T>{
 if(config.ENABLE_LIVE_ANALYSIS!=='true'||provider(config)!==providerId||!providerReady(config)||!config.DB||(providerId==='deepseek'&&!paidProviderAllowed(config)))throw new AppError(503,'FEATURE_UNAVAILABLE',providerId==='deepseek'?'DeepSeek API와 유료 사용 설정을 확인해 주세요.':'NVIDIA 모델과 서버 설정을 확인해 주세요.');
 const db=config.DB,now=Date.now(),actor=await actorHash(request,config);
 const label=providerId==='deepseek'?'DeepSeek':'NVIDIA';
 const cooldown=await db.prepare('SELECT until_at FROM provider_backoff WHERE id=?').bind(providerId).first<{until_at:number}>();
 if(cooldown&&cooldown.until_at>now)throw new AppError(429,'RATE_LIMITED',`${label} 요청 한도가 회복될 때까지 기다려 주세요.`,true);
 if(await db.prepare('SELECT id FROM request_budget WHERE id=?').bind(id).first())throw new AppError(409,'DUPLICATE_REQUEST','이미 처리한 요청입니다.');
 await db.prepare('UPDATE request_budget SET active=0 WHERE active=1 AND lease_until IS NOT NULL AND lease_until<=?').bind(now).run();
 const inserted=await db.prepare(`INSERT INTO request_budget (id,actor,day,created_at,reserved,active,lease_until)
 SELECT ?,?,?,?,?,1,? WHERE
 (SELECT COUNT(*) FROM request_budget WHERE actor=? AND created_at>?)<${IP_REQUESTS_PER_MINUTE} AND
 (SELECT COUNT(*) FROM request_budget WHERE actor=? AND created_at>?)<${IP_REQUESTS_PER_HOUR} AND
 (SELECT COUNT(*) FROM request_budget WHERE active=1 AND COALESCE(lease_until,created_at+?)>?)<1`)
 .bind(id,actor,new Date(now).toISOString().slice(0,10),now,0,now+MODEL_LEASE_MS,actor,now-60000,actor,now-3600000,timeout+10000,now).run();
 if(!inserted.meta.changes)throw new AppError(429,'RATE_LIMITED','다른 분석이 진행 중이거나 요청 횟수 한도에 도달했습니다.',true);
 let consumed:number|undefined;
 const leaseLost=new AbortController();let renewal:Promise<void>|undefined;
 const heartbeat=setInterval(()=>{
  if(renewal)return;
  renewal=(async()=>{
   const at=Date.now();
   try{const updated=await db.prepare('UPDATE request_budget SET lease_until=? WHERE id=? AND active=1 AND lease_until>?').bind(at+MODEL_LEASE_MS,id,at).run();if(!updated.meta.changes)leaseLost.abort();}
   catch{leaseLost.abort();}
  })().finally(()=>{renewal=undefined;});
 },HEARTBEAT_MS);
 try{return await action({...config,onDispatch:()=>{},onUsage:n=>{if(Number.isFinite(n)&&n>=0)consumed=(consumed??0)+Math.ceil(n);},onRateLimit:async seconds=>{
  await db.prepare('INSERT INTO provider_backoff (id,until_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)').bind(providerId,Date.now()+Math.max(60000,Math.min(86400000,seconds*1000))).run();
 }},AbortSignal.any([request.signal,AbortSignal.timeout(timeout),leaseLost.signal]));}
 finally{
  clearInterval(heartbeat);await renewal;
  await db.prepare('UPDATE request_budget SET active=0, consumed=? WHERE id=?').bind(consumed??null,id).run();
  await db.prepare('DELETE FROM request_budget WHERE created_at<?').bind(now-2*86400000).run();
 }
}
