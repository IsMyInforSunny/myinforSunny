import {describe,it,expect} from 'vitest';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import type {Reference} from '../lib/contracts';
import type {ResearchVerification} from '../lib/research-contract';
import {collectObservedSources} from '../lib/source-observations';
import {assessSources} from '../lib/source-quality';
function setup(){const a=structuredClone(demoAnalysis('conflict'));a.mode='live';const v=structuredClone(demoVerification('conflict')) as ResearchVerification;v.mode='live';v.parentAnalysisId=a.analysisId;return {a,v};}
const fetched:Reference={id:'web_0',provenance:'web_fetched',url:'https://news.example/a?utm_source=test',text:'학교 도서관은 평일 오후 6시에 문을 닫는다. 학생들이 이용할 수 있는 시간을 안내하고 운영 비용을 설명했다. '.repeat(5),title:'가상 시험 기사',publishedAt:'2024-10-02T09:00:00Z',fetchedAt:'2025-01-01T00:00:00Z',truncated:true,fullTextLength:2000};
describe('자료 관찰의 분석 연결과 출처 구분',()=>{
 it('같은 자료의 후속 대조에서도 각 주장 시점 경고를 보존하고 순서와 반복에 영향받지 않는다',()=>{
  const {a,v}=setup();const claim=a.claims[0];
  a.claims=[{...claim,targetTime:'2024'},{...claim,id:'later_claim',targetTime:'2026'}];
  const first={...v,references:[{...fetched,id:'ref_0'}],checks:[{...v.checks[0],claimId:claim.id}]};
  const later={...first,checks:[{...first.checks[0],claimId:'later_claim'}]};
  for(const results of [[first,later],[later,first],[first,later,later]]){
   const output=collectObservedSources(a,results);
   expect(output.fetched).toHaveLength(1);
   expect(output.temporalWarnings).toEqual([{referenceId:output.fetched[0].id,targetTime:'2026'}]);
  }
 });
 it('원 사이트 미확인 입력 자료를 웹 취득 자료로 승격하지 않는다',()=>{const {a,v}=setup();v.references=[{...fetched,provenance:'provided_text'}];const output=collectObservedSources(a,[v]);expect(output.fetched).toEqual([]);expect(output.provided).toHaveLength(1);expect(output.provided[0].provenance).toBe('provided_text');});
 it('가상 예시에 웹 출처 필드가 있어도 실제 자료로 세지 않는다',()=>{const a=demoAnalysis('conflict');const v=demoVerification('conflict');v.references=[fetched];const output=collectObservedSources(a,[v]);expect(output.demo).toHaveLength(1);expect(output.fetched).toHaveLength(0);});
 it('다른 분석과 미연결 결과 및 모드가 다른 결과를 제외한다',()=>{const {a,v}=setup();v.references=[fetched];const stale={...v,parentAnalysisId:'previous'};const unbound={...v,parentAnalysisId:undefined};const synthetic={...v,mode:'demo' as const};expect(collectObservedSources(a,[stale,unbound,synthetic])).toMatchObject({fetched:[],excluded:{stale:1,unbound:1,modeMismatch:1}});});
 it('반복 대조 자료는 한 번 집계하고 서로 다른 본문은 중복 후보로 관찰한다',()=>{const {a,v}=setup();v.references=[fetched];const output=collectObservedSources(a,[v,v]);expect(output.fetched).toHaveLength(1);const another={...v,references:[{...fetched,id:'else',url:'https://other.example/a'}]};const combined=collectObservedSources(a,[v,another]);expect(combined.fetched).toHaveLength(2);expect(new Set(combined.fetched.map(r=>r.id)).size).toBe(2);const quality=assessSources(combined.fetched);expect(quality.contentClusters).toHaveLength(1);expect(quality.independence).toBe('not_determined');});
 it('발행일·취득일·잘림·원문을 변경하지 않고 관찰한다',()=>{const {a,v}=setup();v.references=[fetched];const before=JSON.stringify(v);const output=collectObservedSources(a,[v]);expect(output.fetched[0]).toMatchObject({publishedAt:fetched.publishedAt,fetchedAt:fetched.fetchedAt,text:fetched.text,truncated:true,fullTextLength:2000});expect(assessSources(output.fetched).summary.truncated).toBe(1);expect(JSON.stringify(v)).toBe(before);});
 it('시점 경고는 발행일 후보일 뿐 기존 사실 상충 판정을 변경하지 않는다',()=>{const {a,v}=setup();a.claims[0].targetTime='2026';v.references=[{...fetched,id:'ref_0'}];const original=v.checks[0].outcome;const result=collectObservedSources(a,[v]);expect(result.temporalWarnings).toHaveLength(1);expect(v.checks[0].outcome).toBe(original);});
});
