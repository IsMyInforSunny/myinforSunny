import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {Perspectives} from '../components/perspectives';
import {demoAnalysis} from '../lib/fixtures';
import type {Check,Reference} from '../lib/contracts';

function fixture(){
 const analysis=demoAnalysis('supported');
 const claim=analysis.claims.find(c=>c.kind==='factual')!;
 const ref:Reference={id:'manual-reference',url:'https://news.example/manual',text:'같은 날 도서관은 오후 9시에 문을 닫는다.',provenance:'provided_text',truncated:false};
 const check:Check={claimId:claim.id,outcome:'contradicted',execution:'completed',temporalFit:'matched',relations:[{referenceId:ref.id,quote:ref.text,start:0,end:ref.text.length,relation:'contradicts',explanation:'같은 날 운영 시간이 다릅니다.'}],explanation:'입력 자료의 운영 시간 차이',limitations:[]};
 return {analysis,claim,ref,check};
}
function render(data:ReturnType<typeof fixture>,checks:Check[]=[data.check]){
 return renderToStaticMarkup(createElement(Perspectives,{analysis:data.analysis,checks,checkSources:{[data.claim.id]:[data.ref]},onSelect:()=>{}}));
}
const heading='수동 대조에서 확인한 사실관계 차이';

describe('다른 관점과 수동 사실관계 차이의 구분',()=>{
 it.each(['contradicted','conflicting'] as const)('완료된 동시점 %s 인용을 사실관계 차이로 표시한다',outcome=>{
  const data=fixture();data.check.outcome=outcome;
  const html=render(data);
  expect(html).toContain(heading);expect(html).toContain(data.ref.text);
  expect(html).toContain('href="https://news.example/manual"');
  expect(html).toContain('정책이나 제안에 반대하는 의견으로 분류한 것이 아닙니다.');
 });
 it.each(['failed','skipped'] as const)('실행 %s 자료를 근거처럼 표시하지 않는다',execution=>{
  const data=fixture();data.check.execution=execution;expect(render(data)).not.toContain(heading);
 });
 it.each(['unclear','mismatched'] as const)('시점 %s인 수치를 사실관계 차이로 확정하지 않는다',temporalFit=>{
  const data=fixture();data.check.temporalFit=temporalFit;expect(render(data)).not.toContain(heading);
 });
 it.each(['supported','insufficient','unchecked','inaccessible','not_applicable'] as const)('상충 결과가 아닌 %s 관계를 승격하지 않는다',outcome=>{
  const data=fixture();data.check.outcome=outcome;expect(render(data)).not.toContain(heading);
 });
 it.each([
  {start:0.5}, {end:Infinity}, {start:NaN}, {start:-1},
  {end:10000}, {quote:'자료에 없는 인용'}, {start:0,end:0,quote:''},
 ])('위조·본문 경계 밖의 자료 인용을 제외한다: %j',change=>{
  const data=fixture();Object.assign(data.check.relations[0],change);expect(render(data)).not.toContain(heading);
 });
 it('공백뿐인 자료 인용을 제외한다',()=>{
  const data=fixture();data.ref.text='   ';Object.assign(data.check.relations[0],{quote:'   ',start:0,end:3});expect(render(data)).not.toContain(heading);
 });
 it.each(['https://reader:password@news.example/manual','https://reader@news.example/manual','javascript:alert(1)','file:///manual','not a url'])('안전하지 않은 출처 링크를 제외한다: %s',url=>{
  const data=fixture();data.ref.url=url;expect(render(data)).not.toContain(heading);expect(render(data)).not.toContain('출처 열기');
 });
 it('사실 주장이 아닌 의견이나 없는 원문 근거를 제외한다',()=>{
  const data=fixture();data.claim.kind='opinion';expect(render(data)).not.toContain(heading);
  data.claim.kind='factual';data.claim.origin=[];expect(render(data)).not.toContain(heading);
 });
 it('원문 인용도 소수 위치를 slice 보정으로 인정하지 않는다',()=>{
  const data=fixture();data.claim.origin[0].start+=0.1;expect(render(data)).not.toContain(heading);
 });
 it('후속 실패가 이전 성공을 대체한다',()=>{
  const data=fixture();expect(render(data,[data.check,{...data.check,execution:'failed'}])).not.toContain(heading);
 });
 it('수동 인용이 제외되어도 출처 없는 제안은 별도 표시한다',()=>{
  const data=fixture();data.analysis.counterArguments=[{claimId:data.claim.id,kind:'qualification',text:'가상 제안의 조건을 더 살펴보자.',reasoning:'운영 조건을 확인해야 합니다.',evidenceNeeded:'가상 운영 조건 자료',basis:data.claim.origin,provenance:'ai_suggestion'}];data.check.execution='failed';
  const html=render(data);expect(html).toContain('AI 제안 · 출처 없음');expect(html).toContain('가상 제안의 조건을 더 살펴보자.');expect(html).not.toContain(heading);
 });
});
