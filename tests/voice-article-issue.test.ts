import {describe,expect,it} from 'vitest';
import {VOICE_TOPICS} from '../lib/sentence-voice';
import {relatedVoiceIssue,selectArticleVoiceIssue,selectArticleVoiceIssues} from '../lib/voice-article-issue';

describe('article issue selection and target-related abstention',()=>{
  it('keeps a known explicit proposition even when another issue has more mentions',()=>{
    expect(selectArticleVoiceIssue('노후 원전 수명 연장과 계속 운전을 논의했다.','nuclear_energy',VOICE_TOPICS.nuclear_energy.issues.expansion)).toBe('expansion');
  });
  it('leaves absent or equally supported issues unresolved',()=>{
    expect(selectArticleVoiceIssue('기자들이 오늘 회의 내용을 전했다.','nuclear_energy')).toBeNull();
    expect(selectArticleVoiceIssue('보험료율 소득대체율','pension_reform')).toBeNull();
  });
  it('uses the title to identify the primary issue in a mixed article',()=>{
    expect(selectArticleVoiceIssue('보험료율 소득대체율','pension_reform',undefined,'보험료율 논의')).toBe('premium');
  });
  it('weights each title match twice and preserves exactly two ties',()=>{
    const tied=selectArticleVoiceIssues('원전 확대 논의. 노후 원전 대응.','nuclear_energy');
    expect(tied.source).toBe('two_primary');expect(tied.issues.sort()).toEqual(['expansion','lifetime']);
    expect(selectArticleVoiceIssues('원전 확대 논의. 노후 원전 대응.','nuclear_energy',undefined,'원전 확대').issues).toEqual(['expansion']);
    expect(selectArticleVoiceIssues('원전 확대 논의. 노후 원전 대응.','nuclear_energy',undefined,'',VOICE_TOPICS.nuclear_energy.issues.lifetime)).toMatchObject({source:'llm_exact',issues:['lifetime']});
    expect(selectArticleVoiceIssues('원전 확대. 노후 원전. 원전 수출.','nuclear_energy').issues).toEqual([]);
  });
  it('keeps pension replacement and fund-risk terms in separate rules',()=>{
    const investment=selectArticleVoiceIssues('국민연금 기금 수익률과 평가액, 운용 수익을 검토했다.','pension_reform');
    expect(investment.issues).toContain('fund_risk');expect(investment.scores.find(item=>item.issue==='replacement')?.score).toBe(0);
    const benefit=selectArticleVoiceIssues('소득대체율과 받는 연금액 인상을 논의했다.','pension_reform');
    expect(benefit.issues).toContain('replacement');expect(benefit.scores.find(item=>item.issue==='fund_risk')?.score).toBe(0);
  });
  it('does not transfer a different issue direction to the selected target',()=>{
    expect(relatedVoiceIssue({expansion:.1,lifetime:.8,none:0},'expansion')).toBe('none');
    expect(relatedVoiceIssue({expansion:.8,lifetime:.1,none:0},'expansion')).toBe('expansion');
    expect(relatedVoiceIssue({expansion:.8,lifetime:.75,none:0},'expansion')).toBe('unknown');
    expect(relatedVoiceIssue({expansion:NaN,none:0},'expansion')).toBe('unknown');
    expect(relatedVoiceIssue(undefined,'expansion')).toBe('unknown');
  });
});
