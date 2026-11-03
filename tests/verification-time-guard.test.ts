import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {buildChecks} from '../lib/server/verify';
import type {Claim,Reference,VerifyTextRequest} from '../lib/contracts';

const now='2026-11-03T06:00:00.000Z';
const claim=(targetTime:string|undefined='2024년'):Claim=>({id:'claim_1',kind:'factual',text:'가상 2024년 도서관 이용자 수는 1200명이다.',targetTime,origin:[{sourceId:'body',sentenceId:'body_s0',start:0,end:1,quote:'가'}]});
const ref=(id='r1',patch:Partial<Reference>={}):Reference=>({id,provenance:'web_fetched',text:'가상 2024년 도서관 이용자 수는 1200명이다.',url:`https://news.example/${id}`,publishedAt:'2024-12-20T00:00:00Z',fetchedAt:now,truncated:false,...patch});
function review(refs:Reference[],targetTime:string|undefined='2024년',contextIds:string[]=[]){
 const relations=refs.map(r=>({referenceId:r.id,quote:r.text,relation:contextIds.includes(r.id)?'context' as const:'supports' as const,explanation:'가상 자료 인용'}));
 return buildChecks({checks:[{claimId:'claim_1',originMatches:true,outcome:'supported',relations,explanation:'제공 자료의 관계',temporalFit:'matched',limitations:[]}]},[claim(targetTime)] as VerifyTextRequest['claims'],refs).checks[0];
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(now));});
afterEach(()=>vi.useRealTimers());

describe('fetched evidence date uncertainty for explicit claim periods',()=>{
 it.each([undefined,'invalid date','2026-12-01T00:00:00Z'])('does not certify a missing, invalid or future publication date: %s',publishedAt=>{
   const result=review([ref('r1',{publishedAt})]);
   expect(result).toMatchObject({outcome:'insufficient',temporalFit:'unclear',execution:'completed'});
   expect(result.relations).toHaveLength(1);expect(result.limitations.join(' ')).toContain('발행·취득 시점');
 });
 it.each([undefined,'invalid date','2026-12-01T00:00:00Z'])('does not certify a missing, invalid or future fetch date: %s',fetchedAt=>{
   expect(review([ref('r1',{fetchedAt})])).toMatchObject({outcome:'insufficient',temporalFit:'unclear'});
 });
 it('keeps a valid same-period report eligible without treating its date as proof of the event',()=>{
   expect(review([ref()])).toMatchObject({outcome:'supported',temporalFit:'matched'});
 });
 it('allows a later historical report and explains that publication time differs from event time',()=>{
   const result=review([ref('r1',{publishedAt:'2026-10-20T00:00:00Z'})]);
   expect(result).toMatchObject({outcome:'supported',temporalFit:'matched'});
   expect(result.limitations.join(' ')).toContain('발행일은 사건·조사 시점과 다를 수');
 });
 it('does not use a source published before the explicit target period as decisive support',()=>{
   const result=review([ref('r1',{publishedAt:'2023-05-01T00:00:00Z'})]);
   expect(result).toMatchObject({outcome:'insufficient',temporalFit:'unclear'});
   expect(result.limitations.join(' ')).toContain('대상 기간보다 앞서');
 });
 it.each(['현재','작년 겨울','2024년과 2026년'])('does not certify a fetched source against an ambiguous target: %s',targetTime=>{
   expect(review([ref()],targetTime)).toMatchObject({outcome:'insufficient',temporalFit:'unclear'});
 });
 it('keeps user-provided text semantics separate from fetched metadata',()=>{
   expect(review([ref('r1',{provenance:'provided_text',publishedAt:undefined,fetchedAt:undefined})])).toMatchObject({outcome:'supported',temporalFit:'matched'});
 });
 it('does not let dated evidence mask an undated decisive source in the same check',()=>{
   expect(review([ref(),ref('r2',{publishedAt:undefined})])).toMatchObject({outcome:'insufficient',temporalFit:'unclear'});
 });
 it('does not let an undated context-only citation invalidate a dated decisive source',()=>{
   expect(review([ref(),ref('r2',{publishedAt:undefined})],'2024년',['r2'])).toMatchObject({outcome:'supported',temporalFit:'matched'});
 });
});
