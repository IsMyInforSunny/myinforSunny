import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import MediaPositionMap from '../components/media-position-map';
import {demoAnalysis} from '../lib/fixtures';
import type {ResearchVerification} from '../lib/research-contract';
import type {MapPoint} from '../lib/reader-metrics';
import {articleMapObservations} from '../lib/reader-metrics';
import {absolutePositionDifference,canonicalArticleUrl,publisherPositions} from '../lib/media-position';

const P='정책 A를 도입해야 한다';
const pt=(host:string,n:number,stance:MapPoint['stance'],o:Partial<MapPoint>={}):MapPoint=>({url:`https://${host}/a${n}`,title:'t',publisher:host,stance,evidence:'unreviewed',quote:'q',reason:'r',position:P,claimCount:0,...o});
const many=(host:string,stances:MapPoint['stance'][],o:Partial<MapPoint>={})=>stances.map((s,i)=>pt(host,i,s,o));

describe('publisherPositions',()=>{
 it('does not count tracking or www aliases as additional articles and handles nonfinite limits',()=>{
  const p=pt('a.com',1,'supports_position');const alias={...p,url:'https://www.a.com/a1?utm_source=x#top'};
  expect(publisherPositions([p,alias]).groups[0].publishers[0].sampleCount).toBe(1);
  expect(publisherPositions([p],{maxPoints:NaN}).invalid).toBe(0);expect(publisherPositions([p],{maxPoints:Infinity}).truncated).toBe(0);
 });
 it('computes centroids only at >=3 unique articles and counts evidence',()=>{
  const r=publisherPositions([...many('www.a.com',['supports_position','supports_position','adds_context'],{evidence:'supports'}),pt('b.com',1,'opposes_position'),pt('b.com',2,'opposes_position')]);
  expect(r.baseline).toBe('provisional');
  const g=r.groups[0];const a=g.publishers.find(p=>p.publisher==='a.com')!,b=g.publishers.find(p=>p.publisher==='b.com')!;
  expect(a.centroidX).toBeCloseTo(2/3);expect(a.sampleCount).toBe(3);expect(a.evidence).toEqual({factSupport:3,factConflict:0,unreviewed:0});
  expect(b.centroidX).toBeNull();expect(b.eligible).toBe(false);expect(b.evidence.unreviewed).toBe(2);
 });
 it('keeps exact positions separate and dedups canonical URLs',()=>{
  const r=publisherPositions([pt('a.com',1,'supports_position'),pt('a.com',1,'supports_position',{url:'https://A.com/a1/?utm_source=x#top'}),pt('a.com',2,'supports_position',{position:`  ${P}  다름`})]);
  expect(r.groups).toHaveLength(2);
  expect(r.groups.find(g=>g.position===P)!.publishers[0].sampleCount).toBe(1);
 });
 it('rejects conflicting duplicate URLs as undetermined',()=>{
  const r=publisherPositions([pt('a.com',1,'supports_position'),pt('a.com',1,'opposes_position')]);
  expect(r.groups[0].undetermined).toBe(1);expect(r.groups[0].publishers).toEqual([]);
 });
 it('counts invalid points and respects the sample limit',()=>{
  const r=publisherPositions([pt('a.com',1,'supports_position'),pt('a.com',2,'supports_position',{url:'javascript:x'}),pt('a.com',3,'supports_position')],{maxPoints:2});
  expect(r.truncated).toBe(1);expect(r.invalid).toBe(1);
 });
 it('uses the same safe article identity for observations, selection, and aggregation',()=>{
  expect(canonicalArticleUrl('https://WWW.a.com/a1/?utm_source=x&z=2&a=1#top')).toEqual({url:'https://a.com/a1?a=1&z=2',host:'a.com'});
  for(const url of ['https://a.com:8080/a1','http://127.0.0.1/a1','https://news.local/a1','https://user:password@a.com/a1']){
   expect(canonicalArticleUrl(url)).toBeNull();
   expect(publisherPositions([pt('a.com',1,'supports_position',{url})]).invalid).toBe(1);
  }
 });
});

describe('absolutePositionDifference',()=>{
 const base=[...many('a.com',['supports_position','supports_position','supports_position']),...many('b.com',['opposes_position','opposes_position','opposes_position'])];
 it('is abs(selected - equally weighted publisher centroids), within 0..2',()=>{
  const r=absolutePositionDifference(base,'https://a.com/a0');
  expect(r.status).toBe('ok');expect(r.referenceCentroid).toBe(0);expect(r.value).toBe(1);
  const skew=[...base,...many('c.com',['supports_position','supports_position','supports_position']),...many('d.com',['supports_position','supports_position','supports_position'])];
  const s=absolutePositionDifference(skew,'https://b.com/a0');
  expect(s.value).toBeCloseTo(1.5);expect(s.value!).toBeLessThanOrEqual(2);
 });
 it('returns null when insufficient or selection is unusable',()=>{
  expect(absolutePositionDifference(many('a.com',['supports_position','supports_position','supports_position']),'https://a.com/a0')).toMatchObject({value:null,reason:'insufficient_publishers'});
  expect(absolutePositionDifference(base)).toMatchObject({value:null,reason:'no_selection'});
  expect(absolutePositionDifference(base,'https://zzz.com/x')).toMatchObject({value:null,reason:'selected_not_found'});
  const conflict=[...base,pt('a.com',0,'opposes_position')];
  expect(absolutePositionDifference(conflict,'https://a.com/a0')).toMatchObject({value:null,reason:'selected_undetermined'});
 });
 it('does not mix propositions',()=>{
  const other=many('c.com',['supports_position','supports_position','supports_position'],{position:'다른 명제'});
  expect(absolutePositionDifference([...base,...other],'https://c.com/a0')).toMatchObject({value:null,reason:'insufficient_publishers'});
 });
 it('weights eligible publishers equally rather than weighting by article count',()=>{
  const unequal=[...many('a.com',Array(9).fill('supports_position')),...many('b.com',Array(3).fill('opposes_position')),pt('small.com',0,'supports_position')];
  expect(absolutePositionDifference(unequal,'https://b.com/a0')).toMatchObject({value:1,referenceCentroid:0,publishersUsed:2});
 });
 it('supports exact 0 and 2 endpoints without treating context as missing',()=>{
  const positive=[...many('a.com',Array(3).fill('supports_position')),...many('b.com',Array(3).fill('supports_position'))];
  expect(absolutePositionDifference(positive,positive[0].url).value).toBe(0);
  // An observed article can be compared even when its publisher is below the centroid threshold.
  const opposite=pt('small.com',0,'opposes_position');
  expect(absolutePositionDifference([...positive,opposite],opposite.url)).toMatchObject({value:2,referenceCentroid:1,publishersUsed:2});
  const context=[...many('a.com',Array(3).fill('adds_context')),...many('b.com',Array(3).fill('adds_context'))];
  expect(absolutePositionDifference(context,context[0].url)).toMatchObject({value:0,selectedCode:0,referenceCentroid:0});
 });
 it('does not select a URL shared by multiple propositions',()=>{
  expect(absolutePositionDifference([...base,{...base[0],position:'별도 명제'}],base[0].url)).toMatchObject({value:null,reason:'selected_ambiguous'});
 });
});

describe('bounded media coordinate module markup',()=>{
 const analysis=()=>({...demoAnalysis('mixed'),mode:'live' as const,proposition:'학교 도서관 운영 시간을 늘려야 한다.'});
 function verification(a:ReturnType<typeof analysis>,host='a.example',count=3,stance:MapPoint['stance']='supports_position'):ResearchVerification{
  const text='도서관 운영 시간에 관한 시험용 기사 문장입니다.';
  return {schemaVersion:'2.1',requestId:`test-${host}`,parentAnalysisId:a.analysisId,mode:'live',status:'success',versions:{rubric:'test',prompt:'test',model:'mock',retriever:'mock'},scope:'retrieved_documents',references:Array.from({length:count},(_,i)=>({id:`r${i}`,url:`https://${host}/article-${i}`,title:`시험 기사 ${i+1}`,provenance:'web_fetched' as const,text,truncated:false})),checks:[],perspectiveChecks:Array.from({length:count},(_,i)=>({referenceId:`r${i}`,positionText:a.proposition,stance,quote:text,start:0,end:text.length,explanation:'시험용 입장 분류 설명'})),attempts:[],warnings:[],createdAt:'2026-11-01T00:00:00Z'};
 }
 const render=(a:ReturnType<typeof analysis>,results:ResearchVerification[]=[])=>renderToStaticMarkup(createElement(MediaPositionMap,{analysis:a,results}));
 it('starts with current data, explicit waiting states, and a bounded result rather than invented coordinates',()=>{
  const html=render(analysis());
  expect(html).toContain('aria-pressed="true">현재 분석 자료');
  expect(html).toContain('가상 좌표 체험');
  expect(html).toContain('범위 0–2');
  expect(html).toContain('계산 대기');
  expect(html).toContain('실제 외부 기사가 없습니다');
  expect(html).not.toContain('school-a.example');
  expect(html).not.toContain('media-publisher-point');
  expect(html).not.toContain('NaN');
 });
 it('renders observed publisher centroids, eligibility, and linked quote explanations separately from fact evidence',()=>{
  const a=analysis();
  const html=render(a,[verification(a),verification(a,'b.example',3,'opposes_position'),verification(a,'small.example',2)]);
  expect(html).toContain('고유 기사 3개 · 좌표 1.000');
  expect(html).toContain('고유 기사 3개 · 좌표 -1.000');
  expect(html).toContain('고유 기사 2개 · 좌표 미산출');
  expect(html).toContain('고유 기사 1개 더 필요');
  expect(html).toContain('2 / 3곳');
  expect(html).toContain('<dt>잠정 기준선</dt><dd>0.000</dd>');
  expect(html).toContain('href="https://a.example/article-0"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('<blockquote>도서관 운영 시간에 관한 시험용 기사 문장입니다.</blockquote>');
  expect(html).toContain('시험용 입장 분류 설명');
  expect(html).toContain('사실 대조 미완료');
  expect(html).toContain('계산 대기'); // A numeric baseline does not auto-select the input article stance.
  expect(html.match(/class="media-publisher-point"/g)).toHaveLength(2);
 });
 it('keeps a lone eligible publisher visible without manufacturing a baseline',()=>{
  const a=analysis(),html=render(a,[verification(a)]);
  expect(html).toContain('고유 기사 3개 · 좌표 1.000');
  expect(html).toContain('<dt>잠정 기준선</dt><dd>계산 대기</dd>');
  expect(html).toContain('적격 매체 2곳 이상 필요');
  expect(html).not.toContain('class="media-baseline-line"');
 });
 it('does not expose unbound, stale, synthetic, or unquoted source observations',()=>{
  const a=analysis(),v=verification(a);
  for(const change of [{parentAnalysisId:undefined},{parentAnalysisId:'old'},{mode:'demo' as const},{perspectiveChecks:[]}]){
   const html=render(a,[{...v,...change}]);
   expect(html).not.toContain('href="https://a.example/');
   expect(html).not.toContain('media-publisher-point');
  }
 });
 it('excludes conflicting repeated classifications instead of silently taking a latest position',()=>{
  const a=analysis();
  const html=render(a,[verification(a),verification(a,'a.example',3,'opposes_position')]);
  expect(html).toContain('중복 분류 충돌 3개');
  expect(html).not.toContain('class="media-publisher-point"');
  expect(html).toContain('집계 전 관측 자료');
 });
 it('requires fetched provenance and exact current-proposition quotes before a publisher is eligible',()=>{
  const a=analysis(),v=verification(a);
  const changes:Partial<ResearchVerification>[]=[
   {references:v.references.map(ref=>({...ref,provenance:'provided_text' as const}))},
   {perspectiveChecks:v.perspectiveChecks!.map(check=>({...check,quote:'원문에 존재하지 않는 인용'}))},
   {perspectiveChecks:v.perspectiveChecks!.map(check=>({...check,end:check.end+1}))},
   {perspectiveChecks:v.perspectiveChecks!.map(check=>({...check,positionText:'서로 다른 정책을 시행해야 한다.'}))},
  ];
  for(const change of changes){
   const html=render(a,[{...v,...change}]);
   expect(html).not.toContain('class="media-publisher-point"');
   expect(html).not.toContain('href="https://a.example/');
   expect(html).toContain('<dt>잠정 기준선</dt><dd>계산 대기</dd>');
  }
 });
 it('does not let repeated tracking aliases promote a one-article publisher to the three-article threshold',()=>{
  const a=analysis(),v=verification(a,'a.example',1);
  const aliases=['?utm_source=one','?utm_source=two','#fragment'].map((suffix,i)=>({
   ...v,requestId:`tracking-${i}`,
   references:v.references.map(ref=>({...ref,url:`${ref.url}${suffix}`})),
  }));
  const html=render(a,aliases);
  expect(html).toContain('고유 기사 1개 · 좌표 미산출');
  expect(html).toContain('고유 기사 2개 더 필요');
  expect(html).not.toContain('class="media-publisher-point"');
  expect(html).toContain('<dt>잠정 기준선</dt><dd>계산 대기</dd>');
 });
 it('withholds a publisher below three unique articles after a conflict inside one verification',()=>{
  const a=analysis(),v=verification(a),opposite=verification(a,'b.example',3,'opposes_position');
  v.references.push({...v.references[0],id:'duplicate',url:`${v.references[0].url}?utm_source=alias`});
  v.perspectiveChecks!.push({...v.perspectiveChecks![0],referenceId:'duplicate',stance:'opposes_position'});
  const report=publisherPositions(articleMapObservations(a,[v,opposite]));
  const group=report.groups[0];
  expect(group.undetermined).toBe(1);
  expect(group.eligiblePublishers).toBe(1);
  expect(group.publishers.find(p=>p.publisher==='a.example')).toMatchObject({sampleCount:2,eligible:false,centroidX:null});
  expect(absolutePositionDifference(articleMapObservations(a,[v,opposite]),opposite.references[0].url)).toMatchObject({value:null,reason:'insufficient_publishers'});
 });
});
