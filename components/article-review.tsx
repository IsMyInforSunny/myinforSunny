'use client';
import {useEffect,useState} from 'react';
import type {Analysis,Check} from '@/lib/contracts';
import type {ResearchVerification} from '@/lib/research-contract';
import {articleAnnotations,fomoSignals,reviewSegments} from '@/lib/reader-metrics';

export default function ArticleReview({analysis,checks,researchResults=[]}:{analysis:Analysis;checks:Check[];researchResults?:ResearchVerification[]}){
 const [selectedIds,setSelectedIds]=useState<string[]|null>(null);const annotations=articleAnnotations(analysis,checks,researchResults);const fomo=fomoSignals(analysis);const selected=selectedIds?annotations.filter(a=>selectedIds.includes(a.id)):null;
 useEffect(()=>setSelectedIds(null),[analysis.analysisId]);
 return <section className="article-review reader-feature" aria-label="기사 문장 검토">
  <div className="report-section-title"><h3>기사에 표시해 살펴보기</h3><span className="badge">{analysis.mode==='demo'?'가상 예시':'분석 원문'}</span></div>
  <p className="section-description">밑줄을 누르면 표시 이유를 확인할 수 있어요. 노란 밑줄은 미확인 주장, 빨간 밑줄은 대조 자료와 다른 내용, 보라색은 표현 검토입니다.</p>
  <div className="review-legend"><span className="review-key-unverified">추가 근거 확인</span><span className="review-key-contradicted">자료와 다름</span><span className="review-key-expression">표현 검토</span><span className="review-key-supported">자료에서 확인</span></div>
  {analysis.sources.filter(s=>s.kind==='body').map(source=><div className="review-article" key={source.id}>{reviewSegments(source.text,annotations.filter(a=>a.span.sourceId===source.id)).map(piece=>piece.annotations.length?<button key={piece.start} type="button" className={`review-mark review-mark-${piece.annotations.some(a=>a.tone==='contradicted'||a.tone==='conflicting')?'contradicted':piece.annotations.some(a=>a.tone==='unverified')?'unverified':piece.annotations.some(a=>a.tone==='expression'||a.tone==='fomo')?'expression':'supported'}`} aria-label={`${piece.text} — ${piece.annotations.map(a=>a.label).join(', ')}`} title={piece.annotations.map(a=>a.label).join(' · ')} onClick={()=>setSelectedIds(piece.annotations.map(a=>a.id))}>{piece.text}</button>:<span key={piece.start}>{piece.text}</span>)}</div>)}
  {!!selected?.length&&<aside className="review-explanation" aria-live="polite"><button className="small-button" type="button" onClick={()=>setSelectedIds(null)}>설명 닫기</button>{selected.map(a=><div key={a.id}><strong>{a.label}</strong><p>{a.reason}</p></div>)}</aside>}
  <div className="fomo-panel"><div><h4>FOMO 표현 탐색</h4><strong>{fomo.totalSentences?`${fomo.flaggedSentences} / ${fomo.totalSentences}문장`:'해당 없음'}</strong></div>
   {fomo.totalSentences>0&&<meter min={0} max={fomo.totalSentences} value={fomo.flaggedSentences} aria-label={`본문 ${fomo.totalSentences}문장 중 FOMO 표현 후보 ${fomo.flaggedSentences}문장`}/>}
   <p>긴급성·희소성·동조 압력의 표현을 찾는 규칙 기반 보조 표시입니다. 인용·일부 부정 표현은 제외하지만 문맥을 놓칠 수 있어요. 심리 검사, 편향 점수, 진실 확률이 아닙니다.</p><small>탐색 기준 {fomo.version} · 본문만 집계</small>
  </div>
 </section>;
}
