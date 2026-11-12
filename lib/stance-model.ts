import {z} from 'zod/v4';
import {articleTextPrefix} from './server/article-document';
import {normalizeBiasText} from './bias-model';
import {classifyRelativeTopic} from './relative-metrics';

export const STANCE_MODEL_SCHEMA='content-stance-svm-1.0';
export const STANCE_PROPOSITIONS={
  medical_school_quota:'의과대학 입학 정원을 확대해야 한다.',
  pension_reform:'국민연금 보험료율을 인상해야 한다.',
  minimum_wage:'최저임금을 인상해야 한다.',
  electricity_prices:'전기요금을 인상해야 한다.',
  housing_supply:'주택 공급을 확대해야 한다.',
  nuclear_energy:'원자력 발전을 확대해야 한다.',
} as const;
export type StanceTopic=keyof typeof STANCE_PROPOSITIONS;
export type ContentStance='non_directional'|'oppose'|'support';
const finite=z.number().finite();
const schema=z.object({schemaVersion:z.literal(STANCE_MODEL_SCHEMA),version:z.string().min(1),
  task:z.literal('article_stance_toward_proposition'),status:z.literal('ready'),scopeCharacters:z.literal(2000),
  propositions:z.record(z.string(),z.string()),classes:z.array(z.enum(['non_directional','oppose','support'])).length(3),
  vectorizer:z.object({vocabulary:z.record(z.string(),z.number().int().nonnegative()),idf:z.array(finite.positive()).min(1).max(12000)}),
  coefficients:z.array(z.array(finite).min(1).max(12000)).length(3),intercepts:z.array(finite).length(3),
  coordinateScale:finite.positive(),trainingHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  release:z.object({schemaVersion:z.literal('stance-release-1.0'),
    corpusDigest:z.string().regex(/^[a-f0-9]{64}$/),labelsDigest:z.string().regex(/^[a-f0-9]{64}$/),
    reviewDigest:z.string().regex(/^[a-f0-9]{64}$/),modelDigest:z.string().regex(/^[a-f0-9]{64}$/),
    trainingAllowed:z.literal(true),modelDistributionAllowed:z.literal(true)}),
  evaluation:z.object({ready:z.literal(true),automaticChecksPassed:z.literal(true),humanEvaluationCount:z.literal(0),
    groupOverlap:z.literal(0),splitId:z.string().min(1),blockers:z.array(z.string()).length(0),
    teacher:z.tuple([z.literal('ai'),z.string().min(1),z.string().min(1)]),
    classCounts:z.record(z.string(),z.number().int().nonnegative()),
    aiTeacherAgreement:z.object({macroF1:finite.min(0).max(1),majorityMacroF1:finite.min(0).max(1),
      recall:z.record(z.string(),finite.min(0).max(1))})}),
});
export type ContentStanceModel=z.infer<typeof schema>;

/** Different task and schema from the old publisher classifier. No gate bypass. */
export function parseStanceModel(value:unknown):ContentStanceModel|null{
  const parsed=schema.safeParse(value);if(!parsed.success)return null;
  const model=parsed.data,n=model.vectorizer.idf.length,ids=Object.values(model.vectorizer.vocabulary);
  if(new Set(model.classes).size!==3||ids.length!==n||new Set(ids).size!==n||ids.some(id=>id>=n)
    ||model.coefficients.some(row=>row.length!==n)||!model.coefficients.some(row=>row.some(value=>value!==0))
    ||Object.keys(model.vectorizer.vocabulary).some(term=>Array.from(term).length<2||Array.from(term).length>4)
    ||Object.entries(STANCE_PROPOSITIONS).some(([key,value])=>model.propositions[key]!==value)
    ||model.evaluation.aiTeacherAgreement.macroF1<.6
    ||model.evaluation.aiTeacherAgreement.macroF1<=model.evaluation.aiTeacherAgreement.majorityMacroF1
    ||model.classes.some(label=>(model.evaluation.classCounts[label]??0)<10)
    ||['support','oppose'].some(label=>(model.evaluation.aiTeacherAgreement.recall[label]??0)<.5))return null;
  return model;
}

/** Exact originals used in training must not become comparison evidence. */
export async function isStanceTrainingArticle(model:ContentStanceModel,body:string):Promise<boolean>{
  const bytes=new TextEncoder().encode(normalizeBiasText(articleTextPrefix(body,2000)));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return model.trainingHashes.includes(hash);
}

export function stanceModelText(body:string,topic:StanceTopic):string{
  const text=articleTextPrefix(body,2000).replace(/데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)/gi,'');
  return normalizeBiasText(`${STANCE_PROPOSITIONS[topic]}\n${text}`);
}

/** Only known policy propositions qualify. A house fire is not housing policy. */
export function stanceTopicRelevant(body:string,topic:StanceTopic):boolean{
  const text=articleTextPrefix(body,2000);
  const rules:Record<StanceTopic,RegExp>={
    medical_school_quota:/의(?:과)?대[\s\S]{0,35}(?:정원|증원|확대|늘리|줄이)|(?:정원|증원)[\s\S]{0,35}의(?:과)?대/,
    pension_reform:/국민연금|보험료율|소득대체율/,
    minimum_wage:/최저\s*(?:임금|시급)|생활임금/,
    electricity_prices:/(?:전기|전력)\s*(?:요금|료)[\s\S]{0,35}(?:인상|인하|동결|원가|한전|한국전력|올리|올려|내리|내려|오르|오른|조정|현실화)|(?:인상|인하|동결|올리|올려|내리|내려|조정|현실화)[\s\S]{0,35}(?:전기|전력)\s*(?:요금|료)/,
    housing_supply:/(?:주택|아파트|부동산)[\s\S]{0,35}(?:공급|분양|재건축|재개발)|(?:공급|분양|재건축|재개발)[\s\S]{0,35}(?:주택|아파트)/,
    nuclear_energy:/원전|원자력/,
  };
  return rules[topic].test(text);
}

/** Fixed questions keep articles about the same policy comparable. */
export function canonicalStanceProposition(body:string):string|undefined{
  const topic=classifyRelativeTopic(body);
  if(topic&&stanceTopicRelevant(body,topic))return STANCE_PROPOSITIONS[topic];
  // A dominant unrelated topic must not be replaced by an incidental mention.
  // Only the previously absent alias 최저시급 gets a separate fallback.
  return !topic&&/최저\s*시급/.test(articleTextPrefix(body,2000))?STANCE_PROPOSITIONS.minimum_wage:undefined;
}

/** Local char TF-IDF + LinearSVC. Margins are not probabilities or human accuracy. */
export function inferContentStance(model:ContentStanceModel,body:string,topic:StanceTopic){
  if(!stanceTopicRelevant(body,topic))return {status:'off_proposition' as const,coordinate:null,label:null};
  const chars=Array.from(stanceModelText(body,topic)),counts=new Map<number,number>();
  for(let width=2;width<=4;width++)for(let start=0;start+width<=chars.length;start++){
    const term=chars.slice(start,start+width).join('');
    if(Object.hasOwn(model.vectorizer.vocabulary,term)){
      const id=model.vectorizer.vocabulary[term];counts.set(id,(counts.get(id)??0)+1);
    }
  }
  if(!counts.size)return {status:'unrecognized' as const,coordinate:null,label:null};
  const features=[...counts].map(([id,count])=>({id,value:(1+Math.log(count))*model.vectorizer.idf[id]}));
  const norm=features.reduce((value,feature)=>Math.hypot(value,feature.value),0);
  if(!Number.isFinite(norm)||!norm)return {status:'unrecognized' as const,coordinate:null,label:null};
  const decisions=model.classes.map((label,index)=>({label,margin:features.reduce((sum,feature)=>sum+feature.value/norm*model.coefficients[index][feature.id],model.intercepts[index])})).sort((a,b)=>b.margin-a.margin);
  if(decisions.some(value=>!Number.isFinite(value.margin)))return {status:'unrecognized' as const,coordinate:null,label:null};
  if(decisions[0].margin-decisions[1].margin<.15)return {status:'uncertain' as const,coordinate:null,label:null};
  const label=decisions[0].label;
  if(label==='non_directional')return {status:'non_directional' as const,coordinate:null,label};
  const value=(decisions.find(value=>value.label==='support')!.margin-decisions.find(value=>value.label==='oppose')!.margin)/model.coordinateScale;
  return {status:'ready' as const,label,coordinate:Math.max(-1,Math.min(1,value))};
}
