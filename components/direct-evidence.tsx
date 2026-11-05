'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Analysis,Capabilities} from '@/lib/contracts';
import type {EvidenceBundle,ResearchInput,ResearchStage,ResearchVerification} from '@/lib/research-contract';
import {researchWait} from '@/lib/research-runner';

export default function DirectEvidence({analysis,cap,locked,onBusy,onProgress,onResult}:{analysis:Analysis;cap:Capabilities|null;locked:boolean;onBusy:(busy:boolean)=>void;onProgress:(stage:ResearchStage)=>void;onResult:(result:ResearchVerification)=>void}){
 const factual=analysis.claims.filter(c=>c.kind==='factual');
 const proposition=analysis.proposition?.trim()||undefined,position=proposition?undefined:analysis.claims.find(claim=>claim.kind==='opinion');
 let comparisonId=position?.id??'comparison_position';
 if(proposition){const ids=new Set(factual.map(claim=>claim.id));while(ids.has(comparisonId))comparisonId+='_';}
 const targets=[...factual.map(claim=>({id:claim.id,text:`사실 주장: ${claim.text}`})),...(proposition||position?[{id:comparisonId,text:`비교 명제: ${proposition??position!.text}`}]:[])];
 const [claimId,setClaimId]=useState(targets[0]?.id??''),[urls,setUrls]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const controller=useRef<AbortController|null>(null);
 const lastComparison=useRef(0);
 const callbacks=useRef({onBusy,onProgress,onResult});
 useLayoutEffect(()=>{callbacks.current={onBusy,onProgress,onResult};},[onBusy,onProgress,onResult]);
 const ready=analysis.mode==='live'&&!!cap?.live&&!!cap.directFetch;
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{
  if(ready)return;
  const pending=controller.current;if(pending){pending.abort();controller.current=null;}
  const timer=setTimeout(()=>{setConsent(false);setBusy(false);callbacks.current.onBusy(false);if(pending){setMessage('입력이 바뀌었거나 연결을 사용할 수 없어 대조를 취소했어요.');callbacks.current.onProgress('cancelled');}},0);
  return()=>clearTimeout(timer);
 },[ready]);
 async function start(){
  if(busy||locked||!ready||!consent||!targets.some(target=>target.id===claimId))return;
  const selected=urls.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!selected.length||selected.length>2){setMessage('공개 기사 주소를 한 줄에 하나씩, 최대 2개 입력해 주세요.');return;}
  if(selected.some(value=>{try{const u=new URL(value);return u.protocol!=='https:'||!!u.username||!!u.password||!!u.port;}catch{return true;}})){setMessage('로그인 정보가 없는 공개 HTTPS 기사 주소를 입력해 주세요.');return;}
  const c=new AbortController();controller.current=c;setBusy(true);callbacks.current.onBusy(true);setConsent(false);
  // This request checks the selected target only. Other claims remain in the
  // parent analysis denominator and cannot exceed this API's five-claim cap.
  const selectedClaim=factual.find(claim=>claim.id===claimId);
  const targetId=selectedClaim?.id??(proposition?'comparison_position':position?.id);
  if(!targetId){controller.current=null;setBusy(false);callbacks.current.onBusy(false);return;}
  const input:ResearchInput={sources:analysis.sources,claims:selectedClaim?[selectedClaim]:[],proposition,position,transmissionConsent:true,researchConsent:true};
  async function post<T>(body:unknown):Promise<T>{
   const response=await fetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([c.signal,AbortSignal.timeout(60000)])});
   const data=await response.json() as {error?:{message?:string}};if(c.signal.aborted)throw new DOMException('취소됨','AbortError');
   if(!response.ok)throw new Error(data.error?.message??'기사 본문을 대조하지 못했어요.');return data as T;
  }
  try{
   setMessage('선택한 공개 기사 본문을 가져오고 있어요.');callbacks.current.onProgress('fetching');
   const evidence=await post<EvidenceBundle>({operation:'import',input,claimId:targetId,urls:selected});
   if(!evidence.references.length)throw new Error('허용된 공개 본문을 확보하지 못했어요. 접속 실패는 거짓 판정이 아닙니다.');
   const remaining=Math.max(0,Date.parse(analysis.createdAt)+61000-Date.now(),lastComparison.current+61000-Date.now());
   if(remaining){setMessage(`무료 AI 한도를 지키기 위해 약 ${Math.ceil(remaining/1000)}초 기다립니다.`);callbacks.current.onProgress('waiting');await researchWait(remaining,c.signal);}
   setMessage('취득한 본문과 선택한 주장을 대조하고 있어요.');callbacks.current.onProgress('comparing');
   lastComparison.current=Date.now();
   const result=await post<ResearchVerification>({operation:'compare',input,evidenceToken:evidence.token});
   if(c.signal.aborted)return;
   callbacks.current.onResult({...result,parentAnalysisId:analysis.analysisId});setMessage('선택한 자료의 대조를 마쳤어요. 전체 기사의 검증 완료를 뜻하지 않습니다.');
  }catch(error){if(!c.signal.aborted){setMessage(error instanceof Error?error.message:'자료 대조에 실패했어요.');callbacks.current.onProgress('failed');}}
  finally{if(controller.current===c){controller.current=null;setBusy(false);callbacks.current.onBusy(false);}}
 }
 function cancel(){controller.current?.abort();controller.current=null;setBusy(false);setConsent(false);setMessage('자료 대조를 취소했어요.');callbacks.current.onBusy(false);callbacks.current.onProgress('cancelled');}
 if(analysis.mode==='demo'||!targets.length)return null;
 return <div className="check-form" aria-label="기사 주소로 근거 대조">
  <h4>기사 주소로 근거 대조</h4>
  {!ready?<p className="topic-note">기사 주소의 본문 취득은 연결 준비 중입니다. 참고자료 수동 대조에서 본문을 붙여 넣을 수 있어요.</p>:<>
   <label className="field-label" style={{display:'block'}}>대조할 사실 주장·비교 명제<select aria-label="주소 자료와 대조할 주장" style={{display:'block',width:'100%',maxWidth:'100%',minWidth:0,marginTop:8,padding:8,border:'1px solid var(--line)',borderRadius:6,background:'white'}} value={claimId} disabled={busy||locked} onChange={e=>{setClaimId(e.target.value);setConsent(false);setMessage('');}}>{targets.map(target=><option key={target.id} value={target.id}>{target.text}</option>)}</select></label>
   <label className="field-label" style={{display:'block'}}>공개 기사 주소 · 최대 2개<textarea aria-label="근거 기사 주소" value={urls} maxLength={4098} disabled={busy||locked} placeholder={'https://…\nhttps://…'} onChange={e=>{setUrls(e.target.value);setConsent(false);setMessage('');}}/></label>
   <p className="topic-note">운영자가 허용한 매체의 공개 HTTPS 주소만 가져옵니다. 로그인·유료 본문·다른 주소로 이동하는 페이지는 처리하지 않습니다. 사실 주장은 근거를 대조하고, 비교 명제는 참·거짓 대신 기사에 드러난 입장을 살펴봅니다. 선택한 대상에는 이번 자료의 최신 대조 결과를 반영합니다.</p>
   <label className="transmission-consent"><input type="checkbox" checked={consent} disabled={busy||locked} onChange={e=>setConsent(e.target.checked)}/><span>입력한 주소의 기사 본문을 가져오고, 선택한 주장과 기사 발췌를 선택한 AI 제공자에 전송하는 데 동의합니다.</span></label>
   <button className="button secondary" type="button" disabled={busy||locked||!consent||!urls.trim()} onClick={()=>void start()}>기사 본문 가져와 대조하기</button>
   {busy&&<button className="small-button" type="button" onClick={cancel}>주소 자료 대조 취소</button>}
  </>}
  {message&&<p className="topic-note" role="status">{message}</p>}
 </div>;
}
