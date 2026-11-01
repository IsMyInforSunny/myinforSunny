'use client';
import {useId,useState} from 'react';
import type {Analysis} from '@/lib/contracts';
import type {ResearchVerification} from '@/lib/research-contract';
import {articleMapPoints,type MapPoint} from '@/lib/reader-metrics';
import {publisherPositions,absolutePositionDifference,MAX_POSITION_POINTS} from '@/lib/media-position';

const DEMO_POSITION='학교 도서관 운영 시간을 늘려야 한다.';
const sample:MapPoint[]=['supports_position','supports_position','adds_context','opposes_position','opposes_position','adds_context'].map((stance,i)=>({url:`https://school-${i<3?'a':'b'}.example/article-${i}`,title:`가상 도서관 기사 ${i+1}`,publisher:`가상 교내신문 ${i<3?'A':'B'}`,stance:stance as MapPoint['stance'],evidence:'unreviewed',quote:'직접 구성한 좌표 계산 예시입니다.',reason:'학습용 예시',position:DEMO_POSITION,claimCount:0}));
const x=(value:number)=>70+(value+1)*220;
const normal=(value:string)=>value.trim().replace(/\s+/g,' ');
const stanceLabels:Record<MapPoint['stance'],string>={opposes_position:'반대 −1',adds_context:'맥락 보충 0',supports_position:'찬성 +1'};
const evidenceLabels:Record<MapPoint['evidence'],string>={supports:'사실 관계 뒷받침',contradicts:'사실 관계 상충',mixed:'사실 관계 혼재',unreviewed:'사실 대조 미완료'};
const publisherLabel=(publisher:string,demo:boolean)=>demo?`가상 교내신문 ${publisher.includes('school-a')?'A':'B'}`:publisher;

export default function MediaPositionMap({analysis,results}:{analysis:Analysis;results:ResearchVerification[]}){
 const id=useId();
 const [demo,setDemo]=useState(false),[selection,setSelection]=useState('');
 const [manual,setManual]=useState({context:'',code:''});
 // Preserve conflicting observations across runs so the statistics module can reject them.
 const points=demo?sample:results.flatMap(v=>articleMapPoints(analysis,[v]));
 const report=publisherPositions(points);
 const group=report.groups.find(g=>g.position===selection)??report.groups[0];
 const context=JSON.stringify([analysis.analysisId,demo,group?.position]);
 const ownCode=manual.context===context?manual.code:'';
 const eligible=group?.publishers.filter(p=>p.eligible)??[];
 const baseline=eligible.length>=report.minEligiblePublishers?eligible.reduce((n,p)=>n+p.centroidX!,0)/eligible.length:null;
 const absolute=baseline!==null&&ownCode!==''?Math.abs(Number(ownCode)-baseline):null;
 const articleDifference=demo?absolutePositionDifference(sample,sample[0].url):null;
 const max=Math.max(report.minArticlesPerPublisher,...(group?.publishers.map(p=>p.sampleCount)??[]));
 const conflicts=report.groups.reduce((n,g)=>n+g.undetermined,0);
 const observed=points.slice(0,MAX_POSITION_POINTS).filter(p=>normal(p.position)===group?.position);
 const switchMode=(value:boolean)=>{setDemo(value);setSelection('');setManual({context:'',code:''});};

 return <section className="media-position-map reader-feature" aria-labelledby={`${id}-title`}>
  <div className="report-section-title media-header">
   <div><p className="media-eyebrow">매체 좌표 · 입장 비교</p><h3 id={`${id}-title`}>같은 명제, 얼마나 다른 위치일까요?</h3></div>
   <span className="badge media-baseline-badge">관측 입장 · 잠정 기준선</span>
  </div>
  <p className="section-description">수집된 기사에서 관찰한 입장을 매체별 좌표로 모아 비교합니다. 언론사의 고정 성향이나 정치 점수가 아닙니다.</p>
  <div className="media-mode" role="group" aria-label="좌표 자료 선택">
   <button type="button" className={`small-button ${!demo?'selected':''}`} aria-pressed={!demo} onClick={()=>switchMode(false)}>현재 분석 자료</button>
   <button type="button" className={`small-button ${demo?'selected':''}`} aria-pressed={demo} onClick={()=>switchMode(true)}>가상 좌표 체험</button>
  </div>
  {demo&&<p className="notice media-synthetic-notice" role="status">가상 교내신문 A·B의 기사 6개로 직접 구성한 학습용 예시입니다. 실제 언론사 분석·웹 검색·평가 결과가 아니며 현재 분석 자료와 섞이지 않습니다.</p>}
  {(report.invalid>0||report.truncated>0||conflicts>0)&&<p className="notice media-exclusions">좌표 집계 제외: 형식 미확인 {report.invalid}개 · 처리 한도 초과 {report.truncated}개 · 중복 분류 충돌 {conflicts}개. 제외된 자료는 기준선에 사용하지 않습니다.</p>}
  {report.groups.length>1&&<label className="media-select">비교 명제<select value={group?.position??''} onChange={e=>{setSelection(e.target.value);setManual({context:'',code:''});}}>{report.groups.map(g=><option key={g.position} value={g.position}>{g.position}</option>)}</select></label>}
  <p className="map-proposition media-proposition"><strong>비교 명제</strong> {group?.position??analysis.proposition??analysis.claims.find(c=>c.kind==='opinion')?.text??'명시적인 제안이 확인되면 비교합니다.'}</p>

  <div className="media-comparison media-difference-card">
   <div className="media-difference-controls">
    <span className="media-eyebrow">핵심 비교 · 절댓값</span><h4>입장 차이의 절댓값</h4>
    <p>이 명제에 대한 입력 기사의 입장을 직접 지정하세요. 자동 판정이나 사실 검증 결과가 아닙니다.</p>
    <label className="media-select" htmlFor={`${id}-stance`}>직접 지정한 입력 기사 입장</label>
    <select id={`${id}-stance`} className="media-stance-select" value={ownCode} onChange={e=>setManual({context,code:e.target.value})} aria-describedby={`${id}-formula`}>
     <option value="">판단 유보 · 미지정</option><option value="-1">반대 −1</option><option value="0">맥락 보충 0</option><option value="1">찬성 +1</option>
    </select>
   </div>
   <div className="media-difference-result">
    <output className="media-absolute-output" htmlFor={`${id}-stance`} aria-label="입장 차이의 절댓값" aria-live="polite">
     <strong>{absolute===null?'계산 대기':absolute.toFixed(3)}</strong>
     <small>범위 0–2 · 관측 입장 차이</small>
     <small>{absolute===null?(baseline===null?`적격 매체 ${report.minEligiblePublishers}곳 이상 필요`:'입장 지정 필요'):'직접 지정한 입장과 잠정 기준선의 거리'}</small>
    </output>
    {absolute!==null&&<meter className="media-difference-meter" min={0} max={2} value={absolute} aria-label="0에서 2 사이의 입장 차이">{absolute.toFixed(3)} / 2</meter>}
    <p className="media-range-legend">0 = 기준선과 같은 위치 · 2 = 가능한 최대 차이</p>
   </div>
  </div>
  <p id={`${id}-formula`} className="topic-note media-formula">계산식 |직접 지정한 기사 입장 − 적격 매체별 평균 위치의 동일 가중 평균|. {absolute!==null&&`|${Number(ownCode).toFixed(3)} − (${baseline!.toFixed(3)})| = ${absolute.toFixed(3)}. `}표시값은 소수 셋째 자리까지 반올림하며 계산에는 원래 값을 사용합니다.</p>
  <dl className="media-summary">
   <div><dt>잠정 기준선</dt><dd>{baseline===null?'계산 대기':baseline.toFixed(3)}</dd></div>
   <div><dt>적격 매체</dt><dd>{eligible.length} / {group?.publishers.length??0}곳</dd></div>
   <div><dt>매체별 최소 표본</dt><dd>고유 기사 {report.minArticlesPerPublisher}개</dd></div>
  </dl>
  <p className="topic-note media-eligibility">매체별 고유 기사 {report.minArticlesPerPublisher}개 이상이면 좌표를 표시하고, 적격 매체 {report.minEligiblePublishers}곳 이상이면 기준선을 계산합니다. 기사 수가 많은 매체에도 동일한 가중치를 적용합니다.</p>

  <figure className="media-chart">
   <svg className="media-scatter" viewBox="0 0 580 315" role="img" aria-labelledby={`${id}-chart-title ${id}-chart-desc`}>
    <title id={`${id}-chart-title`}>{`${demo?'가상 예시 · ':''}${eligible.length}개 적격 매체의 관측 입장 좌표`}</title>
    <desc id={`${id}-chart-desc`}>가로축은 반대 −1, 맥락 보충 0, 찬성 +1입니다. 세로축은 매체별 고유 기사 수입니다. 점은 매체별 평균 위치, 파란 점선은 잠정 기준선, 주황 점선은 직접 지정한 입장입니다. 수치는 아래 매체 목록에서도 확인할 수 있습니다.</desc>
    <rect x="70" y="25" width="440" height="220" rx="10" fill="#effaff"/>
    {[-1,-.5,0,.5,1].map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="25" y2="245" stroke="#c4dfea" strokeDasharray={v===0?'4 4':undefined}/><text x={x(v)} y="265" textAnchor="middle">{v>0?'+':''}{v}</text></g>)}
    <line x1="70" x2="510" y1="245" y2="245" stroke="#263f4c"/><line x1="70" x2="70" y1="25" y2="245" stroke="#263f4c"/>
    {[0,max].map(n=><text key={n} x="60" y={249-(n/max)*220} textAnchor="end">{n}</text>)}
    <text x="65" y="16">기사 수</text><text x="70" y="293" textAnchor="start">반대 입장</text><text x="290" y="293" textAnchor="middle">맥락 보충</text><text x="510" y="293" textAnchor="end">찬성 입장</text>
    {baseline!==null&&<g className="media-baseline-line"><line x1={x(baseline)} x2={x(baseline)} y1="25" y2="245" stroke="#3b77c9" strokeDasharray="7 4"/><text x={x(baseline)} y="40" textAnchor={baseline>0?'end':'start'} fill="#2564a8">기준선 {baseline.toFixed(2)}</text></g>}
    {ownCode!==''&&<g className="media-manual-line"><line x1={x(Number(ownCode))} x2={x(Number(ownCode))} y1="55" y2="245" stroke="#c27620" strokeDasharray="3 4"/><text x={x(Number(ownCode))} y="232" textAnchor={Number(ownCode)>0?'end':'start'} fill="#865212">직접 지정</text></g>}
    {eligible.map((p,i)=><g className="media-publisher-point" key={p.publisher}><title>{`${publisherLabel(p.publisher,demo)}: 고유 기사 ${p.sampleCount}개, 위치 ${p.centroidX!.toFixed(3)}`}</title><circle cx={x(p.centroidX!)} cy={245-(p.sampleCount/max)*220} r="10" fill={i%2?'#178f92':'#3c63bd'} stroke="white" strokeWidth="3"/><text x={x(p.centroidX!)} y={Math.max(16,226-(p.sampleCount/max)*220)} textAnchor={p.centroidX!>.7?'end':p.centroidX!<-.7?'start':'middle'}>{publisherLabel(p.publisher,demo)}</text></g>)}
    {!eligible.length&&<text x="290" y="135" textAnchor="middle">매체별 기사 {report.minArticlesPerPublisher}개 이상이면 좌표를 표시합니다.</text>}
   </svg>
   <figcaption className="topic-note media-chart-caption">점 = 매체 평균 · 파란 점선 = 잠정 기준선 · 주황 점선 = 직접 지정. ‘맥락 보충 0’은 객관성·중립성 인증이 아닙니다.</figcaption>
  </figure>

  {group?.publishers.length?<div className="media-publisher-list" role="list" aria-label="매체별 좌표와 표본 적격 여부">{group.publishers.map(p=><div className="media-publisher-card" role="listitem" key={p.publisher}>
   <b>{publisherLabel(p.publisher,demo)}</b><span className={`badge media-eligibility-badge ${p.eligible?'media-eligible':'media-insufficient'}`}>{p.eligible?'좌표 표시 가능':'표본 부족'}</span>
   <span>고유 기사 {p.sampleCount}개 · 좌표 {p.centroidX===null?'미산출':p.centroidX.toFixed(3)}</span>
   <small>{p.eligible?(baseline===null?'기준선 대기 · 다른 적격 매체 필요':'잠정 기준선에 동일 가중 반영'):`좌표 표시까지 고유 기사 ${report.minArticlesPerPublisher-p.sampleCount}개 더 필요`}</small>
   <small>사실 대조 (입장과 별개): 뒷받침 {p.evidence.factSupport} · 상충·혼재 {p.evidence.factConflict} · 미완료 {p.evidence.unreviewed}</small>
  </div>)}</div>:<p className="notice media-empty">현재는 좌표를 계산할 실제 외부 기사가 없습니다. 현재 분석에 연결되고 명제·원문 인용이 확인된 외부 자료만 사용합니다. 가상 좌표 체험에서 계산 방식을 살펴볼 수 있습니다.</p>}

  {observed.length>0&&<details className="media-observed-sources"><summary>{demo?'가상 예시의 구성':'관측 출처와 입장 분류 근거'} · {observed.length}건</summary>
   <p className="topic-note">{demo?'아래 문장과 주소는 직접 구성한 가상 예시이며 실제 출처가 아닙니다.':'집계 전 관측 자료입니다. URL 중복은 한 번만 세고 분류가 충돌하는 URL은 집계에서 제외합니다. 출처의 입장과 사실 대조는 서로 다른 정보입니다.'} 최대 20건을 표시합니다.</p>
   <ul className="media-source-list">{observed.slice(0,20).map((p,i)=><li className="media-source-item" key={`${p.url}-${i}`}>
    {demo?<strong>{p.title} · 가상 자료</strong>:<a href={p.url} target="_blank" rel="noopener noreferrer">{p.title} ↗</a>}
    <p>{p.publisher} · {stanceLabels[p.stance]} · {evidenceLabels[p.evidence]}</p>
    <blockquote>{p.quote}</blockquote><p className="topic-note">분류 설명: {p.reason}</p>
   </li>)}</ul>
   {observed.length>20&&<p className="topic-note">나머지 {observed.length-20}건은 이 목록에서 생략했습니다. 목록 표시 한도는 좌표 집계 한도와 별개입니다.</p>}
  </details>}
  {demo&&articleDifference?.value!=null&&<p className="topic-note media-sample-difference">가상 첫 기사 (+1)와 기준선의 차이: {articleDifference.value.toFixed(3)} / 2 · 직접 작성한 계산 예시이며 위의 직접 지정 값과 별개입니다.</p>}
  <details className="media-methodology"><summary>좌표의 기준과 제한</summary><p className="topic-note">매체별 고유 기사 {report.minArticlesPerPublisher}개와 적격 매체 {report.minEligiblePublishers}곳은 계산을 시작하는 최소 조건일 뿐 검증된 평가 기준이나 대표 표본을 보장하지 않습니다. 동일 명제만 비교하고 URL 중복·분류 충돌을 제외합니다. 최대 {MAX_POSITION_POINTS}개 관측 자료까지만 처리합니다. 수집 범위·기간·주제의 영향을 받으며, 자료가 많거나 기준선에 가깝다고 중립이나 진실이 되는 것은 아닙니다. 보정된 편향·신뢰도·정치 성향 점수가 아닙니다.</p></details>
 </section>;
}
