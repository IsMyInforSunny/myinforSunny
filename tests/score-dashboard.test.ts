import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CanvaDashboard from '../components/canva-dashboard';
import {demoAnalysis} from '../lib/fixtures';
import {locate,makeSources} from '../lib/domain';
import type {Analysis,BodyPosition} from '../lib/contracts';
import type {BiasClassifierEvidence,BiasOrientationSet} from '../lib/bias-analysis';
import {VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,voiceAnnotationInput} from '../lib/sentence-voice';

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

const priorityArticleUrls=[
 'https://www.pressian.com/pages/articles/2026091808555217839',
 'https://www.pressian.com/pages/articles/2026110509224063406',
];
function compositionArticle(url:string):Analysis{
 const analysis=article('시가 생활임금 결정을 발표했다. 노동계는 인상을 요구했다. 경영계는 동결을 요구했다. 시행 시점은 내년이다.');
 analysis.status='success';
 analysis.article={url,fetchedAt:'2026-11-23T01:00:00Z',fullTextLength:analysis.sources[0].text.length,analyzedCharacters:analysis.sources[0].text.length,truncated:false};
 analysis.bodyPosition={proposition:'생활임금을 인상해야 한다.',label:'not_expressed',evidence:[],reason:'작성자 입장 표명 없음'};
 delete analysis.sentenceVoices;delete analysis.additionalSentenceVoices;delete analysis.voiceCoordinates;
 delete analysis.issueQuarterComparison;delete analysis.issueQuarterComparisons;
 const directions=['support','oppose','neutral','neutral'] as const;
 analysis.citationBalance={method:'ai',modelVersion:'fixture-only',proposition:'생활임금을 인상해야 한다.',
  labels:analysis.sources[0].sentences.map((unit,index)=>({sentenceId:unit.id,relevance:'related',direction:directions[index],speaker:index<2?'source':'journalist'}))};
 return analysis;
}
const compositionSection=(html:string)=>html.match(/<section[^>]*aria-label="기사 내부 입장 구성 집계"[\s\S]*?<\/section>/)?.[0]??'';

describe('두 우선 기사의 내부 입장 구성 표시',()=>{
 it.each(priorityArticleUrls)('승인된 기사 %s에 실제 분모와 화자별 집계를 표시하며 상대 편향은 대기로 둔다',url=>{
  const html=render(compositionArticle(url)),section=compositionSection(html);
  expect(section).toContain('집계 완료');
  expect(section).toContain('찬성 25%');expect(section).toContain('반대 25%');expect(section).toContain('중립 50%');expect(section).toContain('유보 0%');
  expect(section).toContain('1/4문장');expect(section).toContain('2/4문장');
  expect(section).toContain('기자 서술 2문장 · 취재원 인용·전달 2문장');
  expect(section).toContain('취재원: 찬성 1 · 반대 1 · 중립 0 · 유보 0 (2문장)');
  expect(section).toContain('다른 매체와 비교한 편향 강도 점수가 아닙니다');
  expect(html).toContain('편향 강도 · 같은 쟁점·분기 비교 표본 대기');
  expect(html).toContain('작성자 입장 표명 없음');
  expect(argumentAxis(html)).not.toContain('studio-axis-marker');
 });

 it('중립100%를 기사 작성자 편향0점으로 바꾸지 않는다',()=>{
  const analysis=compositionArticle(priorityArticleUrls[0]);
  analysis.citationBalance!.labels.forEach(label=>{label.direction='neutral';});
  const html=render(analysis),section=compositionSection(html);
  expect(section).toContain('중립 100%');expect(section).toContain('4/4문장');
  expect(html).toContain('작성자 입장 표명 없음');expect(html).toContain('편향 강도 · 같은 쟁점·분기 비교 표본 대기');
  expect(html).not.toContain('편향 강도 · 0점');expect(argumentAxis(html)).not.toContain('studio-axis-marker');
 });

 it('같은 승인 URL에서도 현재 문장 분류가 바뀌면 표시 비율을 다시 계산한다',()=>{
  const analysis=compositionArticle(priorityArticleUrls[0]);
  const before=compositionSection(render(analysis));
  analysis.citationBalance!.labels.forEach(label=>{label.direction='oppose';});
  const after=compositionSection(render(analysis));
  expect(before).toContain('반대 25%');expect(after).toContain('반대 100%');expect(after).toContain('4/4문장');
  expect(after).not.toContain('반대 25%');
 });

 it.each([
  'https://www.pressian.com/pages/articles/2026091808555217830',
  'https://other.example/pages/articles/2026091808555217839',
 ])('다른 기사 %s에는 우선 구성 집계를 노출하지 않는다',url=>{
  const html=render(compositionArticle(url));
  expect(compositionSection(html)).toBe('');
  expect(html).toContain('편향 강도 · 같은 쟁점·분기 비교 표본 대기');
 });

 it('입력이 변경됐거나 문장 분류가 누락된 경우 집계 완료로 표시하지 않는다',()=>{
  const analysis=compositionArticle(priorityArticleUrls[0]);
  expect(compositionSection(render(analysis,{stale:true}))).toBe('');
  analysis.citationBalance!.labels.pop();
  expect(compositionSection(render(analysis))).toBe('');
 });
});

describe('기사 본문을 중심으로 한 대시보드 표시',()=>{
 it('논점은 있어도 작성자 입장 근거가 없으면 입장 표명 없음과 상대 비교 안내를 표시한다',()=>{
  const analysis=article('정부가 정책 논의 결과를 발표했다.');analysis.status='success';
  analysis.bodyPosition={proposition:'새 정책을 시행해야 한다.',label:'not_expressed',evidence:[],reason:'취재원 발언을 전달하며 작성자 평가를 드러내지 않는다.'};
  const html=render(analysis);
  expect(html).toContain('작성자 입장 표명 없음');expect(html).toContain('상대 비교는 준비 중');
  expect(argumentAxis(html)).not.toContain('studio-axis-marker');expect(html).not.toContain('분석 미완료');
 });
 it('기본 논점 관점과 준비되지 않은 정치 모델을 구분하며 좌표를 만들지 않는다',()=>{
  const html=render(article('공개 가상 기사다.'),{availability:{biasModelReady:false,articleResearchReady:false}});
  expect(html).toContain('논점 관점');expect(html).toContain('본문 입장 분석 대기');
  expect(argumentAxis(html)).not.toContain('studio-axis-marker');
  expect(html).toContain('검증된 SVM 모델 준비 중');expect(html).toContain('검색과 원문 연결 준비 중');expect(html).toContain('현재 PCA는 연구용');
 });
 it('본문 분석 결과가 없으면 실패를 알리면서 완료된 인용 균형과 SVM은 계속 표시한다',()=>{
  const body='원전 증설을 추진해야 한다. 지역 주민은 위험을 우려한다. 정부는 관련 자료를 공개했다. 전문가들은 영향이 불확실하다고 말했다. 기자는 보완 대책도 함께 전했다.';
  const analysis=article(body);analysis.topics=[];analysis.claims=[];analysis.expressions=[];delete analysis.bodyPosition;
  analysis.warnings.push({code:'PRIMARY_ANALYSIS_UNAVAILABLE',message:'본문 분석 실패'});
  const input=voiceAnnotationInput(body,'nuclear_energy');
  analysis.citationBalance={method:'ai',modelVersion:'fixture-ai',proposition:'원전 증설을 추진해야 한다.',labels:input.sentences.map((unit,index)=>({
   sentenceId:unit.sentenceId,relevance:'related' as const,direction:index===0?'support' as const:'neutral' as const,speaker:'journalist' as const,
  }))};
  analysis.sentenceVoices={...input,method:'svm',modelVersion:'fixture-svm',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
   articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,labels:input.sentences.map((unit,index)=>({
    sentenceId:unit.sentenceId,issue:'expansion',direction:index===0?'support' as const:'neutral' as const,speaker:'journalist' as const,
   }))};
  const html=render(analysis);
  expect(html).toContain('본문 분석 실패');
  expect(html).toContain('인용 균형(AI 문장 분류)');
  expect(html).toContain('문장 SVM 분류(연구용)');
 });
 it('부분 본문 결과가 있으면 PRIMARY_ANALYSIS_UNAVAILABLE만으로 전체 실패를 표시하지 않는다',()=>{
  const analysis=article('공개 가상 기사가 설명한다.');
  analysis.warnings.push({code:'PRIMARY_ANALYSIS_UNAVAILABLE',message:'본문 분석 실패'});
  expect(render(analysis)).not.toContain('본문 분석 실패');
 });
 it('실시간 분석의 연구 모델 주입 여부를 capabilities 값 그대로 표시한다',()=>{
  const analysis=article('공개 가상 기사다.');
  expect(render(analysis,{availability:{biasModelReady:true,articleResearchReady:true,researchInjected:true}})).toContain('연구 모델 주입 사용 중');
  expect(render(analysis,{availability:{biasModelReady:true,articleResearchReady:true,researchInjected:false}})).toContain('연구 모델 주입 꺼짐');
 });
 it('유효한 본문 입장 인용을 화살표와 원문 근거로 표시한다',()=>{
  const analysis=article('학교 도서관 운영 시간을 늘려야 한다.');setPosition(analysis);
  const html=render(analysis);
  expect(argumentAxis(html)).toContain('반대부터 찬성 · 찬성 관점');expect(argumentAxis(html)).toContain('studio-axis-marker');
  expect(html).toContain('비교 명제 · 학교 도서관 운영 시간을 늘려야 한다.');expect(html).toContain('본문 입장 방향 표시입니다. 편향 강도 점수는 검증된 동일 논점 SVM이 준비되면 산출합니다.');expect(html).toContain('본문의 제안과 인용을 함께 검토한 결과입니다.');
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
  expect(argumentAxis(html)).toContain('반대부터 찬성 · 반대 관점');expect(argumentAxis(html)).toContain('studio-axis-marker');expect(html).toContain(`비교 명제 · ${proposition}`);
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
