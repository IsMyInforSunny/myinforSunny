import type {Analysis,Check,Ratio,Outcome} from './contracts';
import {expressionSummary,completedFactualChecks} from './domain';
export const MIN_N_FOR_PERCENT=10;
export const PROVIDER_NAME='Groq';
export const DAILY_LIMIT_MESSAGE='오늘 실시간 분석 한도를 다 썼어요. 예시로 체험해 보세요';
export function countLabel(r:Ratio,unit:string){return r.denominator?`${r.numerator}/${r.denominator}${unit}`:'해당 없음';}
export function percentLabel(r:Ratio){return r.denominator>=MIN_N_FOR_PERCENT&&r.percent!==null?`${r.percent}%`:null;}
export function headline(a:Analysis,checks:Check[]){const completed=new Set(completedFactualChecks(a.claims,checks).map(c=>c.claimId));return `논점 ${a.topics.length}개 · 검토 표현 ${expressionSummary(a).flagged}문장 · 대조 전 주장 ${a.claims.filter(c=>c.kind==='factual'&&!completed.has(c.id)).length}개`;}
export const outcomeExplanation:Record<Outcome,string>={supported:'입력한 참고자료에서 이 주장을 뒷받침하는 내용을 확인했습니다.',contradicted:'입력한 본문과 참고자료의 내용이 다릅니다. 아래 두 인용을 함께 확인해 주세요.',conflicting:'입력한 참고자료들이 서로 다른 내용을 담고 있습니다.',insufficient:'이 자료만으로 주장을 충분히 확인하기 어렵습니다. 대상·시점·범위를 함께 살펴보세요.',unchecked:'아직 참고자료와 대조하지 않았습니다.',inaccessible:'참고자료를 확인하지 못했습니다.',not_applicable:'의견은 사실의 참·거짓으로 대조하지 않습니다.'};
/** Keep model implementation vocabulary out of reader-facing explanations. Quotes remain untouched. */
export function readerExplanation(text:string,fallback:string){return !text.trim()||/originMatches|claimId|referenceId|referenceSentenceId|\b(?:contradicted|supported|supports|contradicts|true|false)\b|[a-f0-9]{24,}|\b(?:body|comment_\d+)_s\d+\b/i.test(text)?fallback:text;}
