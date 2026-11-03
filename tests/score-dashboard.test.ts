import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import CanvaDashboard from '../components/canva-dashboard';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';
import type {Analysis} from '../lib/contracts';
import type {BiasClassifierEvidence,BiasOrientationSet} from '../lib/bias-analysis';

function article(body:string):Analysis{
  const analysis=structuredClone(demoAnalysis('supported'));analysis.mode='live';
  analysis.sources=makeSources({kind:'text',body,comments:[]});
  analysis.claims=analysis.sources[0].sentences.map((s,i)=>({id:`claim_${i}`,text:body.slice(s.start,s.end),kind:'factual',
    origin:[{sourceId:analysis.sources[0].id,sentenceId:s.id,start:s.start,end:s.end,quote:body.slice(s.start,s.end)}]}));
  analysis.expressions=analysis.sources[0].sentences.map(s=>({sourceId:analysis.sources[0].id,sentenceId:s.id,status:'clear',criteria:[],context:'direct',evidence:[]}));
  return analysis;
}
const render=(analysis:Analysis,extra:Partial<Parameters<typeof CanvaDashboard>[0]>={})=>renderToStaticMarkup(createElement(CanvaDashboard,
  {analysis,researchResults:[],onEvidence:()=>{},onArticles:()=>{},onCoordinates:()=>{},...extra}));

describe('score dashboard contract',()=>{
  it('explains unavailable model and article collection without suggesting that a score is processing',()=>{
    const html=render(article('공개 가상 기사다.'),{availability:{biasModelReady:false,articleResearchReady:false}});
    expect(html).toContain('산출 대기 이유');
    expect(html).toContain('편향: 비교 모델과 검토 기사 자료를 준비 중이에요.');
    expect(html).toContain('신뢰: 관련 기사 검색과 원문 수집을 연결 중이에요.');
    expect(html).not.toContain('신뢰: 외부 자료를 조사하고 있어요.');
  });
  it('only describes an investigation as running when its current stage is active',()=>{
    const analysis=article('공개 가상 기사다.');
    const html=render(analysis,{availability:{biasModelReady:true,articleResearchReady:true},researchStage:'searching'});
    expect(html).toContain('신뢰: 외부 자료를 조사하고 있어요.');
    expect(render(analysis,{availability:{biasModelReady:true,articleResearchReady:true},researchStage:'failed'})).toContain('신뢰: 외부 근거 대조가 필요해요.');
  });
  it('does not confuse demo, stale results, or no factual claims with unavailable trust scoring',()=>{
    const analysis=article('공개 가상 기사다.');
    for(const extra of [{stale:true},{}]){
      const target=extra.stale?analysis:{...analysis,mode:'demo' as const};
      expect(render(target,{...extra,availability:{biasModelReady:false,articleResearchReady:false}})).not.toContain('aria-label="산출 대기 이유"');
    }
    const withoutFacts={...analysis,claims:[]};
    expect(render(withoutFacts,{availability:{biasModelReady:false,articleResearchReady:false}})).not.toContain('신뢰: 관련 기사 검색');
  });
  it('retains actual evidence reasons when search becomes unavailable',()=>{
    const analysis=article('공개 가상 기사다.');
    const html=render(analysis,{availability:{biasModelReady:false,articleResearchReady:false},
      reliabilityObservations:[{claimId:analysis.claims[0].id,articleId:'a',originId:'origin-a',publisher:'unknown.test',outcome:'supports'}]});
    expect(html).toContain('신뢰: 가중치가 없는 출처가 있어 계산 보류.');
    expect(html).not.toContain('신뢰: 관련 기사 검색');
  });
  it('does not replace an existing weighted score with a service availability message',()=>{
    const analysis=article('공개 가상 기사다.');
    const html=render(analysis,{availability:{biasModelReady:false,articleResearchReady:false},
      sourceWeightSet:{version:'synthetic',methodology:'synthetic test weights',weights:[
        {publisher:'a.test',value:0.7,evidence:'synthetic A'},{publisher:'b.test',value:0.3,evidence:'synthetic B'}]},
      reliabilityObservations:[
        {claimId:analysis.claims[0].id,articleId:'a',originId:'origin-a',publisher:'a.test',outcome:'supports'},
        {claimId:analysis.claims[0].id,articleId:'b',originId:'origin-b',publisher:'b.test',outcome:'contradicts'}]});
    expect(html).toMatch(/cv3-axis-trust[\s\S]*?<strong[^>]*>70점/);
    expect(html).not.toContain('신뢰: 관련 기사 검색');
  });
  it('keeps the numeric bias score visible alongside its coordinate action',()=>{
    const analysis=article('합성 입력이다.');
    const set:BiasOrientationSet={axisId:'synthetic',version:'fixture',source:'synthetic only',note:'fixture only',profiles:[{publisherId:'left.test',orientation:'left'},{publisherId:'right.test',orientation:'right'}]};
    const classifier=(coordinate:number):BiasClassifierEvidence=>({coordinate,axisId:set.axisId,coordinateSpace:'fixture',modelId:'fixture',modelVersion:'fixture',task:'fixture',trainingDataId:'train',evaluationDataId:'eval',evaluation:{split:'held_out_articles',heldOutUnit:'original_source_group',groupSplitId:'split',trainingPublisherIds:['left.test','right.test'],evaluationPublisherIds:['left.test','right.test'],trainingSourceGroupIds:['t'],evaluationSourceGroupIds:['e'],metrics:['left.test','right.test'].map(publisherId=>({publisherId,sampleCount:3,coordinateMae:0.1,publisherAccuracy:0.8}))}});
    const point=(articleId:string,publisherId:string,coordinate:number)=>({articleId,publisherId,comparisonGroup:'synthetic',classifier:classifier(coordinate)});
    const rows=[point(analysis.analysisId,'input',-0.8),...Array.from({length:3},(_,i)=>point(`l${i}`,'left.test',-0.5)),...Array.from({length:3},(_,i)=>point(`r${i}`,'right.test',0.5))];
    const html=render(analysis,{biasArticleCoordinates:rows,biasOrientationSet:set,selectedBiasArticleId:analysis.analysisId});
    expect(html).toContain('편향 정도 40점, 100점 만점');
    expect(html).toMatch(/cv3-axis-bias[\s\S]*?<strong[^>]*>40점<\/strong>/);
    expect(html).toContain('좌표 보기');
  });
  it('uses the actual named-source numerator and labels what its trust score measures',()=>{
    const html=render(article('정부에 따르면 예산이 늘었다. 통계청의 2025년 사회조사에 따르면 인구가 감소했다.'));
    expect(html).toMatch(/cv3-axis-trust[\s\S]*?<strong[^>]*>산출 대기/);
    expect(html).toContain('출처 가중 근거');
    expect(html).toContain('출처 명시 50점 (1/2)');
    expect(html).toContain('n=2');
  });
  it('displays unresolved speakers as a possible range and wholly unclassified expressions as pending',()=>{
    const analysis=article('그는 예산이 늘었다고 말했다.');analysis.expressions=[];
    const html=render(analysis);
    expect(html).toMatch(/cv3-axis-expression[\s\S]*?<strong[^>]*>산출 대기/);
    expect(html).toMatch(/cv3-axis-trust[\s\S]*?<strong[^>]*>산출 대기/);
    expect(html).toContain('출처 명시 0–100점');
    expect(html).toContain('화자 미확인');
  });
});
