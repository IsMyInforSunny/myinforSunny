import {z} from 'zod/v4';
import definition from './data/voice-issues.json';
import {naturalSentences,sentences,SEGMENTER} from './segmentation';
import {articleTextPrefix} from './server/article-document';
import {normalizeBiasText} from './bias-model';
import type {InputSource} from './contracts';

export const VOICE_VERSION=definition.version;
export const VOICE_SCOPE=2000;
export type VoiceTopic=keyof typeof definition.topics;
export const VOICE_TOPICS=definition.topics as Record<VoiceTopic,{label:string;issues:Record<string,string>}>;
export const voiceLabelSchema=z.object({sentenceId:z.string(),issue:z.string(),
  direction:z.enum(['support','oppose','neutral','uncertain']),
  speaker:z.enum(['journalist','source','mixed','unknown'])}).strict();
export type VoiceLabel=z.infer<typeof voiceLabelSchema>;
export type VoiceDocument={version:string;segmenter:string;scopeCharacters:number;topic:VoiceTopic;
  method:'ai'|'svm';modelVersion:string;labels:VoiceLabel[]};

export function voiceSentences(body:string){
  const text=articleTextPrefix(body,VOICE_SCOPE);
  return naturalSentences(sentences(text,'body')).map(group=>({sentenceId:group.units[0].id,
    start:group.start,end:group.end,text:text.slice(group.start,group.end)}));
}
/** Exported once for both online generation and local batch annotation. No corpus text in model files. */
export function voiceAnnotationInput(body:string,topic:VoiceTopic){
  return {version:VOICE_VERSION,segmenter:SEGMENTER,scopeCharacters:VOICE_SCOPE,topic,
    issues:VOICE_TOPICS[topic].issues,sentences:voiceSentences(body)};
}
export const VOICE_INSTRUCTIONS=`voiceLabels는 기자의 찬반이 아니라 기사에 실린 목소리를 분류한다. voiceInput.sentences의 각 자연 문장 ID에 정확히 한 번 답한다. issue는 voiceInput.issues의 키 또는 none, 불명확하면 unknown이다. 방향은 그 하위 명제에 대한 support/oppose/neutral/uncertain이다. 기사에 인용된 취재원의 요구·주장도 찬반으로 세되 기자의 입장으로 바꾸지 않는다. speaker는 journalist(서술자),source(인용·간접 인용 취재원),mixed(서로 다른 주체),unknown이다. 단순 시행·발표·통계 보도는 정책 찬성이 아니다. 한 문장에 여러 쟁점이나 상반된 방향이 섞이면 issue=unknown,direction=uncertain으로 유보한다. 앞뒤 문맥으로 대명사·인용·부정을 확인한다. 정책에 대한 위험·비용 언급만으로 반대라고 단정하지 않는다. 중립·무관 문장은 direction=neutral이다. 문장 번호와 분류 기호만 출력하며 원문을 반복하지 않는다.`;

/** Missing, duplicate, off-body and unknown-issue labels become unresolved, never neutral. */
export function validateVoiceDocument(body:string,document:VoiceDocument){
  const topic=VOICE_TOPICS[document.topic];
  if(!topic||document.version!==VOICE_VERSION||document.segmenter!==SEGMENTER||document.scopeCharacters!==VOICE_SCOPE)return null;
  const units=voiceSentences(body),ids=new Set(units.map(unit=>unit.sentenceId));
  if(document.labels.some(label=>!ids.has(label.sentenceId)))return null;
  const labels=units.map(unit=>{
    const candidates=document.labels.filter(label=>label.sentenceId===unit.sentenceId);
    const parsed=candidates.length===1?voiceLabelSchema.safeParse(candidates[0]):null;
    if(!parsed?.success||(!Object.hasOwn(topic.issues,parsed.data.issue)&&!['none','unknown'].includes(parsed.data.issue)))
      return {sentenceId:unit.sentenceId,issue:'unknown',direction:'uncertain' as const,speaker:'unknown' as const};
    const label=parsed.data;
    if((['support','oppose'].includes(label.direction)&&['none','unknown'].includes(label.issue))||label.speaker==='mixed')
      return {...label,direction:'uncertain' as const};
    return label;
  });
  return {...document,labels};
}

const balance=(labels:VoiceLabel[])=>{
  const support=labels.filter(label=>label.direction==='support').length;
  const oppose=labels.filter(label=>label.direction==='oppose').length;
  const directional=support+oppose;
  return {support,oppose,directional,coordinate:directional>=3?(support-oppose)/directional:null};
};
export function summarizeVoices(body:string,document:VoiceDocument){
  const valid=validateVoiceDocument(body,document);if(!valid)return null;
  return {version:VOICE_VERSION,method:valid.method,modelVersion:valid.modelVersion,topic:valid.topic,
    total:valid.labels.length,unresolved:valid.labels.filter(label=>label.direction==='uncertain'||label.speaker==='unknown').length,
    issues:Object.entries(VOICE_TOPICS[valid.topic].issues).map(([issue,proposition])=>{
      const labels=valid.labels.filter(label=>label.issue===issue);
      // Unknown speakers cannot be assigned to either population or the overall coordinate.
      const known=labels.filter(label=>label.speaker==='journalist'||label.speaker==='source');
      return {issue,proposition,...balance(known),journalist:balance(known.filter(label=>label.speaker==='journalist')),
        source:balance(known.filter(label=>label.speaker==='source')),
        unresolved:labels.filter(label=>label.direction==='uncertain'||label.speaker==='unknown').length};
    })};
}

/** Fixed feature transform shared with Python. No proposition prefix or publication identity. */
export function voiceModelText(text:string){
  return normalizeBiasText(text.replace(/데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)/gi,''));
}
const finite=z.number().finite();
const head=z.object({classes:z.array(z.string()).min(2),coefficients:z.array(z.array(finite)),intercepts:z.array(finite)});
const topicModel=z.object({vectorizer:z.object({vocabulary:z.record(z.string(),z.number().int().nonnegative()),idf:z.array(finite.positive()).min(1).max(12000)}),
  direction:head,speaker:head,issue:head,
  evaluation:z.object({ready:z.literal(true),groupOverlap:z.literal(0),heldoutArticleCount:z.number().int().min(2),
    macroF1:finite.min(.6).max(1),majorityMacroF1:finite.min(0).max(1),
    supportRecall:finite.min(.5).max(1),opposeRecall:finite.min(.5).max(1),
    speakerMacroF1:finite.min(.6).max(1),issueMacroF1:finite.min(.6).max(1),
    maskingAgreement:finite.min(.95).max(1),flipAccuracy:finite.min(.5).max(1),
    classCounts:z.record(z.string(),z.number().int().nonnegative())})});
const bundle=z.object({schemaVersion:z.literal('sentence-voice-svm-1.0'),version:z.string().min(1),
  status:z.literal('ready'),segmenter:z.literal(SEGMENTER),definitionVersion:z.literal(VOICE_VERSION),scopeCharacters:z.literal(VOICE_SCOPE),
  topics:z.record(z.string(),topicModel),trainingArticleHashes:z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  release:z.object({schemaVersion:z.literal('voice-release-1.0'),corpusDigest:z.string().regex(/^[a-f0-9]{64}$/),labelsDigest:z.string().regex(/^[a-f0-9]{64}$/),
    reviewDigest:z.string().regex(/^[a-f0-9]{64}$/),modelDigest:z.string().regex(/^[a-f0-9]{64}$/),trainingAllowed:z.literal(true),modelDistributionAllowed:z.literal(true)})});
export type VoiceModel=z.infer<typeof bundle>;
export function parseVoiceModel(value:unknown):VoiceModel|null{
  const parsed=bundle.safeParse(value);if(!parsed.success||!Object.keys(parsed.data.topics).length)return null;
  for(const [key,model] of Object.entries(parsed.data.topics)){
    if(!Object.hasOwn(VOICE_TOPICS,key))return null;
    const size=model.vectorizer.idf.length,ids=Object.values(model.vectorizer.vocabulary),evaluation=model.evaluation;
    if(ids.length!==size||new Set(ids).size!==size||ids.some(id=>id>=size)
      ||Object.keys(model.vectorizer.vocabulary).some(term=>Array.from(term).length<2||Array.from(term).length>4)
      ||evaluation.macroF1<=evaluation.majorityMacroF1||['support','oppose','neutral'].some(label=>(evaluation.classCounts[label]??0)<10))return null;
    for(const [name,allowed] of [['direction',['support','oppose','neutral']],['speaker',['journalist','source']],
      ['issue',[...Object.keys(VOICE_TOPICS[key as VoiceTopic].issues),'none']]] as const){
      const item=model[name];
      if(new Set(item.classes).size!==item.classes.length||item.classes.some(label=>!(allowed as readonly string[]).includes(label))
        ||(name==='direction'&&allowed.some(label=>!item.classes.includes(label)))
        ||(name==='speaker'&&allowed.some(label=>!item.classes.includes(label)))
        ||item.coefficients.length!==item.classes.length||item.intercepts.length!==item.classes.length
        ||item.coefficients.some(row=>row.length!==size)||!item.coefficients.some(row=>row.some(weight=>weight!==0)))return null;
    }
  }
  return parsed.data;
}
function predict(model:VoiceModel['topics'][string],name:'direction'|'speaker'|'issue',text:string):string|null{
  const chars=Array.from(voiceModelText(text)),counts=new Map<number,number>();
  for(let width=2;width<=4;width++)for(let start=0;start+width<=chars.length;start++){
    const term=chars.slice(start,start+width).join(''),id=model.vectorizer.vocabulary[term];
    if(Object.hasOwn(model.vectorizer.vocabulary,term))counts.set(id,(counts.get(id)??0)+1);
  }
  const features=[...counts].map(([id,count])=>({id,value:(1+Math.log(count))*model.vectorizer.idf[id]}));
  const norm=Math.sqrt(features.reduce((sum,item)=>sum+item.value**2,0));if(!norm)return null;
  const classifier=model[name];
  const scores=classifier.classes.map((label,index)=>({label,value:features.reduce((sum,item)=>sum+item.value/norm*classifier.coefficients[index][item.id],classifier.intercepts[index])})).sort((a,b)=>b.value-a.value);
  return scores.every(item=>Number.isFinite(item.value))&&scores[0].value-scores[1].value>=.15?scores[0].label:null;
}
export function inferVoices(model:VoiceModel,body:string,topic:VoiceTopic):VoiceDocument|null{
  const weights=model.topics[topic];if(!weights)return null;
  const labels=voiceSentences(body).map(unit=>{
    const direction=predict(weights,'direction',unit.text),speaker=predict(weights,'speaker',unit.text),issue=predict(weights,'issue',unit.text);
    return {sentenceId:unit.sentenceId,issue:issue??'unknown',direction:direction??'uncertain',speaker:speaker??'unknown'} as VoiceLabel;
  });
  return validateVoiceDocument(body,{version:VOICE_VERSION,segmenter:SEGMENTER,scopeCharacters:VOICE_SCOPE,topic,method:'svm',modelVersion:model.version,labels});
}
export async function voiceArticleHash(body:string){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeBiasText(articleTextPrefix(body,VOICE_SCOPE))));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
