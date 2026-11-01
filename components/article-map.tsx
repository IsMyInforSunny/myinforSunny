import type {Analysis} from '@/lib/contracts';
import type {ResearchVerification} from '@/lib/research-contract';
import {articleMapPoints,type MapPoint} from '@/lib/reader-metrics';
const columns:[MapPoint['stance'],string][]=[['opposes_position','다른 입장'],['adds_context','맥락 보충'],['supports_position','같은 입장']];
const rows:[MapPoint['evidence'],string][]=[['supports','사실 주장 뒷받침'],['mixed','뒷받침·상충 혼재'],['contradicts','사실 주장과 상충'],['unreviewed','사실 대조 미완료']];
export default function ArticleMap({analysis,results}:{analysis:Analysis;results:ResearchVerification[]}){
 const points=articleMapPoints(analysis,results);const positions=[...new Set(points.map(p=>p.position))];
 return <section className="article-map reader-feature" aria-label="기사 관점과 근거 지도"><div className="report-section-title"><h3>편향 살펴보기 · 기사 비교 지도</h3><span className="badge">기사별 상대 비교</span></div>
  <p className="section-description">가로는 명시한 주장에 대한 입장, 세로는 확인한 사실 주장과 자료의 관계입니다. 언론사의 정치 성향이나 신뢰도 점수를 뜻하지 않습니다.</p>
  {!points.length?<div className="notice">{analysis.mode==='demo'?'가상 예시를 실제 언론사 좌표로 표시하지 않습니다.':'아직 지도에 올릴 기사가 없어요. 비교할 명제와 외부 기사 본문·입장 인용이 확인되면 표시합니다.'}</div>:positions.map(position=><div className="article-map-group" key={position}><p className="map-proposition"><strong>비교 명제</strong> {position}</p><div className="article-map-grid" role="table" aria-label={`비교 명제: ${position}`}><div role="row" className="map-grid-row"><div role="columnheader">근거 관계 ↓ / 입장 →</div>{columns.map(([id,label])=><div role="columnheader" key={id}>{label}</div>)}</div>{rows.map(([row,label])=><div role="row" className="map-grid-row" key={row}><div role="rowheader">{label}</div>{columns.map(([column])=><div role="cell" key={column}>{points.filter(p=>p.position===position&&p.evidence===row&&p.stance===column).map(point=><a className="article-map-point" href={point.url} key={point.url} target="_blank" rel="noopener noreferrer"><strong>{point.publisher}</strong><span>{point.title}</span></a>)}</div>)}</div>)}</div></div>)}
  {points.length>0&&<details><summary>좌표의 근거 인용 {points.length}개 보기</summary>{points.map(point=><article className="source-box" key={point.url}><h4><a href={point.url} target="_blank" rel="noopener noreferrer">{point.title} ↗</a></h4><blockquote>“{point.quote.slice(0,280)}{point.quote.length>280?'…':''}”</blockquote><p>{point.reason}</p><small>사실 관계 대조 {point.claimCount}개 · 본문 취득·인용 일치 확인</small></article>)}</details>}
  <p className="topic-note">같은 언론사의 기사도 주제·시점에 따라 달라집니다. 자료와 다른 내용이 있어도 기사 전체를 거짓으로 판정하지 않으며, 중립 칸도 객관성 인증이 아닙니다.</p>
 </section>;
}
