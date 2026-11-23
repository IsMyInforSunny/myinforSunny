import {describe,expect,it} from 'vitest';
import {editorialRange,editorialSentences,nonEditorialRanges} from '../lib/editorial-sentences';
import {FRAGMENT_LIMIT,naturalSentences,sentences} from '../lib/segmentation';

describe('editorial sentence boundaries',()=>{
 it('excludes standalone furniture while retaining original sentence IDs, text and offsets',()=>{
  const body=[
   'ⓒ파주시',
   '파주시가 2027년 생활임금을 결정했다.',
   '▲무안군의원들이 성명을 발표하고 있다. 2026. 11. 05 ⓒ프레시안',
   '시행일은 내년 1월 1일이다.',
   '구글에서 프레시안을 더 자주 만나기',
  ].join('\n');
  const original=sentences(body,'body'),kept=editorialSentences(body,'body');
  expect(kept.map(unit=>body.slice(unit.start,unit.end))).toEqual([
   '파주시가 2027년 생활임금을 결정했다.','시행일은 내년 1월 1일이다.',
  ]);
  for(const unit of kept){
   const raw=original.find(item=>item.id===unit.id)!;
   expect({id:unit.id,start:unit.start,end:unit.end}).toEqual({id:raw.id,start:raw.start,end:raw.end});
   expect(body.slice(unit.start,unit.end)).toBe(body.slice(raw.start,raw.end));
   expect(editorialRange(body,unit.start,unit.end)).toBe(true);
  }
  expect(kept.map(unit=>unit.id)).not.toEqual(['body_s0','body_s1']);
  const excluded=nonEditorialRanges(body);
  expect(excluded).toHaveLength(3);
  for(const range of excluded)expect(editorialRange(body,range.start,range.end)).toBe(false);
 });

 it('retains ordinary bullets and quoted discussion of a promotional sentence',()=>{
  const body=[
   '▲지역 의료 공백 해소 대책을 마련해야 한다.',
   '시민은 “구글에서 프레시안을 더 자주 만나기”라는 문구를 비판했다.',
   '저작권법 개정안을 검토해야 한다.',
  ].join('\n');
  const kept=editorialSentences(body,'body');
  expect(nonEditorialRanges(body)).toEqual([]);
  expect(kept.map(unit=>body.slice(unit.start,unit.end))).toEqual(body.split('\n'));
 });

 it.each(['© 뉴스사','Copyright 2026 Publisher','저작권자: 뉴스사','▲현장 모습 사진=뉴스사'])('excludes the standalone line %s without changing a CRLF body',furniture=>{
  const body=`  ${furniture}  \r\n정책은 다음 달 시행된다.\r\n후속 자료는 추후 공개된다.`;
  const kept=editorialSentences(body,'body'),raw=sentences(body,'body');
  expect(kept).toHaveLength(2);
  expect(kept.map(unit=>body.slice(unit.start,unit.end))).toEqual(['정책은 다음 달 시행된다.','후속 자료는 추후 공개된다.']);
  expect(kept.map(({id,start,end})=>({id,start,end}))).toEqual(raw.slice(-2).map(({id,start,end})=>({id,start,end})));
 });

 it('reindexes only natural-sentence metadata after removing earlier lines and preserves fragment groups',()=>{
  const long='가'.repeat(FRAGMENT_LIMIT+80)+'.';
  const body=`ⓒ뉴스사\n${long}\n구글에서 프레시안을 더 자주 만나기\n정책은 내년 시행된다.`;
  const kept=editorialSentences(body,'body'),groups=naturalSentences(kept);
  expect(groups).toHaveLength(2);
  expect(groups[0].units).toHaveLength(2);
  expect(kept.map(unit=>unit.natural)).toEqual([
   {index:0,part:0,parts:2},{index:0,part:1,parts:2},{index:1,part:0,parts:1},
  ]);
  expect(groups[0].units.map(unit=>body.slice(unit.start,unit.end)).join('')).toBe(long);
  expect(kept.every(unit=>sentences(body,'body').some(raw=>raw.id===unit.id&&raw.start===unit.start&&raw.end===unit.end))).toBe(true);
 });

 it('returns no denominator units when the original consists only of publisher furniture',()=>{
  const body='ⓒ뉴스사\n구글에서 프레시안을 더 자주 만나기';
  expect(editorialSentences(body,'body')).toEqual([]);
 });
});
