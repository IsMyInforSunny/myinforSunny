import type {Analysis} from '@/lib/contracts';
import {summarizeVoices,voiceSentences,VOICE_TOPICS} from '@/lib/sentence-voice';
import type {ResearchVerification} from '@/lib/research-contract';
import {voiceAssessmentFromResearch} from '@/lib/voice-model-adapter';
import trainingStatus from '@/lib/data/voice-model-status.json';
import semanticStatus from '@/lib/data/voice-embedding-status.json';

type Bounds={lower:number|null;upper:number|null};
function coordinateText(evidence:Bounds){
  if(evidence.lower===null||evidence.upper===null)return '방향 근거 부족';
  return evidence.lower===evidence.upper?evidence.lower.toFixed(2):`${evidence.lower.toFixed(2)} ~ ${evidence.upper.toFixed(2)}`;
}
function scoreText(point:number|null,bounds:Bounds|null){
  return point!==null?`${point}점`:bounds?`${bounds.lower} ~ ${bounds.upper}점`:'비교 기사 부족';
}

export default function SentenceVoicePanel({analysis,researchResults=[]}:{analysis:Analysis;researchResults?:ResearchVerification[]}){
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const units=voiceSentences(body);
  const documents=[analysis.sentenceVoices,...analysis.additionalSentenceVoices??[]].filter((item):item is NonNullable<typeof analysis.sentenceVoices>=>!!item);
  const summaries=documents.map(document=>({document,summary:summarizeVoices(body,document)})).filter((item):item is {document:NonNullable<typeof analysis.sentenceVoices>;summary:NonNullable<ReturnType<typeof summarizeVoices>>}=>!!item.summary);
  const summary=summaries[0]?.summary??null;
  const citationBalance=analysis.citationBalance;
  const citationLabels=citationBalance?.labels??[];
  const relatedLabels=citationLabels.filter(label=>label.relevance==='related');
  const unresolvedRelevance=citationLabels.filter(label=>label.relevance==='uncertain').length;
  const citationCounts=(speaker:'journalist'|'source')=>({
    support:relatedLabels.filter(label=>label.speaker===speaker&&label.direction==='support').length,
    oppose:relatedLabels.filter(label=>label.speaker===speaker&&label.direction==='oppose').length,
    neutral:relatedLabels.filter(label=>label.speaker===speaker&&label.direction==='neutral').length,
    unresolved:relatedLabels.filter(label=>label.speaker===speaker&&label.direction==='uncertain').length,
  });
  const citationDirectional=relatedLabels.filter(label=>label.direction==='support'||label.direction==='oppose').length;
  const citationSummary=citationBalance&&<section aria-label="인용 균형 AI 문장 분류">
    <p><strong>인용 균형(AI 문장 분류)</strong></p>
    <p>비교 명제 · {citationBalance.proposition}</p>
    <p>관련 문장 {relatedLabels.length}개 · 무관 {citationLabels.filter(label=>label.relevance==='unrelated').length}개 · 논점 미확정 {unresolvedRelevance}개</p>
    {(['source','journalist'] as const).map(speaker=>{const counts=citationCounts(speaker);return <p key={speaker}>{speaker==='source'?'취재원':'기자'} · 찬성 {counts.support} · 반대 {counts.oppose} · 중립 {counts.neutral} · 유보 {counts.unresolved}</p>;})}
    <p>화자 미확정 {relatedLabels.filter(label=>label.speaker==='mixed'||label.speaker==='unknown').length}개 · 전체 찬반 문장 {citationDirectional}개{citationDirectional<3?' · 찬반 문장이 3개 미만이라 균형을 계산하지 않습니다.':' · 이 문장 분류는 기사 안의 인용·서술 구성을 나타냅니다.'}</p>
    <details><summary>AI 문장 분류 근거</summary><ol>{citationLabels.filter(label=>label.relevance!=='unrelated').map(label=><li key={label.sentenceId}>
      {units.find(unit=>unit.sentenceId===label.sentenceId)?.text??'원문 문장을 찾을 수 없습니다.'} <small>· {label.relevance==='uncertain'?'논점 미확정':label.direction==='support'?'찬성':label.direction==='oppose'?'반대':label.direction==='neutral'?'중립':'유보'} · {label.speaker==='journalist'?'기자':label.speaker==='source'?'취재원':label.speaker==='mixed'?'복합':'화자 미확정'}</small>
    </li>)}</ol></details>
  </section>;
  if(!summary&&!citationBalance)return <div className="studio-relative">
    <p><strong>인용 균형 분석 자료 없음</strong></p>
    <p>실제 기사 AI 라벨 {trainingStatus.annotatedArticleCount}건 · 사람 평가 {trainingStatus.humanEvaluationCount}건</p>
    <p>학습 범위 · {Object.keys(trainingStatus.topics).map(topic=>VOICE_TOPICS[topic as keyof typeof VOICE_TOPICS]?.label??topic).join(' · ')}</p>
    {semanticStatus.performanceChecksPassed&&<p>문장 분류 검사 후 기사 좌표와 같은 쟁점·분기 비교 분포를 로컬에서 검증하고 있습니다.</p>}
    <p>이용 검토와 모델 배포 준비 상태를 확인한 뒤 실제 모델 결과를 연결합니다.</p>
    <p>비교 기사 사전 계산: 조회 경로 준비, 데이터는 이용 검토 후 연결합니다.</p>
  </div>;
  if(!summary)return <div className="studio-relative">{citationSummary}</div>;
  const event=voiceAssessmentFromResearch(analysis,researchResults);
  const quarters=(analysis.issueQuarterComparisons??(analysis.issueQuarterComparison?[analysis.issueQuarterComparison]:[])).filter(quarter=>quarter.parentAnalysisId===analysis.analysisId);
  const references=researchResults.flatMap(result=>result.references);
  const issueRows=summaries.flatMap(({document,summary:item})=>item.issues.filter(issue=>document.articleIssue
    ?issue.issue===document.articleIssue:issue.directional||issue.evidence.unresolved).map(issue=>({issue,document})));
  const methodLabel=summary.method==='ai'?'인용 균형(AI 문장 분류)':'문장 SVM 분류(연구용)';
  const directionCounts=(labels:typeof documents[number]['labels'],speaker:'journalist'|'source')=>({
    support:labels.filter(label=>label.speaker===speaker&&label.direction==='support').length,
    oppose:labels.filter(label=>label.speaker===speaker&&label.direction==='oppose').length,
    neutral:labels.filter(label=>label.speaker===speaker&&label.direction==='neutral').length,
    unresolved:labels.filter(label=>label.speaker===speaker&&label.direction==='uncertain').length,
  });
  return <details className="studio-relative" open><summary>취재원 인용 균형과 기자 서술 방향</summary>
    {citationSummary}
    <p><strong>{methodLabel}</strong></p>
    <p>본문 앞 2,000자 · {summary.total}문장 · 본문 외 표시 제외 {summary.excluded}문장</p>
    {issueRows.map(({issue,document})=><section key={issue.issue} aria-label={issue.proposition}>
      {analysis.additionalSentenceVoices?.some(item=>item.articleIssue===issue.issue)&&<p><strong>두 번째 주 쟁점</strong></p>}
      <p><strong>{issue.proposition}</strong></p>
      {(()=>{const labels=document.labels.filter(label=>label.issue===issue.issue&&!label.excluded);const sources=directionCounts(labels,'source'),journalists=directionCounts(labels,'journalist');const classified=labels.filter(label=>label.direction==='support'||label.direction==='oppose').length;return <>
        <p>취재원 문장 {labels.filter(label=>label.speaker==='source').length}개 · 찬성 {sources.support} · 반대 {sources.oppose} · 중립 {sources.neutral} · 유보 {sources.unresolved} · 가능한 좌표 {coordinateText(issue.source.evidence)}</p>
        <p>기자 문장 {labels.filter(label=>label.speaker==='journalist').length}개 · 찬성 {journalists.support} · 반대 {journalists.oppose} · 중립 {journalists.neutral} · 유보 {journalists.unresolved} · 가능한 좌표 {coordinateText(issue.journalist.evidence)}</p>
        <p>화자 미확정 {labels.filter(label=>label.speaker==='mixed'||label.speaker==='unknown').length}문장 · 비교 범위에 포함한 미확정: 취재원 {issue.source.evidence.unresolved} · 기자 {issue.journalist.evidence.unresolved} · 전체 {issue.evidence.unresolved}문장</p>
        <p>전체 찬반 문장 {classified}개{classified<3?' · 찬반 문장이 3개 미만이라 균형을 계산하지 않습니다.':' · 범위와 유보 수를 함께 확인해 주세요.'}</p>
      </>})()}
      <details><summary>문장별 분류와 원문 근거</summary><ol>{document.labels.filter(label=>label.issue===issue.issue&&(label.direction==='support'||label.direction==='oppose'||label.direction==='neutral'||label.direction==='uncertain')).map(label=><li key={label.sentenceId}>
        {units.find(unit=>unit.sentenceId===label.sentenceId)?.text} <small>· {label.direction==='support'?'찬성':label.direction==='oppose'?'반대':label.direction==='neutral'?'중립':'유보'} · {label.speaker==='journalist'?'기자':label.speaker==='source'?'취재원':label.speaker==='mixed'?'복합':'화자 미확정'}</small>
      </li>)}</ol></details>
    </section>)}
    {!issueRows.length&&<p>기사의 주 쟁점을 하나로 확인할 근거가 부족합니다.</p>}
    {event.status==='ready'&&<section aria-label="같은 사건 비교">
      <p>같은 사건·쟁점 {event.count}건 · {event.publisherCount}개 매체 · 기준선 거리 {scoreText(event.score,event.scoreBounds)}</p>
      {event.baselineBounds&&<p>구간 중앙값 기준선 {coordinateText(event.baselineBounds)}</p>}
      {event.baselineUncertain?<p>기준선 불확실 · 기준선 범위 폭이 0.5를 넘어 방향을 유보합니다.</p>
        :event.direction==='undetermined'&&<p>좌표 범위가 기준선 구간에 닿거나 겹쳐 방향을 유보합니다.</p>}
      {([['similar','같은 편 인용 구성'],['opposing','반대편 인용 구성']] as const).map(([key,label])=><div key={key}>
        <strong>{label}</strong>
        {event[key].slice(0,3).map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{references.find(ref=>ref.voiceCoordinates?.some(coordinate=>coordinate.id===item.id))?.title??item.publisher}</a></p>)}
      </div>)}
    </section>}
    {quarters.length?quarters.map((currentQuarter,index)=><section key={`${currentQuarter.modelVersion}-${index}`} aria-label="같은 쟁점 분기 비교">
      <p>{currentQuarter.comparisonLabel}</p>
      {currentQuarter.fallbackReason&&<p>{currentQuarter.fallbackReason}</p>}
      {currentQuarter.status==='ready'?<>
        <p>중앙값 거리 {scoreText(currentQuarter.score,currentQuarter.scoreRange)} · {currentQuarter.topPercentile&&`찬성 좌표 기준 상위 ${currentQuarter.topPercentile.lower} ~ ${currentQuarter.topPercentile.upper}%`}</p>
        <p>분포에 사용한 점 좌표 {currentQuarter.pointCount}건 · 범위 좌표 {currentQuarter.rangeCount}건</p>
        {currentQuarter.baselineBounds&&<p>구간 중앙값 기준선 {coordinateText(currentQuarter.baselineBounds)}</p>}
        {currentQuarter.selfExcluded&&<p>비교 집합에 있던 같은 본문 기사를 제외하고 기준선을 다시 계산했습니다.</p>}
        {currentQuarter.baselineUncertain?<p>기준선 불확실 · 기준선 범위 폭이 0.5를 넘어 방향을 유보합니다.</p>
          :currentQuarter.direction==='undetermined'&&<p>좌표 범위가 기준선 구간에 닿거나 겹쳐 방향을 유보합니다.</p>}
        {!!currentQuarter.opposingArticles.length&&<div><strong>반대편 기사 후보</strong>{currentQuarter.opposingArticles.map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> · {item.publisher}</p>)}</div>}
        {currentQuarter.sourceComposition&&<section aria-label="인용 구성 분포">
          <p>찬반 문장 수 기준 분류 · 이 기사는 {currentQuarter.sourceComposition.inputCategory==='support'?'찬성 쪽 우세':currentQuarter.sourceComposition.inputCategory==='oppose'?'반대 쪽 우세':'혼합·불확실'}</p>
          <p>같은 비교 묶음 {currentQuarter.count}건 중 찬성 쪽 인용 우세 {currentQuarter.sourceComposition.counts.support}건 · 반대 쪽 {currentQuarter.sourceComposition.counts.oppose}건 · 혼합 {currentQuarter.sourceComposition.counts.mixed}건</p>
          <p>{currentQuarter.sourceComposition.classificationBasis}</p>
          <ol aria-label="좌표 분포와 입력 기사 범위">{currentQuarter.sourceComposition.histogram.map(bin=><li key={`${bin.lower}-${bin.upper}`} data-input-range={bin.includesInput}>
            <span>{bin.lower.toFixed(2)}~{bin.upper.toFixed(2)} · {bin.count}개 경계 관측</span>{bin.includesInput&&<strong>입력 기사 구간</strong>}
          </li>)}</ol>
          {!!currentQuarter.sourceComposition.differentCompositionArticles.length&&<div><strong>인용 구성이 다른 기사</strong>
            {currentQuarter.sourceComposition.differentCompositionArticles.map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a> · {item.publisher}</p>)}</div>}
        </section>}
      </>:<p>비교 기사 부족 · 매체당 고유 기사 3건·2매체 기준으로 표본을 모으고 있습니다.</p>}
    </section>):<p>같은 쟁점 전체 기간 비교 분포를 확인합니다. 매체당 적격 기사 3건·2매체 조건을 유지합니다.</p>}
    <details><summary>문장별 분류 근거</summary>{documents.map(document=><section key={document.articleIssue??'unassigned'}><p>{document.articleIssue?VOICE_TOPICS[document.topic]?.issues[document.articleIssue]??document.articleIssue:'주 쟁점 미확정'}</p><ol>{document.labels.map(label=><li key={label.sentenceId}>
      {units.find(unit=>unit.sentenceId===label.sentenceId)?.text} <small>· {label.excluded?'본문 외 표시 · 집계 제외':`${label.issue} · ${label.direction} · ${label.speaker}`}</small>
    </li>)}</ol></section>)}</details>
  </details>;
}
