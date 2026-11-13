import type {Analysis} from '@/lib/contracts';
import {summarizeVoices,voiceSentences,VOICE_TOPICS} from '@/lib/sentence-voice';
import type {ResearchVerification} from '@/lib/research-contract';
import {voiceAssessmentFromResearch} from '@/lib/voice-model-adapter';
import trainingStatus from '@/lib/data/voice-model-status.json';
export default function SentenceVoicePanel({analysis,researchResults=[]}:{analysis:Analysis;researchResults?:ResearchVerification[]}){
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const summary=analysis.sentenceVoices?summarizeVoices(body,analysis.sentenceVoices):null;
  if(!summary)return <div className="studio-relative">
    <p><strong>문장 SVM 학습·검증 중</strong></p>
    <p>실제 기사 AI 라벨 {trainingStatus.annotatedArticleCount}건 · 학습 가능 {trainingStatus.usableSentenceCount}문장 · 사람 정확도 평가 {trainingStatus.humanEvaluationCount}건</p>
    <p>현재 학습 범위 · {Object.keys(trainingStatus.topics).map(topic=>VOICE_TOPICS[topic as keyof typeof VOICE_TOPICS]?.label??topic).join(' · ')}</p>
    <p>현재 활성화된 문장 SVM은 없습니다. 판별 성능·독립 사건 평가·학습 및 모델 배포 이용 검토를 통과한 모델만 연결합니다.</p>
  </div>;
  const units=voiceSentences(body);
  const comparison=voiceAssessmentFromResearch(analysis,researchResults);
  const references=researchResults.flatMap(result=>result.references);
  return <details className="studio-relative" open><summary>기사에 실린 목소리 · {summary.method==='svm'?'문장 SVM':'AI 임시 집계'}</summary>
    <p>본문 앞 2,000자 · {summary.total}문장 · 미확정 {summary.unresolved}문장 · {summary.modelVersion}</p>
    {summary.issues.filter(issue=>issue.directional||issue.unresolved).map(issue=><div key={issue.issue}>
      <p><strong>{issue.proposition}</strong></p>
      <p>찬성 {issue.support} / 반대 {issue.oppose} · 좌표 {issue.coordinate===null?'입장이 드러나지 않음(방향 문장 3개 미만)':issue.coordinate.toFixed(2)}{issue.unresolved?` · 유보 ${issue.unresolved}문장`:''}</p>
      <p>기자 찬성 {issue.journalist.support} / 반대 {issue.journalist.oppose} · 취재원 찬성 {issue.source.support} / 반대 {issue.source.oppose}</p>
    </div>)}
    {!summary.issues.some(issue=>issue.directional)&&<p>명확한 방향 문장이 없습니다. 정책의 발표·시행 사실을 찬성으로 세지 않습니다.</p>}
    <p>좌표 = (찬성 − 반대) ÷ 방향 문장 수. 기사에 실린 발언 비중이며 기자의 이념·사회 여론·정확도 확률이 아닙니다. 쟁점별 방향을 섞지 않으며 불명확한 문장은 유보합니다.</p>
    {comparison.status==='ready'?<section aria-label="SVM 좌표로 비교한 기사">
      <p>같은 사건·쟁점 {comparison.count}건 · {comparison.publisherCount}개 매체 · 상대 점수 {comparison.score}점</p>
      {([['similar','가까운 발언 구성'],['opposing','기준선 반대쪽 발언 구성']] as const).map(([key,label])=><div key={key}>
        <strong>{label}</strong>
        {comparison[key].slice(0,3).map(item=><p key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer">{references.find(ref=>ref.voiceCoordinates?.some(coordinate=>coordinate.id===item.id))?.title??item.publisher}</a> · 좌표 {item.coordinate.toFixed(2)}</p>)}
        {!comparison[key].length&&<p>해당 조건의 비교 기사가 없습니다.</p>}
      </div>)}
    </section>:<p>상대 점수·추천 대기 · 같은 사건·쟁점에서 매체별 3건 이상, 2개 매체의 미확정 없는 비교 기사가 필요합니다. 학습 원본과 중복은 제외합니다.</p>}
    <details><summary>문장별 분류 근거</summary><ol>{analysis.sentenceVoices!.labels.map(label=><li key={label.sentenceId}>
      {units.find(unit=>unit.sentenceId===label.sentenceId)?.text} <small>· {label.issue} · {label.direction} · {label.speaker}</small>
    </li>)}</ol></details>
  </details>;
}
