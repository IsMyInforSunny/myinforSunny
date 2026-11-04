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
import {makeSources} from '../lib/domain';
import {AppError} from '../lib/server/errors';
const request=()=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':'192.0.2.1'}});
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-only-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
const input=():ResearchInput=>{const a=demoAnalysis('conflict');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};};
afterEach(()=>vi.restoreAllMocks());
function planner(i:ResearchInput){return vi.spyOn(language,'structured').mockResolvedValue({queries:[{claimId:i.claims[0].id,label:'운영 시간',query:'school library closing time',purpose:'fact_check'}]});}
describe('자동 조사 단계 연결 (모의 검색·모의 LLM, 실서비스 검증 아님)',()=>{
 it.each(['SEARCH_LOCK_BUSY','SEARCH_RATE_LIMITED','SEARCH_UNAVAILABLE'])('예약 복원은 실제 전송 전 잠금 실패에만 적용한다 (%s)',async code=>{
  const i=input();planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));
  const reserve=vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined),release=vi.spyOn(searchBudget,'releaseSearch').mockResolvedValue(undefined);
  const search=vi.spyOn(news,'searchNews').mockRejectedValue(new AppError(429,code,'공개 합성 오류'));
  await expect(discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000))).rejects.toMatchObject({code});
  expect(search).toHaveBeenCalledTimes(1);
  if(code==='SEARCH_LOCK_BUSY')expect(release).toHaveBeenCalledWith(expect.any(Request),config,reserve.mock.calls[0][2]);
  else expect(release).not.toHaveBeenCalled();
 });
 it('한국어 기관명·핵심어를 계획 토큰부터 실제 검색 호출까지 보존한다',async()=>{
  const i=input(),query='통계청 도서관 운영 2025'.normalize('NFD');
  const llm=vi.spyOn(language,'structured').mockResolvedValue({queries:[{claimId:i.claims[0].id,label:'운영 시간',query,purpose:'fact_check'}]});
  const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));
  expect(plan.queries[0].query).toBe(query.normalize('NFC'));
  expect(llm.mock.calls[0][2]).toContain('한국어 기관명');
  expect(llm.mock.calls[0][2]).not.toContain('검색어 하나를 영문으로');
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  const search=vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query,status:'empty',articles:[],searchedAt:new Date().toISOString(),scopeNote:'모의'});
  await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));
  expect(search.mock.calls[0][0]).toBe(query.normalize('NFC'));
 });
 it('기사에 명시된 1차 출처를 같은 계획 호출의 미검증 힌트로 연결한다',async()=>{
  const body='통계청에 따르면 2025년 조사에서 인구가 10% 증가했다.';
  const sources=makeSources({kind:'text',body,comments:[]});const sentence=sources[0].sentences[0];
  const i:ResearchInput={sources,claims:[{id:'c1',text:'인구가 10% 증가했다.',kind:'factual',origin:[{sourceId:sources[0].id,sentenceId:sentence.id,start:0,end:body.length,quote:body}]}],transmissionConsent:true,researchConsent:true};
  const llm=planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));
  expect(llm).toHaveBeenCalledTimes(1);expect(plan.queries).toHaveLength(1);
  const payload=llm.mock.calls[0][3] as {claims:{citedSources:unknown[]}[]};
  expect(payload.claims[0].citedSources).toEqual([{name:'통계청',type:'official_statistics',primary:true,documentNamed:true,dated:true}]);
  expect(llm.mock.calls[0][2]).toContain('실제 존재나 사실성을 보장하지 않는다');
 });
 it('익명·출처 없는 전언은 검색 기관으로 꾸미지 않는다',async()=>{
  const body='관계자에 따르면 인구가 10% 증가했다.';
  const sources=makeSources({kind:'text',body,comments:[]});const sentence=sources[0].sentences[0];
  const i:ResearchInput={sources,claims:[{id:'c1',text:'인구가 10% 증가했다.',kind:'factual',origin:[{sourceId:sources[0].id,sentenceId:sentence.id,start:0,end:body.length,quote:body}]}],transmissionConsent:true,researchConsent:true};
  const llm=planner(i);await planResearch(request(),i,config,AbortSignal.timeout(1000));
  const payload=llm.mock.calls[0][3] as {claims:{citedSources:unknown[]}[]};
  expect(payload.claims[0].citedSources).toEqual([]);
 });
 it('서로 다른 매체를 우선하고 같은 본문 전재 후보를 독립 근거로 늘리지 않는다',async()=>{
  const i=input();planner(i);const c={...config,ALLOWED_RETRIEVAL_HOSTS:'news.example,second.example'};const plan=await planResearch(request(),i,c,AbortSignal.timeout(1000));
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  const articles=['https://news.example/a','https://news.example/b','https://second.example/c'].map((url,index)=>({id:`n${index}`,title:'가상 자료',url,publisherDomain:new URL(url).hostname,language:'Korean',provenance:'search_result' as const,stance:'not_checked' as const}));
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library time',status:'success',articles,searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const text='도서관 운영 시간에 관한 가상 보도자료입니다. '.repeat(20);
  const fetch=vi.spyOn(retrieval,'retrieve').mockImplementation(async(url,id)=>({id,url,text,provenance:'web_fetched',fetchedAt:'2026-11-01T00:00:00Z',truncated:false}));
  const evidence=await discoverEvidence(request(),i,plan.token,0,c,AbortSignal.timeout(1000));
  expect(fetch.mock.calls.map(call=>call[0])).toEqual(['https://news.example/a','https://second.example/c']);expect(evidence.references).toHaveLength(1);expect(evidence.attempts.some(a=>a.reason?.includes('중복 후보'))).toBe(true);
 });
 it('자료 발행일과 잘림 메타데이터를 서명된 발췌에 유지한다',async()=>{
  const i=input();planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'firecrawl',query:'school library time',status:'success',articles:[{id:'n',title:'검색 제목',url:'https://news.example/a',publisherDomain:'news.example',language:'not_verified',provenance:'search_result',stance:'not_checked'}],searchedAt:new Date().toISOString(),scopeNote:'모의'});
  vi.spyOn(retrieval,'retrieve').mockResolvedValue({id:'web_0_0',url:'https://news.example/a',text:'도서관은 오후 9시에 문을 닫는다.',title:'취득 제목',provenance:'web_fetched',publishedAt:'2025-03-01T00:00:00Z',fetchedAt:'2026-11-01T00:00:00Z',truncated:true,fullTextLength:9000});
  const evidence=await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));expect(evidence.references[0]).toMatchObject({title:'취득 제목',publishedAt:'2025-03-01T00:00:00Z',truncated:true,fullTextLength:9000,extractionVersion:'firecrawl-markdown-1.0'});
 });
 it('같은 매체의 명시 별칭 두 곳이 두 번의 취득 예산을 차지하지 않는다',async()=>{
  const i=input();planner(i);const c={...config,ALLOWED_RETRIEVAL_HOSTS:'news.donga.com,donga.com,hani.co.kr'};
  const plan=await planResearch(request(),i,c,AbortSignal.timeout(1000));
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  const urls=['https://news.donga.com/a','https://donga.com/b','https://hani.co.kr/c'];
  const articles=urls.map((url,index)=>({id:`n${index}`,title:'가상 자료',url,publisherDomain:new URL(url).hostname,language:'Korean',provenance:'search_result' as const,stance:'not_checked' as const}));
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library time',status:'success',articles,searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const fetch=vi.spyOn(retrieval,'retrieve').mockImplementation(async(url,id)=>({id,url,text:url.includes('hani')?'지역 청소년이 이용한 도서관 현황에 관한 가상 공지입니다.':'운영 시간을 연장하는 학교의 가상 보도자료입니다.',provenance:'web_fetched',fetchedAt:'2026-11-01T00:00:00Z',truncated:false}));
  const bundle=await discoverEvidence(request(),i,plan.token,0,c,AbortSignal.timeout(1000));
  expect(fetch.mock.calls.map(call=>call[0])).toEqual([urls[0],urls[2]]);
  expect(bundle.references).toHaveLength(2);
 });
 it('추적 매개변수·fragment·끝 슬래시만 다른 같은 기사 주소는 다시 취득하지 않는다',async()=>{
  const i=input();planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  const urls=['https://news.example/a?id=1&utm_source=test','https://news.example/a/?id=1#headline','https://news.example/b'];
  const articles=urls.map((url,index)=>({id:`n${index}`,title:'가상 자료',url,publisherDomain:'news.example',language:'Korean',provenance:'search_result' as const,stance:'not_checked' as const}));
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library time',status:'success',articles,searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const fetch=vi.spyOn(retrieval,'retrieve').mockImplementation(async(url,id)=>({id,url,text:url.endsWith('/b')?'지역 어린이 독서 실태를 기록한 가상 자료입니다.':'도서관 운영 시간을 알리는 가상 자료입니다.',provenance:'web_fetched',fetchedAt:'2026-11-01T00:00:00Z',truncated:false}));
  const bundle=await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));
  expect(fetch.mock.calls.map(call=>call[0])).toEqual([urls[0],urls[2]]);
  expect(bundle.attempts.some(a=>a.url===urls[1]&&a.status==='disallowed'&&a.reason?.includes('같은 주소'))).toBe(true);
 });
 it('허용되지 않은 별칭 주소가 같은 주소의 허용된 후보를 숨기지 않는다',async()=>{
  const i=input();planner(i);const plan=await planResearch(request(),i,config,AbortSignal.timeout(1000));
  vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
  const urls=['https://www.news.example/a','https://news.example/a'];
  const articles=urls.map((url,index)=>({id:`n${index}`,title:'가상 자료',url,publisherDomain:new URL(url).hostname,language:'Korean',provenance:'search_result' as const,stance:'not_checked' as const}));
  vi.spyOn(news,'searchNews').mockResolvedValue({provider:'gdelt',query:'school library time',status:'success',articles,searchedAt:new Date().toISOString(),scopeNote:'모의'});
  const fetch=vi.spyOn(retrieval,'retrieve').mockImplementation(async(url,id)=>({id,url,text:'학교 도서관의 가상 운영 공지입니다.',provenance:'web_fetched',fetchedAt:'2026-11-01T00:00:00Z',truncated:false}));
  await discoverEvidence(request(),i,plan.token,0,config,AbortSignal.timeout(1000));
  expect(fetch.mock.calls.map(call=>call[0])).toEqual([urls[1]]);
 });
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
