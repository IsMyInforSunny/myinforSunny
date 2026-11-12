import type {Analysis} from '@/lib/contracts';
import {summarizeVoices,voiceSentences} from '@/lib/sentence-voice';
export default function SentenceVoicePanel({analysis}:{analysis:Analysis}){
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const summary=analysis.sentenceVoices?summarizeVoices(body,analysis.sentenceVoices):null;
  if(!summary)return <p>문장 목소리 분석 준비 중 · 기존 기사 전체 입장과 구분합니다.</p>;
  const units=voiceSentences(body);
  return <details className="studio-relative" open><summary>기사에 실린 목소리 · {summary.method==='svm'?'문장 SVM':'AI 임시 집계'}</summary>
    <p>본문 앞 2,000자 · {summary.total}문장 · 미확정 {summary.unresolved}문장 · {summary.modelVersion}</p>
    {summary.issues.filter(issue=>issue.directional||issue.unresolved).map(issue=><div key={issue.issue}>
      <p><strong>{issue.proposition}</strong></p>
      <p>찬성 {issue.support} / 반대 {issue.oppose} · 좌표 {issue.coordinate===null?'입장이 드러나지 않음(방향 문장 3개 미만)':issue.coordinate.toFixed(2)}{issue.unresolved?` · 유보 ${issue.unresolved}문장`:''}</p>
      <p>기자 찬성 {issue.journalist.support} / 반대 {issue.journalist.oppose} · 취재원 찬성 {issue.source.support} / 반대 {issue.source.oppose}</p>
    </div>)}
    {!summary.issues.some(issue=>issue.directional)&&<p>명확한 방향 문장이 없습니다. 정책의 발표·시행 사실을 찬성으로 세지 않습니다.</p>}
    <p>좌표 = (찬성 − 반대) ÷ 방향 문장 수. 기사에 실린 발언 비중이며 기자의 이념·사회 여론·정확도 확률이 아닙니다. 쟁점별 방향을 섞지 않으며 불명확한 문장은 유보합니다.</p>
    <details><summary>문장별 분류 근거</summary><ol>{analysis.sentenceVoices!.labels.map(label=><li key={label.sentenceId}>
      {units.find(unit=>unit.sentenceId===label.sentenceId)?.text} <small>· {label.issue} · {label.direction} · {label.speaker}</small>
    </li>)}</ol></details>
  </details>;
}
