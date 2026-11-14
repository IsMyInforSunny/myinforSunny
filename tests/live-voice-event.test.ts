import {describe,expect,it} from 'vitest';
import {liveVoiceEventId,matchLiveVoiceEvent} from '../lib/live-voice-event';

const anchor={body:'영덕 원전 신규 건설 후보 부지 선정 평가위원회 발표 주민 설명회',
  title:'영덕 신규 원전 후보 부지 선정',publishedAt:'2026-11-14T00:00:00Z'};

describe('live voice pairwise event comparison',()=>{
  it('matches identical event text with symmetric scores',()=>{
    const candidate={...anchor,publishedAt:'2026-11-15T00:00:00Z'};
    expect(matchLiveVoiceEvent(anchor,candidate)).toMatchObject({status:'matched',dayDistance:1});
    expect(matchLiveVoiceEvent(anchor,candidate).similarity).toBeCloseTo(1);
    expect(matchLiveVoiceEvent(anchor,candidate).titleSimilarity).toBeCloseTo(1);
    expect(matchLiveVoiceEvent(anchor,candidate)).toEqual(matchLiveVoiceEvent(candidate,anchor));
  });
  it('rejects an unrelated body without titles',()=>{
    const result=matchLiveVoiceEvent({...anchor,title:undefined},{body:'태풍 강우 풍속 해일 기상 경보',publishedAt:anchor.publishedAt});
    expect(result).toMatchObject({status:'low_similarity',similarity:0,titleSimilarity:null});
  });
  it('requires both valid publication dates',()=>{
    for(const publishedAt of [undefined,'','invalid']) {
      expect(matchLiveVoiceEvent({...anchor,publishedAt},anchor).status).toBe('date_missing');
      expect(matchLiveVoiceEvent(anchor,{...anchor,publishedAt})).toEqual({
        status:'date_missing',similarity:null,titleSimilarity:null,dayDistance:null,
      });
    }
  });
  it('includes exactly three days and rejects four days in either direction',()=>{
    expect(matchLiveVoiceEvent(anchor,{...anchor,publishedAt:'2026-11-17T00:00:00Z'}).status).toBe('matched');
    expect(matchLiveVoiceEvent(anchor,{...anchor,publishedAt:'2026-11-17T00:00:01Z'}).status).toBe('out_of_period');
    for(const publishedAt of ['2026-11-18T00:00:00Z','2026-11-10T00:00:00Z'])
      expect(matchLiveVoiceEvent(anchor,{...anchor,publishedAt})).toMatchObject({status:'out_of_period',dayDistance:4,similarity:null});
  });
  it('includes candidate-only terms in IDF and penalizes them',()=>{
    const first={body:'alpha beta',publishedAt:anchor.publishedAt};
    const result=matchLiveVoiceEvent(first,{...first,body:'alpha beta gamma delta epsilon zeta'});
    const uniqueIdf=Math.log(3/2)+1;
    expect(result.similarity).toBeCloseTo(Math.sqrt(2)/Math.sqrt(2+4*uniqueIdf**2));
    expect(result.similarity).toBeLessThan(0.56);
    expect(result.status).toBe('low_similarity');
  });
  it('rejects title disagreement even when body alone would match',()=>{
    const result=matchLiveVoiceEvent(anchor,{...anchor,title:'태풍 강우 해일 경보'});
    expect(result.similarity).toBeCloseTo(0.65);
    expect(result.titleSimilarity).toBe(0);
    expect(result.status).toBe('low_similarity');
  });
  it('uses body similarity when one title has no usable terms',()=>{
    expect(matchLiveVoiceEvent(anchor,{...anchor,title:undefined})).toMatchObject({status:'matched',titleSimilarity:null});
    expect(matchLiveVoiceEvent(anchor,{...anchor,title:'the and news'})).toMatchObject({status:'matched',titleSimilarity:null});
  });
  it('bounds bodies to the same first 2000 UTF-16 characters',()=>{
    const body='alpha beta '.repeat(200);
    const first={body,title:'alpha beta',publishedAt:anchor.publishedAt};
    expect(matchLiveVoiceEvent(first,{...first,body:body+' gamma delta'.repeat(300)}).similarity).toBeCloseTo(1);
  });
});

describe('live voice event IDs',()=>{
  it('uses a deterministic supplied digest with a live prefix',()=>{
    expect(liveVoiceEventId('AB'.repeat(32))).toBe('live:'+'ab'.repeat(32));
    expect(liveVoiceEventId('01'.repeat(32))).toBe(liveVoiceEventId('01'.repeat(32)));
  });
  it('rejects malformed or wrong length digests',()=>{
    for(const hash of ['','a'.repeat(63),'a'.repeat(65),'g'.repeat(64),' '+'a'.repeat(64)])
      expect(()=>liveVoiceEventId(hash)).toThrow(/SHA-256/);
  });
});
