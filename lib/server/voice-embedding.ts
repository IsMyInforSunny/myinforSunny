import artifact from '../data/voice-embedding-model.json';
import {parseEmbeddingVoiceModel} from '../voice-embedding-model';
import {denseVoiceInputText,inferDenseVoiceHeads} from '../voice-dense';
import {isVoiceBoilerplate,voiceSentences,validateVoiceDocument,VOICE_VERSION,VOICE_SCOPE,type VoiceTopic,type VoiceLabel} from '../sentence-voice';
import {SEGMENTER} from '../segmentation';
import {provider,type RuntimeConfig} from './config';
import {AppError,providerFailure} from './errors';
import {retrySeconds} from './providers/groq';

export const releasedEmbeddingVoiceModel=parseEmbeddingVoiceModel(artifact);
type Model=NonNullable<typeof releasedEmbeddingVoiceModel>;
const ENDPOINT='https://integrate.api.nvidia.com/v1/embeddings';
const TTL=10*60_000,MAX_CACHE=512;
const vectors=new Map<string,{expiresAt:number;value:number[]}>();
const pending=new Map<string,Promise<void>>();
const hash=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');

/** Runs inside the existing NVIDIA request lease/budget. No new provider,
 * automatic retry, truncation, API-key copy or model fallback. */
async function embedBatch(records:{key:string;text:string}[],model:Model,config:RuntimeConfig,signal:AbortSignal){
  const body=JSON.stringify({model:model.encoder.model,input:records.map(record=>record.text),input_type:'passage',
    encoding_format:'float',truncate:'NONE',dimensions:2048});
  if(records.length>32||new TextEncoder().encode(body).length>6000)throw new AppError(422,'INPUT_TOO_LARGE','편향 분석의 한 요청 범위를 초과했습니다.');
  config.onDispatch?.();
  let response:Response;
  try{response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.NVIDIA_API_KEY}`},
    body,redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(60_000)])});}
  catch{signal.throwIfAborted();throw new AppError(503,'PROVIDER_UNAVAILABLE','편향 분석 서비스에 연결하지 못했습니다.',true);}
  // workerd does not implement redirect:'error'. Refuse redirects explicitly;
  // never forward the provider credential to a response-supplied destination.
  if(response.type==='opaqueredirect'||response.status>=300&&response.status<400){
    await response.body?.cancel().catch(()=>{});
    throw new AppError(502,'PROVIDER_UNAVAILABLE','편향 분석 서비스의 연결 주소를 확인해 주세요.');
  }
  if(!response.ok){
    if(response.status===429)await config.onRateLimit?.(retrySeconds(response.headers));
    await response.body?.cancel().catch(()=>{});throw providerFailure(response.status);
  }
  const data=await response.json().catch(()=>null) as {model?:unknown;data?:{index:number;embedding:number[]}[];usage?:{total_tokens?:number;prompt_tokens?:number}}|null;
  // Charge reported usage even when an otherwise successful response is invalid.
  const usage=data?.usage?.total_tokens??data?.usage?.prompt_tokens;
  if(typeof usage==='number'&&Number.isFinite(usage)&&usage>=0)config.onUsage?.(usage);
  const seen=new Set<number>();
  if(data?.model!==model.encoder.model||!Array.isArray(data.data)||data.data.length!==records.length||data.data.some(row=>{
    if(!row||typeof row!=='object'||!Number.isInteger(row.index)||row.index<0||row.index>=records.length||seen.has(row.index))return true;
    seen.add(row.index);
    return !Array.isArray(row.embedding)||row.embedding.length!==2048||row.embedding.some(value=>!Number.isFinite(value))
      ||!Number.isFinite(Math.hypot(...row.embedding))||Math.hypot(...row.embedding)===0;
  }))throw new AppError(502,'INVALID_MODEL_OUTPUT','편향 분석의 입력 벡터를 확인하지 못했습니다.');
  signal.throwIfAborted();
  for(const row of data.data){const norm=Math.hypot(...row.embedding);
    vectors.set(records[row.index].key,{expiresAt:Date.now()+TTL,value:row.embedding.map(value=>value/norm)});}
  while(vectors.size>MAX_CACHE)vectors.delete(vectors.keys().next().value!);
}

/** Public URL bodies use short-lived memory reuse; pasted text must pass a
 * request-specific scope, so private inputs cannot share a cross-user cache. */
export async function inferEmbeddingVoices(body:string,topic:VoiceTopic,config:RuntimeConfig,signal:AbortSignal,cacheScope:string,model:Model|null=releasedEmbeddingVoiceModel){
  signal.throwIfAborted();
  if(!model||!model.topics[topic])return null;
  if(provider(config)!=='nvidia'||!config.NVIDIA_API_KEY||!config.onDispatch||!cacheScope)
    throw new AppError(503,'FEATURE_UNAVAILABLE','편향 모델의 서버 연결을 확인해 주세요.');
  const units=voiceSentences(body),records=new Map<string,{key:string;text:string}>(),keys=new Map<string,string>(),resolved=new Map<string,number[]>();
  const now=Date.now();for(const [key,entry] of vectors)if(entry.expiresAt<=now)vectors.delete(key);
  for(const unit of units){
    if(isVoiceBoilerplate(unit.text))continue;
    const text=denseVoiceInputText(unit.text);if(!text)continue;
    const key=await hash(JSON.stringify([model.version,model.decisionPolicy??'voice-joint-1.0',model.encoder,cacheScope,text]));keys.set(unit.sentenceId,key);
    const cached=vectors.get(key);if(cached)resolved.set(key,cached.value);else records.set(key,{key,text});
  }
  let batch:{key:string;text:string}[]=[];
  const requestBodyBytes=(items:typeof batch)=>new TextEncoder().encode(JSON.stringify({model:model.encoder.model,input:items.map(item=>item.text),
    input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:2048})).length;
  const send=async(items:typeof batch)=>{
    const id=await hash(items.map(item=>item.key).join(','));
    const existing=pending.get(id);
    if(existing)await existing;
    else{const work=embedBatch(items,model,config,signal);pending.set(id,work);
      try{await work;}finally{if(pending.get(id)===work)pending.delete(id);}}
    for(const item of items){const cached=vectors.get(item.key);if(cached)resolved.set(item.key,cached.value);}
  };
  for(const record of records.values()){
    if(batch.length&&(batch.length>=32||requestBodyBytes([...batch,record])>6000)){await send(batch);batch=[];}
    batch.push(record);
  }
  if(batch.length)await send(batch);
  signal.throwIfAborted();
  const labels=units.map<VoiceLabel>(unit=>{
    if(isVoiceBoilerplate(unit.text))return {sentenceId:unit.sentenceId,issue:'none',direction:'neutral' as const,speaker:'unknown' as const,excluded:true as const};
    const value=resolved.get(keys.get(unit.sentenceId)??'');
    const result=value?inferDenseVoiceHeads(model.topics[topic].heads,value):null;
    return {sentenceId:unit.sentenceId,issue:result?.issue??'unknown',direction:result?.direction??'uncertain',speaker:result?.speaker??'unknown'};
  });
  return validateVoiceDocument(body,{version:VOICE_VERSION,segmenter:SEGMENTER,scopeCharacters:VOICE_SCOPE,topic,method:'svm',modelVersion:model.version,labels,decisionPolicy:model.decisionPolicy});
}
