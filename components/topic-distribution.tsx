'use client';
import { ArrowUpRight, ChartNoAxesColumnIncreasing } from 'lucide-react';
import type { Analysis, Span } from '@/lib/contracts';
import { MIN_N_FOR_PERCENT, countLabel, percentLabel } from '@/lib/display';
import { bodyTopicDistribution, indicators } from '@/lib/domain';

function Bar({value}:{value:number|null}){return <div className="progress-track green"><div className="progress-fill" style={{width:`${value??0}%`}}/></div>;}
const preview=(text:string)=>text.length>90?`${text.slice(0,90)}…`:text;
function QuoteButton({span,onSelect}:{span:Span;onSelect:(span:Span)=>void}){return <button type="button" className="quote-button" onClick={()=>onSelect(span)}>“{preview(span.quote)}” <ArrowUpRight size={11} style={{display:'inline'}}/></button>;}

/** Body topic distribution (main) and, only when comments exist, a separate comment distribution. */
export default function TopicDistribution({analysis,onSelect}:{analysis:Analysis;onSelect:(span:Span)=>void}){
  const body=analysis.sources.find(s=>s.kind==='body');
  const dist=bodyTopicDistribution(analysis);
  const commentCount=analysis.sources.filter(s=>s.kind==='comment').length;
  const unitSpan=(sentenceId:string):Span|null=>{const unit=body?.sentences.find(t=>t.id===sentenceId);return body&&unit?{sourceId:body.id,sentenceId:unit.id,start:unit.start,end:unit.end,quote:body.text.slice(unit.start,unit.end)}:null;};
  // Evidence is the assigned sentence itself (first matching unit of a long sentence), never the example quotes of the topic.
  const topicSpans=(topicId:string)=>dist.items.filter(i=>i.topicIds.includes(topicId)).flatMap(i=>{const id=i.sentenceIds.find(sid=>analysis.bodyTopicAssignments?.find(a=>a.sentenceId===sid)?.topicIds.includes(topicId));const s=id?unitSpan(id):null;return s?[s]:[];});
  const metric=indicators(analysis).topics;
  return <>
    <section className="report-section" aria-label="본문 논점 분포">
      <div className="report-section-title"><h3><ChartNoAxesColumnIncreasing size={16}/> 본문 논점 분포</h3><span className="badge">{analysis.topics.length}가지 논점</span></div>
      {!dist.available?<>
        <p className="topic-note">이 결과는 본문 문장별 분류가 없는 이전 형식이라 본문 논점 분포를 계산할 수 없어요. 아래 인용은 논점을 설명하는 예시일 뿐 분포의 근거가 아닙니다. 다시 분석하면 분포를 볼 수 있어요.</p>
        {analysis.topics.map(t=><div className="topic-row" key={t.id}><div className="topic-label"><span>{t.label}</span><strong>분포 계산 불가</strong></div></div>)}
      </>:<>
        <p className="section-description">본문 {dist.sentences}문장을 한 문장씩 분류한 결과예요. 댓글이 없어도 계산합니다.</p>
        <div className="stance-list" aria-label="본문 분류 현황"><span>논점 있음 {dist.assigned}</span><span>기타 {dist.other}</span><span>판단 유보 {dist.undetermined}</span><span>분모 {dist.sentences}문장</span></div>
        {dist.topics.map(m=>{
          const topic=analysis.topics.find(t=>t.id===m.topicId)!;const spans=topicSpans(m.topicId);
          return <div className="topic-row" key={m.topicId}>
            <div className="topic-label"><span>{topic.label}</span><strong>{countLabel(m.coverage,'문장')} · {percentLabel(m.coverage)??`문장 ${m.coverage.denominator}개 기준`}</strong></div>
            {m.coverage.denominator>=MIN_N_FOR_PERCENT&&<Bar value={m.coverage.percent}/>}
            {spans.length>0&&<details className="topic-evidence"><summary>이 논점으로 분류된 문장 보기</summary>{spans.map(s=><QuoteButton key={s.sentenceId} span={s} onSelect={onSelect}/>)}</details>}
          </div>;
        })}
        {dist.topics.length===0&&<p className="topic-note">추출된 논점이 없어 분포를 만들 수 없어요.</p>}
        {dist.undetermined>0&&<details className="topic-evidence"><summary>판단을 유보한 문장 {dist.undetermined}개 보기</summary>{dist.items.filter(i=>i.status==='undetermined').map(i=>{const s=unitSpan(i.sentenceIds[0]);return s&&<div key={i.index}><QuoteButton span={s} onSelect={onSelect}/>{i.reasons[0]&&<p className="topic-note">{i.reasons[0]}</p>}</div>;})}</details>}
        <p className="topic-note">한 문장이 여러 논점에 해당할 수 있어 비율의 합은 100%를 넘을 수 있어요. 분모에는 판단 유보 문장도 포함됩니다. 글 안의 비중을 문장 수로 센 것이며 중요도나 전체 여론이 아닙니다.{dist.sentences<MIN_N_FOR_PERCENT?` 문장이 ${MIN_N_FOR_PERCENT}개 미만이라 퍼센트는 표시하지 않아요.`:''}</p>
        {dist.fragmentedSentences>0&&<p className="topic-note">500자를 넘는 긴 문장 {dist.fragmentedSentences}개는 처리를 위해 나누어 분석했지만 한 문장으로 셉니다. (처리 단위 {dist.processingUnits}개){dist.items.some(i=>i.partiallyUndetermined)?' 일부 조각은 판단이 유보되었어요.':''}</p>}
      </>}
    </section>
    {commentCount>0&&<section className="report-section" aria-label="댓글 논점 분포">
      <div className="report-section-title"><h3><ChartNoAxesColumnIncreasing size={16}/> 댓글 논점 분포</h3><span className="badge">댓글 {commentCount}개</span></div>
      <p className="section-description">본문과 따로, 제출한 댓글에서 각 논점을 언급한 정도예요.</p>
      <div className="stance-list" aria-label="댓글 분류 현황"><span>논점 있음 {analysis.topicAssignments.filter(a=>a.status==='assigned').length}</span><span>기타 {analysis.topicAssignments.filter(a=>a.status==='other').length}</span><span>판단 유보 {analysis.topicAssignments.filter(a=>a.status==='undetermined').length}</span><span>분모 {commentCount}개 댓글</span></div>
      {analysis.topics.map(t=>{
        const m=metric.find(x=>x.topicId===t.id)?.coverage;if(!m)return null;
        const spans=analysis.topicAssignments.filter(a=>a.topicIds.includes(t.id)).flatMap(a=>a.evidence.slice(0,1));
        return <div className="topic-row" key={t.id}>
          <div className="topic-label"><span>{t.label}</span><strong>{countLabel(m,'개 댓글')} · {percentLabel(m)??`댓글 ${m.denominator}개 기준`}</strong></div>
          {m.denominator>=MIN_N_FOR_PERCENT&&<Bar value={m.percent}/>}
          {spans.length>0&&<details className="topic-evidence"><summary>근거 문장 보기</summary>{spans.map((s,i)=><QuoteButton key={i} span={s} onSelect={onSelect}/>)}</details>}
        </div>;
      })}
      <p className="topic-note">한 댓글이 여러 논점을 다뤄 비율의 합은 100%를 넘을 수 있어요. 댓글 {commentCount}개만의 결과이며 전체 여론의 비율은 아닙니다.{commentCount<MIN_N_FOR_PERCENT?` 댓글이 ${MIN_N_FOR_PERCENT}개 미만이라 퍼센트는 표시하지 않아요.`:''}</p>
    </section>}
  </>;
}
