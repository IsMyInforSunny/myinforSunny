import {describe,it,expect} from 'vitest';
import {buildAnalysisScores} from '../lib/analysis-scores';
import {demoAnalysis} from '../lib/fixtures';
import type {PublisherWeightSet,EvidenceObservation} from '../lib/source-reliability';

const weights:PublisherWeightSet={version:'synthetic-v1',methodology:'synthetic reviewed source weights for testing only',weights:[
  {publisher:'alpha.test',value:0.7,evidence:'synthetic A'},{publisher:'beta.test',value:0.3,evidence:'synthetic B'},
]};
const analysis=()=>({...structuredClone(demoAnalysis('supported')),mode:'live' as const});
const observations=(claimId:string):EvidenceObservation[]=>[
  {claimId,articleId:'a',originId:'origin_a',publisher:'alpha.test',outcome:'supports'},
  {claimId,articleId:'b',originId:'origin_b',publisher:'beta.test',outcome:'contradicts'},
];
describe('reviewed-source trust score',()=>{
  it('requires actual evidence rather than just naming a source',()=>{
    const a=analysis();
    expect(buildAnalysisScores(a).reliability).toMatchObject({value:null,status:'pending',denominator:1});
    expect(buildAnalysisScores({...a,mode:'demo'},undefined,{observations:observations(a.claims[0].id),weightSet:weights}).reliability.value).toBeNull();
  });
  it('reflects public source weights and opposing verified evidence',()=>{
    const a=analysis();const score=buildAnalysisScores(a,undefined,{observations:observations(a.claims[0].id),weightSet:weights}).reliability;
    expect(score).toMatchObject({label:'출처 가중 근거 점수',value:70,status:'ready',numerator:0.7,denominator:1});
    expect(score.note).toContain('진실 확률이 아닙니다');
  });
  it('keeps unreviewed claims in a range instead of completing the article',()=>{
    const a=analysis();a.claims.push({...a.claims[0],id:'unreviewed'});
    const score=buildAnalysisScores(a,undefined,{observations:observations(a.claims[0].id),weightSet:weights}).reliability;
    expect(score).toMatchObject({value:35,status:'partial',lowerBound:35,upperBound:85,unresolvedCount:1,denominator:2});
  });
  it('abstains for missing weights, one publisher and shared originals',()=>{
    const a=analysis(),obs=observations(a.claims[0].id);
    for(const context of [
      {observations:obs,weightSet:null},
      {observations:obs.slice(0,1),weightSet:weights},
      {observations:obs.map(o=>({...o,originId:'same-original'})),weightSet:weights},
      {observations:[...obs,{...obs[0],publisher:'unregistered.test',articleId:'c'}],weightSet:weights},
    ])expect(buildAnalysisScores(a,undefined,context).reliability).toMatchObject({status:'pending',value:null});
  });
});
