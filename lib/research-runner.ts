import type {EvidenceBundle,ResearchInput,ResearchPlan,ResearchStage,ResearchVerification} from './research-contract';
/** Must match researchInputSchema.claims.max and lib/server/score-workflow RESEARCH_BATCH_CLAIMS. */
export const RESEARCH_BATCH_CLAIMS=5;
/** Per-claim scope state. Only `reviewed` means a completed comparison against fetched text. */
export type ClaimCoverage='pending'|'reviewing'|'reviewed'|'no_evidence'|'not_completed';
export type ResearchProgress={stage:ResearchStage;completed:number;total:number;message:string;batch:number;batches:number;coverage:Record<string,ClaimCoverage>};
type Dependencies={post:<T>(body:unknown,signal:AbortSignal)=>Promise<T>;wait:(ms:number,signal:AbortSignal)=>Promise<void>;now:()=>number;firstModelCallAt?:number};
/** Split every factual claim of one analysis into requests of at most five claims.
 * The opinion/proposition comparison target is attached to the first batch only so the
 * perspective search runs once. Each batch is its own signed plan (same sources, consents).
 */
export function researchBatches(input:ResearchInput):ResearchInput[]{
 const seen=new Set<string>();const claims=input.claims.filter(c=>!seen.has(c.id)&&!!seen.add(c.id));
 const {position,proposition,...base}=input;const batches:ResearchInput[]=[];
 for(let at=0;at<claims.length;at+=RESEARCH_BATCH_CLAIMS)batches.push({...base,claims:claims.slice(at,at+RESEARCH_BATCH_CLAIMS)});
 if(!batches.length)batches.push({...base,claims:[]});
 if(position)batches[0].position=position;
 if(proposition)batches[0].proposition=proposition;
 return batches.filter(b=>b.claims.length||b.position||b.proposition);
}
export async function runResearch(input:ResearchInput,signal:AbortSignal,deps:Dependencies,onProgress:(p:ResearchProgress)=>void,onResult:(v:ResearchVerification)=>void){
 const ensureActive=()=>{if(signal.aborted)throw new DOMException('취소됨','AbortError');};
 const batches=researchBatches(input);const coverage:Record<string,ClaimCoverage>={};
 for(const b of batches)for(const c of b.claims)coverage[c.id]='pending';
 const total=Object.keys(coverage).length;let completed=0,reviewed=0,plannedQueries=0,batchIndex=0;const completedIds=new Set<string>();
 let finished=false;const prefix=()=>batches.length>1&&!finished?`[묶음 ${batchIndex+1}/${batches.length}] `:'';
 const emit=(stage:ResearchStage,message:string)=>{ensureActive();onProgress({stage,completed,total,message:prefix()+message,batch:batchIndex+1,batches:batches.length,coverage:{...coverage}});};
 // Earliest time for the next model call (plan/compare). The first plan is not delayed.
 let next=Number.isFinite(deps.firstModelCallAt)?Math.max(0,deps.firstModelCallAt!):0;const searches:number[]=[];
 for(;batchIndex<batches.length;batchIndex++){
  const batch=batches[batchIndex];const batchIds=new Set(batch.claims.map(c=>c.id));
  for(const id of batchIds)coverage[id]='reviewing';
  try{
   const before=Math.max(0,next-deps.now());
   if(before){emit('waiting',`다음 조사 계획 전 무료 AI 한도를 지키기 위해 약 ${Math.ceil(before/1000)}초 기다립니다. 창을 열어 두세요.`);await deps.wait(before,signal);}
   ensureActive();
   emit('planning',batches.length>1?`주장 ${batch.claims.length}개의 공개 자료 조사 계획을 만들고 있어요. (전체 ${total}개 주장)`:'주장별 공개 자료 조사 계획을 만들고 있어요.');
   ensureActive();const plan=await deps.post<ResearchPlan>({operation:'plan',input:batch},signal);ensureActive();
   next=new Date(plan.nextModelCallAt).getTime();plannedQueries+=plan.queries.length;
   for(let index=0;index<plan.queries.length;index++){
    if(signal.aborted)throw new DOMException('취소됨','AbortError');
    // Schedule distinct searches; never retry a failed provider request automatically.
    const now=deps.now();const searchAt=Math.max(searches.length?searches[searches.length-1]+7000:now,searches.length>=3?searches[searches.length-3]+61000:now);
    if(searchAt>now){emit('waiting',`기사 검색 한도를 지키기 위해 약 ${Math.ceil((searchAt-now)/1000)}초 기다립니다.`);await deps.wait(searchAt-now,signal);}
    if(signal.aborted)throw new DOMException('취소됨','AbortError');
    emit('searching',`${index+1}/${plan.queries.length} · ${plan.queries[index].label} 관련 자료를 찾고 있어요.`);
    ensureActive();searches.push(deps.now());const evidence=await deps.post<EvidenceBundle>({operation:'discover',input:batch,planToken:plan.token,queryIndex:index},signal);ensureActive();
    if(!evidence.references.length){if(batchIds.has(evidence.claimId))coverage[evidence.claimId]='no_evidence';emit('partial','해당 주장을 대조할 공개 본문을 확보하지 못했어요.');continue;}
    const remaining=Math.max(0,next-deps.now());if(remaining){emit('waiting',`무료 AI 한도를 지키기 위해 약 ${Math.ceil(remaining/1000)}초 기다립니다. 창을 열어 두세요.`);await deps.wait(remaining,signal);}
    if(signal.aborted)throw new DOMException('취소됨','AbortError');
    emit('comparing','취득한 기사 본문과 주장을 대조하고 있어요.');
    ensureActive();const result=await deps.post<ResearchVerification>({operation:'compare',input:batch,evidenceToken:evidence.token},signal);ensureActive();
    next=deps.now()+61000;
    onResult(result);ensureActive();
    for(const c of result.checks)if(batchIds.has(c.claimId)){if(c.execution==='completed'){completedIds.add(c.claimId);coverage[c.claimId]='reviewed';}else if(coverage[c.claimId]!=='reviewed')coverage[c.claimId]='not_completed';}
    if(result.status==='success'&&result.references.length)reviewed++;completed=completedIds.size;
   }
  }catch(e){
   if(signal.aborted||(e instanceof DOMException&&e.name==='AbortError'))throw e;
   // No automatic retry: report how much of the whole analysis stays unreviewed.
   for(const id of Object.keys(coverage))if(coverage[id]==='reviewing'||coverage[id]==='pending')coverage[id]='not_completed';
   const base=e instanceof Error?e.message:'자동 조사에 연결하지 못했어요.';
   const left=total-completed;
   throw new Error(batches.length>1||completed?`${prefix()}${base} 대조를 마치지 않은 ${left}개 주장은 검토 완료로 세지 않았어요.`:base);
  }
  for(const id of batchIds)if(coverage[id]==='reviewing')coverage[id]='not_completed';
 }
 batchIndex=batches.length-1;finished=true;
 const done=completed>=total&&reviewed===plannedQueries;
 emit(done?'completed':'partial',done?(batches.length>1?`${total}개 주장 전체(${batches.length}묶음)의 계획한 자료 대조를 마쳤어요. 인용·조사 범위·관점 누락 여부를 확인해 주세요.`:'계획한 자료 대조를 마쳤어요. 인용·조사 범위·관점 누락 여부를 확인해 주세요.'):batches.length>1?`확보한 자료만 검토했어요. 전체 ${total}개 주장 중 ${completed}개만 대조를 마쳤고, 남은 주장이나 관점은 확인되지 않았습니다.`:'확보한 자료만 검토했어요. 남은 주장이나 관점은 확인되지 않았습니다.');
}
export function researchWait(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(new DOMException('취소됨','AbortError'));return;}const aborted=()=>{clearTimeout(timer);reject(new DOMException('취소됨','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',aborted);resolve();},ms);signal.addEventListener('abort',aborted,{once:true});});}
