import {describe,it,expect} from 'vitest';
import {reliabilityReview,verifiedRecommendations} from '../lib/reliability';
import type {Claim,Reference} from '../lib/contracts';
import type {ResearchVerification} from '../lib/research-contract';
const claim:Claim={id:'c1',kind:'factual',text:'오후 6시에 닫는다.',origin:[]};
const source:Reference={id:'r1',provenance:'web_fetched',url:'https://news.example/a',title:'가상 기사',text:'오후 9시에 닫는다.',fetchedAt:'2026-10-31T00:00:00Z',truncated:false};
function verification():ResearchVerification{return {schemaVersion:'2.1',requestId:'test',mode:'live',status:'success',versions:{rubric:'test',prompt:'test',model:'mock',retriever:'mock'},scope:'retrieved_documents',references:[source],checks:[{claimId:'c1',outcome:'contradicted',execution:'completed',relations:[{referenceId:'r1',quote:source.text,start:0,end:source.text.length,relation:'contradicts',explanation:'운영 시간이 다릅니다.'}],explanation:'두 자료의 운영 시간이 다릅니다.',temporalFit:'matched',limitations:[]}],attempts:[],warnings:[],createdAt:'2026-10-31T00:00:00Z'};}
describe('자동 신뢰성 검토와 실제 기사 추천',()=>{
 it('다른 명제의 반대 인용을 현재 기사의 반대 입장 추천으로 바꾸지 않는다',()=>{
  const v={...verification(),parentAnalysisId:'current'};
  v.perspectiveChecks=[{referenceId:'r1',positionText:'학교 급식을 무료로 제공해야 한다.',stance:'opposes_position',quote:source.text,start:0,end:source.text.length,explanation:'다른 제안의 입장'}];
  const a={analysisId:'current',mode:'live' as const,claims:[claim],proposition:'운영 시간을 늘려야 한다.'};
  expect(verifiedRecommendations([v],a)[0].kind).toBe('different_evidence');
  v.checks=[];expect(verifiedRecommendations([v],a)).toEqual([]);
  v.perspectiveChecks[0].positionText=a.proposition;
  expect(verifiedRecommendations([v],a)[0].kind).toBe('opposing_view');
 });
 it('시점 불일치·미확인 자료의 양쪽 관계를 사실 상충으로 확정하지 않는다',()=>{for(const temporalFit of ['mismatched','unclear'] as const){const v=verification();v.checks[0].temporalFit=temporalFit;v.checks[0].outcome='conflicting';v.checks[0].relations.push({...v.checks[0].relations[0],relation:'supports'});expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({conflicting:0,insufficient:1,status:'needs_more_evidence'});expect(verifiedRecommendations([v])).toEqual([]);}});
 it('입력 자료를 자동 조사 완료로 승격하지 않는다',()=>{const v=verification();v.references=[{...source,provenance:'provided_text'}];expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({completedClaims:0,sourceCount:0,status:'not_started'});expect(verifiedRecommendations([v])).toEqual([]);});
 it('수치 상충을 의견 반대 기사로 바꾸지 않는다',()=>{const v=verification();expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({status:'contradiction_found',contradicted:1,completedClaims:1,remaining:0});expect(verifiedRecommendations([v])[0].kind).toBe('different_evidence');});
 it('잘못된 인용은 추천에서 제외하고 신뢰성 뒷받침으로 세지 않는다',()=>{const v=verification();v.checks[0].relations[0].quote='없는 인용';expect(verifiedRecommendations([v])).toEqual([]);expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({contradicted:0,insufficient:1});});
 it('시간이 다른 자료로 현재 주장을 확정하지 않는다',()=>{const v=verification();v.checks[0].temporalFit='mismatched';expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({status:'needs_more_evidence',contradicted:0,insufficient:1});});
 it('명시적 입장과 실제 인용이 확인된 기사만 다른 입장으로 표시한다',()=>{const v=verification();v.perspectiveChecks=[{referenceId:'r1',positionText:'운영 시간을 늘려야 한다.',stance:'opposes_position',quote:source.text,start:0,end:source.text.length,explanation:'가상 시험의 입장 근거'}];expect(verifiedRecommendations([v])[0].kind).toBe('opposing_view');v.perspectiveChecks[0].quote='가짜';expect(verifiedRecommendations([v])[0].kind).toBe('different_evidence');});
 it('재대조는 중복 집계하지 않고 미실행·실패와 남은 주장을 구분한다',()=>{const v=verification();expect(reliabilityReview({claims:[claim,{...claim,id:'c2'}]},[v,v],'completed')).toMatchObject({completedClaims:1,remaining:1,sourceCount:1,publisherDomainCount:1});expect(reliabilityReview({claims:[claim]},[],'unavailable').status).toBe('research_unavailable');expect(reliabilityReview({claims:[claim]},[],'searching').status).toBe('investigating');});
 it.each([
  {start:0,end:source.text.length+1}, {start:0.1,end:source.text.length},
  {start:0,end:source.text.length+0.1}, {start:NaN,end:source.text.length},
  {start:0,end:Infinity}, {start:-1,end:source.text.length},
 ])('인용 범위가 정수·본문 경계를 벗어나면 slice 보정으로 인정하지 않는다: %j',bounds=>{
  const v=verification();Object.assign(v.checks[0].relations[0],bounds);
  expect(verifiedRecommendations([v])).toEqual([]);
  expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({contradicted:0,insufficient:1});
 });
 it('공백뿐인 인용을 확인된 외부 근거로 사용하지 않는다',()=>{
  const v=structuredClone(verification());v.references[0].text='   ';
  Object.assign(v.checks[0].relations[0],{quote:'   ',start:0,end:3});
  expect(verifiedRecommendations([v])).toEqual([]);
  expect(reliabilityReview({claims:[claim]},[v],'completed')).toMatchObject({contradicted:0,insufficient:1});
 });
 it('의견 인용에도 정수·본문 범위·공백 검증을 적용한다',()=>{
  for(const change of [{end:source.text.length+1},{start:0.5},{end:Infinity},{quote:'',start:0,end:0}]){
   const v=verification();v.checks=[];
   v.perspectiveChecks=[{referenceId:'r1',positionText:'운영 시간을 늘려야 한다.',stance:'opposes_position',quote:source.text,start:0,end:source.text.length,explanation:'가상 입장 근거',...change}];
   expect(verifiedRecommendations([v])).toEqual([]);
  }
 });
 it.each(['failed','skipped'] as const)('자료 없는 후속 %s도 이전 성공을 대체하되 취득 이력은 유지한다',execution=>{
  const previous=verification(),latest=verification();latest.references=[];
  latest.checks[0]={...latest.checks[0],execution,relations:[]};
  const out=reliabilityReview({claims:[claim]},[previous,latest],'partial');
  expect(out).toMatchObject({completedClaims:0,contradicted:0,remaining:1,sourceCount:1,publisherDomainCount:1});
  expect(out.checks[0].execution).toBe(execution);
  expect(verifiedRecommendations([previous,latest])).toEqual([]);
 });
 it('후속 입력자료 검토를 외부 조사 완료나 이전 외부 추천으로 승격하지 않는다',()=>{
  const previous=verification(),latest=verification();latest.references=[{...source,provenance:'provided_text'}];
  expect(reliabilityReview({claims:[claim]},[previous,latest],'completed')).toMatchObject({completedClaims:0,remaining:1,sourceCount:1});
  expect(verifiedRecommendations([previous,latest])).toEqual([]);
 });
 it('같은 주장에 관한 가장 최근의 자료만 추천한다',()=>{
  const previous=verification(),latest=verification();latest.references=[{...source,url:'https://news.example/new'}];
  expect(verifiedRecommendations([previous,latest]).map(c=>c.url)).toEqual(['https://news.example/new']);
 });
 it('현재 분석이 주어지면 미연결·다른 분석·가상 결과를 조사와 추천에서 제외한다',()=>{
  const analysis={analysisId:'current',mode:'live' as const,claims:[claim]};
  for(const change of [{parentAnalysisId:undefined},{parentAnalysisId:'old'},{parentAnalysisId:'current',mode:'demo' as const}]){
   const v={...verification(),...change};
   expect(reliabilityReview(analysis,[v],'completed')).toMatchObject({completedClaims:0,sourceCount:0});
   expect(verifiedRecommendations([v],analysis)).toEqual([]);
  }
  const current={...verification(),parentAnalysisId:'current'};
  expect(reliabilityReview(analysis,[current],'completed').completedClaims).toBe(1);
  expect(verifiedRecommendations([current],analysis)).toHaveLength(1);
 });
 it('가상 분석을 실제 외부 기사 검증 결과로 만들지 않는다',()=>{
  const analysis={analysisId:'demo',mode:'demo' as const,claims:[claim]};
  const v={...verification(),parentAnalysisId:'demo',mode:'demo' as const};
  expect(reliabilityReview(analysis,[v],'completed')).toMatchObject({completedClaims:0,sourceCount:0});
  expect(verifiedRecommendations([v],analysis)).toEqual([]);
 });
 it('과거 분석의 실패를 현재 분석의 성공과 섞지 않는다',()=>{
  const current={...verification(),parentAnalysisId:'current'},old={...verification(),parentAnalysisId:'old'};old.checks[0].execution='failed';
  const analysis={analysisId:'current',mode:'live' as const,claims:[claim]};
  expect(reliabilityReview(analysis,[current,old],'completed').completedClaims).toBe(1);
  expect(verifiedRecommendations([current,old],analysis)).toHaveLength(1);
 });
 it('같은 기사·같은 입장의 후속 재분류가 이전 반대 입장을 대체한다',()=>{
  const previous=verification();previous.checks=[];previous.perspectiveChecks=[{referenceId:'r1',positionText:'운영 시간을 늘려야 한다.',stance:'opposes_position',quote:source.text,start:0,end:source.text.length,explanation:'이전 입장'}];
  const latest=structuredClone(previous);latest.perspectiveChecks![0].stance='supports_position';
  expect(verifiedRecommendations([previous,latest])[0].kind).toBe('supporting_view');
  latest.perspectiveChecks![0].end=source.text.length+1;
  expect(verifiedRecommendations([previous,latest])).toEqual([]);
 });
 it('공백·추적 주소가 달라도 같은 명제와 기사의 최신 입장만 추천한다',()=>{
  const previous=verification();previous.checks=[];
  previous.references=[{...source,url:'https://www.news.example/a/?utm_source=old#quote'}];
  previous.perspectiveChecks=[{referenceId:'r1',positionText:'운영 시간을 늘려야 한다.',stance:'opposes_position',quote:source.text,start:0,end:source.text.length,explanation:'이전 분류'}];
  const latest=structuredClone(previous);
  latest.references[0].url='https://news.example/a?utm_source=new';
  Object.assign(latest.perspectiveChecks![0],{positionText:'  운영  시간을\n늘려야 한다. ',stance:'supports_position',explanation:'새 분류'});
  const cards=verifiedRecommendations([previous,latest]);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({kind:'supporting_view',reason:'새 분류',url:latest.references[0].url});
  expect(reliabilityReview({claims:[claim]},[previous,latest],'completed')).toMatchObject({sourceCount:1,publisherDomainCount:1});
  latest.perspectiveChecks![0].quote='원문에 없는 후속 인용';
  expect(verifiedRecommendations([previous,latest])).toEqual([]);
 });
});
