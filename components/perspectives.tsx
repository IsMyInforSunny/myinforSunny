'use client';
import type {Analysis,Check,Reference,Span} from '@/lib/contracts';
import {readerExplanation,outcomeExplanation} from '@/lib/display';
import {validSpan} from '@/lib/domain';
import {ArrowUpRight,MessageCircle,Search} from 'lucide-react';

export function Perspectives({analysis,checks,checkSources,onSelect,searchReady=false}:{analysis:Analysis;checks:Check[];checkSources:Record<string,Reference[]>;onSelect:(span:Span)=>void;searchReady?:boolean}){
 const alternatives=analysis.counterArguments??[];
 const sourced=checks.flatMap(c=>c.relations.filter(r=>r.relation==='contradicts').flatMap(r=>{
  const ref=checkSources[c.claimId]?.find(x=>x.id===r.referenceId);const claim=analysis.claims.find(x=>x.id===c.claimId);
  if(!ref?.url||!/^https?:\/\//.test(ref.url)||!claim||!claim.origin.every(s=>validSpan(analysis.sources,s))||r.start<0||r.end<=r.start||ref.text.slice(r.start,r.end)!==r.quote)return [];
  return [{claim,ref,relation:r}];
 }));
 return <section className="report-section perspectives"><div className="report-section-title"><h3><MessageCircle size={16}/> 다른 관점</h3></div>
 <p className="section-description">원래 주장의 조건과 한계를 함께 살펴보세요. 다른 관점이 있다는 이유만으로 두 주장이 똑같이 타당한 것은 아닙니다.</p>
 {alternatives.map((c,i)=><article className="perspective-card" key={i}><span className="badge badge-purple">{c.provenance==='curated_example'?'직접 작성한 예시 · 출처 없음':'AI 제안 · 출처 없음'}</span><h4>{c.text}</h4><p>{c.reasoning}</p><p className="topic-note">확인할 자료: {c.evidenceNeeded}</p><details><summary>어떤 주장에 대한 관점인가요?</summary>{c.basis.map((s,j)=><button type="button" className="quote-button" key={j} onClick={()=>onSelect(s)}>“{s.quote}” <ArrowUpRight size={11}/></button>)}</details></article>)}
 {!alternatives.length&&<p className="topic-note">이 결과에서는 별도로 제안한 다른 관점이 없습니다. 아래 검토 질문과 원문을 함께 살펴보세요.</p>}
 {sourced.map(({ref,relation,claim},i)=><article key={i} className="perspective-card"><span className="badge">출처 인용 일치 확인 · 입력 자료 기준</span><h4>{claim.text}</h4><blockquote>“{relation.quote}”</blockquote><p>{readerExplanation(relation.explanation,outcomeExplanation.contradicted)}</p><a className="inline-link" href={ref.url} target="_blank" rel="noopener noreferrer">출처 열기 <ArrowUpRight size={12}/></a><p className="topic-note">인용문이 입력 자료에 존재함을 확인했습니다. 원 사이트의 본문과 해석의 정확성까지 보장하지 않습니다.</p></article>)}
 {!searchReady&&<div className="news-pending"><h4><Search size={14}/> 참고해 볼 관련 기사</h4><p className="topic-note">기사 검색은 서비스 이용 조건 검토와 운영자 승인 후 연결할 예정입니다. 관련 기사를 주장의 근거로 자동 표시하지 않습니다.</p></div>}
 </section>;
}
