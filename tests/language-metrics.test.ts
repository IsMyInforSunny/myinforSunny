import {describe,it,expect} from 'vitest';
import {languageMetrics} from '../lib/language-metrics';
import {makeSources} from '../lib/domain';
import type {Analysis,Expression} from '../lib/contracts';

function input(body:string,comments:string[]=[]):Pick<Analysis,'sources'|'expressions'>{
 const sources=makeSources({kind:'text',body,comments:comments.map((text,i)=>({id:`comment_${i}`,text}))});
 return {sources,expressions:sources.flatMap(source=>source.sentences.map(unit=>({sourceId:source.id,sentenceId:unit.id,status:'clear',criteria:[],context:'direct',evidence:[]})))};
}
function flag(data:ReturnType<typeof input>,index:number,criteria:Expression['criteria']){data.expressions[index]={...data.expressions[index],status:'flagged',criteria};}

describe('본문 자극과 공격성의 독립 집계',()=>{
 it('공포·과도한 단정과 인신공격·조롱·일반화·위협을 서로 다른 축에 센다',()=>{
  const data=input('첫째 문장이다. 둘째 문장이다. 셋째 문장이다. 넷째 문장이다. 다섯째 문장이다. 여섯째 문장이다.');
  const criteria:Expression['criteria'][number][]=['fear_appeal','overstatement','personal_attack','mockery','group_generalization','threat'];criteria.forEach((criterion,index)=>flag(data,index,[criterion]));
  expect(languageMetrics(data)).toMatchObject({total:6,unresolved:0,scope:'body',stimulation:{flagged:2,value:33,upperBound:33,total:6},aggression:{flagged:4,value:67,upperBound:67,total:6}});
 });
 it('같은 문장이 두 기준에 해당해도 각 축에서 한 번만 센다',()=>{
  const data=input('공개 가상 문장이다.');flag(data,0,['fear_appeal','overstatement','personal_attack','threat']);expect(languageMetrics(data)).toMatchObject({total:1,stimulation:{flagged:1,value:100},aggression:{flagged:1,value:100}});
 });
 it('댓글 표현은 기본 본문 점수에서 제외하며 명시한 all 범위에만 포함한다',()=>{
  const data=input('차분한 본문이다.',['공포 유도의 가상 댓글이다.','공격 표현의 가상 댓글이다.']);flag(data,1,['fear_appeal']);flag(data,2,['mockery']);
  expect(languageMetrics(data)).toMatchObject({total:1,stimulation:{flagged:0,value:0},aggression:{flagged:0,value:0}});expect(languageMetrics(data,'all')).toMatchObject({total:3,scope:'all',stimulation:{flagged:1,value:33},aggression:{flagged:1,value:33}});
 });
 it('긴 문장의 여러 처리 조각에서 같은 기준이 반복돼도 자연 문장 한 개로 센다',()=>{
  const data=input('가'.repeat(1200)+'다.');expect(data.sources[0].sentences.length).toBeGreaterThan(1);data.expressions.forEach((_,index)=>flag(data,index,['fear_appeal','mockery']));
  expect(languageMetrics(data)).toMatchObject({total:1,unresolved:0,stimulation:{flagged:1,value:100,upperBound:100},aggression:{flagged:1,value:100,upperBound:100}});
 });
 it('빠진 조각과 미판정 조각이 같은 자연 문장에 있어도 가능한 상한은 한 번만 늘린다',()=>{
  const data=input('가'.repeat(1200)+'다. 차분한 둘째 문장이다. 미판정 셋째 문장이다.');flag(data,0,['fear_appeal']);data.expressions[1].status='undetermined';const last=data.expressions[data.expressions.length-1].sentenceId;
  data.expressions=data.expressions.filter((entry,index)=>index!==2&&entry.sentenceId!==last);
  expect(languageMetrics(data)).toMatchObject({total:3,unresolved:2,stimulation:{flagged:1,value:33,upperBound:67},aggression:{flagged:0,value:0,upperBound:67}});
 });
 it('전부 미판정이면 가능한 상한만 남기고 검출값은 대기로 둔다',()=>{
  const data=input('판단하지 못한 가상 문장이다.');data.expressions=[];expect(languageMetrics(data)).toMatchObject({total:1,unresolved:1,stimulation:{flagged:0,value:null,upperBound:100},aggression:{flagged:0,value:null,upperBound:100}});
 });
 it('본문이 없으면 댓글을 본문 분모로 대신하지 않는다',()=>{
  const data=input('',['댓글만 있다.']);flag(data,0,['fear_appeal']);expect(languageMetrics(data)).toMatchObject({total:0,stimulation:{value:null,upperBound:null,total:0},aggression:{value:null,upperBound:null,total:0}});
 });
});
