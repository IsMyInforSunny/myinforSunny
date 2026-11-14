import {describe,expect,it} from 'vitest';
import {VOICE_TOPICS} from '../lib/sentence-voice';
import {relatedVoiceIssue,selectArticleVoiceIssue} from '../lib/voice-article-issue';

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
  it('does not transfer a different issue direction to the selected target',()=>{
    expect(relatedVoiceIssue({expansion:.1,lifetime:.8,none:0},'expansion')).toBe('none');
    expect(relatedVoiceIssue({expansion:.8,lifetime:.1,none:0},'expansion')).toBe('expansion');
    expect(relatedVoiceIssue({expansion:.8,lifetime:.75,none:0},'expansion')).toBe('unknown');
    expect(relatedVoiceIssue({expansion:NaN,none:0},'expansion')).toBe('unknown');
    expect(relatedVoiceIssue(undefined,'expansion')).toBe('unknown');
  });
});
