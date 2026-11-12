import {describe,expect,it} from 'vitest';
import {eventComparisonMessage} from '../components/event-comparison';

describe('event comparison states',()=>{
  it('distinguishes unsupported topics from missing matching events',()=>{
    expect(eventComparisonMessage('unknown_topic')).toContain('이 주제는 포함되지 않습니다');
    expect(eventComparisonMessage('no_match')).toContain('사건 기사 묶음을 찾지 못했습니다');
    expect(eventComparisonMessage('date_missing')).toContain('발행일');
    expect(eventComparisonMessage('ambiguous')).toContain('대응을 유보');
    expect(eventComparisonMessage('incompatible')).toContain('버전');
  });
});
