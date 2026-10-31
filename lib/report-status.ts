import type {Analysis,Check} from './contracts';
import {expressionSummary,completedFactualChecks} from './domain';
export function reportStatus(a:Analysis,checks:Check[]){
 const {flagged,undetermined:undecided,total}=expressionSummary(a);
 const factual=a.claims.filter(c=>c.kind==='factual');
 const completed=completedFactualChecks(a.claims,checks);
 const needsMore=completed.some(c=>c&&['contradicted','conflicting','insufficient'].includes(c.outcome));
 return {topics:a.topics.length>=2?'복수 논점 확인':a.topics.length===1?'단일 논점 확인':'판단 유보',
  expression:flagged?(undecided?'검토 표현 있음 · 일부 판단 유보':'검토 표현 있음'):undecided||!total?'판단 유보':'명확한 표현 근거 없음',
  evidence:!factual.length?'추출된 사실 주장 없음':!completed.length?'아직 대조하지 않음':needsMore?'추가 자료 필요':'입력 자료 범위에서 확인',
  completed:completed.length,totalClaims:factual.length};
}
