import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {researchInputSchema,type ResearchInput} from '../lib/research-contract';
import {planResearch,discoverEvidence,compareEvidence} from '../lib/server/research';
import {verify} from '../lib/server/verify';
import * as language from '../lib/server/language';
import * as news from '../lib/server/news';
import * as retrieval from '../lib/server/retrieval';
import * as searchBudget from '../lib/server/search-budget';
import {reliabilityReview,verifiedRecommendations} from '../lib/reliability';
import {articleMapPoints} from '../lib/reader-metrics';
import type {RuntimeConfig} from '../lib/server/config';

const proposition='학교 도서관 운영 시간을 늘려야 한다.';
const request=()=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':'192.0.2.10'}});
const signal=()=>AbortSignal.timeout(2000);
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-only-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
function input(factual=false):ResearchInput{
 const a=demoAnalysis('supported');
 return {sources:a.sources,claims:factual?a.claims.filter(c=>c.kind==='factual'):[],proposition,transmissionConsent:true,researchConsent:true};
}
function planner(){
 return vi.spyOn(language,'structured').mockImplementation(async(_c,_schema,_prompt,payload)=>{
  const data=payload as {claims:{id:string}[];position:{id:string;text:string;source:string}|null};
  return {queries:[...data.claims.map(c=>({claimId:c.id,label:'도서관 시간',query:'school library hours',purpose:'fact_check'})),...(data.position?[{claimId:data.position.id,label:'운영 시간 연장',query:'school library extended hours viewpoints',purpose:'perspective'}]:[])]};
 });
}
function articles(text='학교 도서관 운영 시간을 늘려야 한다.'){
 vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
 vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library extended hours viewpoints',status:'success',articles:[{id:'n',title:'공개 합성 의견',url:'https://news.example/position',publisherDomain:'news.example',language:'Korean',provenance:'search_result',stance:'not_checked'}],searchedAt:new Date().toISOString(),scopeNote:'모의 응답'});
 vi.spyOn(retrieval,'retrieve').mockResolvedValue({id:'web_0_0',url:'https://news.example/position',text,provenance:'web_fetched',fetchedAt:new Date().toISOString(),truncated:false});
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('직접 지정한 비교 명제의 자동 조사 연결 — 외부 호출 없는 모의 시험',()=>{
 it('추출된 사실·의견이 없어도 명제를 받되 빈 값·길이 초과는 거부한다',()=>{
  expect(researchInputSchema.safeParse(input()).success).toBe(true);
  for(const value of [undefined,'   ','가'.repeat(161)])expect(researchInputSchema.safeParse({...input(),proposition:value}).success).toBe(false);
 });
 it('실제 주장 ID와 겹치지 않는 의견 탐색을 추가하고 사실 주장 수는 유지한다',async()=>{
  const i=input(true);i.claims[0].id='comparison_position';const llm=planner();
  const plan=await planResearch(request(),i,config,signal());
  expect(plan.claimCount).toBe(1);
  expect(plan.queries.map(q=>[q.claimId,q.purpose])).toEqual([['comparison_position','fact_check'],['comparison_position_','perspective']]);
  const payload=llm.mock.calls[0][3] as {position:{text:string;source:string}};
  expect(payload.position).toMatchObject({text:proposition,source:'user_selected'});
 });
 it('추출 의견도 있어도 직접 지정한 명제를 비교 기준으로 우선한다',async()=>{
  const opinion=demoAnalysis('no_comments');const i={...input(),sources:opinion.sources,position:opinion.claims[0]};const llm=planner();
  const plan=await planResearch(request(),i,config,signal());
  expect(plan.queries).toHaveLength(1);
  expect((llm.mock.calls[0][3] as {position:{text:string}}).position.text).toBe(proposition);
 });
 it('명제를 바꾸면 이전 계획·취득 자료를 재사용하지 못한다',async()=>{
  const i=input();const llm=planner();const plan=await planResearch(request(),i,config,signal());articles();
  const altered={...i,proposition:'학교 도서관 주말 운영을 시작해야 한다.'};
  await expect(discoverEvidence(request(),altered,plan.token,0,config,signal())).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  expect(news.searchNews).not.toHaveBeenCalled();
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,signal());
  await expect(compareEvidence(request(),altered,bundle.token,config,'changed',signal())).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  expect(llm).toHaveBeenCalledTimes(1);
 });
 it('명제만 조사한 결과는 사실 판정 0개로 두고 실제 인용만 추천·좌표에 연결한다',async()=>{
  const i=input(),llm=planner();const plan=await planResearch(request(),i,config,signal());articles();
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,signal());
  llm.mockResolvedValue({checks:[],perspectives:[{referenceSentenceId:'web_0_0_s0',stance:'supports_position',explanation:'운영 연장에 대한 명시적인 제안이다.'}]});
  const result=await compareEvidence(request(),i,bundle.token,config,'proposition-only',signal());
  const a={...demoAnalysis('supported'),mode:'live' as const,analysisId:'proposition_only',claims:[],proposition};
  const bound={...result,parentAnalysisId:a.analysisId};
  expect(result.checks).toEqual([]);
  expect(result.perspectiveChecks?.[0]).toMatchObject({positionText:proposition,quote:proposition,start:0,end:proposition.length});
  expect(reliabilityReview(a,[bound],'completed')).toMatchObject({totalClaims:0,completedClaims:0,sourceCount:1});
  expect(verifiedRecommendations([bound],a)[0]).toMatchObject({kind:'supporting_view',quote:proposition});
  expect(articleMapPoints(a,[bound])[0]).toMatchObject({position:proposition,stance:'supports_position',evidence:'unreviewed',claimCount:0});
  const payload=llm.mock.calls.at(-1)![3] as {claims:unknown[];position:string};
  expect(payload).toMatchObject({claims:[],position:proposition});
 });
 it('사실 대조에도 같은 비교 명제를 전달하고 수치 상충과 의견 입장을 분리한다',async()=>{
  const i=input(true),llm=planner();const plan=await planResearch(request(),i,config,signal());
  const quote='학교 도서관은 오후 9시에 닫는다. 운영 시간을 늘릴 필요는 없다.';articles(quote);
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,signal());
  llm.mockResolvedValue({checks:[{claimId:i.claims[0].id,originMatches:true,outcome:'contradicted',relations:[{referenceSentenceId:'web_0_0_s0',relation:'contradicts',explanation:'같은 기간의 운영 시간이 다르다.'}],explanation:'취득한 공개 합성 자료와 수치가 다르다.',temporalFit:'matched',limitations:[]}],perspectives:[{referenceSentenceId:'web_0_0_s1',stance:'opposes_position',explanation:'연장 필요성을 명시적으로 부정한다.'}]});
  const result=await compareEvidence(request(),i,bundle.token,config,'fact-and-position',signal());
  expect(result.checks).toHaveLength(1);expect(result.checks[0].claimId).toBe(i.claims[0].id);expect(result.checks[0].outcome).toBe('contradicted');
  expect(result.perspectiveChecks?.[0]).toMatchObject({positionText:proposition,stance:'opposes_position',quote:'운영 시간을 늘릴 필요는 없다.'});
 });
 it('사실 주장 5개와 비교 명제도 기존의 최대 6개 조사 계획 안에서 처리한다',async()=>{
  const i=input(true);i.claims=Array.from({length:5},(_,n)=>({...i.claims[0],id:`c${n}`}));planner();
  const plan=await planResearch(request(),i,config,signal());
  expect(plan.claimCount).toBe(5);expect(plan.queries).toHaveLength(6);
 });
 it('명제를 사실 주장으로 바꾼 잘못된 조사 계획은 거부한다',async()=>{
  vi.spyOn(language,'structured').mockResolvedValue({queries:[{claimId:'comparison_position',label:'잘못된 계획',query:'school library hours',purpose:'fact_check'}]});
  await expect(planResearch(request(),input(),config,signal())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
 });
 it('비교 명제의 개인정보도 계획 모델에 전달하기 전에 차단한다',async()=>{
  const llm=vi.spyOn(language,'structured');
  await expect(planResearch(request(),{...input(),proposition:'test@example.com에 연락해야 한다.'},config,signal())).rejects.toMatchObject({code:'PRIVACY_INPUT_REJECTED'});
  expect(llm).not.toHaveBeenCalled();
 });
 it('취득 자료·비교 명제 없는 빈 사실 대조를 허용하지 않는다',async()=>{
  const i=input();const llm=vi.spyOn(language,'structured');
  await expect(verify({kind:'text',sources:i.sources,claims:[],references:[],useWebSearch:false},config,'empty',signal())).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  expect(llm).not.toHaveBeenCalled();
 });
 it('실제 스키마·토큰 사전 검사로도 명제만 있는 계획과 입장 대조가 가능하다',async()=>{
  const response=(content:unknown)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
  const call=vi.fn().mockResolvedValueOnce(response({queries:[{claimId:'comparison_position',label:'운영 연장',query:'school library extended hours',purpose:'perspective'}]})).mockResolvedValueOnce(response({checks:[],perspectives:[{referenceSentenceId:'r1_s0',stance:'supports_position',explanation:'명시적인 운영 연장 의견이다.'}]}));
  vi.stubGlobal('fetch',call);const i=input();
  expect((await planResearch(request(),i,config,signal())).claimCount).toBe(0);
  const result=await verify({kind:'text',sources:i.sources,claims:[],references:[],useWebSearch:false},config,'schema-and-budget',signal(),[{id:'r1',text:proposition,url:'https://news.example/position',provenance:'web_fetched',truncated:false}],proposition);
  expect(result.checks).toEqual([]);expect(result.perspectiveChecks?.[0].quote).toBe(proposition);
  expect(call).toHaveBeenCalledTimes(2);
  for(const args of call.mock.calls)expect(JSON.parse(args[1].body)).toMatchObject({max_completion_tokens:2000});
 });
 it('명제만 검토할 때 모델이 만든 가상 사실 판정을 스키마에서 거부한다',async()=>{
  const call=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({checks:[{claimId:'no_factual_claims',originMatches:true,outcome:'supported',relations:[],explanation:'만들어낸 판정',temporalFit:'matched',limitations:[]}],perspectives:[]})}}]}));
  vi.stubGlobal('fetch',call);const i=input();
  await expect(verify({kind:'text',sources:i.sources,claims:[],references:[],useWebSearch:false},config,'invented-check',signal(),[{id:'r1',text:proposition,url:'https://news.example/position',provenance:'web_fetched',truncated:false}],proposition)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(call).toHaveBeenCalledTimes(1);
 });
});
