import type {Analysis} from '@/lib/contracts';
import type {ResearchVerification} from '@/lib/research-contract';
import {collectObservedSources} from '@/lib/source-observations';
import {assessSources,normalizeSourceUrl} from '@/lib/source-quality';

export default function SourceObservations({analysis,results}:{analysis:Analysis;results:ResearchVerification[]}){
 const sources=collectObservedSources(analysis,results);const quality=assessSources(sources.fetched);const count=quality.summary;
 const excluded=Object.values(sources.excluded).reduce((n,v)=>n+v,0);
 return <section className="source-observations" aria-label="자료 상태 확인">
  <div className="report-section-title"><h3>자료 상태 확인</h3><span className="badge">확인한 정보만</span></div>
  <p className="section-description">자료가 어디서 왔고 얼마나 확인됐는지 살펴봅니다. 신뢰 점수나 독립 취재원 수가 아닙니다.</p>
  <div className="source-observation-counts"><span>웹 본문 {sources.fetched.length}개</span><span>직접 입력 {sources.provided.length}개</span><span>가상 예시 {sources.demo.length}개</span></div>
  {sources.fetched.length?<>
   <dl className="source-observation-stats"><div><dt>발행일 미확인</dt><dd>{count.missingPublishedAt}개</dd></div><div><dt>본문이 잘린 자료</dt><dd>{count.truncated}개</dd></div><div><dt>중복 내용 후보</dt><dd>{quality.contentClusters.length}묶음</dd></div><div><dt>같은 매체 자료</dt><dd>{quality.sameHostGroups.length}묶음</dd></div></dl>
   {quality.contentClusters.length>0&&<p className="source-observation-warning">같거나 매우 비슷한 내용이 있습니다. 다른 사이트에 실렸어도 독립적인 근거 여러 개로 해석하지 마세요.</p>}
   {quality.sameHostGroups.length>0&&<p className="topic-note">같은 호스트의 자료가 여러 개 있습니다. 같은 매체인지와 독립적으로 취재한 자료인지는 별개의 문제입니다.</p>}
   {sources.temporalWarnings.length>0&&<p className="source-observation-warning">발행일과 검토 대상 기간을 다시 살펴볼 자료가 {new Set(sources.temporalWarnings.map(w=>w.referenceId)).size}개 있습니다. 발행일만으로 내용의 시점이나 사실 상충을 확정하지 않습니다.</p>}
   <details><summary>자료별 상태 보기</summary>{sources.fetched.map(ref=>{
    const observation=quality.items.find(item=>item.id===ref.id)!;const url=normalizeSourceUrl(ref.url);
    return <article className="source-observation-item" key={ref.id}><h4>{url.status==='ok'?<a href={ref.url} target="_blank" rel="noopener noreferrer">{ref.title??url.host} ↗</a>:ref.title??'주소를 확인하지 못한 자료'}</h4><p>발행일 {observation.publishedAt.status==='present'?observation.publishedAt.iso?.slice(0,10):'미확인'} · 취득일 {observation.fetchedAt.status==='present'?observation.fetchedAt.iso?.slice(0,10):'미확인'}</p><p>확보 본문 {observation.body.chars.toLocaleString()}자 · {observation.body.truncation==='truncated'?'일부 발췌':observation.body.truncation==='complete'?'취득 텍스트 내 잘림 표시 없음':'잘림 여부 불명'} · 본문 안 링크 {observation.sourceLinks.count}개</p></article>;
   })}</details>
  </>:<p className="source-observation-empty">아직 상태를 확인할 실제 웹 취득 자료가 없습니다. 검색 결과·직접 입력 자료·가상 예시를 웹에서 검증한 자료로 바꾸지 않습니다.</p>}
  {sources.provided.length>0&&<p className="topic-note">직접 입력한 자료 {sources.provided.length}개는 입력한 텍스트를 대조한 결과입니다. 주소가 있어도 원 사이트 본문을 가져왔다는 뜻은 아닙니다.</p>}
  {sources.demo.length>0&&<p className="topic-note">가상 예시 자료 {sources.demo.length}개는 기능을 설명하기 위해 작성한 자료입니다. 실제 기사나 실제 외부 조사 결과가 아닙니다.</p>}
  {excluded>0&&<p className="topic-note">현재 분석과 연결을 확인하지 못한 결과 {excluded}개는 표시에서 제외했습니다.</p>}
  <p className="topic-note">날짜·링크·길이·잘림 여부는 자료의 정확성을 보장하지 않습니다. 링크가 없다고 원자료가 없다고 단정하지 않습니다.</p>
 </section>;
}
