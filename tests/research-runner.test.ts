import {describe,it,expect} from 'vitest';
import {runResearch} from '../lib/research-runner';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {ResearchInput} from '../lib/research-contract';
const input=():ResearchInput=>{const a=demoAnalysis('conflict');return {sources:a.sources,claims:a.claims.filter(c=>c.kind==='factual').slice(0,1),transmissionConsent:true,researchConsent:true};};
describe('브라우저 자동 조사 실행 순서',()=>{
 it('추천용 관점 검색을 사실 대조보다 먼저 실행하되 서명된 원래 검색 인덱스를 유지한다',async()=>{
  const indexes:number[]=[];let time=0;
  await runResearch(input(),new AbortController().signal,{now:()=>time,wait:async ms=>{time+=ms;},post:async<T,>(body:unknown)=>{
   const op=body as {operation:string;queryIndex:number};
   if(op.operation==='plan')return {token:'signed',queries:[{label:'fact',purpose:'fact_check'},{label:'perspective',purpose:'perspective'}],nextModelCallAt:new Date(0).toISOString()} as T;
   indexes.push(op.queryIndex);return {token:'evidence',references:[]} as T;
  }},()=>{},()=>{});
  expect(indexes).toEqual([1,0]);
 });
 it('자료가 연속으로 없더라도 검색 간격과 IP별 분당 한도를 지킨다',async()=>{let time=0;const at:number[]=[];const waits:number[]=[];await runResearch(input(),new AbortController().signal,{now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},post:async<T,>(body:unknown)=>{const op=(body as {operation:string}).operation;if(op==='plan')return {token:'p',queries:Array.from({length:4},()=>({label:'자료'})),nextModelCallAt:new Date(61000).toISOString()} as T;at.push(time);return {token:'e',references:[]} as T;}},()=>{},()=>{});expect(at).toEqual([0,7000,14000,61000]);expect(waits).toEqual([7000,7000,47000]);});
 it('검색 뒤 한도 대기 후 대조하며 실제로 완료한 주장만 센다',async()=>{
  const i=input(),operations:string[]=[],stages:string[]=[],waits:number[]=[];let time=1000;
  const result=demoVerification('conflict');result.checks=result.checks.slice(0,1);result.checks[0].claimId=i.claims[0].id;
  await runResearch(i,new AbortController().signal,{now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},post:async<T,>(body:unknown)=>{const op=(body as {operation:string}).operation;operations.push(op);return (op==='plan'?{token:'p',queries:[{label:'운영 시간',claimId:i.claims[0].id,purpose:'fact_check'}],nextModelCallAt:new Date(62000).toISOString()}:op==='discover'?{token:'e',references:[{text:'공개 자료'}]}:result) as T;}},p=>stages.push(p.stage),()=>{});
  expect(operations).toEqual(['plan','discover','compare']);expect(waits).toEqual([61000]);expect(stages).toContain('waiting');expect(stages.at(-1)).toBe('completed');
 });
 it('취득 본문이 없으면 모델을 호출하거나 대조 완료로 세지 않는다',async()=>{const operations:string[]=[],stages:string[]=[];await runResearch(input(),new AbortController().signal,{now:Date.now,wait:async()=>{throw Error('unexpected wait');},post:async<T,>(body:unknown)=>{const op=(body as {operation:string}).operation;operations.push(op);return (op==='plan'?{token:'p',queries:[{label:'자료'}],nextModelCallAt:new Date().toISOString()}:{token:'e',references:[]}) as T;}},p=>stages.push(p.stage),()=>{throw Error('unexpected result');});expect(operations).toEqual(['plan','discover']);expect(stages.at(-1)).toBe('partial');});
 it('취소하면 기다린 뒤 비교 호출을 시작하지 않는다',async()=>{const c=new AbortController(),operations:string[]=[];await expect(runResearch(input(),c.signal,{now:()=>0,wait:async()=>{c.abort();},post:async<T,>(body:unknown)=>{const op=(body as {operation:string}).operation;operations.push(op);return (op==='plan'?{token:'p',queries:[{label:'자료'}],nextModelCallAt:new Date(61000).toISOString()}:{token:'e',references:[{text:'자료'}]}) as T;}},()=>{},()=>{})).rejects.toMatchObject({name:'AbortError'});expect(operations).toEqual(['plan','discover']);});
 it('이미 취소된 요청은 계획 API도 호출하지 않는다',async()=>{
  const c=new AbortController();c.abort();const operations:string[]=[],stages:string[]=[];
  await expect(runResearch(input(),c.signal,{now:()=>0,wait:async()=>{},post:async<T,>(body:unknown)=>{operations.push((body as {operation:string}).operation);return {} as T;}},p=>stages.push(p.stage),()=>{})).rejects.toMatchObject({name:'AbortError'});
  expect(operations).toEqual([]);expect(stages).toEqual([]);
 });
 it.each(['plan','discover','compare'])('%s 응답 도중 취소되면 늦은 결과나 완료 상태를 반영하지 않는다',async cancelAt=>{
  const c=new AbortController(),operations:string[]=[],stages:string[]=[],results:unknown[]=[];let time=0;
  await expect(runResearch(input(),c.signal,{now:()=>time,wait:async ms=>{time+=ms;},post:async<T,>(body:unknown)=>{
   const op=(body as {operation:string}).operation;operations.push(op);
   if(op===cancelAt)c.abort();
   return (op==='plan'?{token:'p',queries:[{label:'자료'}],nextModelCallAt:new Date(0).toISOString()}:op==='discover'?{token:'e',references:[{text:'자료'}]}:demoVerification('conflict')) as T;
  }},p=>stages.push(p.stage),r=>results.push(r))).rejects.toMatchObject({name:'AbortError'});
  expect(operations).toEqual(['plan','discover','compare'].slice(0,['plan','discover','compare'].indexOf(cancelAt)+1));
  expect(results).toEqual([]);expect(stages).not.toContain('completed');expect(stages).not.toContain('partial');
 });
});
