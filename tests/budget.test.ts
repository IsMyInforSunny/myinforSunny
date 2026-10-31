import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import * as configModule from '../lib/server/config';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {withBudget,actorHash,RESERVATION} from '../lib/server/budget';
import {reserveSearch} from '../lib/server/search-budget';
import type {RuntimeConfig} from '../lib/server/config';
let mf:Miniflare;let db:D1Database;
beforeAll(async()=>{vi.spyOn(configModule,'providerReady').mockReturnValue(true);mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});db=await mf.getD1Database('DB') as unknown as D1Database;for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();});
afterAll(async()=>{vi.restoreAllMocks();await mf?.dispose();});
beforeEach(async()=>{await db.prepare('DELETE FROM request_budget').run();await db.prepare('DELETE FROM provider_backoff').run();await db.prepare('DELETE FROM research_search_budget').run();await db.prepare('DELETE FROM search_monthly_budget').run();});
const req=(user:string)=>new Request('https://site.test/api/analyze',{headers:{'cf-connecting-ip':user,'user-agent':'budget-test'}});
const config=():RuntimeConfig=>({AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',GROQ_API_KEY:'synthetic-not-a-real-key',OPENAI_API_KEY:'synthetic-not-a-real-key',OPENAI_MODEL:'synthetic-model',DB:db,DAILY_TOKEN_BUDGET:'1000000'});
describe('IP 해시 (서버 HMAC)',()=>{
 const withIp=(ip?:string,extra:Record<string,string>={})=>new Request('https://site.test/x',{headers:{...(ip?{'cf-connecting-ip':ip}:{}),...extra}});
 it('같은 IP는 안정적이고 다른 IP는 다르며 평문 SHA-256이 아니다',async()=>{
  const c={GROQ_API_KEY:'synthetic-a'};const a=await actorHash(withIp('1.1.1.1'),c);
  expect(await actorHash(withIp('1.1.1.1'),c)).toBe(a);expect(await actorHash(withIp('2.2.2.2'),c)).not.toBe(a);
  const plain=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('ip:1.1.1.1')))).map(v=>v.toString(16).padStart(2,'0')).join('');
  expect(a).not.toBe(plain);expect(a).toMatch(/^[0-9a-f]{64}$/);
 });
 it('비밀값이 다르면 해시가 다르고 IP_HASH_SECRET이 있으면 우선한다',async()=>{
  const r=withIp('1.1.1.1');
  expect(await actorHash(r,{GROQ_API_KEY:'synthetic-a'})).not.toBe(await actorHash(r,{GROQ_API_KEY:'synthetic-b'}));
  expect(await actorHash(r,{IP_HASH_SECRET:'s1',GROQ_API_KEY:'synthetic-a'})).toBe(await actorHash(r,{IP_HASH_SECRET:'s1',GROQ_API_KEY:'synthetic-b'}));
  expect(await actorHash(r,{IP_HASH_SECRET:'s1'})).not.toBe(await actorHash(r,{IP_HASH_SECRET:'s2'}));
  expect(await actorHash(r,{IP_HASH_SECRET:'synthetic-a'})).not.toBe(await actorHash(r,{GROQ_API_KEY:'synthetic-a'}));
 });
 it('신뢰할 수 없는 전달 헤더는 무시하고 누락 시 공유 버킷을 쓴다',async()=>{
  const c={GROQ_API_KEY:'synthetic-a'};const none=await actorHash(withIp(),c);
  expect(await actorHash(withIp(undefined,{'x-forwarded-for':'9.9.9.9','x-real-ip':'8.8.8.8'}),c)).toBe(none);
  expect(none).not.toBe(await actorHash(withIp('9.9.9.9'),c));
 });
 it('보수적 예약값 6500은 의도적으로 유지한다',()=>{expect(RESERVATION).toBe(6500);});
 it('비밀값이 없으면 해시하지 않고 요청을 닫는다',async()=>{await expect(actorHash(withIp('1.1.1.1'),{})).rejects.toMatchObject({code:'FEATURE_UNAVAILABLE'});});
});
describe('D1 실제 예약과 제한',()=>{
 it('다른 사용자도 전체 분당 토큰 예산을 공유한다',async()=>{
  const now=Date.now(),day=new Date(now).toISOString().slice(0,10);
  await db.prepare('INSERT INTO request_budget (id,actor,day,created_at,reserved,consumed,active) VALUES (?,?,?,?,?,?,0)').bind('seed','other',day,now,600,600).run();
  let entered=false;await expect(withBudget(req('new-user'),config(),'blocked-minute',1000,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPACITY_EXCEEDED'});expect(entered).toBe(false);
 });
 it('0으로 설정한 일일 예산을 임의로 올리지 않는다',async()=>{await expect(withBudget(req('zero'),{...config(),DAILY_TOKEN_BUDGET:'0'},'zero',1000,async()=>{})).rejects.toMatchObject({code:'FREE_QUOTA_EXHAUSTED'});});
 it('같은 요청 ID를 다시 외부 호출하지 않는다',async()=>{await withBudget(req('dup'),config(),'same-id',1000,async c=>c.onUsage?.(1));await expect(withBudget(req('dup'),config(),'same-id',1000,async()=>{})).rejects.toMatchObject({code:'DUPLICATE_REQUEST'});});
 it('외부 전송 전 실패는 사용 토큰 0으로 정산한다',async()=>{
  await expect(withBudget(req('preflight'),config(),'preflight',1000,async()=>{throw Error('input rejected');})).rejects.toThrow();
  expect(await db.prepare('SELECT consumed FROM request_budget WHERE id=?').bind('preflight').first()).toMatchObject({consumed:0});
 });
 it('전송 후 사용량 불명은 예약을 유지한다',async()=>{
  await expect(withBudget(req('unknown'),config(),'unknown',1000,async c=>{c.onDispatch?.();throw Error('network');})).rejects.toThrow();
  expect(await db.prepare('SELECT consumed FROM request_budget WHERE id=?').bind('unknown').first()).toMatchObject({consumed:6500});
 });
 it('공급자 대기 상태는 다른 사용자 요청도 차단한다',async()=>{
  await withBudget(req('cooldown'),config(),'cooldown',1000,async c=>{await c.onRateLimit?.(120);c.onUsage?.(1);});
  await expect(withBudget(req('other-user'),config(),'wait',1000,async()=>{})).rejects.toMatchObject({code:'RATE_LIMITED'});
 });
 it('호출 사용량을 정산하고 원문 없이 저장한다',async()=>{await withBudget(req('settle'),config(),'budget-settle',1000,async c=>{c.onUsage?.(100);return 'done';});const row=await db.prepare('SELECT consumed,active FROM request_budget WHERE id=?').bind('budget-settle').first<{consumed:number;active:number}>();expect(row).toMatchObject({consumed:100,active:0});});
 it('같은 사용자의 분당 네 번째 요청을 차단한다',async()=>{for(let i=0;i<3;i++)await withBudget(req('rate'),config(),`budget-rate-${i}`,1000,async c=>{c.onUsage?.(1);});await expect(withBudget(req('rate'),config(),'budget-rate-4',1000,async()=>{})).rejects.toMatchObject({status:429});});
 it('활성 요청의 예약을 원자적으로 적용하고 종료 후 해제한다',async()=>{let release:()=>void=()=>{};const hold=new Promise<void>(r=>{release=r;});let entered:()=>void=()=>{};const ready=new Promise<void>(r=>{entered=r;});const first=withBudget(req('concurrent'),config(),'budget-active',5000,async c=>{entered();await hold;c.onUsage?.(1);});await ready;await expect(withBudget(req('concurrent'),config(),'budget-active-2',1000,async()=>{})).rejects.toMatchObject({status:503});release();await first;const row=await db.prepare('SELECT active FROM request_budget WHERE id=?').bind('budget-active').first<{active:number}>();expect(row?.active).toBe(0);});
});


describe('기사 검색 안전 상한 · 실제 D1',()=>{
 const searchConfig=()=>({...config(),ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true'});
 it('동시 요청에서도 IP별 분당 3개만 예약한다',async()=>{const now=Date.now();const out=await Promise.allSettled(Array.from({length:4},(_,i)=>reserveSearch(req('search-rate'),searchConfig(),`s-${i}`,now)));expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(3);expect(out.filter(r=>r.status==='rejected')).toHaveLength(1);});
 it('같은 조사 재전송과 승인 전 검색을 차단한다',async()=>{await reserveSearch(req('search-replay'),searchConfig(),'one');await expect(reserveSearch(req('search-replay'),searchConfig(),'one')).rejects.toMatchObject({code:'SEARCH_RATE_LIMITED'});await expect(reserveSearch(req('search-off'),{...searchConfig(),NEWS_TERMS_APPROVED:'false'},'off')).rejects.toMatchObject({code:'SEARCH_UNAVAILABLE'});});
 it('분당 한도 아래여도 IP별 시간당 20개를 넘길 수 없다',async()=>{const start=Date.now();for(let i=0;i<20;i++)await reserveSearch(req('hour'),searchConfig(),`hour-${i}`,start+i*80000);await expect(reserveSearch(req('hour'),searchConfig(),'hour-over',start+20*80000)).rejects.toMatchObject({code:'SEARCH_RATE_LIMITED'});});
 it('저장소에는 질의·본문·원 IP 필드가 없다',async()=>{const cols=await db.prepare('PRAGMA table_info(research_search_budget)').all<{name:string}>();expect(cols.results.map(c=>c.name)).toEqual(['id','actor','day','created_at']);});
 it('서로 다른 IP도 월간 무료 예약을 원자적으로 초과할 수 없다',async()=>{const c={...searchConfig(),NEWS_PROVIDER:'tavily',TAVILY_API_KEY:'synthetic-not-real',TAVILY_FREE_PLAN_CONFIRMED:'true',TAVILY_ELIGIBILITY_CONFIRMED:'true',TAVILY_MONTHLY_CREDITS_CONFIRMED:'true',TAVILY_MONTHLY_CREDITS:'2'};const out=await Promise.allSettled([reserveSearch(req('month-a'),c,'month-a'),reserveSearch(req('month-b'),c,'month-b')]);expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(out.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'SEARCH_QUOTA_EXHAUSTED'}});const row=await db.prepare('SELECT reserved FROM search_monthly_budget').first<{reserved:number}>();expect(row?.reserved).toBe(1);});
});
