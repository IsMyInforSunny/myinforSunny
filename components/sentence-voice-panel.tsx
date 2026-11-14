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
  const summary=analysis.sentenceVoices?summarizeVoices(body,analysis.sentenceVoices):null;
  if(!summary)return <div className="studio-relative">
    <p><strong>문장 SVM 분석 준비 중</strong></p>
    <p>실제 기사 AI 라벨 {trainingStatus.annotatedArticleCount}건 · 사람 평가 {trainingStatus.humanEvaluationCount}건</p>
    <p>학습 범위 · {Object.keys(trainingStatus.topics).map(topic=>VOICE_TOPICS[topic as keyof typeof VOICE_TOPICS]?.label??topic).join(' · ')}</p>
    {semanticStatus.performanceChecksPassed&&<p>문장 분류 검사 후 기사 좌표와 같은 쟁점·분기 비교 분포를 로컬에서 검증하고 있습니다.</p>}
    <p>이용 검토와 모델 배포 준비 상태를 확인한 뒤 실제 모델 결과를 연결합니다.</p>
  </div>;
  const units=voiceSentences(body);
  const event=voiceAssessmentFromResearch(analysis,researchResults);
  const quarter=analysis.issueQuarterComparison;
  const currentQuarter=quarter?.parentAnalysisId===analysis.analysisId&&quarter.modelVersion===summary.modelVersion?quarter:null;
  const references=researchResults.flatMap(result=>result.references);
  const issues=summary.issues.filter(issue=>analysis.sentenceVoices?.articleIssue
    ?issue.issue===analysis.sentenceVoices.articleIssue:issue.directional||issue.evidence.unresolved);
  return <details className="studio-relative" open><summary>취재원 인용 균형과 기자 서술 방향</summary>
    <p>본문 앞 2,000자 · {summary.total}문장 · 본문 외 표시 제외 {summary.excluded}문장</p>
    {issues.map(issue=><section key={issue.issue} aria-label={issue.proposition}>
      <p><strong>{issue.proposition}</strong></p>
      <p>취재원 인용 균형 · 찬성 {issue.source.support} / 반대 {issue.source.oppose}문장 · 가능한 좌표 {coordinateText(issue.source.evidence)}</p>
      <p>기자 서술 방향 · 찬성 {issue.journalist.support} / 반대 {issue.journalist.oppose}문장 · 가능한 좌표 {coordinateText(issue.journalist.evidence)}</p>
      <p>취재원 미확정 {issue.source.evidence.unresolved} · 기자 미확정 {issue.journalist.evidence.unresolved}문장. 방향 문장 3개 이상, 범위 폭 0.5 이하일 때 상대 비교에 사용합니다.</p>
    </section>)}
    {!issues.length&&<p>기사의 주 쟁점을 하나로 확인할 근거가 부족합니다.</p>}
    {event.status==='ready'&&<section aria-label="같은 사건 비교">
      <p>같은 사건·쟁점 {event.count}건 · {event.publisherCount}개 매체 · 기준선 거리 {scoreText(event.score,event.scoreBounds)}</p>
      {event.direction==='undetermined'&&<p>좌표 범위가 기준선을 걸쳐 방향을 유보합니다.</p>}
      {([['similar','같은 편 인용 구성'],['opposing','반대편 인용 구성']] as const).map(([key,label])=><div key={key}>
        <strong>{label}</strong>
        {event[key].slice(0,3).map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{references.find(ref=>ref.voiceCoordinates?.some(coordinate=>coordinate.id===item.id))?.title??item.publisher}</a></p>)}
      </div>)}
    </section>}
    {currentQuarter?.status==='ready'?<section aria-label="같은 쟁점 분기 비교">
      <p>{currentQuarter.comparisonLabel}</p>
      {currentQuarter.fallbackReason&&<p>{currentQuarter.fallbackReason}</p>}
      <p>중앙값 거리 {scoreText(currentQuarter.score,currentQuarter.scoreRange)} · {currentQuarter.topPercentile&&`찬성 좌표 기준 상위 ${currentQuarter.topPercentile.lower} ~ ${currentQuarter.topPercentile.upper}%`}</p>
      <p>분포에 사용한 점 좌표 {currentQuarter.pointCount}건 · 범위만 확인된 기사 {currentQuarter.rangeCount}건</p>
      {currentQuarter.direction==='undetermined'&&<p>좌표 범위가 기준선을 걸쳐 방향을 유보합니다.</p>}
    </section>:<p>같은 쟁점·분기의 비교 분포 대기. 매체당 고유 기사 3건·2매체를 확인하며 표본이 부족하면 반기·전체 기간 순으로 비교합니다.</p>}
    <details><summary>문장별 분류 근거</summary><ol>{analysis.sentenceVoices!.labels.map(label=><li key={label.sentenceId}>
      {units.find(unit=>unit.sentenceId===label.sentenceId)?.text} <small>· {label.excluded?'본문 외 표시 · 집계 제외':`${label.issue} · ${label.direction} · ${label.speaker}`}</small>
    </li>)}</ol></details>
  </details>;
}
