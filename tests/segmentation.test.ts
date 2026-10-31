import { describe,it,expect } from 'vitest';
import { FRAGMENT_LIMIT,SEGMENTER,naturalSentenceCount,naturalSentences,sentences } from '../lib/segmentation';
import { analysisCompatibility,locate,makeSources,validSpan } from '../lib/domain';
import { demoAnalysis,fixtures } from '../lib/fixtures';
import { sourceSchema,verifyRequestSchema } from '../lib/contracts';
import { validateVerifyInput } from '../lib/server/verify';

const pieces=(text:string)=>sentences(text,'body').map(s=>text.slice(s.start,s.end));
function expectExactOffsets(text:string){
  const units=sentences(text,'body');let previousEnd=0;
  units.forEach((u,i)=>{expect(u.id).toBe(`body_s${i}`);expect(u.start).toBeGreaterThanOrEqual(previousEnd);expect(u.end).toBeGreaterThan(u.start);previousEnd=u.end;});
  return units;
}

describe('자연 문장 분리 (오프라인)',()=>{
  it('소수점·배수·퍼센트의 마침표에서 문장을 끊지 않는다',()=>{
    expect(pieces('증가율은 42.7%였다. 가격은 1.5배 올랐다.')).toEqual(['증가율은 42.7%였다.','가격은 1.5배 올랐다.']);
    expect(pieces('3.14는 원주율이다.')).toEqual(['3.14는 원주율이다.']);
  });
  it('점으로 쓴 한국식 날짜를 한 문장 안에 둔다',()=>{
    expect(pieces('회의는 2026. 10. 31. 오후에 열렸다. 다음 회의는 2026.11.7에 열린다.')).toEqual(['회의는 2026. 10. 31. 오후에 열렸다.','다음 회의는 2026.11.7에 열린다.']);
    // A date at the very end of a line still ends the sentence.
    expect(pieces('마감일은 2026. 10. 31.\n다음 줄이다.')).toEqual(['마감일은 2026. 10. 31.','다음 줄이다.']);
  });
  it('물음표·느낌표·말줄임표와 한국어 종결을 구분한다',()=>{
    expect(pieces('정말요?! 네, 맞아요... 그렇군요. 좋아요!')).toEqual(['정말요?!','네, 맞아요...','그렇군요.','좋아요!']);
    expect(pieces('끝났다.다음 문장이다.')).toEqual(['끝났다.','다음 문장이다.']);
  });
  it('따옴표 안 문장부호는 인용문을 끊지 않고 닫는 따옴표는 앞 문장에 붙는다',()=>{
    expect(pieces('그는 “이제 그만하자.”라고 말했다. 나는 "정말? 알겠어." 하고 답했다.')).toEqual(['그는 “이제 그만하자.”라고 말했다.','나는 "정말? 알겠어." 하고 답했다.']);
    expect(pieces('“그만해.” 그가 말했다. 다음 문장이다.')).toEqual(['“그만해.”','그가 말했다.','다음 문장이다.']);
    expect(pieces('결과를 봤다. (자세한 내용은 아래와 같다.) 이어서 설명한다.')).toEqual(['결과를 봤다.','(자세한 내용은 아래와 같다.)','이어서 설명한다.']);
  });
  it('짝이 맞지 않는 따옴표가 줄 전체를 한 문장으로 삼키지 않는다',()=>{
    expect(pieces('그는 "안녕했다. 다음 문장이다. 끝.')).toEqual(['그는 "안녕했다.','다음 문장이다.','끝.']);
  });
  it('목록 번호와 영문 약어, 줄바꿈을 처리한다',()=>{
    expect(pieces('1. 서론을 쓴다. Dr. Kim은 3.14를 말했다.')).toEqual(['1. 서론을 쓴다.','Dr. Kim은 3.14를 말했다.']);
    expect(pieces('첫째 줄\r\n둘째 줄\n셋째.')).toEqual(['첫째 줄','둘째 줄','셋째.']);
  });
  it('이모지는 앞 문장 끝에 붙고 UTF-16 위치가 정확하며 반복 문장도 위치로 구분한다',()=>{
    const text='🌤️ 맑아요!🌤️ 맑아요!🌤️ 오늘도 맑아요.';const units=expectExactOffsets(text);
    expect(units.map(u=>text.slice(u.start,u.end))).toEqual(['🌤️ 맑아요!🌤️','맑아요!🌤️','오늘도 맑아요.']);
    const src=makeSources({kind:'text',body:text,comments:[]});const first=locate(src,{sentenceId:'body_s0',quote:'맑아요!'})!,second=locate(src,{sentenceId:'body_s1',quote:'맑아요!'})!;
    expect(second.start).toBeGreaterThan(first.end);expect(validSpan(src,first)&&validSpan(src,second)).toBe(true);
    expect(text.slice(first.start,first.end)).toBe('맑아요!');
  });
  it('문장 앞뒤 공백은 제외하되 원문 위치는 바꾸지 않는다',()=>{
    const text='  \t첫 문장이다.   둘째 문장이다.  \n\n 셋째 문장이다. ';const units=expectExactOffsets(text);
    expect(units.map(u=>text.slice(u.start,u.end))).toEqual(['첫 문장이다.','둘째 문장이다.','셋째 문장이다.']);
    expect(pieces('...\n🙂\n!!')).toEqual([]);
  });
});

describe('자연 문장과 500자 처리 조각 구분',()=>{
  it('짧은 문장은 조각 1개이며 메타데이터가 part=0, parts=1이다',()=>{
    const units=sentences('첫째다. 둘째다.','body');
    expect(units.map(u=>u.natural)).toEqual([{index:0,part:0,parts:1},{index:1,part:0,parts:1}]);
  });
  it('500자를 넘는 한 문장은 여러 조각이지만 자연 문장은 1개다',()=>{
    const long='가나다라'.repeat(300)+'.';const units=expectExactOffsets(long);
    expect(FRAGMENT_LIMIT).toBe(500);expect(units).toHaveLength(3);
    expect(units.map(u=>u.end-u.start)).toEqual([500,500,long.length-1000]);
    expect(units.every((u,i)=>u.natural?.index===0&&u.natural.part===i&&u.natural.parts===3)).toBe(true);
    expect(units.map(u=>long.slice(u.start,u.end)).join('')).toBe(long);
    const groups=naturalSentences(units);expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({fragmented:true,start:0,end:long.length});
    expect(naturalSentenceCount([{sentences:units}])).toBe(1);
  });
  it('짧은 문장 사이의 긴 문장도 앞뒤 문장 번호를 밀어내지 않는다',()=>{
    const text=`짧은 문장이다. ${'긴'.repeat(700)}. 마지막이다.`;const units=sentences(text,'body');
    expect(units.map(u=>u.natural?.index)).toEqual([0,1,1,2]);expect(naturalSentences(units).map(g=>g.units.length)).toEqual([1,2,1]);
    expect(units[1].end).toBe(units[2].start);
  });
  it('긴 문장을 나눌 때 서로게이트 쌍과 ZWJ 이모지를 자르지 않는다',()=>{
    const family='\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';expect(family).toHaveLength(11);const text='가'.repeat(498)+family+'나'.repeat(10);const units=sentences(text,'body');
    expect(units.map(u=>text.slice(u.start,u.end)).join('')).toBe(text);
    expect(text.slice(units[0].start,units[0].end)).toBe('가'.repeat(498));expect(text.slice(units[1].start,units[1].end).startsWith(family)).toBe(true);
  });
  it('500자 뒤에 오는 마침표만 남은 조각을 만들지 않고 앞 조각에 붙인다',()=>{
    const text='가'.repeat(500)+'.';const units=expectExactOffsets(text);
    expect(units).toHaveLength(1);expect(units[0]).toMatchObject({start:0,end:501,natural:{index:0,part:0,parts:1}});
    const closed='가'.repeat(500)+'.”';expect(pieces(closed)).toEqual([closed]);
    // The exception is bounded: a long run of trailing punctuation is not absorbed.
    const many='가'.repeat(500)+'!'.repeat(20);expect(pieces(many).length).toBeGreaterThan(0);
    expect(pieces('가'.repeat(500)+'나'+'.').map(p=>p.length)).toEqual([500,2]);
  });
  it('국기(지역 표시 기호 쌍)를 조각 경계에서 나누지 않는다',()=>{
    const flag='\u{1F1F0}\u{1F1F7}';const text='가'.repeat(498)+flag+'나'.repeat(10);const units=expectExactOffsets(text);
    expect(units.map(u=>text.slice(u.start,u.end)).join('')).toBe(text);
    expect(text.slice(units[0].start,units[0].end)).toBe('가'.repeat(498));expect(text.slice(units[1].start,units[1].end).startsWith(flag)).toBe(true);
  });
  it('공백이 있는 긴 문장은 뒤쪽 절반의 공백 경계에서 나누고 위치가 정확하다',()=>{
    const text='abcdefg '.repeat(200).trim()+'.';const units=expectExactOffsets(text);
    expect(units.length).toBeGreaterThan(2);
    for(const u of units){const p=text.slice(u.start,u.end);expect(p.length).toBeLessThanOrEqual(FRAGMENT_LIMIT);expect(p).toBe(p.trim());if(u!==units[units.length-1])expect(p.length).toBeGreaterThan(FRAGMENT_LIMIT/2);expect(text.slice(u.end,u.end+1)===' '||u.end===text.length).toBe(true);}
    expect(units.map(u=>text.slice(u.start,u.end)).join(' ')).toBe(text);
    expect(units.every((u,i)=>u.natural?.index===0&&u.natural.part===i&&u.natural.parts===units.length)).toBe(true);
  });
  it('마침표가 붙어도 처리 단위는 24개를 넘지 않는다',()=>{
    const text='가'.repeat(24*FRAGMENT_LIMIT)+'.';const units=expectExactOffsets(text);
    expect(units).toHaveLength(24);expect(units[23].end).toBe(text.length);
    expect(sentences('가'.repeat(24*FRAGMENT_LIMIT+1)+'.','body')).toHaveLength(25);
  });
  it('메타데이터가 없는 이전 형식은 조각을 문장 하나로 합치지 않는다',()=>{
    const legacy=[{id:'body_s0',start:0,end:500},{id:'body_s1',start:500,end:700}];
    expect(naturalSentences(legacy)).toHaveLength(2);
  });
});

describe('이전 분석 이전(stale) 처리',()=>{
  it('분리기 버전을 올려 이전 결과를 현재 결과로 오인하지 않는다',()=>{
    expect(SEGMENTER).not.toBe('sentence-2.0');
    const current=demoAnalysis('mixed');expect(analysisCompatibility(current)).toEqual({current:true});
    const old={...current,versions:{...current.versions,segmenter:'sentence-2.0'}};expect(analysisCompatibility(old)).toEqual({current:false,reason:'SEGMENTER_CHANGED'});
    const missing={...current,bodyTopicAssignments:undefined};expect(analysisCompatibility(missing)).toEqual({current:false,reason:'BODY_TOPICS_MISSING'});
  });
  for(const f of fixtures)it(`${f.id}: 조각 메타데이터가 스키마 검증과 서버 재분리 비교를 통과한다`,()=>{
    const a=demoAnalysis(f.id);
    expect(JSON.stringify(a.sources.map(s=>sourceSchema.parse(s).sentences))).toBe(JSON.stringify(a.sources.map(s=>s.sentences)));
    const parsed=verifyRequestSchema.parse({kind:'text',sources:a.sources,claims:a.claims,references:[],useWebSearch:false,transmissionConsent:true});
    if(parsed.kind!=='text')throw Error('unexpected kind');
    expect(()=>validateVerifyInput(parsed)).not.toThrow();
  });
  it('메타데이터가 없는 이전 분석 원본은 대조 요청에서 다시 분석하도록 거절한다',()=>{
    const a=demoAnalysis('conflict');const sources=structuredClone(a.sources);sources.forEach(s=>s.sentences.forEach(t=>{delete t.natural;}));
    const req={kind:'text' as const,sources,claims:a.claims,references:[],useWebSearch:false as const};
    expect(()=>validateVerifyInput(req)).toThrow();
  });
});
