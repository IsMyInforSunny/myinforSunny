import type {Analysis,Capabilities,Check,Reference} from './contracts';
import type {Recommendation,ResearchStage,ResearchVerification,ReliabilityReview} from './research-contract';
import {canonicalArticleUrl} from './media-position';
import {validSpan} from './domain';

type ResearchPositionSource=Partial<Pick<Analysis,'proposition'|'bodyPosition'|'sources'>>;

/** A user-selected proposition takes priority. Automatic targets need evidence
 * from this analysis's body, never a comment's stance or an unbound quote. */
export function researchProposition(analysis:ResearchPositionSource):string|undefined{
 const explicit=analysis.proposition?.trim();
 if(explicit)return explicit;
 const candidate=analysis.bodyPosition;
 const proposition=candidate?.proposition.trim();
 if(!candidate||!proposition||proposition.length>160||!candidate.evidence.length||!analysis.sources)return undefined;
 const bodySources=analysis.sources.filter(source=>source.kind==='body');
 const grounded=candidate.evidence.every(span=>
  Number.isInteger(span.start)&&Number.isInteger(span.end)&&
  !!span.quote.trim()&&validSpan(bodySources,span),
 );
 return grounded?proposition:undefined;
}

/** NVIDIA's server request window is ten minutes. Allow transport overhead
 * while keeping cancellation and the shorter Groq request window intact. */
export function researchRequestTimeout(cap:Pick<Capabilities,'aiProvider'>|null|undefined):number{
 return cap?.aiProvider==='nvidia'?660_000:60_000;
}

function validRelation(ref:Reference|undefined,r:{quote:string;start:number;end:number}){return !!ref&&ref.provenance==='web_fetched'&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end>r.start&&r.end<=ref.text.length&&!!r.quote.trim()&&ref.text.slice(r.start,r.end)===r.quote;}
function safeLink(value:string|undefined){try{const u=new URL(value??'');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u:null;}catch{return null;}}
// Match the coordinate module's article identity without rewriting the link
// shown to the reader. Tracking aliases are observations of the same article.
const articleIdentity=(url:URL)=>canonicalArticleUrl(url.href)?.url??url.href;
type ReviewIdentity=Partial<Pick<Analysis,'analysisId'|'mode'>>;
/** A stance toward the comparison proposition may be opposite to the input article. */
export function recommendationLabel(card:Pick<Recommendation,'kind'|'relationToArticle'>):string{
 if(card.relationToArticle==='similar')return '본문과 같은 관점';
 if(card.relationToArticle==='opposing')return '본문과 다른 관점';
 if(card.kind==='different_evidence')return '다른 사실 근거';
 if(card.kind==='supporting_view')return '비교 명제에 찬성';
 if(card.kind==='opposing_view')return '비교 명제에 반대';
 return '관련 맥락';
}
function inScope(verifications:ResearchVerification[],analysis?:ReviewIdentity){
 if(!analysis?.analysisId&&!analysis?.mode)return verifications;
 if(analysis.mode==='demo')return [];
 return verifications.filter(v=>(!analysis.analysisId||v.parentAnalysisId===analysis.analysisId)&&(!analysis.mode||v.mode===analysis.mode));
}
// Claim IDs are only unique within their parent analysis. Keep independent
// histories separate even when a caller is doing a context-free inspection.
function claimKey(v:ResearchVerification,id:string){return JSON.stringify([v.mode,v.parentAnalysisId??null,id]);}

/** Only externally retrieved evidence contributes to the automatic reliability review. */
export function reliabilityReview(analysis:Pick<Analysis,'claims'>&ReviewIdentity,verifications:ResearchVerification[],stage:ResearchStage):ReliabilityReview{
 const claims=analysis.claims.filter(c=>c.kind==='factual');const ids=new Set(claims.map(c=>c.id));
 const latest=new Map<string,Check>();const sources=new Set<string>();const domains=new Set<string>();
 for(const v of inScope(verifications,analysis)){
  const fetched=v.references.filter(r=>r.provenance==='web_fetched'&&safeLink(r.url));
  for(const c of v.checks){if(!ids.has(c.claimId))continue;
   const relations=c.relations.filter(r=>validRelation(fetched.find(f=>f.id===r.referenceId),r));
   let outcome=c.outcome;
   if(outcome==='supported'&&!relations.some(r=>r.relation==='supports')||outcome==='contradicted'&&!relations.some(r=>r.relation==='contradicts')||outcome==='conflicting'&&!(relations.some(r=>r.relation==='supports')&&relations.some(r=>r.relation==='contradicts')))outcome='insufficient';
   if(c.temporalFit!=='matched'&&['supported','contradicted','conflicting'].includes(outcome))outcome='insufficient';
   // A failed retry may have no references. It still supersedes the previous
   // attempt. A completed provided-text comparison is not an external review.
   const execution=!fetched.length&&c.execution==='completed'?'skipped':c.execution;
   latest.set(c.claimId,{...c,outcome,execution,relations});
  }
  for(const r of fetched){const u=safeLink(r.url)!;u.hash='';sources.add(articleIdentity(u));domains.add(u.hostname.replace(/^www\./,''));}
 }
 const checks=[...latest.values()];const complete=checks.filter(c=>c.execution==='completed');
 const count=(outcome:Check['outcome'])=>complete.filter(c=>c.outcome===outcome).length;
 const supported=count('supported'),contradicted=count('contradicted'),conflicting=count('conflicting'),insufficient=count('insufficient');
 const pending=['planning','searching','fetching','waiting','comparing'].includes(stage);
 let status:ReliabilityReview['status'];let label:string;
 if(!claims.length){status='no_factual_claims';label='검토할 사실 주장 없음';}
 else if(contradicted||conflicting){status='contradiction_found';label='상충하는 자료 확인';}
 else if(pending){status='investigating';label='외부 자료 조사 중';}
 else if(!complete.length&&['unavailable','failed'].includes(stage)){status='research_unavailable';label='자동 조사에 연결하지 못함';}
 else if(!complete.length){status='not_started';label='아직 외부 조사 전';}
 else if(complete.length<claims.length){status='partially_reviewed';label='일부 주장만 검토됨';}
 else if(supported===claims.length){status='supported_in_reviewed_scope';label='확인한 자료 범위에서 뒷받침됨';}
 else{status='needs_more_evidence';label='추가 조사가 필요함';}
 return {status,label,totalClaims:claims.length,completedClaims:complete.length,supported,contradicted,conflicting,insufficient,remaining:Math.max(0,claims.length-complete.length),sourceCount:sources.size,publisherDomainCount:domains.size,checks,scopeNote:'추출한 주장과 실제 취득한 자료의 관계를 검토합니다. 기사 전체의 진실 확률이나 언론사 점수가 아니며, 도메인 수는 독립적인 근거의 수를 뜻하지 않습니다.'};
}

/** A factual contradiction is not automatically a policy/opinion disagreement. */
export function verifiedRecommendations(verifications:ResearchVerification[],analysis?:(Pick<Analysis,'analysisId'|'mode'>&Partial<Pick<Analysis,'claims'|'proposition'|'bodyPosition'|'sources'|'article'>>)):Recommendation[]{
 const scoped=inScope(verifications,analysis);
 const inputUrl=safeLink(analysis?.article?.url);
 const inputIdentity=inputUrl?articleIdentity(inputUrl):undefined;
 const known=analysis?.claims?new Set(analysis.claims.filter(c=>c.kind==='factual').map(c=>c.id)):null;
 const normal=(value:string)=>value.trim().replace(/\s+/g,' ');
 const selectedProposition=analysis?researchProposition(analysis):undefined;
 const positions=analysis?new Set([selectedProposition,...(analysis.claims??[]).filter(c=>c.kind==='opinion').map(c=>c.text)].filter((p):p is string=>!!p).map(normal)):null;
 const groundedBodyProposition=analysis?researchProposition({bodyPosition:analysis.bodyPosition,sources:analysis.sources}):undefined;
 const sameBodyProposition=!!groundedBodyProposition&&normal(groundedBodyProposition)===normal(selectedProposition??'');
 const articleLabel=sameBodyProposition?analysis?.bodyPosition?.label:undefined;
 const articleDirection=articleLabel==='support'?'supports_position':articleLabel==='oppose'?'opposes_position':undefined;
 const latest=new Map<string,{index:number;check:Check}>();
 scoped.forEach((v,index)=>{for(const check of v.checks)latest.set(claimKey(v,check.claimId),{index,check});});
 const perspectiveKey=(v:ResearchVerification,url:URL,position:string)=>JSON.stringify([v.mode,v.parentAnalysisId??null,articleIdentity(url),normal(position)]);
 const latestPerspective=new Map<string,NonNullable<ResearchVerification['perspectiveChecks']>[number]>();
 for(const v of scoped)for(const p of v.perspectiveChecks??[]){
  const ref=v.references.find(r=>r.id===p.referenceId),url=safeLink(ref?.url);
  if(!url)continue;url.hash='';latestPerspective.set(perspectiveKey(v,url,p.positionText),p);
 }
 const cards=new Map<string,Recommendation>();
 for(const [index,v] of scoped.entries()){for(const r of v.references){
  const u=safeLink(r.url);if(r.provenance!=='web_fetched'||!u)continue;
  u.hash='';
  if(inputIdentity&&articleIdentity(u)===inputIdentity)continue;
  const relations=v.checks.flatMap(c=>{const last=latest.get(claimKey(v,c.claimId));return last?.index===index&&last.check===c&&(!known||known.has(c.claimId))&&c.execution==='completed'&&c.temporalFit==='matched'?c.relations:[];}).filter(q=>q.referenceId===r.id&&validRelation(r,q));
  const perspective=v.perspectiveChecks?.find(p=>p.referenceId===r.id&&(!positions||positions.has(normal(p.positionText)))&&latestPerspective.get(perspectiveKey(v,u,p.positionText))===p&&validRelation(r,p));
  const related=relations.find(q=>q.relation==='contradicts')??relations[0];
  let kind:Recommendation['kind'],reason:string,quote:string,start:number,end:number;
  if(perspective&&['opposes_position','supports_position'].includes(perspective.stance)){
   kind=perspective.stance==='opposes_position'?'opposing_view':'supporting_view';reason=perspective.explanation;({quote,start,end}=perspective);
  }else if(perspective?.stance==='adds_context'){
   kind='context';reason=perspective.explanation;({quote,start,end}=perspective);
  }else if(related){kind=related.relation==='contradicts'?'different_evidence':'context';reason=related.explanation;({quote,start,end}=related);}
  else continue;
  let relationToArticle:Recommendation['relationToArticle']='unclassified';
  if(kind==='context'||kind==='different_evidence')relationToArticle='context';
  else if(articleDirection&&perspective&&normal(perspective.positionText)===normal(groundedBodyProposition!)){
   relationToArticle=perspective.stance===articleDirection?'similar':'opposing';
  }
  const key=articleIdentity(u);const old=cards.get(key);
  if(old&&(articleDirection?old.relationToArticle==='opposing':old.kind==='opposing_view'))continue;
  cards.set(key,{referenceId:r.id,title:r.title??u.hostname,url:u.href,publisherDomain:u.hostname.replace(/^www\./,''),kind,relationToArticle,reason,quote,start,end,provenance:'web_fetched'});
 }}
 return [...cards.values()].sort((a,b)=>articleDirection?Number(b.relationToArticle==='opposing')-Number(a.relationToArticle==='opposing'):Number(b.kind==='opposing_view')-Number(a.kind==='opposing_view')).slice(0,6);
}
