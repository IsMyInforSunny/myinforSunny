import {fomoSignals} from './fomo-signals';
import type {Analysis, Check, Reference, Span} from './contracts';
import type {ResearchVerification} from './research-contract';
import {validSpan} from './domain';
import {currentResearch} from './current-research';
import {canonicalArticleUrl} from './media-position';

export type ReviewTone='unverified'|'supported'|'contradicted'|'conflicting'|'expression'|'fomo';
export type ReviewAnnotation={id:string;tone:ReviewTone;label:string;reason:string;span:Span};
export type ReviewSegment={start:number;end:number;text:string;annotations:ReviewAnnotation[]};
export {FOMO_RULE_VERSION, fomoSignals} from './fomo-signals';
export type {FomoSignal} from './fomo-signals';

function relationExists(ref:Reference|undefined,relation:{start:number;end:number;quote:string}){
 return !!ref&&!!relation.quote.trim()&&Number.isInteger(relation.start)&&Number.isInteger(relation.end)&&relation.start>=0&&relation.end>relation.start&&relation.end<=ref.text.length&&ref.text.slice(relation.start,relation.end)===relation.quote;
}
const labels:Record<ReviewTone,string>={unverified:'추가 근거 확인',supported:'대조 자료에서 확인',contradicted:'대조 자료와 다름',conflicting:'자료 간 내용이 다름',expression:'자극 표현 검토',fomo:'FOMO 표현 후보'};

/** Strong claim labels require matching reference quotes; absent or stale checks remain unverified. */
export function articleAnnotations(analysis:Analysis,checks:Check[]=[],verifications:ResearchVerification[]=[]):ReviewAnnotation[]{
 const latest=new Map<string,{check:Check;references:Reference[]}>();
 for(const check of checks)latest.set(check.claimId,{check,references:[]});
 for(const v of currentResearch(analysis,verifications)){for(const check of v.checks)latest.set(check.claimId,{check,references:v.references});}
 const out:ReviewAnnotation[]=[];
 for(const claim of analysis.claims.filter(c=>c.kind==='factual')){
  const record=latest.get(claim.id);const check=record?.check;let tone:ReviewTone='unverified';let reason='이 문장은 확인 가능한 사실 주장입니다. 아직 대조가 충분하지 않다는 뜻이며 거짓 판정이 아닙니다.';
  if(check?.execution==='completed'&&check.temporalFit==='matched'){
   const relations=check.relations.filter(r=>relationExists(record?.references.find(ref=>ref.id===r.referenceId),r));
   const support=relations.some(r=>r.relation==='supports'),opposition=relations.some(r=>r.relation==='contradicts');
   if(check.outcome==='supported'&&support)tone='supported';
   else if(check.outcome==='contradicted'&&opposition)tone='contradicted';
   else if(check.outcome==='conflicting'&&support&&opposition)tone='conflicting';
   if(tone!=='unverified')reason=check.explanation;
  }
  for(const [i,span] of claim.origin.entries())if(validSpan(analysis.sources,span))out.push({id:`claim-${claim.id}-${i}`,tone,label:labels[tone],reason,span});
 }
 for(const expression of analysis.expressions.filter(e=>e.status==='flagged'))for(const [i,span] of expression.evidence.entries())if(validSpan(analysis.sources,span))out.push({id:`expression-${expression.sentenceId}-${i}`,tone:'expression',label:labels.expression,reason:expression.explanation??'표현의 맥락을 직접 확인해 주세요.',span});
 for(const [i,signal] of fomoSignals(analysis).signals.entries()){
  const source=analysis.sources.find(s=>s.id===signal.sourceId)!;
  // A lexical phrase can cross a long sentence's processing boundary. Keep
  // one detected signal/count, but give each visible part a valid unit span.
  for(const unit of source.sentences){
   const start=Math.max(signal.start,unit.start),end=Math.min(signal.end,unit.end);
   if(end<=start)continue;const quote=source.text.slice(start,end);if(!quote.trim())continue;
   out.push({id:`fomo-${i}-${unit.id}`,tone:'fomo',label:labels.fomo,reason:`‘${signal.quote}’ 표현이 긴급성·희소성·동조 압력을 찾는 규칙에 해당합니다. 문맥을 확인해 주세요.`,span:{sourceId:signal.sourceId,sentenceId:unit.id,start,end,quote}});
  }
 }
 return out;
}

/** Split overlapping marks into disjoint slices without changing or duplicating source text. */
export function reviewSegments(text:string,annotations:ReviewAnnotation[]):ReviewSegment[]{
 const safe=annotations.filter(a=>a.span.start>=0&&a.span.end>a.span.start&&a.span.end<=text.length&&text.slice(a.span.start,a.span.end)===a.span.quote);
 const boundaries=[...new Set([0,text.length,...safe.flatMap(a=>[a.span.start,a.span.end])])].sort((a,b)=>a-b);
 return boundaries.slice(0,-1).map((start,i)=>({start,end:boundaries[i+1],text:text.slice(start,boundaries[i+1]),annotations:safe.filter(a=>a.span.start<=start&&a.span.end>=boundaries[i+1])}));
}

export type MapPoint={url:string;title:string;publisher:string;stance:'opposes_position'|'adds_context'|'supports_position';evidence:'supports'|'contradicts'|'mixed'|'unreviewed';quote:string;reason:string;position:string;claimCount:number}&Pick<Reference,'contentDigest'|'retrievedTextLength'|'retrievedTruncated'|'fullTextLength'|'extractionVersion'>;
const normal=(v:string)=>v.trim().replace(/\s+/g,' ');
/** Valid quoted observations, including contradictory classifications for the same article.
 * Keep those contradictions available to the publisher module so it can count them as undetermined.
 */
export function articleMapObservations(analysis:Analysis,results:ResearchVerification[]):MapPoint[]{
 if(analysis.mode==='demo')return [];
 const positions=[analysis.proposition,...analysis.claims.filter(c=>c.kind==='opinion').map(c=>c.text)].filter((p):p is string=>!!p).map(normal);
 if(!positions.length)return [];
 const factual=new Set(analysis.claims.filter(c=>c.kind==='factual').map(c=>c.id));const articles=new Map<string,MapPoint>();
 for(const v of currentResearch(analysis,results)){
  for(const ref of v.references){const article=canonicalArticleUrl(ref.url);if(!article||ref.provenance!=='web_fetched')continue;
   const perspectives=v.perspectiveChecks?.filter(p=>p.referenceId===ref.id&&positions.includes(normal(p.positionText))&&['supports_position','opposes_position','adds_context'].includes(p.stance)&&relationExists(ref,p))??[];
   if(!perspectives.length)continue;
   const latest=new Map(v.checks.map(c=>[c.claimId,c]));let supports=false,contradicts=false;const claimIds=new Set<string>();
   for(const check of latest.values()){
    if(!factual.has(check.claimId)||check.execution!=='completed'||check.temporalFit!=='matched'||!['supported','contradicted','conflicting'].includes(check.outcome))continue;
    const relations=check.relations.filter(r=>r.referenceId===ref.id&&relationExists(ref,r));
    for(const r of relations){if(r.relation==='supports'&&['supported','conflicting'].includes(check.outcome)){supports=true;claimIds.add(check.claimId);}if(r.relation==='contradicts'&&['contradicted','conflicting'].includes(check.outcome)){contradicts=true;claimIds.add(check.claimId);}}
   }
   const evidence:MapPoint['evidence']=supports&&contradicts?'mixed':supports?'supports':contradicts?'contradicts':'unreviewed';
   for(const p of perspectives){
    const position=normal(p.positionText),key=JSON.stringify([article.url,position,p.stance,evidence,ref.contentDigest??null,ref.retrievedTextLength??null,ref.retrievedTruncated??null,ref.fullTextLength??null,ref.extractionVersion??null]);
    if(!articles.has(key))articles.set(key,{url:article.url,title:ref.title??article.host,publisher:article.host,stance:p.stance as MapPoint['stance'],evidence,quote:p.quote,reason:p.explanation,position,claimCount:claimIds.size,contentDigest:ref.contentDigest,retrievedTextLength:ref.retrievedTextLength,retrievedTruncated:ref.retrievedTruncated,fullTextLength:ref.fullTextLength,extractionVersion:ref.extractionVersion});
   }
  }
 }
 return [...articles.values()];
}

/** Per-article map placements are local to one proposition. Conflicting placements are withheld,
 * rather than allowing array order or the last reference to choose an article's position.
 */
export function articleMapPoints(analysis:Analysis,results:ResearchVerification[]):MapPoint[]{
 const placements=new Map<string,{point:MapPoint;conflict:boolean}>();
 for(const point of articleMapObservations(analysis,results)){
  const key=JSON.stringify([point.url,point.position]),previous=placements.get(key);
  if(!previous)placements.set(key,{point,conflict:false});
  else if(previous.point.stance!==point.stance||previous.point.evidence!==point.evidence)previous.conflict=true;
 }
 return [...placements.values()].filter(p=>!p.conflict).map(p=>p.point);
}
