import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import * as configuration from '../lib/server/config';
import {POST as analyzeRoute} from '../app/api/analyze/route';
import {POST as verifyRoute} from '../app/api/verify/route';
import {makeSources,assertAnalysis} from '../lib/domain';
import type {Analysis,Verification} from '../lib/contracts';
let mf:Miniflare;let db:D1Database;
const text={kind:'text' as const,body:'도서관은 오후 6시에 문을 닫는다.',comments:[{id:'c1',text:'운영 시간을 늘려 주세요.'}]};
const request=(path:string,body:unknown)=>new Request(`https://site.test/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const raw=()=>{
 const sources=makeSources(text),span=(source:number)=>({sentenceId:sources[source].sentences[0].id,quote:sources[source].text});
 return {clearSentenceIds:[],topics:[{id:'hours',label:'운영 시간',description:'도서관 운영 시간',evidence:[span(0)]}],topicAssignments:[{sourceId:'comment_0',topicIds:['hours'],status:'assigned',evidence:[span(1)],reason:'운영 시간을 언급'}],stances:[],bodyAssigned:[{sentenceId:'body_s0',topicIds:['hours']}],bodyOtherIds:[],bodyUndeterminedIds:[],expressions:sources.flatMap(s=>s.sentences.map(t=>({sentenceId:t.id,status:'clear',criteria:[],severity:'none',context:'direct',explanation:'명확한 검토 표현 없음',evidence:[]}))),claims:[{id:'claim_1',text:text.body,kind:'factual',origin:[span(0)],targetTime:''}],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[{sentenceId:'body_s0',quote:'원문'}]}],searchSuggestions:[],claimsMayBeOmitted:true};
};
const reply=(data:unknown)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage:{total_tokens:500}});
beforeAll(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});db=await mf.getD1Database('DB') as unknown as D1Database;for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(statement.trim())await db.prepare(statement.trim()).run();});
beforeEach(async()=>{
 await db.prepare('DELETE FROM request_budget').run();await db.prepare('DELETE FROM provider_backoff').run();
 vi.spyOn(configuration,'runtimeConfig').mockResolvedValue({AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',GROQ_API_KEY:'synthetic-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',DB:db});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});afterAll(async()=>{await mf.dispose();});
describe('실제 라우트·D1·어댑터·인용 검증 통합 (공급자만 모의)',()=>{
 it('자료 문장 ID를 선택하면 서버가 해당 출처의 인용과 위치를 복원한다',async()=>{
  const source=makeSources(text);const selected={id:'claim_1',text:text.body,kind:'factual',origin:[{sourceId:'body',sentenceId:'body_s0',start:0,end:text.body.length,quote:text.body}]};
  const reference='도서관은 오후 9시에 문을 닫는다.';
  const fetch=vi.fn().mockResolvedValue(reply({checks:[{claimId:'claim_1',originMatches:true,outcome:'contradicted',relations:[{referenceSentenceId:'r1_s0',relation:'contradicts',explanation:'운영 시간이 다릅니다.'}],explanation:'입력 출처와 운영 시간이 다릅니다.',temporalFit:'matched',limitations:['가상 입력 자료 범위']}]}));vi.stubGlobal('fetch',fetch);
  const response=await verifyRoute(request('verify',{kind:'text',sources:source,claims:[selected],references:[{id:'r1',text:reference}],useWebSearch:false,transmissionConsent:true}));
  expect(response.status).toBe(200);const v=await response.json() as Verification;const relation=v.checks[0].relations[0];
  expect(v.checks[0].outcome).toBe('contradicted');expect(relation.quote).toBe(reference);expect(v.references[0].text.slice(relation.start,relation.end)).toBe(relation.quote);
  const body=JSON.parse(fetch.mock.calls[0][1].body);expect(JSON.stringify(body.response_format)).toContain('referenceSentenceId');
 });
 it('임의 입력 분석부터 입력 자료 대조와 정산까지 연결한다',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(reply(raw())).mockResolvedValueOnce(reply({checks:[{claimId:'claim_1',originMatches:true,outcome:'supported',relations:[{referenceSentenceId:'r1_s0',relation:'supports',explanation:'입력 자료와 같은 운영 시간'}],explanation:'입력 자료에서 확인한 내용',temporalFit:'matched',limitations:['입력 자료 범위의 관계']}]}));vi.stubGlobal('fetch',fetch);
  const response=await analyzeRoute(request('analyze',{...text,transmissionConsent:true}));
  expect(response.status).toBe(200);const analysis=await response.json() as Analysis;expect(analysis.mode).toBe('live');expect(()=>assertAnalysis(analysis)).not.toThrow();expect(analysis.indicators.topics[0].coverage).toMatchObject({numerator:1,denominator:1});expect(analysis.bodyTopicAssignments).toEqual([{sentenceId:'body_s0',topicIds:['hours'],status:'assigned'}]);
  const check=await verifyRoute(request('verify',{kind:'text',parentAnalysisId:analysis.analysisId,sources:analysis.sources,claims:analysis.claims,references:[{id:'r1',text:text.body}],useWebSearch:false,transmissionConsent:true}));
  expect(check.status).toBe(200);const verification=await check.json() as Verification;expect(verification.checks[0].outcome).toBe('supported');expect(verification.references[0].provenance).toBe('provided_text');expect(fetch).toHaveBeenCalledTimes(2);
  expect(await db.prepare('SELECT SUM(consumed) AS consumed,SUM(active) AS active FROM request_budget').first()).toMatchObject({consumed:1000,active:0});
 });
 it('위조 인용은 부분 결과로 유보하고 공급자를 재호출하지 않는다',async()=>{
  const data=raw();data.claims[0].origin[0].quote='존재하지 않는 문장';
  const fetch=vi.fn().mockResolvedValue(reply(data));vi.stubGlobal('fetch',fetch);
  const response=await analyzeRoute(request('analyze',{...text,transmissionConsent:true}));const result=await response.json() as Analysis;
  expect(response.status).toBe(200);expect(result.status).toBe('partial');expect(result.claims).toHaveLength(0);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('자료 본문이 없는 대조는 예약·요청 한도·공급자 호출 없이 URL 미취득으로 처리한다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const sources=makeSources(text);const claim={id:'claim_1',text:text.body,kind:'factual' as const,origin:[{sourceId:sources[0].id,sentenceId:sources[0].sentences[0].id,start:0,end:sources[0].text.length,quote:sources[0].text}],targetTime:''};
  const body={kind:'text',sources,claims:[claim],references:[{id:'r1',url:'https://example.com/a'}],useWebSearch:false,transmissionConsent:true};
  const response=await verifyRoute(request('verify',body));expect(response.status).toBe(200);
  const result=await response.json() as Verification;expect(result.checks[0]).toMatchObject({outcome:'unchecked',execution:'skipped'});expect(result.attempts[0]).toMatchObject({status:'not_fetched'});
  expect(fetch).not.toHaveBeenCalled();expect(await db.prepare('SELECT COUNT(*) AS n FROM request_budget').first()).toMatchObject({n:0});
  // Validation is unchanged: forged spans are still rejected, and still without any budget usage.
  const forged=structuredClone(body);forged.claims[0].origin[0].quote='존재하지 않는 문장';
  const bad=await verifyRoute(request('verify',forged));expect(bad.status).toBe(422);
  const badSource=structuredClone(body);badSource.sources[0].sentences[0].end+=1;
  expect((await verifyRoute(request('verify',badSource))).status).toBe(422);
  const noConsent={...body,transmissionConsent:false};expect((await verifyRoute(request('verify',noConsent))).status).toBe(422);
  const contact={...body,references:[{id:'r1',url:'https://example.com/a?mail=a@b.co'}]};expect((await verifyRoute(request('verify',contact))).status).toBe(422);
  expect(fetch).not.toHaveBeenCalled();expect(await db.prepare('SELECT COUNT(*) AS n FROM request_budget').first()).toMatchObject({n:0});
 });
 it('기능이 꺼져 있으면 자료 없는 대조도 503으로 막는다',async()=>{
  vi.spyOn(configuration,'runtimeConfig').mockResolvedValue({AI_PROVIDER:'groq',DB:db});
  const sources=makeSources(text);const claim={id:'claim_1',text:text.body,kind:'factual' as const,origin:[{sourceId:sources[0].id,sentenceId:sources[0].sentences[0].id,start:0,end:sources[0].text.length,quote:sources[0].text}],targetTime:''};
  expect((await verifyRoute(request('verify',{kind:'text',sources,claims:[claim],references:[],useWebSearch:false,transmissionConsent:true}))).status).toBe(503);
 });
 it('한 번의 429 이후 다른 요청도 공급자 호출 없이 중단한다',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('not exposed',{status:429,headers:{'retry-after':'120'}}));vi.stubGlobal('fetch',fetch);
  expect((await analyzeRoute(request('analyze',{...text,transmissionConsent:true}))).status).toBe(429);
  expect((await analyzeRoute(request('analyze',{...text,transmissionConsent:true}))).status).toBe(429);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
