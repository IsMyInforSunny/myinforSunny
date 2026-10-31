import {describe,it,expect} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {expressionSummary,indicators,makeSources} from '../lib/domain';
import {headline} from '../lib/display';
import {reportStatus} from '../lib/report-status';
describe('자극성의 자연 문장 집계',()=>{
 it('긴 문장의 여러 검토 조각은 한 문장으로 집계하며 나머지 미분류를 알린다',()=>{
  const a=demoAnalysis('no_comments');a.sources=makeSources({kind:'text',body:'가'.repeat(1100)+'다.',comments:[]});
  a.expressions=a.sources[0].sentences.map((s,i)=>({sentenceId:s.id,sourceId:'body',status:i<2?'flagged':'undetermined',criteria:[],severity:i<2?'moderate':undefined,context:'direct',explanation:'가상 시험',evidence:[]}));
  expect(a.sources[0].sentences).toHaveLength(3);expect(expressionSummary(a)).toEqual({total:1,flagged:1,undetermined:1});expect(indicators(a)).toMatchObject({expression:{numerator:1,denominator:1,percent:100},expressionUndetermined:1});expect(headline(a,[])).toContain('검토 표현 1문장');expect(reportStatus(a,[]).expression).toBe('검토 표현 있음 · 일부 판단 유보');
 });
 it('미분류 조각을 명확한 표현 없음으로 바꾸지 않는다',()=>{const a=demoAnalysis('no_comments');a.expressions=[];expect(expressionSummary(a).undetermined).toBe(a.sources[0].sentences.length);expect(reportStatus(a,[]).expression).toBe('판단 유보');});
});
