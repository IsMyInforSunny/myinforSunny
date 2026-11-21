import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import SentenceVoicePanel from '../components/sentence-voice-panel';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';
import {VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,voiceAnnotationInput} from '../lib/sentence-voice';

type CitationLabel={direction:'support'|'oppose'|'neutral'|'uncertain';speaker:'journalist'|'source'|'mixed'|'unknown';relevance:'related'|'unrelated'|'uncertain'};
function panel(directions:CitationLabel[],withResearchSvm=false,citationFailure=false){
 const body='원전 증설을 추진해야 한다. 지역 주민은 위험을 우려한다. 정부는 관련 자료를 공개했다. 전문가들은 영향이 불확실하다고 말했다. 기자는 보완 대책도 함께 전했다.';
 const input=voiceAnnotationInput(body,'nuclear_energy');
 const analysis=structuredClone(demoAnalysis('supported'));
 analysis.mode='live';analysis.sources=makeSources({kind:'text',body,comments:[]});
 analysis.citationBalance={method:'ai',modelVersion:'fixture-ai',proposition:'의과대학 정원을 확대해야 한다.',
  labels:input.sentences.map((unit,index)=>({...directions[index],sentenceId:unit.sentenceId}))};
 if(citationFailure){delete analysis.citationBalance;analysis.warnings.push({code:'CITATION_BALANCE_UNAVAILABLE',message:'기사 문장별 인용 균형 분류가 완성되지 않았습니다.'});}
 if(withResearchSvm)analysis.sentenceVoices={...input,method:'svm',modelVersion:'fixture-svm',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
  articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,
  labels:input.sentences.map((unit,index)=>({sentenceId:unit.sentenceId,issue:'expansion',direction:directions[index].direction,speaker:directions[index].speaker}))};
 return renderToStaticMarkup(createElement(SentenceVoicePanel,{analysis}));
}

describe('인용 균형 P4 화면',()=>{
 it('AI 분류의 찬성·반대·중립·유보와 기자·취재원 및 근거 문장을 모두 보여 준다',()=>{
  const html=panel([
   {direction:'support',speaker:'source',relevance:'related'},{direction:'oppose',speaker:'source',relevance:'related'},
   {direction:'neutral',speaker:'source',relevance:'related'},{direction:'uncertain',speaker:'journalist',relevance:'related'},
   {direction:'support',speaker:'journalist',relevance:'related'},
  ],true);
  expect(html).toContain('인용 균형(AI 문장 분류)');
  expect(html).toContain('문장 SVM 분류(연구용)');
  expect(html).toContain('찬성 1 · 반대 1 · 중립 1 · 유보 0');
  expect(html).toContain('기자 문장 2개');expect(html).toContain('취재원 문장 3개');
  expect(html).toContain('원전 증설을 추진해야 한다.');expect(html).toContain('유보 · 기자');
  expect(html).toContain('취재원 문장 구성: 전체 3개, 찬성 1, 반대 1, 중립 1, 유보 0');
  expect(html).toContain('기자 문장 구성: 전체 2개, 찬성 1, 반대 0, 중립 0, 유보 1');
 });
 it('citationBalance 호출이 실패해도 SVM 결과를 유지하고 해당 칸만 실패로 표시한다',()=>{
  const html=panel([
   {direction:'support',speaker:'source',relevance:'related'},{direction:'oppose',speaker:'source',relevance:'related'},
   {direction:'neutral',speaker:'source',relevance:'related'},{direction:'uncertain',speaker:'journalist',relevance:'related'},
   {direction:'support',speaker:'journalist',relevance:'related'},
  ],true,true);
  expect(html).toContain('인용 균형 분석 실패');
  expect(html).toContain('문장 SVM 분류(연구용)');
  expect(html).not.toContain('인용 균형 분석 자료 없음');
 });
 it('찬반 문장이 3개 미만이면 균형 계산을 하지 않는다고 표시한다',()=>{
  const html=panel([
   {direction:'support',speaker:'source',relevance:'related'},{direction:'neutral',speaker:'journalist',relevance:'related'},
   {direction:'neutral',speaker:'source',relevance:'related'},{direction:'support',speaker:'source',relevance:'unrelated'},
   {direction:'oppose',speaker:'journalist',relevance:'uncertain'},
  ]);
  expect(html).toContain('관련 문장 3개 · 무관 1개 · 논점 미확정 1개');
  expect(html).toContain('찬반 문장이 3개 미만이라 균형을 계산하지 않습니다.');
  expect(html).toContain('상대 비교는 준비 중');
 });
 it('방향 근거와 미확정 화자가 있으면 가능한 좌표 범위를 표시하고 0으로 채우지 않는다',()=>{
  const html=panel([
   {direction:'support',speaker:'source',relevance:'related'},{direction:'support',speaker:'source',relevance:'related'},
   {direction:'oppose',speaker:'source',relevance:'related'},{direction:'uncertain',speaker:'mixed',relevance:'related'},
   {direction:'neutral',speaker:'journalist',relevance:'unrelated'},
  ]);
  expect(html).toContain('미확정 문장 1개를 포함한 가능한 좌표 0.00 ~ 0.50');
  expect(html).toContain('화자 미확정 1개');
 });
});
