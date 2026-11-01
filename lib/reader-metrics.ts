import type {Analysis, Check, Reference, Span} from './contracts';
import type {ResearchVerification} from './research-contract';
import {naturalSentences, validSpan} from './domain';
import {currentResearch} from './current-research';

export type ReviewTone='unverified'|'supported'|'contradicted'|'conflicting'|'expression'|'fomo';
export type ReviewAnnotation={id:string;tone:ReviewTone;label:string;reason:string;span:Span};
export type ReviewSegment={start:number;end:number;text:string;annotations:ReviewAnnotation[]};
export const FOMO_RULE_VERSION='fomo-lexical-1.0';
export type FomoSignal={sourceId:string;start:number;end:number;quote:string;category:'urgency'|'scarcity'|'social_pressure'};
const fomoRules:{category:FomoSignal['category'];pattern:RegExp}[]=[
 {category:'urgency',pattern:/지금\s*당장|오늘만|마감\s*임박|놓치면(?:\s*(?:후회|손해))?/gu},
 {category:'scarcity',pattern:/한정\s*수량|품절\s*임박|마지막\s*기회|이번이\s*마지막/gu},
 {category:'social_pressure',pattern:/나만\s*뒤처[지질]|남들(?:은|이)?\s*다\s*(?:하는|한다|샀)|모두(?:가)?\s*(?:하고|사고)\s*있/gu},
];
function quotedAt(text:string,at:number){
 const pairs:[string,string][]=[['“','”'],['「','」'],['‘','’'],['"','"']];
 return pairs.some(([left,right])=>{let start=0;while(start<text.length){const a=text.indexOf(left,start);if(a<0)return false;const b=text.indexOf(right,a+1);if(b<0)return false;if(at>a&&at<b)return true;start=b+1;}return false;});
}
/** A transparent lexical screen of body sentences, never a psychological or reliability score. */
export function fomoSignals(analysis:Pick<Analysis,'sources'>){
 const body=analysis.sources.find(s=>s.kind==='body');
 if(!body)return {version:FOMO_RULE_VERSION,totalSentences:0,flaggedSentences:0,signals:[] as FomoSignal[]};
 const groups=naturalSentences(body.sentences);const signals:FomoSignal[]=[];let flaggedSentences=0;
 for(const sentence of groups){const chunk=body.text.slice(sentence.start,sentence.end);const found:FomoSignal[]=[];
  for(const rule of fomoRules){const regex=new RegExp(rule.pattern.source,rule.pattern.flags);for(const hit of chunk.matchAll(regex)){
   const at=hit.index!,after=chunk.slice(at+hit[0].length,at+hit[0].length+24),before=chunk.slice(Math.max(0,at-12),at);
   // Exclude directly quoted slogans and obvious negated/metalinguistic examples.
   if(quotedAt(body.text,sentence.start+at)||/^\s*(?:가|이|는|은|라고|라는|이라는)?\s*(?:아니|않|없|금지|표현|문구)/u.test(after)||/(?:말라는|않도록|아닌)\s*$/u.test(before))continue;
   found.push({sourceId:body.id,start:sentence.start+at,end:sentence.start+at+hit[0].length,quote:hit[0],category:rule.category});
  }}
  if(found.length)flaggedSentences++;signals.push(...found);
 }
 return {version:FOMO_RULE_VERSION,totalSentences:groups.length,flaggedSentences,signals};
}
function relationExists(ref:Reference|undefined,relation:{start:number;end:number;quote:string}){
 return !!ref&&Number.isInteger(relation.start)&&Number.isInteger(relation.end)&&relation.start>=0&&relation.end>relation.start&&relation.end<=ref.text.length&&ref.text.slice(relation.start,relation.end)===relation.quote;
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
  const source=analysis.sources.find(s=>s.id===signal.sourceId)!;const unit=source.sentences.find(s=>s.start<=signal.start&&s.end>=signal.end);
  if(unit)out.push({id:`fomo-${i}`,tone:'fomo',label:labels.fomo,reason:'긴급성·희소성·동조 압력 표현을 찾는 규칙에 해당합니다. 문맥을 확인해 주세요.',span:{...signal,sentenceId:unit.id}});
 }
 return out;
}

/** Split overlapping marks into disjoint slices without changing or duplicating source text. */
export function reviewSegments(text:string,annotations:ReviewAnnotation[]):ReviewSegment[]{
 const safe=annotations.filter(a=>a.span.start>=0&&a.span.end>a.span.start&&a.span.end<=text.length&&text.slice(a.span.start,a.span.end)===a.span.quote);
 const boundaries=[...new Set([0,text.length,...safe.flatMap(a=>[a.span.start,a.span.end])])].sort((a,b)=>a-b);
 return boundaries.slice(0,-1).map((start,i)=>({start,end:boundaries[i+1],text:text.slice(start,boundaries[i+1]),annotations:safe.filter(a=>a.span.start<=start&&a.span.end>=boundaries[i+1])}));
}

export type MapPoint={url:string;title:string;publisher:string;stance:'opposes_position'|'adds_context'|'supports_position';evidence:'supports'|'contradicts'|'mixed'|'unreviewed';quote:string;reason:string;position:string;claimCount:number};
const normal=(v:string)=>v.trim().replace(/\s+/g,' ');
function safeUrl(value:string|undefined){try{const u=new URL(value??'');const host=u.hostname.toLowerCase();return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port&&host.includes('.')&&!host.endsWith('.local')&&!host.endsWith('.localhost')&&!/^[\d.:[\]]+$/.test(host)?u:null;}catch{return null;}}
/** Per-article coordinates are local to one explicit proposition, not fixed publisher ideology. */
export function articleMapPoints(analysis:Analysis,results:ResearchVerification[]):MapPoint[]{
 if(analysis.mode==='demo')return [];
 const positions=[analysis.proposition,...analysis.claims.filter(c=>c.kind==='opinion').map(c=>c.text)].filter((p):p is string=>!!p).map(normal);
 if(!positions.length)return [];
 const factual=new Set(analysis.claims.filter(c=>c.kind==='factual').map(c=>c.id));const articles=new Map<string,MapPoint>();
 for(const v of currentResearch(analysis,results)){
  for(const ref of v.references){const url=safeUrl(ref.url);if(!url||ref.provenance!=='web_fetched')continue;
   const p=v.perspectiveChecks?.find(p=>p.referenceId===ref.id&&positions.includes(normal(p.positionText))&&['supports_position','opposes_position','adds_context'].includes(p.stance)&&relationExists(ref,p));
   if(!p)continue;
   const latest=new Map(v.checks.map(c=>[c.claimId,c]));let supports=false,contradicts=false;const claimIds=new Set<string>();
   for(const check of latest.values()){
    if(!factual.has(check.claimId)||check.execution!=='completed'||check.temporalFit!=='matched'||!['supported','contradicted','conflicting'].includes(check.outcome))continue;
    const relations=check.relations.filter(r=>r.referenceId===ref.id&&relationExists(ref,r));
    for(const r of relations){if(r.relation==='supports'&&['supported','conflicting'].includes(check.outcome)){supports=true;claimIds.add(check.claimId);}if(r.relation==='contradicts'&&['contradicted','conflicting'].includes(check.outcome)){contradicts=true;claimIds.add(check.claimId);}}
   }
   url.hash='';articles.set(url.href,{url:url.href,title:ref.title??url.hostname,publisher:url.hostname.replace(/^www\./,''),stance:p.stance as MapPoint['stance'],evidence:supports&&contradicts?'mixed':supports?'supports':contradicts?'contradicts':'unreviewed',quote:p.quote,reason:p.explanation,position:p.positionText,claimCount:claimIds.size});
  }
 }
 return [...articles.values()];
}
