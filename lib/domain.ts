import { Analysis, BodyTopicAssignment, Check, InputSource, Ratio, Span, TextRequest } from './contracts';
import { SEGMENTER, naturalSentenceCount, naturalSentences, sentences } from './segmentation';

export { SEGMENTER, FRAGMENT_LIMIT, naturalSentenceCount, naturalSentences, sentences } from './segmentation';
export function makeSources(req:TextRequest):InputSource[]{
  return [{id:'body',kind:'body' as const,text:req.body},...req.comments.map((c,i)=>({id:`comment_${i}`,clientId:c.id,kind:'comment' as const,text:c.text}))].map(s=>({...s,sentences:sentences(s.text,s.id)}));
}
export function locate(sources:InputSource[],candidate:{sentenceId:string;quote:string}):Span|null{
  for(const source of sources){const sentence=source.sentences.find(s=>s.id===candidate.sentenceId);if(!sentence)continue;
    const within=source.text.slice(sentence.start,sentence.end);const index=within.indexOf(candidate.quote);
    if(!candidate.quote.trim()||index<0)return null;
    const start=sentence.start+index;return {sourceId:source.id,sentenceId:sentence.id,start,end:start+candidate.quote.length,quote:candidate.quote};
  }return null;
}
export function validSpan(sources:InputSource[],span:Span){
  const s=sources.find(s=>s.id===span.sourceId);const sentence=s?.sentences.find(t=>t.id===span.sentenceId);
  return !!s&&!!sentence&&span.start>=sentence.start&&span.end<=sentence.end&&span.end>span.start&&s.text.slice(span.start,span.end)===span.quote;
}
export function ratio(numerator:number,denominator:number):Ratio{return {numerator,denominator,percent:denominator?Math.round(numerator/denominator*1000)/10:null};}
/** Count natural sentences once, even when a long sentence has several processing units. */
export function expressionSummary(analysis:Pick<Analysis,'sources'|'expressions'>){
  let total=0,flagged=0,undetermined=0;
  const byId=new Map(analysis.expressions.map(e=>[e.sentenceId,e]));
  for(const source of analysis.sources)for(const group of naturalSentences(source.sentences)){
    total++;
    const entries=group.units.map(u=>byId.get(u.id));
    if(entries.some(e=>e?.status==='flagged'))flagged++;
    // A sentence may contain a flagged part and another part still unclassified.
    if(entries.some(e=>!e||e.status==='undetermined'))undetermined++;
  }
  return {total,flagged,undetermined};
}
/** A later failed check supersedes an older completed check in every summary. */
export function completedFactualChecks(claims:Analysis['claims'],checks:Check[]){
  const latest=new Map(checks.map(c=>[c.claimId,c]));
  return claims.filter(c=>c.kind==='factual').map(c=>latest.get(c.id)).filter((c):c is Check=>!!c&&c.execution==='completed');
}
export function indicators(analysis:Pick<Analysis,'sources'|'topics'|'topicAssignments'|'expressions'|'claims'>,checks:Check[]=[]):Analysis['indicators']{
  const count=analysis.sources.filter(s=>s.kind==='comment').length;
  const factual=analysis.claims.filter(c=>c.kind==='factual');
  const completed=completedFactualChecks(factual,checks);
  const expression=expressionSummary(analysis);
  return {topics:analysis.topics.map(t=>({topicId:t.id,coverage:ratio(new Set(analysis.topicAssignments.filter(a=>a.topicIds.includes(t.id)).map(a=>a.sourceId)).size,count)})),expression:ratio(expression.flagged,expression.total),expressionUndetermined:expression.undetermined,evidenceSupport:ratio(completed.filter(c=>c?.outcome==='supported').length,completed.length),verificationProgress:ratio(completed.length,factual.length)};
}

/** One natural body sentence. Long sentences keep several processing units but are counted once. */
export type BodyTopicSentence={index:number;sentenceIds:string[];start:number;end:number;fragmented:boolean;status:BodyTopicAssignment['status'];topicIds:string[];reasons:string[];partiallyUndetermined:boolean};
export type BodyTopicDistribution={
  /** false for exports made before body assignments existed: no distribution is invented from example quotes. */
  available:boolean;
  /** Denominator: natural body sentences, including undetermined ones. */
  sentences:number;processingUnits:number;fragmentedSentences:number;
  assigned:number;other:number;undetermined:number;
  /** Multi-topic sentences are counted under every topic, so percentages may add up to more than 100. */
  topics:{topicId:string;coverage:Ratio}[];
  items:BodyTopicSentence[];
};
export function bodyTopicDistribution(analysis:Pick<Analysis,'sources'|'topics'|'bodyTopicAssignments'>):BodyTopicDistribution{
  const body=analysis.sources.find(s=>s.kind==='body');const empty:BodyTopicDistribution={available:false,sentences:0,processingUnits:0,fragmentedSentences:0,assigned:0,other:0,undetermined:0,topics:[],items:[]};
  if(!body||!analysis.bodyTopicAssignments)return empty;
  const known=new Set(analysis.topics.map(t=>t.id));const byId=new Map(analysis.bodyTopicAssignments.map(a=>[a.sentenceId,a]));
  const items:BodyTopicSentence[]=naturalSentences(body.sentences).map(group=>{
    // A unit without an assignment is undetermined; it is never silently dropped from the denominator.
    const entries=group.units.map(u=>byId.get(u.id)??{sentenceId:u.id,topicIds:[],status:'undetermined' as const,reason:'분류 결과가 없습니다.'});
    const topicIds=[...new Set(entries.flatMap(e=>e.status==='assigned'?e.topicIds.filter(id=>known.has(id)):[]))];
    const missing=entries.some(e=>e.status==='undetermined'||e.status==='assigned'&&!e.topicIds.some(id=>known.has(id)));
    const status=topicIds.length?'assigned' as const:missing?'undetermined' as const:'other' as const;
    return {index:group.index,sentenceIds:group.units.map(u=>u.id),start:group.start,end:group.end,fragmented:group.fragmented,status,topicIds,reasons:entries.flatMap(e=>e.reason&&e.status==='undetermined'?[e.reason]:[]),partiallyUndetermined:status==='assigned'&&missing};
  });
  const total=items.length;
  return {available:true,sentences:total,processingUnits:body.sentences.length,fragmentedSentences:items.filter(i=>i.fragmented).length,assigned:items.filter(i=>i.status==='assigned').length,other:items.filter(i=>i.status==='other').length,undetermined:items.filter(i=>i.status==='undetermined').length,
    topics:analysis.topics.map(t=>({topicId:t.id,coverage:ratio(items.filter(i=>i.topicIds.includes(t.id)).length,total)})),items};
}
/** Stale-analysis check for exports or in-memory results: a different segmenter means unit ids/offsets may differ. */
export function analysisCompatibility(analysis:Pick<Analysis,'versions'|'bodyTopicAssignments'>):{current:boolean;reason?:'SEGMENTER_CHANGED'|'BODY_TOPICS_MISSING'}{
  if(analysis.versions.segmenter!==SEGMENTER)return {current:false,reason:'SEGMENTER_CHANGED'};
  if(!analysis.bodyTopicAssignments)return {current:false,reason:'BODY_TOPICS_MISSING'};
  return {current:true};
}
function assertBodyTopics(a:Analysis){
  const body=a.sources.find(s=>s.kind==='body');const items=a.bodyTopicAssignments;
  if(!items)throw Error('BODY_TOPIC_MISSING');
  const units=body?.sentences??[];const ids=new Set(units.map(u=>u.id));
  if(items.length!==units.length||new Set(items.map(i=>i.sentenceId)).size!==units.length||items.some(i=>!ids.has(i.sentenceId)))throw Error('BODY_TOPIC_COVERAGE');
  if(items.some(i=>new Set(i.topicIds).size!==i.topicIds.length||i.topicIds.some(id=>!a.topics.some(t=>t.id===id))||(i.status==='assigned')!==!!i.topicIds.length))throw Error('BODY_TOPIC_ASSIGNMENT');
}
function assertNaturalMetadata(a:Analysis){
  if(a.versions.segmenter!==SEGMENTER)return;
  for(const source of a.sources){
    let lastEnd=0;
    for(const group of naturalSentences(source.sentences)){
      for(let part=0;part<group.units.length;part++){
        const unit=group.units[part],m=unit.natural;
        if(!m||m.index!==group.index||m.part!==part||m.parts!==group.units.length||unit.start<lastEnd||unit.end<=unit.start||unit.end>source.text.length)throw Error('NATURAL_METADATA');
        lastEnd=unit.end;
      }
    }
  }
}
export function assertAnalysis(a:Analysis){
  const ids=new Set(a.sources.map(s=>s.id));if(ids.size!==a.sources.length)throw Error('DUPLICATE_SOURCE');
  const spans=[...a.topics.flatMap(t=>t.evidence),...a.expressions.flatMap(e=>e.evidence),...a.claims.flatMap(c=>c.origin),...a.topicAssignments.flatMap(t=>t.evidence),...(a.stances??[]).flatMap(s=>s.evidence),...a.perspectiveQuestions.flatMap(q=>q.basis),...(a.counterArguments??[]).flatMap(c=>c.basis)];
  if(spans.some(s=>!validSpan(a.sources,s)))throw Error('INVALID_EVIDENCE');
  const all=a.sources.flatMap(s=>s.sentences);if(a.expressions.length!==all.length||new Set(a.expressions.map(e=>e.sentenceId)).size!==all.length||a.expressions.some(e=>!a.sources.some(s=>s.id===e.sourceId&&s.sentences.some(t=>t.id===e.sentenceId))))throw Error('EXPRESSION_COVERAGE');
  if(a.expressions.some(e=>e.status==='flagged'&&(!e.evidence.length||!e.criteria.length||!e.severity||!e.explanation)))throw Error('MISSING_FLAG_EVIDENCE');
  const comments=a.sources.filter(s=>s.kind==='comment');if(a.topicAssignments.length!==comments.length||new Set(a.topicAssignments.map(s=>s.sourceId)).size!==comments.length||a.topicAssignments.some(t=>!comments.some(c=>c.id===t.sourceId)))throw Error('TOPIC_COVERAGE');
  if(a.topicAssignments.some(t=>new Set(t.topicIds).size!==t.topicIds.length||t.topicIds.some(id=>!a.topics.some(topic=>topic.id===id))||(t.status==='assigned')!==!!t.topicIds.length))throw Error('TOPIC_ASSIGNMENT');
  // Older exports have no body assignments; anything made by the current segmenter must be complete, never partial.
  if(a.bodyTopicAssignments||a.versions.segmenter===SEGMENTER)assertBodyTopics(a);
  assertNaturalMetadata(a);
  if(a.coverage.naturalSentences!==undefined&&a.coverage.naturalSentences!==naturalSentenceCount(a.sources))throw Error('NATURAL_SENTENCE_COUNT');
  if(a.proposition&&(a.stances?.length!==comments.length||new Set(a.stances.map(s=>s.sourceId)).size!==comments.length||a.stances.some(s=>!comments.some(c=>c.id===s.sourceId))))throw Error('STANCE_COVERAGE');
  if((a.counterArguments??[]).some(c=>!a.claims.some(claim=>claim.id===c.claimId)||!c.basis.length))throw Error('COUNTER_ARGUMENT_BASIS');
  if(new Set(a.claims.map(c=>c.id)).size!==a.claims.length)throw Error('DUPLICATE_CLAIM');
}
