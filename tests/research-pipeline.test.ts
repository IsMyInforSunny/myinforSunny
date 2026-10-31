import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import type {ResearchInput} from '../lib/research-contract';
import * as language from '../lib/server/language';
import * as news from '../lib/server/news';
import * as retrieval from '../lib/server/retrieval';
import * as searchBudget from '../lib/server/search-budget';
import {planResearch,discoverEvidence,compareEvidence,researchExcerpt} from '../lib/server/research';
import type {RuntimeConfig} from '../lib/server/config';
import {verifiedRecommendations,reliabilityReview} from '../lib/reliability';
const request=()=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':'192.0.2.1'}});
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-only-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
const input=():ResearchInput=>{const a=demoAnalysis('conflict');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};};
afterEach(()=>vi.restoreAllMocks());
function planner(i:ResearchInput){return vi.spyOn(language,'structured').mockResolvedValue({queries:[{claimId:i.claims[0].id,label:'운영 시간',query:'school library closing time',purpose:'fact_check'}]});}
describe('자동 조사 단계 연결 (모의 검색·모의 LLM, 실서비스 검증 아님)',()=>{
 it('의견만 있는 글도 다른 입장을 찾고 사실 판정 건수는 늘리지 않는다',async()=>{
  const a=demoAnalysis('no_comments');const i:ResearchInput={sources:a.sources,claims:[],position:a.claims[0],transmissionConsent:true,researchConsent:true};
  const llm=vi.spyOn(language,'structured').mockResolvedValue({queries:[{claimId:i.position!.id,label:'나무와 통행 공간',query:'school trees walking space objections',purpose:'perspective'}]});
  const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));expect(plan.claimCount).toBe(0);expect(plan.queries[0].purpose).toBe('perspective');
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school trees walking space objections',status:'success',articles:[{id:'a',title:'가상 다른 의견',url:'https://news.example/a',publisherDomain:'news.example',language:'Korean',provenance:'search_result',stance:'not_checked'}],searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const quote='학교 정원의 통행 공간을 확보하려면 나무를 더 심지 말아야 한다.';
  vi.spyOn(retrieval,'retrieve').mockResolvedValue({id:'web_0_0',text:quote,url:'https://news.example/a',provenance:'web_fetched',fetchedAt:new Date().toISOString(),truncated:false,fullTextLength:quote.length,extractionVersion:'mock'});
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));
  llm.mockResolvedValue({checks:[{claimId:i.position!.id,originMatches:true,outcome:'not_applicable',relations:[],explanation:'의견은 사실 판정 대상이 아닙니다.',temporalFit:'unclear',limitations:[]}],perspectives:[{referenceSentenceId:'web_0_0_s0',stance:'opposes_position',explanation:'나무 추가 대신 통행 공간 확보를 제안합니다.'}]});
  const v=await compareEvidence(request(),i,bundle.token,config,'opinion-test',AbortSignal.timeout(1000));
  expect(v.checks[0].execution).toBe('skipped');expect(v.perspectiveChecks?.[0].quote).toBe(quote);expect(verifiedRecommendations([v])[0].kind).toBe('opposing_view');expect(reliabilityReview({claims:[]},[v],'completed')).toMatchObject({status:'no_factual_claims',totalClaims:0,completedClaims:0,sourceCount:1});
 });
 it('검색 승인 전에는 외부 호출 없이 중단한다',async()=>{const call=vi.spyOn(language,'structured');await expect(planResearch(request(),input(),{...config,NEWS_TERMS_APPROVED:'false'},AbortSignal.timeout(1000))).rejects.toMatchObject({code:'RESEARCH_UNAVAILABLE'});expect(call).not.toHaveBeenCalled();});
 it('계획 원문 변경은 검색에 전달되지 않는다',async()=>{const i=input();planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));const search=vi.spyOn(news,'searchNews');const altered=structuredClone(i);altered.claims[0].text+=' 변경';await expect(discoverEvidence(request(),altered,plan.token,0,config,AbortSignal.timeout(1000))).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});expect(search).not.toHaveBeenCalled();});
 it('허용된 본문만 서명하고 대조 결과의 인용·위치를 보존한다',async()=>{
  const i=input(),llm=planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library closing time',status:'success',articles:[{id:'n0',title:'외부 출처',url:'https://other.example/a',publisherDomain:'other.example',language:'Korean',provenance:'search_result',stance:'not_checked'},{id:'n1',title:'가상 공지',url:'https://news.example/a',publisherDomain:'news.example',language:'Korean',provenance:'search_result',stance:'not_checked'}],searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const quote='도서관은 오후 9시에 문을 닫는다.';const text=`${quote} ${quote}`;
  const fetch=vi.spyOn(retrieval,'retrieve').mockResolvedValue({id:'web_0_0',text,url:'https://news.example/a',provenance:'web_fetched',fetchedAt:new Date().toISOString(),truncated:false,fullTextLength:text.length,extractionVersion:'mock-extractor'});
  const evidence=await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));
  expect(fetch).toHaveBeenCalledTimes(1);expect(evidence.attempts.some(a=>a.status==='disallowed')).toBe(true);expect(evidence.references[0]).toMatchObject({provenance:'web_fetched',excerptStart:0,excerptEnd:text.length});
  llm.mockResolvedValue({checks:[{claimId:i.claims[0].id,originMatches:true,outcome:'contradicted',relations:[{referenceSentenceId:'web_0_0_s1',relation:'contradicts',explanation:'운영 시간이 다릅니다.'}],explanation:'취득한 자료 범위에서 다름',temporalFit:'matched',limitations:[]}]});
  const result=await compareEvidence(request(),i,evidence.token,config,'test',AbortSignal.timeout(1000));
  expect(result.scope).toBe('retrieved_documents');expect(result.checks[0].outcome).toBe('contradicted');expect(result.checks[0].relations[0]).toMatchObject({quote,start:quote.length+1,end:text.length});
  const forged=evidence.token.slice(0,-4)+'abcd';await expect(compareEvidence(request(),i,forged,config,'test',AbortSignal.timeout(1000))).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
 });
 it('발췌는 관련 문맥을 선택하고 원래 위치를 정확히 보존한다',()=>{const text='일반 안내입니다. '.repeat(180)+'도서관 운영 시간은 오후 9시입니다.';const e=researchExcerpt(text,'도서관 운영 시간',1500);expect(e.start).toBeGreaterThan(0);expect(e.text).toContain('도서관 운영 시간');expect(text.slice(e.start,e.end)).toBe(e.text);expect(e.text.length).toBeLessThanOrEqual(1500);});
});
