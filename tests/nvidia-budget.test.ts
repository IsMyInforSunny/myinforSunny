import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {withBudget} from '../lib/server/budget';
let mf:Miniflare,db:D1Database;
beforeAll(async()=>{
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
 db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();
});
afterAll(async()=>{await mf.dispose();});
beforeEach(async()=>{await db.prepare('DELETE FROM request_budget').run();await db.prepare('DELETE FROM provider_backoff').run();});
afterEach(()=>vi.restoreAllMocks());
const nvidiaConfig=()=>({AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',ENABLE_LIVE_ANALYSIS:'true',DB:db});
const actorRequest=(actor:string)=>new Request('http://localhost/api/analyze',{headers:{'cf-connecting-ip':actor}});
function latch(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
describe('NVIDIA request accounting without token caps',()=>{
 it('allows three different actors while keeping one active analysis per actor',async()=>{
  const gate=latch(),config=nvidiaConfig();
  const running=['one','two','three'].map(actor=>withBudget(actorRequest(actor),config,crypto.randomUUID(),60000,async()=>gate.promise));
  await vi.waitFor(async()=>expect((await db.prepare('SELECT COUNT(*) AS n FROM request_budget WHERE active=1').first<{n:number}>())!.n).toBe(3));
  await expect(withBudget(actorRequest('four'),config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
  await expect(withBudget(actorRequest('one'),config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
  gate.release();await Promise.all(running);
 });
 it('counts follow-up calls in one signed analysis group while retaining individual leases',async()=>{
  const config=nvidiaConfig(),request=actorRequest('grouped'),group=crypto.randomUUID();
  await withBudget(request,config,group,60000,async()=>null);
  for(let index=0;index<25;index++)await withBudget(request,config,crypto.randomUUID(),60000,async()=>null,group);
  const counts=await db.prepare('SELECT COUNT(*) AS requests,COUNT(DISTINCT COALESCE(group_id,id)) AS groups FROM request_budget').first();
  expect(counts).toEqual({requests:26,groups:1});
  await withBudget(request,config,crypto.randomUUID(),60000,async()=>null);
  await withBudget(request,config,crypto.randomUUID(),60000,async()=>null);
  await expect(withBudget(request,config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
 },15000);
 it('reduces admission to one after 429 and restores three after cooldown plus five quiet minutes',async()=>{
  const config=nvidiaConfig(),now=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(now);
  await withBudget(actorRequest('limited'),config,crypto.randomUUID(),60000,async current=>{await current.onRateLimit?.(1);});
  await expect(withBudget(actorRequest('during-cooldown'),config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
  clock.mockReturnValue(now+61000);
  const gate=latch();const running=withBudget(actorRequest('single'),config,crypto.randomUUID(),60000,async()=>gate.promise);
  await vi.waitFor(async()=>expect((await db.prepare('SELECT COUNT(*) AS n FROM request_budget WHERE active=1').first<{n:number}>())!.n).toBe(1));
  await expect(withBudget(actorRequest('second'),config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
  gate.release();await running;
  clock.mockReturnValue(now+7*60000);
  const restored=latch();const three=['restored-one','restored-two','restored-three'].map(actor=>withBudget(actorRequest(actor),config,crypto.randomUUID(),60000,async()=>restored.promise));
  await vi.waitFor(async()=>expect((await db.prepare('SELECT COUNT(*) AS n FROM request_budget WHERE active=1').first<{n:number}>())!.n).toBe(3));
  restored.release();await Promise.all(three);
 },15000);
 it('recovers an expired crashed-server lease and gives a new request a bounded lease',async()=>{
  const now=Date.now(),orphan=crypto.randomUUID(),next=crypto.randomUUID();
  await db.prepare('INSERT INTO request_budget(id,actor,day,created_at,reserved,active,lease_until) VALUES(?,?,?,?,0,1,?)').bind(orphan,'orphan',new Date(now).toISOString().slice(0,10),now-60000,now-1).run();
  const config={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',ENABLE_LIVE_ANALYSIS:'true',DB:db};
  await withBudget(new Request('http://localhost/api/analyze',{headers:{'cf-connecting-ip':'lease-test'}}),config,next,60000,async()=>{
   const lease=await db.prepare('SELECT lease_until FROM request_budget WHERE id=?').bind(next).first<{lease_until:number}>();
   expect(lease!.lease_until).toBeGreaterThan(Date.now());
   expect(lease!.lease_until-Date.now()).toBeLessThanOrEqual(45000);
  });
  expect((await db.prepare('SELECT active FROM request_budget WHERE id=?').bind(orphan).first<{active:number}>())!.active).toBe(0);
 });
 it('records usage exceeding old caps, blocks duplicate and concurrent requests, releases on error',async()=>{
  const config={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',ENABLE_LIVE_ANALYSIS:'true',DB:db};
  const request=new Request('http://localhost/api/analyze');
  const id=crypto.randomUUID();
  const result=await withBudget(request,config,id,60000,async c=>{
   c.onUsage?.(999999);
   await expect(withBudget(request,config,crypto.randomUUID(),60000,async()=>null)).rejects.toMatchObject({code:'RATE_LIMITED'});
   return 'ok';
  });
  expect(result).toBe('ok');
  expect(await db.prepare('SELECT consumed,active FROM request_budget WHERE id=?').bind(id).first()).toEqual({consumed:999999,active:0});
  await expect(withBudget(request,config,id,60000,async()=>null)).rejects.toMatchObject({code:'DUPLICATE_REQUEST'});
  await expect(withBudget(request,config,crypto.randomUUID(),60000,async()=>{throw Error('synthetic');})).rejects.toThrow('synthetic');
  expect((await db.prepare('SELECT COUNT(*) AS n FROM request_budget WHERE active=1').first<{n:number}>())?.n).toBe(0);
  expect(await withBudget(request,config,crypto.randomUUID(),60000,async()=>true)).toBe(true);
 });
});
