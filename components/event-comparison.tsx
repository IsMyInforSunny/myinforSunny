'use client';
import {useEffect,useRef,useState} from 'react';
import type {EventComparisonResult} from '@/lib/server/event-comparison';

export function eventComparisonMessage(status:EventComparisonResult['status']){
  if(status==='date_missing')return '기사 발행일을 확인할 수 없어 같은 사건 묶음을 찾지 못했습니다.';
  if(status==='unknown_topic')return '현재 사건 비교 기준에 이 주제는 포함되지 않습니다.';
  if(status==='incompatible')return '사건 비교 기준 버전이 달라 결과를 표시할 수 없습니다.';
  if(status==='ambiguous')return '여러 사건 묶음과 비슷해 대응을 유보했습니다.';
  return '같은 주제·발행일·본문 기준에 맞는 사건 기사 묶음을 찾지 못했습니다.';
}

export default function EventComparison({body,title,publishedAt}:{body:string;title?:string;publishedAt?:string}){
  const [result,setResult]=useState<EventComparisonResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>{setResult(null);setError('');setBusy(false);controller.current?.abort();return()=>controller.current?.abort();},[body,title,publishedAt]);
  async function compare(){
    controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setError('');
    try{
      const response=await fetch('/api/article-comparison',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({body,title,publishedAt}),signal:c.signal});
      const value:unknown=await response.json();
      if(!response.ok){
        const message=value&&typeof value==='object'&&'error' in value&&value.error&&typeof value.error==='object'&&'message' in value.error&&typeof value.error.message==='string'?value.error.message:'사건 비교를 불러오지 못했습니다.';
        throw Error(message);
      }
      if(!c.signal.aborted)setResult(value as EventComparisonResult);
    }catch(error){if(!c.signal.aborted)setError(error instanceof Error?error.message:'사건 비교를 불러오지 못했습니다.');}
    finally{if(!c.signal.aborted)setBusy(false);}
  }
  return <div className="studio-event-comparison">
    <button type="button" className="studio-text-button" onClick={()=>void compare()} disabled={busy||!publishedAt}>{busy?'같은 사건 찾는 중':'같은 사건 기사와 비교'}</button>
    {!publishedAt&&<p>발행일이 확인된 기사 링크를 분석하면 같은 사건 비교를 할 수 있습니다.</p>}
    {publishedAt&&!result&&!busy&&!error&&<p>현재 본문을 서버의 수집 자료와 비교합니다. 외부 검색과 AI 호출은 하지 않습니다.</p>}
    {error&&<p role="alert">{error}</p>}
    {result&&<div role="status">{result.event?<>
      <p>같은 사건 {result.event.n}건 · {result.event.publisherCount}개 매체 · {result.event.start}~{result.event.through}</p>
      <dl>{[{label:'자극 표현 탐색',...result.fomo},{label:'근거 출처 명시',...result.attribution}].map(metric=><div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value??'—'}점 · {metric.count}/{metric.total}문장{metric.position&&` · 백분위 ${metric.position.lower===metric.position.upper?metric.position.lower:`${metric.position.lower}–${metric.position.upper}`}`}{metric.position?.ties!=null&&metric.position.ties>0&&` · 같은 값 ${metric.position.ties}%`}</dd></div>)}</dl>
      <p>본문 앞 {result.scopeCharacters.toLocaleString()}자 · 기준 {result.version}</p>
    </>:<p>{eventComparisonMessage(result.status)}</p>}</div>}
  </div>;
}
