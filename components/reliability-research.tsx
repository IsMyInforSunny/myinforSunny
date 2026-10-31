'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,LoaderCircle,Search} from 'lucide-react';
import type {Analysis,Capabilities} from '@/lib/contracts';
import type {ResearchStage,ResearchVerification} from '@/lib/research-contract';
import {reliabilityReview,verifiedRecommendations} from '@/lib/reliability';
import {researchWait,runResearch} from '@/lib/research-runner';
export default function ReliabilityResearch({analysis,cap,onChange}:{analysis:Analysis;cap:Capabilities|null;onChange:(results:ResearchVerification[],stage:ResearchStage)=>void}){
 const [consent,setConsent]=useState(false),[started,setStarted]=useState(false),[stage,setStage]=useState<ResearchStage>('not_started'),[message,setMessage]=useState(''),[results,setResults]=useState<ResearchVerification[]>([]);
 const callback=useRef(onChange);callback.current=onChange;const control=useRef<AbortController|null>(null);
 const ready=!!cap?.live&&cap.webSearch&&cap.webFetch&&analysis.mode==='live';
 const factual=analysis.claims.filter(c=>c.kind==='factual');const position=analysis.claims.find(c=>c.kind==='opinion');const hasTargets=!!factual.length||!!position;
 useEffect(()=>{
  if(!started||!consent||!ready||!hasTargets)return;
  const c=new AbortController();control.current=c;const found:ResearchVerification[]=[];
  void runResearch({sources:analysis.sources,claims:factual,position,transmissionConsent:true,researchConsent:true},c.signal,{
   now:Date.now,wait:researchWait,
   post:async<T,>(body:unknown,signal:AbortSignal)=>{const response=await fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});const data=await response.json() as {error?:{message?:string}};if(!response.ok)throw new Error(data.error?.message??'자동 조사에 연결하지 못했어요.');return data as T;},
  },p=>{if(!c.signal.aborted){setStage(p.stage);setMessage(p.message);callback.current(found,p.stage);}},v=>{if(!c.signal.aborted){found.push(v);setResults([...found]);callback.current([...found],'comparing');}}).catch(e=>{if(!c.signal.aborted){setStage('failed');setMessage(e instanceof Error?e.message:'자동 조사에 연결하지 못했어요.');callback.current([...found],'failed');}});
  return ()=>c.abort();
  // The parent remounts this component for each immutable analysis id.
 },[started,consent,ready]);
 const review=reliabilityReview(analysis,results,stage),cards=verifiedRecommendations(results);
 const busy=['planning','searching','fetching','waiting','comparing'].includes(stage);
 function cancel(){control.current?.abort();setStage('cancelled');setMessage('조사를 취소했어요. 이미 확인한 자료만 표시합니다.');callback.current(results,'cancelled');}
 const kindLabel={opposing_view:'다른 입장',supporting_view:'같은 입장',different_evidence:'다른 수치·사실을 담은 자료',context:'관련 맥락'};
 return <section className="report-section" aria-label="자동 신뢰성 조사">
  <div className="report-section-title"><h3><Search size={16}/> 03. 신뢰성</h3><span className="badge badge-purple">외부 자료 조사</span></div>
  <p className="section-description">{review.label}</p>
  <div className="stance-list"><span>조사 대상 {review.totalClaims}개 주장</span><span>대조 완료 {review.completedClaims}개</span><span>미확인 {review.remaining}개</span><span>취득 자료 {review.sourceCount}개</span></div>
  {!factual.length&&<p className="topic-note">대조할 사실 주장이 없어요. 의견을 참·거짓으로 판정하지 않고 다른 관점의 자료를 찾습니다.</p>}
  {!hasTargets?<p className="topic-note">조사할 주장이나 의견을 추출하지 못했어요.</p>:analysis.mode==='demo'?<p className="topic-note">이 예시는 가상 자료입니다. 외부 검색이나 실제 조사 결과가 아닙니다.</p>:!ready?<div className="notice">자동 신뢰성 조사·관련 기사 검색은 아직 연결 준비 중입니다. 현재 입력한 기사만으로 외부 신뢰성 검토가 완료되지는 않습니다.</div>:<>
   {!started&&<><label className="transmission-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>공개 자료에서 추출한 검색어가 {cap?.searchProviderName??'기사 검색 서비스'}로 전송되고, 취득한 기사 발췌와 주장이 Groq로 전송되는 자동 조사에 동의합니다. 검색어는 검색 제공자 정책에 따라 보관·서비스 개선에 사용될 수 있습니다.</span></label><button className="button secondary" disabled={!consent} onClick={()=>setStarted(true)}>{factual.length?'공개 자료로 자동 조사하기':'다른 관점의 기사 찾기'}</button><p className="topic-note">무료 한도를 지키며 주장별로 조사하므로 수 분 걸릴 수 있어요. 창을 열어 두세요.</p></>}
   {message&&<p className="topic-note" role="status">{busy&&<LoaderCircle size={14} className="spin"/>} {message}</p>}
   {busy&&<button className="small-button" onClick={cancel}>조사 취소</button>}
  </>}
  {!!review.completedClaims&&<div className="stance-list"><span>뒷받침 {review.supported}</span><span>상충 {review.contradicted+review.conflicting}</span><span>불충분 {review.insufficient}</span></div>}
  {cards.length>0&&<><h4>참고할 관련 기사</h4>{cards.map(card=><article className="claim-relations" key={card.url}><span className="badge">{kindLabel[card.kind]}</span><h4><a href={card.url} target="_blank" rel="noopener noreferrer">{card.title} <ArrowUpRight size={12}/></a></h4><p className="topic-note">{card.publisherDomain} · 본문 취득 · 인용 일치 확인</p><blockquote>“{card.quote.slice(0,280)}{card.quote.length>280?'…':''}”</blockquote><p>{card.reason}</p></article>)}</>}
  <p className="topic-note">{review.scopeNote} 자료가 없거나 접속에 실패했다고 거짓으로 분류하지 않습니다.</p>
 </section>;
}
