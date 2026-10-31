import { describe,it,expect } from 'vitest';
import { POST as analyze } from '../app/api/analyze/route';
import { POST as verify } from '../app/api/verify/route';
import { GET as capabilities } from '../app/api/capabilities/route';
import { fixtures } from '../lib/fixtures';
const request=(path:string,body:unknown)=>new Request(`https://site.test/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
describe('실제 API 처리 경로',()=>{
  for(const f of fixtures)it(`${f.id}: 예시 API 응답이 명확한 demo다`,async()=>{const response=await analyze(request('analyze',{kind:'demo',fixtureId:f.id}));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json() as {mode:string}).mode).toBe('demo');});
  it('없는 예시를 고정 결과로 대체하지 않는다',async()=>{expect((await analyze(request('analyze',{kind:'demo',fixtureId:'unknown'}))).status).toBe(422);});
  it('연결 전 임의 글을 예시로 분석하지 않는다',async()=>{const response=await analyze(request('analyze',{kind:'text',body:'새로 작성한 글이다.',comments:[],transmissionConsent:true}));expect(response.status).toBe(503);expect((await response.json() as {error:{code:string}}).error.code).toBe('FEATURE_UNAVAILABLE');});
  it('다른 내용을 completed로 표시하고 가상 출처를 명시한다',async()=>{const response=await verify(request('verify',{kind:'demo',fixtureId:'conflict'}));const data=await response.json() as {mode:string;checks:{execution:string;outcome:string}[];references:{provenance:string;fetchedAt?:string}[]};expect(response.status).toBe(200);expect(data.mode).toBe('demo');expect(data.checks[0]).toMatchObject({execution:'completed',outcome:'contradicted'});expect(data.references.every(r=>r.provenance==='provided_text'&&!r.fetchedAt)).toBe(true);});
  it('capabilities는 비밀값을 노출하지 않는다',async()=>{const response=await capabilities();const data=await response.json();expect(data).not.toHaveProperty('OPENAI_API_KEY');expect(data).toMatchObject({live:false,webSearch:false});});
});
