import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {ResearchInput,ResearchVerification} from '../lib/research-contract';
import type {RuntimeConfig} from '../lib/server/config';
import {researchExcludedUrlsSchema} from '../lib/research-contract';
import {runResearch} from '../lib/research-runner';
import {compareEvidence,discoverEvidence,planResearch,researchQueryRequirements} from '../lib/server/research';
import * as language from '../lib/server/language';
import * as news from '../lib/server/news';
import * as retrieval from '../lib/server/retrieval';
import * as searchBudget from '../lib/server/search-budget';
import * as verification from '../lib/server/verify';
import {POST} from '../app/api/research/route';

// Only the planner support predicate reads this test stub. It is never parsed,
// trained, inferred, stored as an artifact, or presented as a real model.
const release=vi.hoisted(()=>({model:null as null|{comparisonGroup:string}}));
vi.mock('../lib/bias-model-release',()=>({get releasedBiasModel(){return release.model;}}));
const request=()=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':'192.0.2.27'}});
const signal=()=>AbortSignal.timeout(3000);
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-only-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example,second.example',DB:{} as D1Database};
function input():ResearchInput{const a=demoAnalysis('supported');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};}
const queries=(i:ResearchInput,count=1)=>Array.from({length:count},(_,index)=>({claimId:i.claims[0].id,label:`표본 ${index+1}`,query:`공개 도서관 시간 ${index+1}`,purpose:'fact_check' as const}));
afterEach(()=>{release.model=null;vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('편향 기준 표본을 위한 같은 계획의 제한된 추가 검색 — 모의 호출만 사용',()=>{
 it('명시적 명제를 우선하고 그 대상만 세 검색으로 확장해 최대 여덟 개를 유지한다',()=>{
  const i=input();i.claims=Array.from({length:5},(_,index)=>({...i.claims[0],id:`c${index}`}));i.proposition='도서관 운영 시간을 늘려야 한다.';
  const strategy=researchQueryRequirements(i,()=>true);
  expect(strategy.biasTargetId).toBe('comparison_position');
  expect(strategy.targets.reduce((n,target)=>n+target.count,0)).toBe(8);
  expect(strategy.targets.filter(target=>target.count===3)).toEqual([{id:'comparison_position',purpose:'perspective',count:3}]);
  expect(researchQueryRequirements(i,()=>false).targets.every(target=>target.count===1)).toBe(true);
  // Unsupported explicit positions must not silently switch to a factual topic.
  expect(researchQueryRequirements(i,text=>text===i.claims[0].text).biasTargetId).toBeNull();
 });
 it('직접 명제가 없으면 추출 의견, 그마저 없으면 첫 지원 사실 주장을 선택한다',()=>{
  const i=input(),opinion=demoAnalysis('no_comments').claims.find(c=>c.kind==='opinion')!;
  expect(researchQueryRequirements({...i,position:opinion},()=>true).biasTargetId).toBe(opinion.id);
  const two={...i,claims:[i.claims[0],{...i.claims[0],id:'other',text:'다른 사실 주장이다.'}]};
  expect(researchQueryRequirements(two,text=>text===two.claims[1].text).biasTargetId).toBe('other');
 });
 it('계획 모델 호출 하나에서 세 개의 서로 다른 검색어를 검증하고 동일 검색 반복을 거부한다',async()=>{
  const i=input();release.model={comparisonGroup:i.claims[0].text};
  const llm=vi.spyOn(language,'structured').mockResolvedValue({queries:queries(i,3)});
  const plan=await planResearch(request(),i,config,signal());
  expect(plan.queries).toHaveLength(3);expect(llm).toHaveBeenCalledTimes(1);
  expect(llm.mock.calls[0][3]).toMatchObject({biasTargetId:i.claims[0].id,queryRequirements:[{id:i.claims[0].id,count:3}]});
  const duplicates=queries(i,3);duplicates[2].query=duplicates[0].query+'  ';
  llm.mockResolvedValue({queries:duplicates});
  await expect(planResearch(request(),i,config,signal())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  release.model=null;llm.mockResolvedValue({queries:queries(i,3)});
  await expect(planResearch(request(),i,config,signal())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
 });
 it('이미 취득한 URL의 추적 주소 변형은 취득 전에 제외하고 새 두 매체 기사를 취득한다',async()=>{
  const i=input();vi.spyOn(language,'structured').mockResolvedValue({queries:queries(i)});
  const plan=await planResearch(request(),i,config,signal());
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'모의',status:'success',searchedAt:new Date().toISOString(),scopeNote:'모의 응답',articles:[
   ['news.example','https://news.example/old?utm_source=again'],['news.example','https://news.example/new'],['second.example','https://second.example/new']
  ].map(([host,url],index)=>({id:`a${index}`,title:'공개 합성 기사',url,publisherDomain:host,language:'Korean',provenance:'search_result' as const,stance:'not_checked' as const}))});
  const fetch=vi.spyOn(retrieval,'retrieve').mockImplementation(async(url,id)=>({id,url,title:'공개 합성 기사',text:url.includes('second')?'별도 원본에서는 도서관의 운영 확대 조건을 설명했다.':'도서관 운영 공지에는 현재 폐관 시간이 명시되어 있다.',provenance:'web_fetched',fetchedAt:'2026-11-01T00:00:00Z',publishedAt:'2026-01-01',truncated:false}));
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,signal(),['https://www.news.example/old#previous']);
  expect(fetch.mock.calls.map(call=>call[0])).toEqual(['https://news.example/new','https://second.example/new']);
  expect(bundle.references).toHaveLength(2);expect(bundle.attempts.some(attempt=>attempt.url?.includes('/old')&&attempt.status==='disallowed')).toBe(true);
  vi.spyOn(verification,'verify').mockResolvedValue(demoVerification('supported'));
  const result=await compareEvidence(request(),i,bundle.token,config,'same-plan',signal());
  expect(result.researchPlanId).toBe(plan.planId);
 });
 it('제외 URL은 공개 HTTPS 형식과 24개 상한을 지키며 브라우저의 계획 ID 주입은 거부한다',async()=>{
  for(const values of [['http://news.example/a'],['https://user:pass@news.example/a'],Array.from({length:25},()=> 'https://news.example/a')])expect(researchExcludedUrlsSchema.safeParse(values).success).toBe(false);
  const response=await POST(new Request('https://site.test/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'compare',input:input(),evidenceToken:'not-a-token',researchPlanId:'browser-forgery'})}));
  expect(response.status).toBe(422);
 });
 it('같은 계획의 세 검색이 새 URL을 모으고 비교 간 61초를 유지하며 한 주장을 중복 집계하지 않는다',async()=>{
  const i=input(),discoverBodies:{excludeUrls?:string[]}[]=[],compareAt:number[]=[],results:ResearchVerification[]=[];let time=0;
  await runResearch(i,new AbortController().signal,{now:()=>time,wait:async ms=>{time+=ms;},post:async<T,>(body:unknown)=>{
   const data=body as {operation:string;queryIndex:number;excludeUrls?:string[]};
   if(data.operation==='plan')return {token:'p',planId:'signed-plan',queries:queries(i,3),nextModelCallAt:new Date(61000).toISOString()} as T;
   if(data.operation==='discover'){
    discoverBodies.push(data);return {token:`e${data.queryIndex}`,claimId:i.claims[0].id,references:[{url:`https://www.news.example/${data.queryIndex}?utm_source=test`},{url:`https://second.example/${data.queryIndex}`}]} as T;
   }
   compareAt.push(time);const result=demoVerification('supported');result.checks=result.checks.slice(0,1);result.checks[0].claimId=i.claims[0].id;
   return {...result,researchPlanId:'signed-plan'} as T;
  }},progress=>{if(progress.stage==='completed'){expect(progress.completed).toBe(1);expect(progress.coverage[i.claims[0].id]).toBe('reviewed');}},result=>results.push(result));
  expect(discoverBodies.map(body=>body.excludeUrls?.length??0)).toEqual([0,2,4]);
  expect(discoverBodies[1].excludeUrls).toEqual(['https://news.example/0','https://second.example/0']);
  expect(compareAt).toEqual([61000,122000,183000]);expect(results).toHaveLength(3);
  expect(new Set(results.map(result=>result.researchPlanId))).toEqual(new Set(['signed-plan']));
 });
 it('추가 표본 검색이 비어도 이미 대조한 주장의 검토 상태를 지우지 않는다',async()=>{
  const i=input();let time=0,last:{stage:string;completed:number;coverage:Record<string,string>}|undefined;
  await runResearch(i,new AbortController().signal,{now:()=>time,wait:async ms=>{time+=ms;},post:async<T,>(body:unknown)=>{
   const data=body as {operation:string;queryIndex:number};
   if(data.operation==='plan')return {token:'p',queries:queries(i,3),nextModelCallAt:new Date(0).toISOString()} as T;
   if(data.operation==='discover')return {token:'e',claimId:i.claims[0].id,references:data.queryIndex===0?[{url:'https://news.example/one'}]:[]} as T;
   const result=demoVerification('supported');result.checks=result.checks.slice(0,1);result.checks[0].claimId=i.claims[0].id;return result as T;
  }},progress=>{last=progress;},()=>{});
  expect(last).toMatchObject({stage:'partial',completed:1,coverage:{[i.claims[0].id]:'reviewed'}});
 });
});
