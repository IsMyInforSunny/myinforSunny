import {describe,expect,it,vi} from 'vitest';
import {buildAnalysisScores} from '../lib/analysis-scores';
import {analyzeBiasCoordinate} from '../lib/bias-analysis';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';
import {buildReviewExport} from '../lib/review-export';
import * as citedSources from '../lib/cited-sources';

function sourceAnalysis(body:string,comments:{id:string;text:string}[]=[]){
  const analysis=structuredClone(demoAnalysis('supported'));
  analysis.sources=makeSources({kind:'text',body,comments});
  analysis.claims=[];
  analysis.expressions=analysis.sources.flatMap(source=>source.sentences.map(sentence=>({sourceId:source.id,sentenceId:sentence.id,status:'clear' as const,criteria:[],context:'direct' as const,evidence:[]})));
  return analysis;
}

describe('descriptive analysis scores',()=>{
  it('distinguishes missing analysis, no factual claims and unavailable bias',()=>{
    const absent=buildAnalysisScores(null);
    expect([absent.bias,absent.stimulation,absent.reliability].every(score=>score.value===null&&score.status==='pending')).toBe(true);
    const scores=buildAnalysisScores(sourceAnalysis('의견입니다.'));
    expect(scores.bias).toMatchObject({value:null,status:'pending'});
    expect(scores.stimulation).toMatchObject({value:0,status:'ready',numerator:0,denominator:1});
    expect(scores.reliability).toMatchObject({value:null,status:'not_applicable',numerator:0,denominator:0});
  });
  it('scores flagged natural sentences across body and comments with a visible small denominator',()=>{
    const analysis=sourceAnalysis('첫 문장이다. 둘째 문장이다.',[{id:'comment',text:'과장된 댓글이다.'}]);
    analysis.expressions.at(-1)!.status='flagged';
    expect(buildAnalysisScores(analysis).stimulation).toMatchObject({value:33,status:'ready',numerator:1,denominator:3,scale:100});
  });
  it('keeps missing classifications in a partial interval rather than treating them as clear',()=>{
    const analysis=sourceAnalysis('첫 문장이다. 둘째 문장이다. 셋째 문장이다.');
    analysis.expressions[0].status='flagged';analysis.expressions.pop();
    expect(buildAnalysisScores(analysis).stimulation).toMatchObject({value:33,status:'partial',lowerBound:33,upperBound:67,unresolvedCount:1,numerator:1,denominator:3});
  });
  it('keeps wholly unclassified stimulation pending instead of publishing a zero score',()=>{
    const analysis=sourceAnalysis('첫 문장이다. 둘째 문장이다.');analysis.expressions=[];
    expect(buildAnalysisScores(analysis).stimulation).toMatchObject({value:null,status:'pending',lowerBound:0,upperBound:100,unresolvedCount:2,numerator:0,denominator:2});
  });
  it('does not double-count a sentence containing both flagged and unclassified fragments',()=>{
    const analysis=sourceAnalysis('가'.repeat(1100)+'다. 조용한 문장이다.');
    expect(analysis.sources[0].sentences.length).toBeGreaterThan(2);
    analysis.expressions[0].status='flagged';analysis.expressions[1].status='undetermined';
    expect(buildAnalysisScores(analysis).stimulation).toMatchObject({value:50,status:'partial',lowerBound:50,upperBound:50,denominator:2,unresolvedCount:1});
  });
  it('scores cited-source attribution without inventing publisher weights or a truth probability',()=>{
    const body='통계청에 따르면 2025년 조사에서 인구가 10% 증가했다. 가상기업은 매출이 20% 증가했다고 발표했다. 관계자에 따르면 인구가 감소했다.';
    const analysis=sourceAnalysis(body);
    analysis.claims=analysis.sources[0].sentences.map((sentence,index)=>({id:`claim_${index}`,text:body.slice(sentence.start,sentence.end),kind:'factual',
      origin:[{sourceId:analysis.sources[0].id,sentenceId:sentence.id,start:sentence.start,end:sentence.end,quote:body.slice(sentence.start,sentence.end)}]}));
    const score=buildAnalysisScores(analysis).reliability;
    expect(score).toMatchObject({label:'근거 출처 명시 점수',value:67,status:'ready',numerator:2,denominator:3});
    expect(score.note).toContain('참일 확률');
    analysis.claims=analysis.claims.slice(0,1);
    expect(buildAnalysisScores(analysis).reliability.value).toBe(100);
  });
  it('excludes generic government and research-team labels from named-source coverage',()=>{
    const body='정부에 따르면 예산이 증가했다. 연구팀에 따르면 인구가 감소했다.';
    const analysis=sourceAnalysis(body);
    analysis.claims=analysis.sources[0].sentences.map((sentence,index)=>({id:`claim_${index}`,text:body.slice(sentence.start,sentence.end),kind:'factual',
      origin:[{sourceId:analysis.sources[0].id,sentenceId:sentence.id,start:sentence.start,end:sentence.end,quote:body.slice(sentence.start,sentence.end)}]}));
    expect(citedSources.reviewCitedSources(analysis).summary.traceable_secondary).toBe(2);
    expect(buildAnalysisScores(analysis).reliability).toMatchObject({value:0,status:'ready',numerator:0,denominator:2});
  });
  it('keeps unresolved attribution outside the named numerator and within a partial upper bound',()=>{
    const body='그는 예산이 증가했다고 말했다.';
    const analysis=sourceAnalysis(body),sentence=analysis.sources[0].sentences[0];
    analysis.claims=[{id:'claim',text:body,kind:'factual',origin:[{sourceId:analysis.sources[0].id,sentenceId:sentence.id,start:0,end:body.length,quote:body}]}];
    const review=citedSources.reviewCitedSources(analysis);
    // Exercise the optional attribution uncertainty contract independently of
    // extraction rule changes, which have their own cited-sources tests.
    const spy=vi.spyOn(citedSources,'reviewCitedSources').mockReturnValue({...review,claims:review.claims.map(claim=>({...claim,unresolvedAttribution:true}))});
    try{
      expect(buildAnalysisScores(analysis).reliability).toMatchObject({value:0,status:'partial',numerator:0,denominator:1,lowerBound:0,upperBound:100,unresolvedCount:1});
    }finally{spy.mockRestore();}
  });
  it('uses only available finite 0–100 bias output and preserves the distance denominator',()=>{
    const analysis=sourceAnalysis('기사입니다.');
    const pending=analyzeBiasCoordinate([],null);
    expect(buildAnalysisScores(analysis,pending).bias.value).toBeNull();
    const ready={...pending,status:'ready' as const,gaugePercent:25.4,magnitude:0.508};
    expect(buildAnalysisScores(analysis,ready).bias).toMatchObject({value:25,status:'ready',numerator:0.508,denominator:2});
    for(const invalid of [NaN,Infinity,-1,101])expect(buildAnalysisScores(analysis,{...ready,gaugePercent:invalid}).bias.value).toBeNull();
  });
  it('exports only score aggregates by default and forwards the current bias summary',()=>{
    const analysis=sourceAnalysis('출처나 표현 세부 원문을 내보내지 않는 가상 기사입니다.');
    const biasAssessment={...analyzeBiasCoordinate([],null),status:'ready' as const,gaugePercent:20,magnitude:0.4};
    const output=buildReviewExport({analysis,biasAssessment,checks:[],feedback:'',includeRaw:false,includeRefs:false,verifications:[],researchResults:[],researchStage:'not_started'});
    expect(output.schemaVersion).toBe('2.4');
    expect(output.scores.bias).toMatchObject({value:20,status:'ready'});
    expect(output.scores.stimulation).toMatchObject({value:0,denominator:1});
    expect(JSON.stringify(output)).not.toContain(analysis.sources[0].text);
    expect(output).not.toHaveProperty('analysis');
  });
  it('marks previous-input exports without leaking input and clears stale state after reset',()=>{
    const analysis=sourceAnalysis('이전 입력의 가상 원문입니다.');
    const input={analysis,checks:[],feedback:'',includeRaw:false,includeRefs:false,verifications:[],researchResults:[],researchStage:'not_started' as const};
    expect(buildReviewExport(input)).toMatchObject({parentAnalysisId:analysis.analysisId,stale:false,inputState:'current'});
    const previous=buildReviewExport({...input,stale:true});
    expect(previous).toMatchObject({parentAnalysisId:analysis.analysisId,stale:true,inputState:'stale'});
    expect(previous.note).toContain('이전 입력');
    expect(JSON.stringify(previous)).not.toContain(analysis.sources[0].text);
    expect(buildReviewExport({...input,analysis:null,stale:true})).toMatchObject({parentAnalysisId:null,stale:false,inputState:'no_analysis'});
  });
});
