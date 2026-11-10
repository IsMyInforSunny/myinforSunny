import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CanvaDashboard from '../components/canva-dashboard';
import {demoAnalysis} from '../lib/fixtures';
import {locate,makeSources} from '../lib/domain';
import type {Analysis,BodyPosition} from '../lib/contracts';
import type {BiasClassifierEvidence,BiasOrientationSet} from '../lib/bias-analysis';

function article(body:string,comments:string[]=[]):Analysis{
 const analysis=structuredClone(demoAnalysis('supported'));analysis.mode='live';
 delete analysis.bodyPosition;delete analysis.proposition;delete analysis.stances;
 analysis.sources=makeSources({kind:'text',body,comments:comments.map((text,i)=>({id:`reader_${i}`,text}))});
 analysis.claims=analysis.sources[0].sentences.map((unit,i)=>({id:`claim_${i}`,text:body.slice(unit.start,unit.end),kind:'factual',origin:[locate(analysis.sources,{sentenceId:unit.id,quote:body.slice(unit.start,unit.end)})!]}));
 analysis.expressions=analysis.sources.flatMap(source=>source.sentences.map(unit=>({sourceId:source.id,sentenceId:unit.id,status:'clear',criteria:[],context:'direct',evidence:[]})));
 return analysis;
}
function setPosition(analysis:Analysis,label:BodyPosition['label']='support',proposition=analysis.sources[0].text){
 const body=analysis.sources[0],unit=body.sentences[0];
 analysis.bodyPosition={proposition,label,evidence:[locate(analysis.sources,{sentenceId:unit.id,quote:body.text.slice(unit.start,unit.end)})!],reason:'본문의 제안과 인용을 함께 검토한 결과입니다.'};
}
const render=(analysis:Analysis,extra:Partial<Parameters<typeof CanvaDashboard>[0]>={})=>renderToStaticMarkup(createElement(CanvaDashboard,{analysis,researchResults:[],onEvidence:()=>{},onArticles:()=>{},onCoordinates:()=>{},...extra}));
const argumentAxis=(html:string)=>html.match(/<div[^>]*role="img"[\s\S]*?<\/div>/)?.[0]??'';

describe('기사 본문을 중심으로 한 대시보드 표시',()=>{
 it('기본 논점 관점과 준비되지 않은 정치 모델을 구분하며 좌표를 만들지 않는다',()=>{
  const html=render(article('공개 가상 기사다.'),{availability:{biasModelReady:false,articleResearchReady:false}});
  expect(html).toContain('논점 관점');expect(html).toContain('본문 입장 분석 대기');
  expect(argumentAxis(html)).not.toContain('studio-axis-marker');
  expect(html).toContain('검증된 SVM 모델 준비 중');expect(html).toContain('검색과 원문 연결 준비 중');expect(html).toContain('현재 PCA는 연구용');
 });
 it('유효한 본문 입장 인용을 화살표와 원문 근거로 표시한다',()=>{
  const analysis=article('학교 도서관 운영 시간을 늘려야 한다.');setPosition(analysis);
  const html=render(analysis);
  expect(argumentAxis(html)).toContain('반대부터 찬성 · 찬성 관점');expect(argumentAxis(html)).toContain('studio-axis-marker');
  expect(html).toContain('비교 논점 · 학교 도서관 운영 시간을 늘려야 한다.');expect(html).toContain('본문의 제안과 인용을 함께 검토한 결과입니다.');
 });
 it('본문과 반대인 댓글 입장이 본문 방향을 대신하지 않는다',()=>{
  const analysis=article('학교 도서관 운영 시간을 늘려야 한다.',['운영 시간을 늘릴 필요가 없다.']);setPosition(analysis);
  const comment=analysis.sources[1];analysis.stances=[{sourceId:comment.id,label:'oppose',evidence:[locate(analysis.sources,{sentenceId:comment.sentences[0].id,quote:comment.text})!]}];
  expect(argumentAxis(render(analysis))).toContain('찬성 관점');delete analysis.bodyPosition;
  expect(argumentAxis(render(analysis))).toContain('본문 입장 분석 대기');expect(argumentAxis(render(analysis))).not.toContain('studio-axis-marker');
 });
 it('명시한 비교 명제가 있어도 댓글 인용을 본문 입장 근거로 승격하지 않는다',()=>{
  const analysis=article('새 기술의 도입 조건을 살펴본다.',['새 기술 도입에 찬성한다.']);setPosition(analysis);analysis.proposition=analysis.bodyPosition!.proposition;
  const comment=analysis.sources[1];analysis.bodyPosition!.evidence=[locate(analysis.sources,{sentenceId:comment.sentences[0].id,quote:comment.text})!];
  expect(argumentAxis(render(analysis))).not.toContain('studio-axis-marker');expect(argumentAxis(render(analysis))).toContain('본문 입장 분석 대기');
 });
 it.each([
  ['인공지능 숙제의 전면 도입에 반대한다.','학교는 인공지능 숙제를 전면 도입해야 한다.'],
  ['새로운 의약품의 성급한 승인을 반대한다.','새로운 의약품을 즉시 승인해야 한다.'],
 ])('기술·과학 논점의 본문 반대 입장을 정치 좌우에 강제하지 않는다', (body,proposition)=>{
  const analysis=article(body);setPosition(analysis,'oppose',proposition);const html=render(analysis);
  expect(argumentAxis(html)).toContain('반대부터 찬성 · 반대 관점');expect(argumentAxis(html)).toContain('studio-axis-marker');expect(html).toContain(`비교 논점 · ${proposition}`);
 });
 it('주장 출처 명시 비율과 실제 분모를 기본 신뢰 항목에 표시한다',()=>{
  const html=render(article('정부에 따르면 예산이 늘었다. 통계청의 2025년 사회조사에 따르면 인구가 감소했다.'));
  expect(html).toContain('근거 출처 명시');expect(html).toMatch(/aria-label="사실 주장의 출처 명시 비율"[^>]*aria-valuenow="50"/);expect(html).toContain('분석된 사실 주장 1/2개에 출처 표시');
 });
 it('화자 미확인 범위와 표현 미판정을 숫자 확정 없이 표시한다',()=>{
  const analysis=article('그는 예산이 늘었다고 말했다.');analysis.expressions=[];const html=render(analysis);
  expect(html).toContain('0–100%');expect(html).toContain('화자 미확인 1개');expect(html).toMatch(/aria-label="본문 자극 표현 비율"[^>]*aria-valuetext="분석 대기"/);expect(html).toContain('공격성 분석 대기');
 });
 it('외부 가중 근거를 제공하면 기본 출처 명시 비율 옆의 보조 결과로 표시한다',()=>{
  const analysis=article('공개 가상 기사다.');
  const html=render(analysis,{sourceWeightSet:{version:'synthetic',methodology:'synthetic weights',weights:[{publisher:'a.test',value:0.7,evidence:'fixture A'},{publisher:'b.test',value:0.3,evidence:'fixture B'}]},reliabilityObservations:[{claimId:analysis.claims[0].id,articleId:'a',originId:'origin-a',publisher:'a.test',outcome:'supports'},{claimId:analysis.claims[0].id,articleId:'b',originId:'origin-b',publisher:'b.test',outcome:'contradicts'}]});
  expect(html).toContain('외부 대조 근거 70%');expect(html).toContain('분석된 사실 주장 0/1개에 출처 표시');
 });
 it.each([['searching','관련 기사 검색 중'],['failed','조사 연결 확인 필요'],['cancelled','조사 중단'],['not_started','추가 조사 전']] as const)('실제 조사 단계 %s를 표시한다',(researchStage,label)=>{
  const html=render(article('공개 가상 기사다.'),{researchStage});expect(html).toContain(label);if(researchStage!=='searching')expect(html).not.toContain('관련 기사 검색 중');
 });
 it('입력 변경·가상 예시·사실 주장 없음의 상태를 각각 표시한다',()=>{
  const analysis=article('공개 가상 기사다.');expect(render(analysis,{stale:true})).toContain('아래는 이전 입력의 결과입니다.');expect(render({...analysis,mode:'demo'})).toContain('가상 예시 결과');
  const withoutFacts=render({...analysis,claims:[]});expect(withoutFacts).toContain('해당 없음');expect(withoutFacts).toContain('출처를 확인할 사실 주장 없음');
 });
 it('검증된 정치 좌표가 있어도 기본 화면은 논점 관점이며 좌표 수치는 방법 설명에 제공한다',()=>{
  const analysis=article('합성 입력이다.');
  const set:BiasOrientationSet={axisId:'synthetic',version:'fixture',source:'synthetic only',note:'fixture only',profiles:[{publisherId:'left.test',orientation:'left'},{publisherId:'right.test',orientation:'right'}]};
  const classifier=(coordinate:number):BiasClassifierEvidence=>({coordinate,axisId:set.axisId,coordinateSpace:'fixture',modelId:'fixture',modelVersion:'fixture',task:'fixture',trainingDataId:'train',evaluationDataId:'eval',evaluation:{split:'held_out_articles',heldOutUnit:'original_source_group',groupSplitId:'split',trainingPublisherIds:['left.test','right.test'],evaluationPublisherIds:['left.test','right.test'],trainingSourceGroupIds:['t'],evaluationSourceGroupIds:['e'],metrics:['left.test','right.test'].map(publisherId=>({publisherId,sampleCount:3,coordinateMae:0.1,publisherAccuracy:0.8}))}});
  const point=(articleId:string,publisherId:string,coordinate:number)=>({articleId,publisherId,comparisonGroup:'synthetic',classifier:classifier(coordinate)});
  const rows=[point(analysis.analysisId,'input',-0.8),...Array.from({length:3},(_,i)=>point(`l${i}`,'left.test',-0.5)),...Array.from({length:3},(_,i)=>point(`r${i}`,'right.test',0.5))];
  const html=render(analysis,{biasArticleCoordinates:rows,biasOrientationSet:set,selectedBiasArticleId:analysis.analysisId,availability:{biasModelReady:true,articleResearchReady:true}});
  expect(argumentAxis(html)).toContain('본문 입장 분석 대기');expect(argumentAxis(html)).not.toContain('studio-axis-marker');expect(html).toContain('기준선 거리 0.80 · 편향 강도 40%');expect(html).toContain('비교 좌표와 표본 보기');
 });
});
