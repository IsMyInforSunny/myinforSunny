import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {demoAnalysis} from '../lib/fixtures';
import {locate,makeSources} from '../lib/domain';
import {researchProposition,researchRequestTimeout,verifiedRecommendations} from '../lib/reliability';
import type {Analysis,Capabilities} from '../lib/contracts';
import type {ResearchVerification,SourcePerspective} from '../lib/research-contract';
import DirectEvidence from '../components/direct-evidence';

function analysis():Analysis{
 const result=structuredClone(demoAnalysis('supported'));
 result.mode='live';result.analysisId='body-position-current';result.proposition=undefined;
 result.sources=makeSources({kind:'text',body:'학교 도서관 운영 시간을 늘려야 한다.',comments:[{id:'comment-input',text:'운영 시간을 늘릴 필요가 없다.'}]});
 result.claims=[];
 const body=result.sources[0];
 result.bodyPosition={proposition:'학교 도서관 운영 시간을 늘려야 한다.',label:'support',evidence:[locate(result.sources,{sentenceId:body.sentences[0].id,quote:body.text})!],reason:'본문에 제안이 명시되어 있습니다.'};
 return result;
}
function verification(a:Analysis,stance:SourcePerspective['stance']='opposes_position'):ResearchVerification{
 const text='도서관 운영 시간의 변경 조건을 검토한다.';
 return {schemaVersion:'2.1',requestId:'synthetic-recommendation',parentAnalysisId:a.analysisId,mode:'live',status:'success',versions:{rubric:'test',prompt:'test',model:'mock',retriever:'mock'},scope:'retrieved_documents',references:[{id:'ref-body-position',provenance:'web_fetched',url:'https://news.example/body-position',text,title:'공개 합성 자료',truncated:false}],checks:[],perspectiveChecks:[{referenceId:'ref-body-position',positionText:a.bodyPosition!.proposition,stance,quote:text,start:0,end:text.length,explanation:'시험용 입장 근거'}],attempts:[],warnings:[],createdAt:'2026-11-10T00:00:00Z'};
}

describe('본문 입장 근거에 연결된 조사 명제와 추천',()=>{
 it('사실·의견 주장 추출이 없어도 본문 근거의 명제를 조사 대상으로 사용한다',()=>{
  const a=analysis(),v=verification(a);
  expect(researchProposition(a)).toBe(a.bodyPosition!.proposition);
  expect(verifiedRecommendations([v],a)[0]).toMatchObject({kind:'opposing_view',relationToArticle:'opposing'});
 });
 it('사용자가 직접 정한 명제를 우선하며 다른 본문 명제의 입장을 섞지 않는다',()=>{
  const a=analysis(),v=verification(a);a.proposition='학교 도서관은 주말에도 운영해야 한다.';
  expect(researchProposition(a)).toBe(a.proposition);
  expect(verifiedRecommendations([v],a)).toEqual([]);
 });
 it.each(['wrong-quote','fractional-span','comment-span','missing-evidence','empty-proposition'] as const)('본문 명제의 %s 근거를 조사·추천에 사용하지 않는다',change=>{
  const a=analysis(),v=verification(a);
  if(change==='wrong-quote')a.bodyPosition!.evidence[0].quote='원문에 없는 문장';
  if(change==='fractional-span')a.bodyPosition!.evidence[0].start+=0.1;
  if(change==='comment-span'){
   const comment=a.sources[1];a.bodyPosition!.evidence=[locate(a.sources,{sentenceId:comment.sentences[0].id,quote:comment.text})!];
  }
  if(change==='missing-evidence')a.bodyPosition!.evidence=[];
  if(change==='empty-proposition')a.bodyPosition!.proposition=' ';
  expect(researchProposition(a)).toBeUndefined();expect(verifiedRecommendations([v],a)).toEqual([]);
 });
 it('과거 분석·미연결 결과와 다른 명제 또는 위조 외부 인용을 제외한다',()=>{
  const a=analysis(),base=verification(a);
  for(const parentAnalysisId of ['old-analysis',undefined])expect(verifiedRecommendations([{...base,parentAnalysisId}],a)).toEqual([]);
  const unrelated=structuredClone(base);unrelated.perspectiveChecks![0].positionText='급식 정책을 바꿔야 한다.';
  expect(verifiedRecommendations([unrelated],a)).toEqual([]);
  const forged=structuredClone(base);forged.perspectiveChecks![0].end+=1;
  expect(verifiedRecommendations([forged],a)).toEqual([]);
 });
 it('본문이 명제에 반대하면 명제 지지 기사는 본문과 반대, 명제 반대 기사는 본문과 유사하다',()=>{
  const a=analysis();a.bodyPosition!.label='oppose';
  const supports=verification(a,'supports_position'),opposes=verification(a,'opposes_position');
  opposes.references[0].url='https://news.example/same-position';
  const cards=verifiedRecommendations([opposes,supports],a);
  expect(cards.map(card=>[card.kind,card.relationToArticle])).toEqual([['supporting_view','opposing'],['opposing_view','similar']]);
 });
 it.each(['mixed','not_expressed','undetermined'] as const)('본문 입장 %s는 방향의 유사·반대를 확정하지 않는다',label=>{
  const a=analysis();a.bodyPosition!.label=label;
  expect(verifiedRecommendations([verification(a)],a)[0]).toMatchObject({kind:'opposing_view',relationToArticle:'unclassified'});
  expect(verifiedRecommendations([verification(a,'adds_context')],a)[0]).toMatchObject({kind:'context',relationToArticle:'context'});
 });
 it('본문 입장 필드가 없는 기존 분석도 명시한 비교 명제로 추천한다',()=>{
  const a=analysis(),v=verification(a);a.proposition=a.bodyPosition!.proposition;delete a.bodyPosition;
  expect(verifiedRecommendations([v],a)[0]).toMatchObject({kind:'opposing_view',relationToArticle:'unclassified'});
 });
 it('직접 주소 대조에서도 본문 근거의 비교 명제를 선택할 수 있다',()=>{
  const a=analysis();const cap={live:true,webSearch:false,webFetch:true,directFetch:true,aiProvider:'nvidia'} as Capabilities;
  const html=renderToStaticMarkup(createElement(DirectEvidence,{analysis:a,cap,locked:false,onBusy:()=>{},onProgress:()=>{},onResult:()=>{}}));
  expect(html).toContain(`비교 명제: ${a.bodyPosition!.proposition}`);
 });
});

describe('조사 클라이언트 제한 시간',()=>{
 it('NVIDIA 서버의 600초 요청을 기다리되 Groq와 미확인 제공자는 60초를 유지한다',()=>{
  expect(researchRequestTimeout({aiProvider:'nvidia'})).toBe(660_000);
  expect(researchRequestTimeout({aiProvider:'groq'})).toBe(60_000);
  expect(researchRequestTimeout(undefined)).toBe(60_000);
 });
});
