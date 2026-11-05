import {afterAll,beforeAll,describe,expect,it} from 'vitest';
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
describe('NVIDIA request accounting without token caps',()=>{
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
