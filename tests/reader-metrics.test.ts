import {describe,expect,it} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources,locate,validSpan} from '../lib/domain';
import {articleAnnotations,articleMapObservations,articleMapPoints,fomoSignals,reviewSegments} from '../lib/reader-metrics';
import {publisherPositions} from '../lib/media-position';
import type {Analysis,Check,Span} from '../lib/contracts';
import type {ResearchVerification} from '../lib/research-contract';

function analysis(body='학교 도서관은 오후 6시에 닫는다.'):Analysis{
 const a=structuredClone(demoAnalysis('mixed'));a.mode='live';a.analysisId='reader_test';a.sources=makeSources({kind:'text',body,comments:[]});a.expressions=[];a.claims=[];a.proposition='도서관 운영 시간을 늘려야 한다.';return a;
}
function factual(a:Analysis){const source=a.sources[0],sentence=source.sentences[0];const origin=locate(a.sources,{sentenceId:sentence.id,quote:source.text.slice(sentence.start,sentence.end)})!;a.claims=[{id:'c1',kind:'factual',text:origin.quote,origin:[origin]}];return origin;}
function verification(a:Analysis):ResearchVerification{
 const text='학교 도서관은 오후 9시에 닫는다. 시간을 늘릴 필요가 없다.';
 return {schemaVersion:'2.1',requestId:'reader_test',parentAnalysisId:a.analysisId,mode:'live',status:'success',versions:{rubric:'test',prompt:'test',model:'mock',retriever:'mock'},scope:'retrieved_documents',references:[{id:'r1',provenance:'web_fetched',url:'https://news.example/library',text,title:'도서관 운영시간 가상 시험 자료',truncated:false}],checks:[{claimId:'c1',outcome:'contradicted',execution:'completed',relations:[{referenceId:'r1',quote:text.slice(0,23),start:0,end:23,relation:'contradicts',explanation:'대조한 운영 시간이 다릅니다.'}],explanation:'같은 시점의 운영 시간이 다릅니다.',temporalFit:'matched',limitations:[]}],perspectiveChecks:[{referenceId:'r1',positionText:a.proposition!,stance:'opposes_position',quote:text,start:0,end:text.length,explanation:'시간 연장에 반대합니다.'}],attempts:[],warnings:[],createdAt:'2026-11-01T00:00:00Z'};
}
describe('기사 문장 표시와 FOMO 표현 탐색',()=>{
 it('미대조 사실 주장을 거짓이나 상충으로 표시하지 않는다',()=>{const a=analysis();factual(a);expect(articleAnnotations(a).map(a=>a.tone)).toEqual(['unverified']);});
 it('원문 인용 위치가 틀리면 표시하지 않는다',()=>{const a=analysis();factual(a);a.claims[0].origin[0].quote='원문에 없는 내용';expect(articleAnnotations(a)).toEqual([]);});
 it('검증 자료 없이 전달된 결과나 인용 불일치를 상충으로 승격하지 않는다',()=>{const a=analysis();factual(a);const v=verification(a);expect(articleAnnotations(a,v.checks)[0].tone).toBe('unverified');v.checks[0].relations[0].quote='없는 인용';expect(articleAnnotations(a,[],[v])[0].tone).toBe('unverified');});
 it('인용이 일치하고 시점이 맞는 대조만 강한 표시를 한다',()=>{const a=analysis();factual(a);const v=verification(a);expect(articleAnnotations(a,[],[v])[0].tone).toBe('contradicted');v.checks[0].temporalFit='mismatched';expect(articleAnnotations(a,[],[v])[0].tone).toBe('unverified');});
 it('공백뿐인 대조·입장 인용을 확인된 밑줄이나 지도 근거로 쓰지 않는다',()=>{
  const a=analysis();factual(a);const v=verification(a),ref=v.references[0];
  const start=ref.text.indexOf(' '),blank={quote:' ',start,end:start+1};
  v.checks[0].outcome='supported';Object.assign(v.checks[0].relations[0],blank,{relation:'supports'});
  Object.assign(v.perspectiveChecks![0],blank);
  expect(articleAnnotations(a,[],[v])[0].tone).toBe('unverified');
  expect(articleMapObservations(a,[v])).toEqual([]);expect(articleMapPoints(a,[v])).toEqual([]);
 });
 it('재검토가 실패하면 이전 성공 표시를 유지하지 않는다',()=>{const a=analysis();factual(a);const v=verification(a);const failed=structuredClone(v);failed.checks[0].execution='failed';expect(articleAnnotations(a,[],[v,failed])[0].tone).toBe('unverified');});
 it('겹치는 표시를 분할해도 원문과 이모지가 보존된다',()=>{const text='😀 오늘만 마지막 기회';const base:Span={sourceId:'body',sentenceId:'s1',start:3,end:6,quote:'오늘만'};const pieces=reviewSegments(text,[{id:'a',tone:'fomo',label:'후보',reason:'규칙',span:base},{id:'b',tone:'expression',label:'표현',reason:'규칙',span:{...base,start:3,end:text.length,quote:text.slice(3)}}]);expect(pieces.map(p=>p.text).join('')).toBe(text);expect(pieces.find(p=>p.start===3)?.annotations).toHaveLength(2);});
 it('긴급성·희소성·동조 표현과 분모를 문장 단위로 집계한다',()=>{const a=analysis('오늘만 마지막 기회입니다. 나만 뒤처지면 안 됩니다. 평범한 소식입니다.');expect(fomoSignals(a)).toMatchObject({totalSentences:3,flaggedSentences:2});expect(new Set(fomoSignals(a).signals.map(s=>s.category)).size).toBe(3);});
 it('인용한 구호나 명시적 부정을 단정적으로 탐지하지 않는다',()=>{const a=analysis('“지금 당장”이라는 문구를 비판한다. 마지막 기회가 아니다.');expect(fomoSignals(a).flaggedSentences).toBe(0);});
 it('긴 문장의 처리 조각을 중복 문장으로 집계하지 않는다',()=>{const a=analysis('오늘만 '+ '가'.repeat(1050)+' 마지막 기회입니다.');expect(a.sources[0].sentences.length).toBeGreaterThan(1);expect(fomoSignals(a)).toMatchObject({totalSentences:1,flaggedSentences:1});});
 it('처리 조각 사이의 FOMO 표현도 집계와 동일한 원문 위치에 표시한다',()=>{
  const a=analysis('가'.repeat(495)+' 지금 당장 참여하세요.');
  expect(a.sources[0].sentences).toHaveLength(2);
  const signals=fomoSignals(a);expect(signals).toMatchObject({totalSentences:1,flaggedSentences:1});
  expect(signals.signals.map(s=>s.quote)).toEqual(['지금 당장']);
  const annotations=articleAnnotations(a).filter(a=>a.tone==='fomo');
  expect(annotations.map(a=>a.span.quote)).toEqual(['지금','당장']);
  expect(annotations.every(annotation=>validSpan(a.sources,annotation.span))).toBe(true);
  expect(annotations.every(annotation=>annotation.reason.includes('지금 당장'))).toBe(true);
  const pieces=reviewSegments(a.sources[0].text,annotations);
  expect(pieces.map(p=>p.text).join('')).toBe(a.sources[0].text);
  expect(pieces.filter(p=>p.annotations.length).map(p=>p.text).join('')).toBe('지금당장');
 });
 it('빈 본문은 0/0 수치 대신 빈 집계를 준다',()=>{const a=analysis();a.sources=[];expect(fomoSignals(a)).toMatchObject({totalSentences:0,flaggedSentences:0,signals:[]});});
});
describe('기사별 관점·근거 좌표',()=>{
 it('미연결·다른 분석·가상 결과는 밑줄과 좌표에 섞이지 않는다',()=>{const a=analysis();factual(a);for(const change of [{parentAnalysisId:undefined},{parentAnalysisId:'old'},{mode:'demo' as const}]){const v={...verification(a),...change};expect(articleAnnotations(a,[],[v])[0].tone).toBe('unverified');expect(articleMapPoints(a,[v])).toEqual([]);}});
 it('검색 결과나 수동 자료와 가상 예시를 실제 언론사 좌표로 만들지 않는다',()=>{const a=analysis();factual(a);const v=verification(a);v.references[0].provenance='provided_text';expect(articleMapPoints(a,[v])).toEqual([]);v.references[0].provenance='web_fetched';a.mode='demo';expect(articleMapPoints(a,[v])).toEqual([]);});
 it('명제와 인용이 확인된 기사만 입장과 사실 관계를 별개로 표시한다',()=>{const a=analysis();factual(a);const v=verification(a);expect(articleMapPoints(a,[v])[0]).toMatchObject({stance:'opposes_position',evidence:'contradicts',claimCount:1});});
 it('시점이 다르면 자료 상충 좌표 대신 대조 미완료로 둔다',()=>{const a=analysis();factual(a);const v=verification(a);v.checks[0].temporalFit='mismatched';expect(articleMapPoints(a,[v])[0]).toMatchObject({stance:'opposes_position',evidence:'unreviewed',claimCount:0});});
 it('상충 판정이 아닌 관계를 상충 좌표로 오독하지 않는다',()=>{const a=analysis();factual(a);const v=verification(a);v.checks[0].outcome='insufficient';expect(articleMapPoints(a,[v])[0].evidence).toBe('unreviewed');v.checks[0].outcome='supported';expect(articleMapPoints(a,[v])[0].evidence).toBe('unreviewed');});
 it('다른 명제나 존재하지 않는 인용을 사용한 좌표는 제외한다',()=>{const a=analysis();factual(a);const v=verification(a);v.perspectiveChecks![0].positionText='학교 휴대전화를 금지해야 한다.';expect(articleMapPoints(a,[v])).toEqual([]);v.perspectiveChecks![0].positionText=a.proposition!;v.perspectiveChecks![0].quote='출처에 없음';expect(articleMapPoints(a,[v])).toEqual([]);});
 it('반복 대조는 같은 기사 한 점으로 표시하며 다른 분석 결과를 섞지 않는다',()=>{const a=analysis();factual(a);const v=verification(a);expect(articleMapPoints(a,[v,v])).toHaveLength(1);v.parentAnalysisId='another';expect(articleMapPoints(a,[v])).toEqual([]);});
 it('한 검토 안 동일 URL의 모순 입장은 순서와 무관하게 유보한다',()=>{
  const a=analysis();factual(a);const v=verification(a),ref=v.references[0],opposes=v.perspectiveChecks![0];
  v.references.push({...ref,id:'r2',url:`${ref.url}?utm_source=duplicate#top`});
  v.perspectiveChecks!.push({...opposes,referenceId:'r2',stance:'supports_position',explanation:'반대되는 시험 분류'});
  for(const references of [v.references,[...v.references].reverse()]){
   const result={...v,references};
   expect(articleMapPoints(a,[result])).toEqual([]);
   const observations=articleMapObservations(a,[result]);
   expect(observations).toHaveLength(2);
   expect(publisherPositions(observations).groups[0]).toMatchObject({undetermined:1,publishers:[]});
  }
 });
 it('같은 참조에 여러 유효한 입장 인용이 있으면 첫 분류로 확정하지 않는다',()=>{
  const a=analysis();factual(a);const v=verification(a),opposes=v.perspectiveChecks![0];
  v.perspectiveChecks!.push({...opposes,stance:'supports_position'});
  expect(articleMapPoints(a,[v])).toEqual([]);
  expect(articleMapObservations(a,[v]).map(p=>p.stance).sort()).toEqual(['opposes_position','supports_position']);
  v.perspectiveChecks![1].quote='원문에 없는 인용';
  expect(articleMapPoints(a,[v])).toHaveLength(1); // An unvalidated observation cannot veto a valid quote.
 });
 it('동일한 기사라도 명제가 다르면 각 명제의 입장을 별도로 보존한다',()=>{
  const a=analysis();factual(a);const other='도서관 주말 운영을 시작해야 한다.';
  a.claims.push({id:'opinion',kind:'opinion',text:other,origin:a.claims[0].origin});
  const v=verification(a),opposes=v.perspectiveChecks![0];
  v.perspectiveChecks!.push({...opposes,positionText:other,stance:'supports_position'});
  expect(articleMapPoints(a,[v]).map(p=>[p.position,p.stance])).toEqual([[a.proposition,'opposes_position'],[other,'supports_position']]);
 });
 it('여러 검토의 A/B/A 분류도 최신 입장으로 되돌리지 않고 계속 유보한다',()=>{
  const a=analysis();factual(a);const first=verification(a),second=structuredClone(first);
  second.perspectiveChecks![0].stance='supports_position';
  expect(articleMapPoints(a,[first,second,first])).toEqual([]);
  expect(publisherPositions(articleMapObservations(a,[first,second,first])).groups[0].undetermined).toBe(1);
 });
});
