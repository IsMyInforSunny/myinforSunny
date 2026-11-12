import {describe,expect,it} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources,locate} from '../lib/domain';
import {compareArticleViewpoints} from '../lib/viewpoint-comparison';
import type {ResearchVerification} from '../lib/research-contract';

function fixture(){
  const analysis=structuredClone(demoAnalysis('supported'));
  analysis.mode='live';analysis.analysisId='current';delete analysis.proposition;
  analysis.sources=makeSources({kind:'text',body:'도서관 운영 시간을 늘려야 한다.',comments:[]});
  analysis.bodyPosition={proposition:analysis.sources[0].text,label:'support',reason:'작성자 제안',
    evidence:[locate(analysis.sources,{sentenceId:'body_s0',quote:analysis.sources[0].text})!]};
  const text='운영 시간 변경에 관한 공개 자료다.';
  const result:ResearchVerification={schemaVersion:'2.1',requestId:'comparison',parentAnalysisId:'current',mode:'live',status:'success',
    scope:'retrieved_documents',versions:{rubric:'test',prompt:'test',model:'mock',retriever:'mock'},attempts:[],warnings:[],checks:[],createdAt:'2026-11-12T00:00:00Z',
    references:['a.test/1','a.test/2','b.test/3'].map((path,i)=>({id:`ref${i}`,provenance:'web_fetched',url:`https://${path}`,text,truncated:false})),
    perspectiveChecks:[0,1,2].map(i=>({referenceId:`ref${i}`,positionText:analysis.bodyPosition!.proposition,
      stance:i===2?'opposes_position':'supports_position',quote:text,start:0,end:text.length,explanation:'본문 인용 대조'}))};
  return {analysis,result};
}
describe('원문 근거에 연결된 관점 비교',()=>{
  it('현재 같은 명제의 고유 기사 찬반 건수와 매체 수를 산출한다',()=>{
    const {analysis,result}=fixture();
    expect(compareArticleViewpoints(analysis,[result])).toMatchObject({status:'ready',support:2,oppose:1,total:3,publisherCount:2});
  });
  it('과거 분석·위조 인용·같은 기사 별칭·다른 명제는 비교 표본을 늘리지 않는다',()=>{
    const {analysis,result}=fixture();
    result.perspectiveChecks![2].quote='일치하지 않는 인용';
    result.references[1].url='https://a.test/1?utm_source=copy';
    const past={...structuredClone(result),parentAnalysisId:'past'};
    expect(compareArticleViewpoints(analysis,[result,past])).toMatchObject({status:'insufficient',total:1,publisherCount:1});
    analysis.proposition='새 명제다.';
    expect(compareArticleViewpoints(analysis,[result])).toMatchObject({status:'no_grounded_proposition',total:0});
  });
  it('취재원 발언만 전달하는 기사도 비교 건수는 보여주되 작성자 방향을 만들지 않는다',()=>{
    const {analysis,result}=fixture();analysis.bodyPosition!.label='not_expressed';
    const comparison=compareArticleViewpoints(analysis,[result]);
    expect(comparison.status).toBe('ready');expect(comparison.articles.every(a=>a.relationToArticle==='unclassified')).toBe(true);
  });
});
