'use client';
import {newsProviderLabel} from '@/lib/news-provider';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,LoaderCircle,Search} from 'lucide-react';
import type {Analysis,Capabilities} from '@/lib/contracts';
import type {ResearchStage,ResearchVerification} from '@/lib/research-contract';
import {reliabilityReview,researchProposition,researchRequestTimeout,verifiedRecommendations} from '@/lib/reliability';
import {RESEARCH_BATCH_CLAIMS,researchWait,runResearch,type ClaimCoverage} from '@/lib/research-runner';
import DirectEvidence from './direct-evidence';
const coverageLabel:Record<ClaimCoverage,string>={pending:'대기',reviewing:'조사 중',reviewed:'대조 완료',no_evidence:'공개 본문 미확보',not_completed:'대조 미완료'};
/** `researchConsent` is the user's explicit pre-analysis research opt-in from the main input.
 * With it, research starts automatically after this live analysis,
 * but only when search and article fetch are ready. Without it nothing is sent.
 */
export default function ReliabilityResearch({analysis,cap,onChange,researchConsent}:{analysis:Analysis;cap:Capabilities|null;onChange:(results:ResearchVerification[],stage:ResearchStage)=>void;researchConsent?:boolean}){
 const [consent,setConsent]=useState(false),[started,setStarted]=useState(false),[stage,setStage]=useState<ResearchStage>('not_started'),[message,setMessage]=useState(''),[results,setResults]=useState<ResearchVerification[]>([]);
 const [directActive,setDirectActive]=useState(false);
 const [autoStarted,setAutoStarted]=useState(false);
 const [coverage,setCoverage]=useState<Record<string,ClaimCoverage>>({}),[batchInfo,setBatchInfo]=useState<{batch:number;batches:number}|null>(null);
 const autoTried=useRef(false);
 const callback=useRef(onChange);callback.current=onChange;const control=useRef<AbortController|null>(null);
 const consentRef=useRef<HTMLInputElement>(null),cancelRef=useRef<HTMLButtonElement>(null),restartRef=useRef<HTMLButtonElement>(null);
 const focusAfterTransition=useRef<'cancel'|'restart'|'consent'|null>(null);
 const researchFocusChain=useRef(false);
 const ready=!!cap?.live&&cap.webSearch&&cap.webFetch&&analysis.mode==='live';
 const factual=analysis.claims.filter(c=>c.kind==='factual');const proposition=researchProposition(analysis);const position=proposition?undefined:analysis.claims.find(c=>c.kind==='opinion');const hasTargets=!!factual.length||!!position||!!proposition;
 useEffect(()=>{
  if(!started)return;
  if(!consent||!ready||!hasTargets||(autoStarted&&researchConsent!==true)){
   control.current?.abort();setStarted(false);setConsent(false);setStage('cancelled');
   setMessage('입력이 바뀌었거나 조사 기능을 사용할 수 없어 중단했어요. 다시 조사하려면 동의를 확인하고 시작해 주세요.');callback.current([...results],'cancelled');return;
  }
  const c=new AbortController();control.current=c;const found:ResearchVerification[]=[];
  const modelIntervalMs=cap?.aiProvider==='nvidia'?0:61000;
  void runResearch({sources:analysis.sources,claims:factual,position,proposition,transmissionConsent:true,researchConsent:true},c.signal,{
   now:Date.now,wait:researchWait,modelIntervalMs,firstModelCallAt:Date.parse(analysis.createdAt)+modelIntervalMs,
   post:async<T,>(body:unknown,signal:AbortSignal)=>{const response=await fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(researchRequestTimeout(cap))])});const data=await response.json() as {error?:{message?:string}};if(!response.ok)throw new Error(data.error?.message??'자동 조사에 연결하지 못했어요.');return data as T;},
  },p=>{if(!c.signal.aborted){setStage(p.stage);setMessage(p.message);setCoverage(p.coverage);setBatchInfo({batch:p.batch,batches:p.batches});callback.current(found,p.stage);}},v=>{if(!c.signal.aborted){found.push({...v,parentAnalysisId:analysis.analysisId});setResults([...found]);callback.current([...found],'comparing');}}).catch(e=>{if(!c.signal.aborted){settleCoverage();setStage('failed');setMessage(e instanceof Error?e.message:'자동 조사에 연결하지 못했어요.');callback.current([...found],'failed');}});
  return ()=>c.abort();
  // The parent remounts this component for each immutable analysis id.
 },[started,consent,ready,researchConsent]);
 // Automatic start after a live analysis: current-input explicit consent AND
 // search + fetch ready. Tried once per analysis; a manual restart never auto-resends.
 useEffect(()=>{
  if(autoTried.current||started||!ready||!hasTargets||directActive)return;
  if(researchConsent!==true)return;
  autoTried.current=true;setConsent(true);setAutoStarted(true);setStarted(true);
 },[ready,hasTargets,researchConsent]);
 const batches=Math.ceil(factual.length/RESEARCH_BATCH_CLAIMS);
 const waitReasons=analysis.mode!=='live'?[]:!cap?['기능 연결 상태를 확인하는 중입니다.']:[
  ...(!cap.live?[cap.reason??'실시간 분석이 준비되지 않았습니다.']:[]),
  ...(!cap.webSearch?[`${newsProviderLabel(cap.searchProvider)} 기사 검색 연결(이용 조건 승인·운영 설정)이 아직 준비되지 않았습니다.`]:[]),
  ...(!cap.webFetch?['본문 취득을 허용한 공개 기사 출처 설정이 아직 준비되지 않았습니다.']:[]),
 ];
 const review=reliabilityReview(analysis,results,stage),cards=verifiedRecommendations(results,analysis);
 const busy=['planning','searching','fetching','waiting','comparing'].includes(stage);
 useEffect(()=>{
  const terminal=started&&!busy&&['completed','partial','failed','cancelled'].includes(stage);
  if(!focusAfterTransition.current&&researchFocusChain.current&&terminal)focusAfterTransition.current='restart';
  const target=focusAfterTransition.current;
  const element=target==='cancel'?cancelRef.current:target==='restart'?restartRef.current:target==='consent'?consentRef.current:null;
  if(!element){if(terminal)researchFocusChain.current=false;return;}
  const frame=requestAnimationFrame(()=>{
   // Restore focus only after the active control disappears; never pull it
   // back from a user who has deliberately moved somewhere else.
   if(document.activeElement===document.body){element.focus();if(document.activeElement===element){researchFocusChain.current=target==='cancel';focusAfterTransition.current=null;}}
   else if(target!=='cancel'||terminal){researchFocusChain.current=false;focusAfterTransition.current=null;}
  });
  return ()=>cancelAnimationFrame(frame);
 },[started,stage]);
 function start(){researchFocusChain.current=false;focusAfterTransition.current='cancel';setStarted(true);}
 function settleCoverage(){setCoverage(prev=>Object.fromEntries(Object.entries(prev).map(([id,v])=>[id,v==='pending'||v==='reviewing'?'not_completed':v])) as Record<string,ClaimCoverage>);}
 function cancel(){researchFocusChain.current=false;focusAfterTransition.current='restart';control.current?.abort();settleCoverage();setStage('cancelled');setMessage('조사를 취소했어요. 이미 확인한 자료만 표시합니다.');callback.current(results,'cancelled');}
 function prepareRestart(){researchFocusChain.current=false;focusAfterTransition.current='consent';control.current?.abort();setStarted(false);setConsent(false);setAutoStarted(false);setStage('not_started');setMessage('');setResults([]);setCoverage({});setBatchInfo(null);callback.current([],'not_started');}
 const kindLabel={opposing_view:'다른 입장',supporting_view:'같은 입장',different_evidence:'다른 수치·사실을 담은 자료',context:'관련 맥락'};
 return <><section className="report-section" aria-label="자동 신뢰성 조사">
  <div className="report-section-title"><h3><Search size={16}/> 03. 신뢰성</h3><span className="badge badge-purple">외부 자료 조사</span></div>
  <p className="section-description">{review.label}</p>
  {cap?.searchProvider==='publisher_feeds'&&<p className="topic-note">공식 RSS에 실린 최근 기사 제목에서 관련 후보를 찾습니다. 전체 웹이나 과거 기사 전체를 검색하는 기능은 아니며, 본문을 확보해 대조한 자료만 점수에 반영합니다.</p>}
  <div className="stance-list"><span>조사 대상 {review.totalClaims}개 주장</span><span>대조 완료 {review.completedClaims}개</span><span>미확인 {review.remaining}개</span><span>취득 자료 {review.sourceCount}개</span></div>
  {!factual.length&&<p className="topic-note">대조할 사실 주장이 없어요. 의견·비교 명제를 참·거짓으로 판정하지 않고 다른 관점의 자료를 찾습니다.</p>}
  {proposition&&<p className="topic-note">{analysis.proposition?.trim()?'직접 지정한 비교 명제':'본문 근거에서 추출한 비교 명제'}: {proposition} · 이 명제에 대한 기사 입장을 별도로 살펴봅니다.</p>}
  {!hasTargets?<p className="topic-note">조사할 주장이나 의견을 추출하지 못했어요.</p>:analysis.mode==='demo'?<p className="topic-note">이 예시는 가상 자료입니다. 외부 검색이나 실제 조사 결과가 아닙니다.</p>:!ready?<div className="notice" role="status">자동 신뢰성 조사·관련 기사 검색은 아직 연결 준비 중입니다. 현재 입력한 기사만으로 외부 신뢰성 검토가 완료되지는 않습니다.{waitReasons.length>0&&<ul>{waitReasons.map(r=><li key={r}>대기 이유: {r}</li>)}</ul>}{researchConsent===true&&<p className="topic-note">자동 조사 동의는 확인했지만 위 조건이 준비되지 않아 아무 자료도 전송하지 않았어요.</p>}</div>:<>
   {factual.length>0&&<p className="topic-note">수집 범위: 사실 주장 {factual.length}개{batches>1?`를 한 요청당 최대 ${RESEARCH_BATCH_CLAIMS}개씩 ${batches}묶음으로 나누어 순서대로`:'를'} 조사합니다. 주장마다 검색 1회·허용 출처 본문 최대 2건을 취득하고, 같은 원본 전재는 한 근거로 셉니다.{(position||proposition)?' 다른 관점 검색 1회가 첫 묶음에 포함됩니다.':''} 대조를 마치지 못한 주장은 미확인으로 남깁니다.</p>}
   {autoStarted&&<p className="topic-note">{researchConsent===true?'분석 전에 동의한 자동 조사':'이 창에서 켜 둔 자동 조사'}에 따라 분석 직후 조사를 시작했어요. 언제든 취소할 수 있어요.</p>}
   <p className="topic-note">본문 분석이 끝난 뒤 외부 자료를 백그라운드에서 조사합니다. 결과는 확인되는 순서대로 추가되며, 조사 중에도 본문 분석 결과를 살펴볼 수 있어요.</p>
   {!started&&<><label className="transmission-consent"><input ref={consentRef} type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>공개 자료에서 추출한 검색어가 {newsProviderLabel(cap?.searchProvider)}로 전송되고, 취득한 기사 발췌와 주장이 선택한 AI 제공자로 전송되는 자동 조사에 동의합니다. 검색어는 검색 제공자 정책에 따라 보관·서비스 개선에 사용될 수 있습니다.</span></label><button className="button secondary" disabled={!consent||directActive} onClick={start}>{factual.length?'공개 자료로 자동 조사하기':'다른 관점의 기사 찾기'}</button><p className="topic-note">무료 한도를 지키며 주장별로 조사하므로 수 분 걸릴 수 있어요. 창을 열어 두세요.</p>
   </>}
   {batchInfo&&batchInfo.batches>1&&busy&&<p className="topic-note">진행 묶음 {batchInfo.batch}/{batchInfo.batches}</p>}
   {Object.keys(coverage).length>0&&<ul className="stance-list" aria-label="주장별 조사 범위">{factual.filter(c=>coverage[c.id]).map(c=><li key={c.id}><span className="badge">{coverageLabel[coverage[c.id]]}</span> {c.text.slice(0,60)}{c.text.length>60?'…':''}</li>)}</ul>}
   {message&&<p className="topic-note" role="status">{busy&&<LoaderCircle size={14} className="spin"/>} {message}</p>}
   {busy&&<button ref={cancelRef} className="small-button" onClick={cancel}>조사 취소</button>}
   {started&&!busy&&['completed','partial','failed','cancelled'].includes(stage)&&<button ref={restartRef} className="small-button" onClick={prepareRestart}>새 조사 준비하기</button>}
  </>}
  {!!review.completedClaims&&<div className="stance-list"><span>뒷받침 {review.supported}</span><span>상충 {review.contradicted+review.conflicting}</span><span>불충분 {review.insufficient}</span></div>}
  {cards.length>0&&<><h4>참고할 관련 기사</h4>{cards.map(card=><article className="claim-relations" key={card.url}><span className="badge">{kindLabel[card.kind]}</span><h4><a href={card.url} target="_blank" rel="noopener noreferrer">{card.title} <ArrowUpRight size={12}/></a></h4><p className="topic-note">{card.publisherDomain} · 본문 취득 · 인용 일치 확인</p><blockquote>“{card.quote.slice(0,280)}{card.quote.length>280?'…':''}”</blockquote><p>{card.reason}</p></article>)}</>}
  <p className="topic-note">{review.scopeNote} 자료가 없거나 접속에 실패했다고 거짓으로 분류하지 않습니다.</p>
 </section>
  <DirectEvidence analysis={analysis} cap={cap} locked={started} onBusy={setDirectActive} onProgress={next=>{setStage(next);callback.current(results,next);}} onResult={result=>{const next=[...results,result];setResults(next);setStage('partial');callback.current(next,'partial');}}/>
 </>;
}
