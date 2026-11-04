import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import type {ResearchInput} from '../lib/research-contract';
import {importEvidence,compareEvidence,planResearch} from '../lib/server/research';
import {readResearchToken,digest} from '../lib/server/research-token';
import type {RuntimeConfig} from '../lib/server/config';
import * as runtime from '../lib/server/config';
import * as retrieval from '../lib/server/retrieval';
import * as language from '../lib/server/language';
import * as news from '../lib/server/news';
import * as searchBudget from '../lib/server/search-budget';
import {POST} from '../app/api/research/route';

const request=(actor='192.0.2.1')=>new Request('https://site.test/api/research',{headers:{'cf-connecting-ip':actor}});
const signal=()=>AbortSignal.timeout(2000);
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-only-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_NEWS_SEARCH:'false',ENABLE_DIRECT_FETCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example,second.example',DB:{} as D1Database};
const input=():ResearchInput=>{const a=demoAnalysis('conflict');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};};
const url='https://news.example/article';
const quote='도서관은 오후 9시에 문을 닫는다.';
function mockFetch(text=quote){
 vi.spyOn(searchBudget,'reserveSearch').mockResolvedValue(undefined);
 return vi.spyOn(retrieval,'retrieve').mockImplementation(async(address,id)=>({id,url:address,text,provenance:'web_fetched',title:'공개 합성 공지',publishedAt:'2026-01-01',fetchedAt:'2026-11-01T00:00:00Z',truncated:false,fullTextLength:text.length,extractionVersion:'synthetic-extractor'}));
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('검색과 독립적인 공개 URL 근거 연결 — 모의 공급자만 사용',()=>{
 it('검색·모델 호출 없이 서버 메타데이터와 원문 위치를 서명한다',async()=>{
  const i=input(),text='안내 문구. '.repeat(300)+quote;mockFetch(text);
  const search=vi.spyOn(news,'searchNews'),llm=vi.spyOn(language,'structured');
  const bundle=await importEvidence(request(),i,i.claims[0].id,[url],config,signal());
  expect(search).not.toHaveBeenCalled();expect(llm).not.toHaveBeenCalled();
  const ref=bundle.references[0];
  expect(ref).toMatchObject({provenance:'web_fetched',url,title:'공개 합성 공지',publisherDomain:'news.example',publishedAt:'2026-01-01',extractionVersion:'synthetic-extractor',fullTextLength:text.length,retrievedTextLength:text.length});
  expect(ref.contentDigest).toBe(await digest(text));
  expect(text.slice(ref.excerptStart,ref.excerptEnd)).toBe(ref.text);
  expect(bundle.attempts.every(a=>a.stage==='fetch')).toBe(true);
  const signed=await readResearchToken<{references:unknown[]}>(request(),config,bundle.token,'evidence');expect(signed.references).toEqual(bundle.references);
  expect(searchBudget.reserveSearch).toHaveBeenCalledWith(expect.any(Request),config,expect.any(String),expect.any(Number),'fetch');
 });
 it('직접 연결 근거를 같은 서명 대조 경로에서 사용하고 검색했다고 표시하지 않는다',async()=>{
  const i=input();mockFetch();const bundle=await importEvidence(request(),i,i.claims[0].id,[url],config,signal());
  const id=bundle.references[0].id;
  vi.spyOn(language,'structured').mockResolvedValue({checks:[{claimId:i.claims[0].id,originMatches:true,outcome:'contradicted',relations:[{referenceSentenceId:`${id}_s0`,relation:'contradicts',explanation:'운영 시간이 다릅니다.'}],explanation:'취득 자료 범위의 대조',temporalFit:'matched',limitations:[]}]});
  const result=await compareEvidence(request(),i,bundle.token,config,'direct-test',signal());
  expect(result.scope).toBe('retrieved_documents');expect(result.checks[0].relations[0]).toMatchObject({quote,start:0,end:quote.length});
  expect(result.warnings.find(w=>w.code==='RESEARCH_SCOPE')?.message).toContain('직접 연결한');
 });
 it('검색이 비활성 상태이면 자동 계획은 여전히 거부한다',async()=>{
  const llm=vi.spyOn(language,'structured');await expect(planResearch(request(),input(),config,signal())).rejects.toMatchObject({code:'RESEARCH_UNAVAILABLE'});expect(llm).not.toHaveBeenCalled();
 });
 it('명시 취득 승인·전송 동의·조사 대상이 없으면 네트워크 전에 거부한다',async()=>{
  const i=input(),fetch=mockFetch();
  for(const c of [{...config,ENABLE_DIRECT_FETCH:'false'},{...config,NEWS_TERMS_APPROVED:'false'},{...config,ENABLE_LIVE_ANALYSIS:'false'}])await expect(importEvidence(request(),i,i.claims[0].id,[url],c,signal())).rejects.toMatchObject({code:'RESEARCH_UNAVAILABLE'});
  await expect(importEvidence(request(),{...i,researchConsent:false} as unknown as ResearchInput,i.claims[0].id,[url],config,signal())).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await expect(importEvidence(request(),i,'invented',[url],config,signal())).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  await expect(importEvidence(request(),i,i.claims[0].id,[url,url,url],config,signal())).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  expect(fetch).not.toHaveBeenCalled();expect(searchBudget.reserveSearch).not.toHaveBeenCalled();
 });
 it('내부 주소·자격 증명·비허용 주소·인코딩된 연락처는 취득 전에 거부한다',async()=>{
  const i=input(),fetch=mockFetch();
  for(const address of ['http://news.example/a','http://127.0.0.1/a','https://news.example.evil/a','https://person:password@news.example/a','https://news.example:8443/a','https://news.example/a?email=person%40example.com'])await expect(importEvidence(request(),i,i.claims[0].id,[address],config,signal())).rejects.toMatchObject({status:422});
  expect(fetch).not.toHaveBeenCalled();expect(searchBudget.reserveSearch).not.toHaveBeenCalled();
 });
 it('추적 주소 중복을 제거하고 동일 요청의 예산 ID를 안정적으로 유지한다',async()=>{
  const i=input(),fetch=mockFetch();
  const urls=[`${url}?utm_source=example`,`${url}/#heading`];
  const a=await importEvidence(request(),i,i.claims[0].id,urls,config,signal());
  expect(fetch).toHaveBeenCalledTimes(1);expect(a.references).toHaveLength(1);expect(a.attempts.some(a=>a.status==='disallowed')).toBe(true);
  await importEvidence(request(),i,i.claims[0].id,[...urls].reverse(),config,signal());
  const calls=vi.mocked(searchBudget.reserveSearch).mock.calls;expect(calls[0][2]).toBe(calls[1][2]);
  await importEvidence(request('192.0.2.2'),i,i.claims[0].id,urls,config,signal());expect(calls[0][2]).not.toBe(vi.mocked(searchBudget.reserveSearch).mock.calls[2][2]);
 });
 it('복제 본문은 두 개의 독립 근거로 세지 않는다',async()=>{
  const i=input();mockFetch(quote.repeat(20));
  const bundle=await importEvidence(request(),i,i.claims[0].id,[url,'https://second.example/a'],config,signal());
  expect(bundle.references).toHaveLength(1);expect(bundle.attempts.some(a=>a.reason?.includes('독립 근거'))).toBe(true);
 });
 it('변경된 입력·다른 사용자·위조 토큰은 모델 대조에 전달하지 않는다',async()=>{
  const i=input();mockFetch();const bundle=await importEvidence(request(),i,i.claims[0].id,[url],config,signal());const llm=vi.spyOn(language,'structured');
  const changed=structuredClone(i);changed.claims[0].text+=' 변경';
  await expect(compareEvidence(request(),changed,bundle.token,config,'changed',signal())).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  await expect(compareEvidence(request('192.0.2.2'),i,bundle.token,config,'actor',signal())).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
  await expect(compareEvidence(request(),i,bundle.token.slice(0,-4)+'abcd',config,'forged',signal())).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
  expect(llm).not.toHaveBeenCalled();
 });
 it('비교 명제 ID가 실제 사실 주장 ID와 겹치면 구분한다',async()=>{
  const i=input();i.claims[0].id='comparison_position';i.proposition='도서관 시간을 늘려야 한다.';mockFetch();
  const bundle=await importEvidence(request(),i,'comparison_position_',[url],config,signal());expect(bundle.claimId).toBe('comparison_position_');
 });
 it('빈 취득 결과를 지지·반박 자료로 꾸미지 않는다',async()=>{
  const i=input();mockFetch().mockResolvedValue(null);
  const bundle=await importEvidence(request(),i,i.claims[0].id,[url],config,signal());expect(bundle.references).toEqual([]);
  await expect(compareEvidence(request(),i,bundle.token,config,'empty',signal())).rejects.toMatchObject({code:'RESEARCH_NO_EVIDENCE'});
 });
 it('API는 검색 비활성 상태에서 import를 허용하고 초과 URL·위조 provenance를 거부한다',async()=>{
  const i=input(),fetch=mockFetch();vi.spyOn(runtime,'runtimeConfig').mockResolvedValue(config);
  const call=(body:unknown)=>POST(new Request('https://site.test/api/research',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(body)}));
  const valid={operation:'import',input:i,claimId:i.claims[0].id,urls:[url]};
  expect((await call(valid)).status).toBe(200);
  expect((await call({...valid,urls:[url,url,url]})).status).toBe(422);
  expect((await call({...valid,provenance:'web_fetched'})).status).toBe(422);
  expect((await call({...valid,input:{...i,transmissionConsent:false}})).status).toBe(422);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
});
