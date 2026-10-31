import {describe,it,expect} from 'vitest';
import {demoAnalysis,demoVerification,fixtures} from '../lib/fixtures';
import {assertAnalysis,validSpan} from '../lib/domain';
import {countLabel,percentLabel,headline,readerExplanation} from '../lib/display';
import {dailyLimits} from '../lib/server/limits';

describe('기존 6종 + 확인됨 예시 회귀',()=>{
 const expected:Record<string,{factual:number;flagged:number;outcome:string}>={mixed:{factual:0,flagged:1,outcome:'not_applicable'},neutral:{factual:0,flagged:0,outcome:'not_applicable'},provocative:{factual:1,flagged:3,outcome:'unchecked'},unsupported:{factual:1,flagged:0,outcome:'unchecked'},no_comments:{factual:0,flagged:0,outcome:'not_applicable'},conflict:{factual:1,flagged:0,outcome:'contradicted'},supported:{factual:1,flagged:0,outcome:'supported'}};
 for(const f of fixtures)it(f.id,()=>{
  const a=demoAnalysis(f.id),v=demoVerification(f.id),e=expected[f.id];expect(()=>assertAnalysis(a)).not.toThrow();
  expect(a.claims.filter(c=>c.kind==='factual')).toHaveLength(e.factual);expect(a.expressions.filter(x=>x.status==='flagged')).toHaveLength(e.flagged);expect(v.checks[0].outcome).toBe(e.outcome);
  for(const c of a.claims)for(const span of c.origin)expect(validSpan(a.sources,span)).toBe(true);
  for(const c of v.checks)for(const r of c.relations){const ref=v.references.find(x=>x.id===r.referenceId)!;expect(ref.text.slice(r.start,r.end)).toBe(r.quote);}
  if(f.id==='supported')expect(a.topics.map(t=>t.label)).toEqual(['운영 시간']);
  expect(headline(a,v.checks)).toContain(`논점 ${a.topics.length}개`);
 });
 it('내부 필드명은 화면 설명에서 제외하며 자연스러운 설명은 보존한다',()=>{expect(readerExplanation('originMatches가 true이며 referenceId abcdef123456789012345678를 비교했습니다.','두 자료의 내용이 다릅니다.')).toBe('두 자료의 내용이 다릅니다.');expect(readerExplanation('운영 시간이 서로 다릅니다.','대체 설명')).toBe('운영 시간이 서로 다릅니다.');});
 it('작은 분모와 0 분모는 퍼센트를 노출하지 않는다',()=>{
  expect(countLabel({numerator:0,denominator:0,percent:null},'개')).toBe('해당 없음');
  expect(percentLabel({numerator:1,denominator:9,percent:11.1})).toBeNull();expect(percentLabel({numerator:1,denominator:10,percent:10})).toBe('10%');
 });
 it('운영자가 확인한 한도의 80%와 더 작은 자체 예산을 적용한다',()=>{
  expect(dailyLimits({})).toMatchObject({verified:false});
  expect(dailyLimits({GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'10000',GROQ_CONSOLE_RPD:'100'})).toEqual({verified:true,tokens:8000,requests:80});
  expect(dailyLimits({GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',DAILY_TOKEN_BUDGET:'0'}).tokens).toBe(0);
 });
});
