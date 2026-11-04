import {z} from 'zod/v4';
import type {BiasClassifierEvidence} from './bias-analysis';

const finite=z.number().finite();
const strings=z.array(z.string().min(1)).min(1);
const evidenceSchema=z.object({
  axisId:z.string().min(1),coordinateSpace:z.string().min(1),modelId:z.string().min(1),modelVersion:z.string().min(1),
  task:z.string().min(1),trainingDataId:z.string().min(1),evaluationDataId:z.string().min(1),
  evaluation:z.object({split:z.literal('held_out_articles'),heldOutUnit:z.literal('original_source_group'),groupSplitId:z.string().min(1),
    trainingPublisherIds:strings,evaluationPublisherIds:strings,trainingSourceGroupIds:strings,evaluationSourceGroupIds:strings,
    metrics:z.array(z.object({publisherId:z.string().min(1),sampleCount:z.number().int().positive(),coordinateMae:finite.min(0).max(2),publisherAccuracy:finite.min(0).max(1)})).min(2)}),
});
const artifactSchema=z.object({
  schemaVersion:z.literal('publisher-coordinate-svm-1'),synthetic:z.literal(false),dataKind:z.literal('real'),status:z.literal('validated'),
  comparisonGroup:z.string().min(1).max(160),classifierEvidence:evidenceSchema,
  topicScope:z.object({mode:z.literal('cross_topic'),trainingTopics:z.array(z.string().trim().min(1).max(160)).min(3),
    evaluationTopics:z.array(z.string().trim().min(1).max(160)).min(2)}).strict().optional(),
  vectorizer:z.object({analyzer:z.literal('char'),ngramRange:z.tuple([z.literal(2),z.literal(4)]),lowercase:z.literal(false),
    whitespace:z.literal('collapse'),norm:z.literal('l2'),sublinearTf:z.literal(true),vocabulary:z.record(z.string(),z.number().int().nonnegative()),idf:z.array(finite.positive()).min(1).max(100000)}),
  projection:z.object({coefficients:z.array(finite).min(1).max(100000),offset:finite,scale:finite.positive()}),
  validation:z.object({heldoutAnchorSeparation:z.literal(true),humanAxisReview:z.object({status:z.literal('approved'),
    reviewedBy:z.string().min(1),evidence:z.string().min(1),reviewedModelVersion:z.string().min(1),
    reviewers:z.array(z.string().min(1)).min(2),sampleCount:z.number().int().min(40),interReviewerAgreement:finite.min(0).max(1)})}),
  lineage:z.array(z.object({articleId:z.string().min(1),publisherId:z.string().min(1),url:z.string().url(),
    publishedAt:z.string().min(1),sourceGroupId:z.string().min(1),comparisonGroup:z.string().trim().min(1).max(160).optional(),contentHash:z.string().regex(/^[a-f0-9]{64}$/),
    split:z.enum(['training','evaluation']),usage:z.object({trainingAllowed:z.literal(true),modelDistributionAllowed:z.literal(true),
      basisUrl:z.string().trim().min(1),reviewedBy:z.string().trim().min(1),reviewedAt:z.string().trim().min(1)})})).min(12),
});
export type PortableBiasModel=z.infer<typeof artifactSchema>;

// Signed per-article data contains only a bounded coordinate and immutable
// release identity. Dataset group lists and metrics remain in the release.
const identityText=z.string().trim().min(1).max(256);
const compactClassifierSchema=z.object({
  coordinate:finite.min(-1).max(1),axisId:identityText,coordinateSpace:identityText,
  modelId:identityText,modelVersion:identityText,task:identityText,trainingDataId:identityText,evaluationDataId:identityText,
  evaluation:z.object({groupSplitId:identityText}).strict(),
}).strict();
const compactPredictionSchema=z.object({comparisonGroup:z.string().min(1).max(160),classifier:compactClassifierSchema}).strict();
export type CompactBiasPrediction=z.infer<typeof compactPredictionSchema>;

export function compactBiasPrediction(model:PortableBiasModel,coordinate:number,comparisonGroup=model.comparisonGroup):CompactBiasPrediction|null{
  const evidence=model.classifierEvidence;
  if(!modelAcceptsComparison(model,comparisonGroup))return null;
  const parsed=compactPredictionSchema.safeParse({comparisonGroup,classifier:{coordinate,
    axisId:evidence.axisId,coordinateSpace:evidence.coordinateSpace,modelId:evidence.modelId,modelVersion:evidence.modelVersion,
    task:evidence.task,trainingDataId:evidence.trainingDataId,evaluationDataId:evidence.evaluationDataId,
    evaluation:{groupSplitId:evidence.evaluation.groupSplitId}}});
  return parsed.success?parsed.data:null;
}

/** Compare compact identities against the current locally validated release. */
export function sameBiasModel(evidence:unknown,model:PortableBiasModel):boolean{
  const parsed=compactClassifierSchema.safeParse(evidence);if(!parsed.success)return false;
  const expected=compactBiasPrediction(model,parsed.data.coordinate);
  return !!expected&&JSON.stringify(parsed.data)===JSON.stringify(expected.classifier);
}

/** Accept a reviewed real-data release, never a research/synthetic training run. */
export function parseBiasModel(value:unknown):PortableBiasModel|null{
  const parsed=artifactSchema.safeParse(value);if(!parsed.success)return null;
  const model=parsed.data,{evaluation:e}=model.classifierEvidence;
  const ids=Object.values(model.vectorizer.vocabulary),n=model.vectorizer.idf.length;
  const review=model.validation.humanAxisReview;
  const sameSet=(a:string[],b:string[])=>new Set(a).size===a.length&&new Set(b).size===b.length
    &&a.length===b.length&&a.every(item=>b.includes(item));
  const publishers=e.metrics.map(m=>m.publisherId);
  const train=model.lineage.filter(row=>row.split==='training'),heldout=model.lineage.filter(row=>row.split==='evaluation');
  const trainingHashes=new Set(train.map(row=>row.contentHash));
  const scope=model.topicScope;
  if(scope){
    const topics=(rows:typeof train)=>[...new Set(rows.map(row=>row.comparisonGroup).filter((v):v is string=>!!v))];
    if(model.lineage.some(row=>!row.comparisonGroup)
      ||!sameSet(scope.trainingTopics,topics(train))||!sameSet(scope.evaluationTopics,topics(heldout))
      ||scope.trainingTopics.some(topic=>scope.evaluationTopics.includes(topic))
      ||publishers.some(p=>topics(train.filter(row=>row.publisherId===p)).length<2
        ||topics(heldout.filter(row=>row.publisherId===p)).length<2))return null;
  }else if(model.lineage.some(row=>row.comparisonGroup!==undefined&&row.comparisonGroup!==model.comparisonGroup))return null;
  if(ids.length!==n||new Set(ids).size!==n||ids.some(i=>i>=n)||model.projection.coefficients.length!==n
    ||!model.projection.coefficients.some(v=>v!==0)
    ||Object.keys(model.vectorizer.vocabulary).some(term=>Array.from(term).length<2||Array.from(term).length>4)
    ||model.classifierEvidence.trainingDataId===model.classifierEvidence.evaluationDataId
    ||e.trainingSourceGroupIds.some(id=>e.evaluationSourceGroupIds.includes(id))
    ||new Set(e.metrics.map(m=>m.publisherId)).size!==e.metrics.length
    ||model.classifierEvidence.modelId!=='publisher-char-tfidf-linear-svm'||model.classifierEvidence.task!=='publisher_identity_relative_coordinate'
    ||!review.reviewedBy.trim()||!review.evidence.trim()||review.reviewers.some(name=>!name.trim())
    ||review.reviewedModelVersion!==model.classifierEvidence.modelVersion||new Set(review.reviewers.map(name=>name.trim())).size<2
    ||review.sampleCount>new Set(heldout.map(row=>row.sourceGroupId)).size
    ||review.sampleCount>new Set(heldout.map(row=>row.contentHash)).size
    ||!sameSet(e.trainingPublisherIds,publishers)||!sameSet(e.evaluationPublisherIds,publishers)
    ||!sameSet(e.trainingSourceGroupIds,[...new Set(train.map(row=>row.sourceGroupId))])
    ||!sameSet(e.evaluationSourceGroupIds,[...new Set(heldout.map(row=>row.sourceGroupId))])
    ||e.metrics.some(m=>m.sampleCount<3||train.filter(row=>row.publisherId===m.publisherId).length<3
      ||heldout.filter(row=>row.publisherId===m.publisherId).length!==m.sampleCount)
    ||new Set(model.lineage.map(row=>row.articleId)).size!==model.lineage.length
    ||new Set(model.lineage.map(row=>row.url)).size!==model.lineage.length
    ||new Set(model.lineage.map(row=>JSON.stringify([row.publisherId,row.sourceGroupId]))).size!==model.lineage.length
    ||heldout.some(row=>trainingHashes.has(row.contentHash))
    ||model.lineage.some(row=>{const url=new URL(row.url);return url.protocol!=='https:'||!!url.username||!!url.password
      ||!publishers.includes(row.publisherId)||!(url.hostname===row.publisherId||url.hostname.endsWith(`.${row.publisherId}`))
      ||!Number.isFinite(Date.parse(row.publishedAt));})
    ||e.metrics.some(m=>!e.trainingPublisherIds.includes(m.publisherId)||!e.evaluationPublisherIds.includes(m.publisherId)))return null;
  return model;
}

/** A general publisher model must first pass held-out-topic validation. Runtime
 * article comparisons still use the user's current topic, never a pooled mix. */
export function modelAcceptsComparison(model:PortableBiasModel,group:string):boolean{
  return !!group.trim()&&group.length<=160&&(model.topicScope?.mode==='cross_topic'||model.comparisonGroup===group);
}

export function biasComparisonGroup(model:PortableBiasModel,analysis:{proposition?:string;claims:readonly {kind:string;text:string}[]}):string|null{
  if(!model.topicScope){
    return (analysis.proposition?analysis.proposition===model.comparisonGroup:analysis.claims.some(c=>c.text===model.comparisonGroup))?model.comparisonGroup:null;
  }
  const group=analysis.proposition??analysis.claims.find(c=>c.kind==='opinion')?.text
    ??analysis.claims.find(c=>c.kind==='factual'&&modelAcceptsComparison(model,c.text))?.text;
  return group&&modelAcceptsComparison(model,group)?group:null;
}

export function normalizeBiasText(text:string){
  return text.replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu,' ').replace(/^ +| +$/g,'');
}

/** Evaluation/reference articles must not silently be the classifier's training rows. */
export async function isBiasTrainingArticle(model:PortableBiasModel,url:string,text:string):Promise<boolean>{
  const training=model.lineage.filter(row=>row.split==='training');
  const canonical=(value:string)=>{const parsed=new URL(value);parsed.hash='';return parsed.href;};
  if(training.some(row=>canonical(row.url)===canonical(url)))return true;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeBiasText(text)));
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return training.some(row=>row.contentHash===hash);
}

/** Mirrors the offline char TF-IDF encoder; no API, storage, or article text logging. */
export function inferBiasCoordinate(model:PortableBiasModel,text:string):BiasClassifierEvidence|null{
  // Python re's Unicode whitespace set differs from JavaScript (notably BOM).
  const chars=Array.from(normalizeBiasText(text));
  const counts=new Map<number,number>();
  for(let width=2;width<=4;width++)for(let start=0;start+width<=chars.length;start++){
    const term=chars.slice(start,start+width).join('');
    if(!Object.prototype.hasOwnProperty.call(model.vectorizer.vocabulary,term))continue;
    const id=model.vectorizer.vocabulary[term];counts.set(id,(counts.get(id)??0)+1);
  }
  const tfidf=[...counts].map(([id,count])=>({id,value:(1+Math.log(count))*model.vectorizer.idf[id]}));
  const norm=tfidf.reduce((sum,x)=>Math.hypot(sum,x.value),0);if(!norm||!Number.isFinite(norm))return null;
  const margin=tfidf.reduce((sum,x)=>sum+x.value/norm*model.projection.coefficients[x.id],model.projection.offset);
  if(!Number.isFinite(margin))return null;
  const coordinate=Math.max(-1,Math.min(1,margin/model.projection.scale));
  return {...model.classifierEvidence,coordinate};
}
