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
    expect(html).toMatch(/cv3-axis-trust[\s\S]*?<strong[^>]*>50점/);
    expect(html).toContain('출처 명시 점수');
    expect(html).toContain('출처 명시 1/2');
    expect(html).toContain('n=2');
  });
  it('displays unresolved speakers as a possible range and wholly unclassified expressions as pending',()=>{
    const analysis=article('그는 예산이 늘었다고 말했다.');analysis.expressions=[];
    const html=render(analysis);
    expect(html).toMatch(/cv3-axis-expression[\s\S]*?<strong[^>]*>산출 대기/);
    expect(html).toMatch(/cv3-axis-trust[\s\S]*?<strong[^>]*>0–100점/);
    expect(html).toContain('화자 미확인');
  });
});
