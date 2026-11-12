import artifact from '@/lib/data/stance-model.json';
import training from '@/lib/data/stance-model-status.json';
import {classifyRelativeTopic} from '@/lib/relative-metrics';
import {inferContentStance,parseStanceModel,STANCE_PROPOSITIONS} from '@/lib/stance-model';

const model=parseStanceModel(artifact);
const reasons:Record<string,string>={annotation_in_progress:'실제 기사 입장 라벨 작성 중',
  'insufficient_class:support':'찬성 입장 표본 부족','insufficient_class:oppose':'반대 입장 표본 부족',
  'insufficient_class:non_directional':'입장 미표현 표본 부족',independent_group_split_unavailable:'독립 사건으로 나눈 평가 표본 부족',
  teacher_agreement_below_threshold:'AI 라벨 재현 점검 미통과',direction_recall_below_threshold:'찬반 판별 점검 미통과',
  usage_review_pending:'학습·모델 배포 이용 검토 대기'};
export default function ContentStanceComparison({body,title=''}:{body:string;title?:string}){
  const topic=classifyRelativeTopic(body,title),prediction=model&&topic?inferContentStance(model,body,topic):null;
  const status=training as {version?:string;annotatedArticleCount:number;relevantArticleCount:number;blockers:string[];classCounts:Record<string,number>;aiTeacherAgreement?:{macroF1:number;majorityMacroF1:number;recall:Record<string,number>};humanEvaluationCount:number};
  return <div className="studio-content-stance">
    <p><strong>기사 내용의 입장 비교 모델</strong></p>
    {topic?<p>공통 비교 명제 · {STANCE_PROPOSITIONS[topic]}</p>
      :<p>이 연구 SVM은 6개 정책 명제만 대상으로 합니다. 다른 분야의 기사는 위의 일반 논점 분석에서 본문 입장과 인용 근거를 확인해 주세요.</p>}
    {prediction?.status==='ready'?<p>{prediction.label==='support'?'찬성':'반대'} 관점 · 모델 좌표 {prediction.coordinate!.toFixed(2)} · {model!.version}</p>
      :prediction?.status==='non_directional'?<p>명시적인 찬반 입장 없음 · 편향 강도 점수로 바꾸지 않습니다.</p>
      :prediction?<p>{prediction.status==='off_proposition'?'해당 정책 명제와 직접 관련 없는 기사입니다.':'모델이 입장을 확정하지 못했습니다.'}</p>
      :<><p>입장 모델 준비 · {status.blockers.map(reason=>reasons[reason]??'모델 연결 점검 필요').join(' · ')}</p>
        {!!status.annotatedArticleCount&&<><p>AI 검토 {status.annotatedArticleCount}건 중 명제 관련 {status.relevantArticleCount}건 · 학습 가능 표본: 찬성 {status.classCounts.support??0} · 반대 {status.classCounts.oppose??0} · 입장 미표현·복합 {status.classCounts.non_directional??0}</p>
          {status.aiTeacherAgreement&&<p>AI 라벨 재현 macro-F1 {(status.aiTeacherAgreement.macroF1*100).toFixed(1)}% · 찬성 재현율 {((status.aiTeacherAgreement.recall.support??0)*100).toFixed(1)}% · 반대 {((status.aiTeacherAgreement.recall.oppose??0)*100).toFixed(1)}% · 사람 평가 {status.humanEvaluationCount}건</p>}</>}</>}
    <p>매체를 맞히는 기존 모델과 구분합니다. AI 라벨 재현 점검은 사람 정확도 평가가 아니며, 기준을 통과하지 못한 모델은 점수에 연결하지 않습니다.</p>
  </div>;
}
