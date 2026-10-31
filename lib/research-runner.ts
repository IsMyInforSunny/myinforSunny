import type {EvidenceBundle,ResearchInput,ResearchPlan,ResearchStage,ResearchVerification} from './research-contract';
type Progress={stage:ResearchStage;completed:number;total:number;message:string};
type Dependencies={post:<T>(body:unknown,signal:AbortSignal)=>Promise<T>;wait:(ms:number,signal:AbortSignal)=>Promise<void>;now:()=>number};
export async function runResearch(input:ResearchInput,signal:AbortSignal,deps:Dependencies,onProgress:(p:Progress)=>void,onResult:(v:ResearchVerification)=>void){
 const total=input.claims.length;let completed=0,reviewed=0;const factualIds=new Set(input.claims.map(c=>c.id));const completedIds=new Set<string>();const emit=(stage:ResearchStage,message:string)=>onProgress({stage,completed,total,message});
 emit('planning','주장별 공개 자료 조사 계획을 만들고 있어요.');
 const plan=await deps.post<ResearchPlan>({operation:'plan',input},signal);let next=new Date(plan.nextModelCallAt).getTime();const searches:number[]=[];
 for(let index=0;index<plan.queries.length;index++){
  if(signal.aborted)throw new DOMException('취소됨','AbortError');
  // Schedule distinct searches; never retry a failed provider request automatically.
  const now=deps.now();const searchAt=Math.max(searches.length?searches[searches.length-1]+7000:now,searches.length>=3?searches[searches.length-3]+61000:now);
  if(searchAt>now){emit('waiting',`기사 검색 한도를 지키기 위해 약 ${Math.ceil((searchAt-now)/1000)}초 기다립니다.`);await deps.wait(searchAt-now,signal);}
  if(signal.aborted)throw new DOMException('취소됨','AbortError');
  emit('searching',`${index+1}/${plan.queries.length} · ${plan.queries[index].label} 관련 자료를 찾고 있어요.`);
  searches.push(deps.now());const evidence=await deps.post<EvidenceBundle>({operation:'discover',input,planToken:plan.token,queryIndex:index},signal);
  if(!evidence.references.length){emit('partial','해당 주장을 대조할 공개 본문을 확보하지 못했어요.');continue;}
  const remaining=Math.max(0,next-deps.now());if(remaining){emit('waiting',`무료 AI 한도를 지키기 위해 약 ${Math.ceil(remaining/1000)}초 기다립니다. 창을 열어 두세요.`);await deps.wait(remaining,signal);}
  if(signal.aborted)throw new DOMException('취소됨','AbortError');
  emit('comparing','취득한 기사 본문과 주장을 대조하고 있어요.');
  const result=await deps.post<ResearchVerification>({operation:'compare',input,evidenceToken:evidence.token},signal);
  onResult(result);for(const c of result.checks)if(c.execution==='completed'&&factualIds.has(c.claimId))completedIds.add(c.claimId);if(result.status==='success'&&result.references.length)reviewed++;completed=completedIds.size;next=deps.now()+61000;
 }
 const done=completed>=total&&reviewed===plan.queries.length;
 emit(done?'completed':'partial',done?'계획한 자료 대조를 마쳤어요. 인용·조사 범위·관점 누락 여부를 확인해 주세요.':'확보한 자료만 검토했어요. 남은 주장이나 관점은 확인되지 않았습니다.');
}
export function researchWait(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(new DOMException('취소됨','AbortError'));return;}const aborted=()=>{clearTimeout(timer);reject(new DOMException('취소됨','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},ms);signal.addEventListener('abort',aborted,{once:true});});}
