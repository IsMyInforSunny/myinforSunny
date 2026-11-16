import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import SentenceVoicePanel from '../components/sentence-voice-panel';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';
import {VOICE_ARTICLE_ISSUE,VOICE_INDEPENDENT_NEUTRAL,voiceAnnotationInput} from '../lib/sentence-voice';

function panel(directions:Array<{direction:'support'|'oppose'|'neutral'|'uncertain';speaker:'journalist'|'source'|'mixed'}>){
 const body='원전 증설을 추진해야 한다. 지역 주민은 위험을 우려한다. 정부는 관련 자료를 공개했다. 전문가들은 영향이 불확실하다고 말했다. 기자는 보완 대책도 함께 전했다.';
 const input=voiceAnnotationInput(body,'nuclear_energy');
 const analysis=structuredClone(demoAnalysis('supported'));
 analysis.mode='live';analysis.sources=makeSources({kind:'text',body,comments:[]});
 analysis.sentenceVoices={...input,method:'ai',modelVersion:'fixture-ai',decisionPolicy:VOICE_INDEPENDENT_NEUTRAL,
  articleIssue:'expansion',issuePolicy:VOICE_ARTICLE_ISSUE,
  labels:input.sentences.map((unit,index)=>({...directions[index],sentenceId:unit.sentenceId,issue:'expansion'}))};
 return renderToStaticMarkup(createElement(SentenceVoicePanel,{analysis}));
}

describe('인용 균형 P4 화면',()=>{
 it('AI 분류의 찬성·반대·중립·유보와 기자·취재원 및 근거 문장을 모두 보여 준다',()=>{
  const html=panel([
   {direction:'support',speaker:'source'},{direction:'oppose',speaker:'source'},
   {direction:'neutral',speaker:'source'},{direction:'uncertain',speaker:'journalist'},
   {direction:'support',speaker:'journalist'},
  ]);
  expect(html).toContain('인용 균형(AI 문장 분류)');
  expect(html).toContain('찬성 1 · 반대 1 · 중립 1 · 유보 0');
  expect(html).toContain('기자 문장 2개');expect(html).toContain('취재원 문장 3개');
  expect(html).toContain('원전 증설을 추진해야 한다.');expect(html).toContain('유보 · 기자');
 });
 it('찬반 문장이 3개 미만이면 균형 계산을 하지 않는다고 표시한다',()=>{
  const html=panel([
   {direction:'support',speaker:'source'},{direction:'neutral',speaker:'journalist'},
   {direction:'neutral',speaker:'source'},{direction:'neutral',speaker:'source'},
   {direction:'neutral',speaker:'journalist'},
  ]);
  expect(html).toContain('찬반 문장이 3개 미만이라 균형을 계산하지 않습니다.');
 });
});
