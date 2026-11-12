import { RuntimeConfig, providerReady, provider } from './config';
import {dailyLimits,minuteLimits,MODEL_REQUEST_RESERVATION,IP_REQUESTS_PER_MINUTE,IP_REQUESTS_PER_HOUR} from './limits';
import {DAILY_LIMIT_MESSAGE} from '../display';
import { AppError } from './errors';
import {withNvidiaBudget} from './nvidia-budget';
import {NVIDIA_TIMEOUT_MS} from './providers/nvidia';

export const RESERVATION=MODEL_REQUEST_RESERVATION;
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(v=>v.toString(16).padStart(2,'0')).join('');
const hmac=async(key:ArrayBuffer|Uint8Array,message:string)=>crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key as BufferSource,{name:'HMAC',hash:'SHA-256'},false,['sign']),new TextEncoder().encode(message));
/** Server-keyed actor id. Only the trusted Cloudflare header is used; a missing one shares one conservative bucket. */
export async function actorHash(request:Request,config:Pick<RuntimeConfig,'IP_HASH_SECRET'|'GROQ_API_KEY'|'NVIDIA_API_KEY'|'DEEPSEEK_API_KEY'|'AI_PROVIDER'>):Promise<string>{
  const encoder=new TextEncoder();let key:ArrayBuffer|Uint8Array;
  if(config.IP_HASH_SECRET)key=encoder.encode(config.IP_HASH_SECRET);
  // Domain-separated derivation so the provider key itself is never used directly as the HMAC key.
  else {
    const selected=provider(config);
    const material=selected==='nvidia'?config.NVIDIA_API_KEY:selected==='deepseek'?config.DEEPSEEK_API_KEY:config.GROQ_API_KEY;
    if(!material)throw new AppError(503,'FEATURE_UNAVAILABLE','실시간 분석은 준비 중입니다. 예시 체험을 이용해 주세요.');
    key=await hmac(encoder.encode(material),'naeinfo:actor-hash:v1');
  }
  return hex(await hmac(key,`ip:${request.headers.get('cf-connecting-ip')??'local'}`));
}
export async function withBudget<T>(request:Request,config:RuntimeConfig,requestId:string,timeout:number,action:(config:RuntimeConfig,signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(provider(config)==='nvidia')return withNvidiaBudget(request,config,requestId,Math.max(timeout,NVIDIA_TIMEOUT_MS),action);
  if(provider(config)==='deepseek')return withNvidiaBudget(request,config,requestId,Math.max(timeout,600000),action,'deepseek');
  if(config.ENABLE_LIVE_ANALYSIS!=='true'||!providerReady(config)||!dailyLimits(config).verified||!config.DB)throw new AppError(503,'FEATURE_UNAVAILABLE','실시간 분석은 준비 중입니다. 예시 체험을 이용해 주세요.');
  const minute=minuteLimits(config);
  if(!minute.compatible)throw new AppError(503,'PROJECT_MINUTE_LIMIT_UNSUPPORTED','확인된 프로젝트의 분당 한도가 요청 예약을 충족하지 못하거나 설정이 올바르지 않습니다.');
  const now=Date.now();
  const cooldown=await config.DB.prepare('SELECT until_at FROM provider_backoff WHERE id=?').bind('groq').first<{until_at:number}>();
  if(cooldown&&cooldown.until_at>now)throw new AppError(429,'RATE_LIMITED','무료 AI 한도가 회복될 때까지 기다려 주세요.',true);
  const day=new Date(now).toISOString().slice(0,10);
  const actor=await actorHash(request,config);
  const db=config.DB;const limits=dailyLimits(config);const daily=limits.tokens;
  if(await db.prepare('SELECT id FROM request_budget WHERE id=?').bind(requestId).first())throw new AppError(409,'DUPLICATE_REQUEST','이미 처리한 요청입니다.');
  const result=await db.prepare(`INSERT INTO request_budget (id, actor, day, created_at, reserved, active)
    SELECT ?, ?, ?, ?, ?, 1 WHERE
    (SELECT COUNT(*) FROM request_budget WHERE actor=? AND created_at>?)<${IP_REQUESTS_PER_MINUTE} AND
    (SELECT COUNT(*) FROM request_budget WHERE actor=? AND created_at>?)<${IP_REQUESTS_PER_HOUR} AND
    (SELECT COUNT(*) FROM request_budget WHERE actor=? AND active=1 AND created_at>?)<1 AND
    (SELECT COUNT(*) FROM request_budget WHERE active=1 AND created_at>?)<1 AND
    (SELECT COALESCE(SUM(COALESCE(consumed,reserved)),0) FROM request_budget WHERE created_at>?)+?<=${minute.tokens} AND
    ${minute.requests===null?'':`(SELECT COUNT(*) FROM request_budget WHERE created_at>${now-60000})<${minute.requests} AND`}
    (SELECT COUNT(*) FROM request_budget WHERE day=?)<${limits.requests} AND
    (SELECT COALESCE(SUM(COALESCE(consumed,reserved)),0) FROM request_budget WHERE day=?)+?<=?`)
    .bind(requestId,actor,day,now,RESERVATION,actor,now-60000,actor,now-3600000,actor,now-70000,now-70000,now-60000,RESERVATION,day,day,RESERVATION,daily).run();
  if(!result.meta.changes){
    const spent=await db.prepare('SELECT COALESCE(SUM(COALESCE(consumed,reserved)),0) AS tokens, COUNT(*) AS requests FROM request_budget WHERE day=?').bind(day).first<{tokens:number;requests:number}>();
    if(spent&&(spent.tokens+RESERVATION>daily||spent.requests>=limits.requests))throw new AppError(429,'FREE_QUOTA_EXHAUSTED',DAILY_LIMIT_MESSAGE);
    const rate=await db.prepare('SELECT COUNT(*) AS recent FROM request_budget WHERE actor=? AND created_at>?').bind(actor,now-60000).first<{recent:number}>();
    throw new AppError(rate&&rate.recent>=IP_REQUESTS_PER_MINUTE?429:503,rate&&rate.recent>=IP_REQUESTS_PER_MINUTE?'RATE_LIMITED':'CAPACITY_EXCEEDED','요청 한도 또는 오늘의 분석 예산에 도달했습니다. 잠시 후 다시 시도해 주세요.',true);
  }
  let consumed:number|undefined;let dispatched=false;const signal=AbortSignal.any([request.signal,AbortSignal.timeout(timeout)]);
  try{return await action({...config,onDispatch:()=>{dispatched=true;},onUsage:n=>{if(Number.isFinite(n)&&n>=0)consumed=(consumed??0)+Math.ceil(n);},onRateLimit:async seconds=>{const until=Date.now()+Math.max(60000,Math.min(86400000,seconds*1000));await db.prepare('INSERT INTO provider_backoff (id,until_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET until_at=MAX(until_at,excluded.until_at)').bind('groq',until).run();}},signal);}
  finally{
    // Unknown provider usage keeps the conservative reservation, rather than undercounting.
    await db.prepare('UPDATE request_budget SET active=0, consumed=? WHERE id=?').bind(consumed??(dispatched?RESERVATION:0),requestId).run();
    await db.prepare('DELETE FROM request_budget WHERE created_at<?').bind(now-2*86400000).run();
  }
}
