'use client';
import {useRef} from 'react';

export type ReviewTab='overview'|'claims';
const tabs:ReviewTab[]=['overview','claims'];

/** Native buttons with roving focus: the same view can be reached by mouse,
 * Tab, arrows, Home or End without adding every inactive tab to the tab order.
 */
export default function ReviewTabs({value,onChange,factualClaims}:{value:ReviewTab;onChange:(tab:ReviewTab)=>void;factualClaims:number}){
 const buttons=useRef<(HTMLButtonElement|null)[]>([]);
 return <div className="report-tabs" role="tablist" aria-label="결과 보기">{tabs.map((tab,index)=><button key={tab} ref={node=>{buttons.current[index]=node;}} id={`${tab}-tab`} type="button" role="tab" aria-selected={value===tab} aria-controls={`${tab}-panel`} tabIndex={value===tab?0:-1} className={value===tab?'selected':''} onClick={()=>onChange(tab)} onKeyDown={event=>{
  const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
  if(next===null)return;event.preventDefault();onChange(tabs[next]);buttons.current[next]?.focus();
 }}>{tab==='overview'?'성분 살펴보기':<>주장 · 자료 대조 <span className="badge">{factualClaims}</span></>}</button>)}</div>;
}
