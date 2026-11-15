import type {Analysis, analyzeRequestSchema} from '../contracts';
import type {z} from 'zod/v4';
import {assertAnalysis, SEGMENTER} from '../domain';
import {RUBRIC,ANALYSIS_PROMPT_VERSION} from '../contracts';
import {capabilities, modelName, type RuntimeConfig} from './config';
import {actorHash} from './budget';
import {allowedUrl} from './retrieval';
import {releasedVoiceModel,releasedEmbeddingVoiceModel} from './voice-analysis';
import localResearchComparison from './local-research-comparison';
import type {prepareUrlAnalysis} from './analyze-url';
import {AppError} from './errors';

type LiveRequest = Exclude<z.infer<typeof analyzeRequestSchema>, {kind:'demo'}>;
type Entry = {expiresAt: number; analysis: Analysis};
const TTL_MS = 10 * 60_000;
const PUBLIC_TTL_MS=24*60*60_000;
const MAX_ENTRIES = 32;
const memory = new Map<string, Entry>();
type Running={promise:Promise<Analysis>;controller:AbortController;waiters:number};
const inFlight=new Map<string,Running>();
const CACHE_VERSION = 'article-analysis-cache-14-body-revalidated';
type PreparedUrl=Awaited<ReturnType<typeof prepareUrlAnalysis>>;
type UrlRequest=Extract<LiveRequest,{kind:'url'}>;
export type BackgroundScheduler=(task:()=>Promise<void>)=>void;
type PublicEntry={expiresAt:number;analysis:Analysis;articleHash:string;cacheCheckedAt:string;invalid:boolean;invalidReason?:'changed'|'unavailable';generation:string};
const publicMemory=new Map<string,PublicEntry>();
const revalidating=new Set<string>();
function reusable(analysis:Analysis){
  const unavailableOnly=!releasedVoiceModel&&!releasedEmbeddingVoiceModel&&analysis.warnings.length>0
    &&analysis.warnings.every(warning=>warning.code==='VOICE_MODEL_UNAVAILABLE');
  return analysis.mode==='live'&&!!analysis.bodyPosition&&(analysis.status==='success'||analysis.status==='partial'&&unavailableOnly);
}

/** Public URL pointer: return saved analysis before I/O to the publisher, then
 * revalidate with the framework's post-response scheduler (Workers waitUntil).
 * Tests must explicitly supply a scheduler; background promises are never dropped. */
export async function cachedPublicUrlAnalysis(request:Request,input:UrlRequest,config:RuntimeConfig,requestId:string,
 prepare:(signal:AbortSignal)=>Promise<PreparedUrl>,
 action:(prepared:PreparedUrl,signal?:AbortSignal)=>Promise<Analysis>,schedule:BackgroundScheduler){
 const cap=capabilities(config),hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(host=>host.trim()).filter(Boolean);
 const url=allowedUrl(input.url,hosts);
 if(!cap.live||!cap.directFetch||!url||input.comments.length||input.proposition){
  const prepared=await prepare(request.signal);
  return cachedAnalysis(request,input,config,requestId,signal=>action(prepared,signal),{articleHash:prepared.articleHash});
 }
 const key=await digest(['public-url-swr-1',CACHE_VERSION,ANALYSIS_PROMPT_VERSION,RUBRIC,SEGMENTER,
  config.AI_PROVIDER??'groq',modelName(config),releasedVoiceModel?.version??null,releasedEmbeddingVoiceModel?.version??null,localResearchComparison?.identity??null,
  config.NEWS_PROVIDER??'gdelt',config.NEWS_TERMS_APPROVED??'',config.FIRECRAWL_SOURCE_TERMS_APPROVED??'',hosts,url.href]);
 const edgeRequest=new Request(`https://article-cache.invalid/public-url/${key}`);
 let edge:Cache|undefined;
 try{if(typeof caches!=='undefined')edge=await caches.open('naeinfo-public-url-analysis-v1');}catch{/* Memory remains usable. */}
 let entry=publicMemory.get(key);
 if(!entry&&edge){try{const response=await edge.match(edgeRequest);if(response){const stored=await response.json() as PublicEntry;
   if(stored.expiresAt>Date.now()&&typeof stored.articleHash==='string'&&typeof stored.cacheCheckedAt==='string'
    &&typeof stored.invalid==='boolean'&&typeof stored.generation==='string'&&reusable(stored.analysis)
    &&stored.analysis.article?.url===url.href&&stored.analysis.versions.prompt===ANALYSIS_PROMPT_VERSION
    &&stored.analysis.sources.length===1&&stored.analysis.sources[0].kind==='body'&&!stored.analysis.proposition){
    assertAnalysis(stored.analysis);entry=stored;publicMemory.set(key,stored);
   }
  }}catch{/* Malformed/unavailable edge data is a miss. */}}
 if(entry&&entry.expiresAt<=Date.now()){publicMemory.delete(key);entry=undefined;}
 const save=async(value:PublicEntry)=>{
  if(publicMemory.size>=MAX_ENTRIES&&!publicMemory.has(key))publicMemory.delete(publicMemory.keys().next().value!);
  publicMemory.set(key,value);
  if(edge)try{await edge.put(edgeRequest,Response.json(value,{headers:{'Cache-Control':`public, max-age=${Math.max(1,Math.ceil((value.expiresAt-Date.now())/1000))}`}}));}catch{/* Completed results stay usable in memory. */}
 };
 if(entry&&!entry.invalid){
  const snapshot=entry;
  if(!revalidating.has(key)){
   revalidating.add(key);
   try{schedule(async()=>{
    try{
     const checked=await prepare(AbortSignal.timeout(15000));
     const current=publicMemory.get(key);
     // An older check must never invalidate a newer successful analysis.
     if(current?.generation!==snapshot.generation)return;
     const changed=checked.articleHash!==current.articleHash;
     await save({...current,invalid:changed,invalidReason:changed?'changed':undefined,cacheCheckedAt:new Date().toISOString()});
    }catch(error){
     if(error instanceof AppError&&['ARTICLE_BODY_UNAVAILABLE','PRIVACY_INPUT_REJECTED','ARTICLE_URL_NOT_ALLOWED','ARTICLE_IMPORT_UNAVAILABLE'].includes(error.code)){
      const current=publicMemory.get(key);
      if(current?.generation===snapshot.generation)await save({...current,invalid:true,invalidReason:'unavailable'});
     }
     // A failed retrieval is not confirmation that the stored body is current.
     console.info(JSON.stringify({type:'article_cache_revalidation',status:'unavailable'}));
    }finally{revalidating.delete(key);}
   });}catch(error){revalidating.delete(key);throw error;}
  }
  return {analysis:{...delivered(snapshot.analysis,requestId),cacheCheckedAt:snapshot.cacheCheckedAt},cache:'hit' as const};
 }
 const changed=entry?.invalid===true&&entry.invalidReason==='changed';
 const prepared=await prepare(request.signal);
 const result=await cachedAnalysis(request,input,config,requestId,signal=>action(prepared,signal),{articleHash:prepared.articleHash});
 const checkedAt=new Date().toISOString();
 const analysis={...result.analysis,cacheCheckedAt:checkedAt,
  warnings:[...result.analysis.warnings,...(changed?[{code:'ARTICLE_CHANGED',message:'기사 수정됨 · 변경된 원문으로 다시 분석했습니다.'}]:[])]};
 if(reusable(result.analysis))await save({expiresAt:Date.now()+PUBLIC_TTL_MS,articleHash:prepared.articleHash,cacheCheckedAt:checkedAt,
  generation:crypto.randomUUID(),invalid:false,analysis:{...result.analysis,warnings:result.analysis.warnings.filter(w=>!['CACHED_ANALYSIS','SHARED_ANALYSIS','ARTICLE_CHANGED'].includes(w.code))}});
 return {analysis,cache:result.cache};
}
function waitForAnalysis(running:Running,signal:AbortSignal){
  signal.throwIfAborted();running.waiters++;
  return new Promise<Analysis>((resolve,reject)=>{
    let settled=false;
    const finish=(error:unknown,value?:Analysis)=>{
      if(settled)return;settled=true;signal.removeEventListener('abort',aborted);
      running.waiters--;if(!running.waiters&&signal.aborted)running.controller.abort();
      if(error)reject(error);else resolve(value!);
    };
    const aborted=()=>finish(new DOMException('취소됨','AbortError'));
    signal.addEventListener('abort',aborted,{once:true});
    running.promise.then(value=>finish(null,value),error=>finish(error));
  });
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function delivered(analysis: Analysis, requestId: string,coalesced=false): Analysis {
  const analysisId=crypto.randomUUID();
  return {...structuredClone(analysis), analysisId, requestId,
    ...(analysis.issueQuarterComparison?{issueQuarterComparison:{...analysis.issueQuarterComparison,parentAnalysisId:analysisId}}:{}),
    ...(analysis.issueQuarterComparisons?{issueQuarterComparisons:analysis.issueQuarterComparisons.map(item=>({...item,parentAnalysisId:analysisId}))}:{}),
    warnings: [...analysis.warnings, coalesced?{code:'SHARED_ANALYSIS',message:'동시에 요청한 동일 기사 분석을 한 번의 AI 호출로 처리했습니다.'}:{code:'CACHED_ANALYSIS', message:`최근 저장된 분석을 재사용했습니다. 원문 취득·분석 시각은 ${analysis.createdAt}입니다.`}]};
}

/** Text stays in bounded, short-lived worker memory. Shared cache contains only fetched public articles. */
export async function cachedAnalysis(
  request: Request, input: LiveRequest, config: RuntimeConfig, requestId: string,
  action: (signal?:AbortSignal) => Promise<Analysis>,
  options:{articleHash?:string}={},
): Promise<{analysis: Analysis; cache:'hit'|'miss'|'coalesced'}> {
  const cap = capabilities(config);
  if (!cap.live || (input.kind === 'url' && !cap.directFetch)) return {analysis:await action(),cache:'miss'};
  const hosts = (config.ALLOWED_RETRIEVAL_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean);
  const url = input.kind === 'url' ? allowedUrl(input.url, hosts) : null;
  if (input.kind === 'url' && !url) return {analysis:await action(),cache:'miss'};
  const version = [CACHE_VERSION, ANALYSIS_PROMPT_VERSION, RUBRIC, SEGMENTER, config.AI_PROVIDER ?? 'groq', modelName(config),releasedVoiceModel?.version??null,releasedEmbeddingVoiceModel?.version??null,localResearchComparison?.identity??null];
  const payload = {...input, ...(url ? {url:url.href} : {})};
  const publicArticle=input.kind==='url'&&!input.comments.length&&!input.proposition&&!!options.articleHash;
  const ttl=publicArticle?PUBLIC_TTL_MS:TTL_MS;
  const key = await digest([version, hosts, publicArticle?'public':await actorHash(request, config), payload,options.articleHash??null]);
  const now = Date.now();
  for (const [storedKey, entry] of memory) if (entry.expiresAt <= now) memory.delete(storedKey);
  const entry = memory.get(key);
  if (entry) return {analysis:delivered(entry.analysis,requestId),cache:'hit'};

  // An explicit proposition or comments belong only to the caller's short-lived memory entry.
  const shared = input.kind === 'url' && !input.comments.length && !input.proposition && typeof caches !== 'undefined';
  let edge: Cache | undefined;
  let edgeRequest: Request | undefined;
  if (shared) {
    try {
      edge = await caches.open('naeinfo-public-article-analysis');
      const publicKey = await digest([version,hosts,url!.href,options.articleHash??null]);
      edgeRequest = new Request(`https://article-cache.invalid/${publicKey}`);
      const response = await edge.match(edgeRequest);
      if (response) {
        const stored = await response.json() as Entry;
        if (stored.expiresAt > now && reusable(stored.analysis)
          && stored.analysis.article?.url === url!.href && stored.analysis.versions.prompt === ANALYSIS_PROMPT_VERSION
          && stored.analysis.sources.length === 1 && stored.analysis.sources[0].kind === 'body' && !stored.analysis.proposition) {
          assertAnalysis(stored.analysis);
          return {analysis:delivered(stored.analysis,requestId),cache:'hit'};
        }
      }
    } catch { /* Cache availability cannot prevent a fresh analysis. */ }
  }
  const running=inFlight.get(key);
  if(running)return {analysis:delivered(await waitForAnalysis(running,request.signal),requestId,true),cache:'coalesced'};
  const controller=new AbortController();
  const computation=Promise.resolve().then(()=>action(controller.signal)).then(async analysis=>{
  if (reusable(analysis)) {
    const stored = {expiresAt:Date.now()+ttl,analysis:structuredClone(analysis)};
    if (memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value!);
    memory.set(key,stored);
    if (edge && edgeRequest && analysis.sources.length === 1 && !analysis.proposition) {
      try { await edge.put(edgeRequest, Response.json(stored,{headers:{'Cache-Control':`public, max-age=${ttl/1000}`}})); }
      catch { /* A completed analysis remains usable if cache storage fails. */ }
    }
  }
    return analysis;
  }).finally(()=>{if(inFlight.get(key)===entryRunning)inFlight.delete(key);});
  const entryRunning={promise:computation,controller,waiters:0};
  inFlight.set(key,entryRunning);
  return {analysis:await waitForAnalysis(entryRunning,request.signal),cache:'miss'};
}
