import type {Analysis, analyzeRequestSchema} from '../contracts';
import type {z} from 'zod/v4';
import {assertAnalysis, SEGMENTER} from '../domain';
import {RUBRIC,ANALYSIS_PROMPT_VERSION} from '../contracts';
import {capabilities, modelName, type RuntimeConfig} from './config';
import {actorHash} from './budget';
import {allowedUrl} from './retrieval';
import {releasedVoiceModel,releasedEmbeddingVoiceModel} from './voice-analysis';

type LiveRequest = Exclude<z.infer<typeof analyzeRequestSchema>, {kind:'demo'}>;
type Entry = {expiresAt: number; analysis: Analysis};
const TTL_MS = 10 * 60_000;
const PUBLIC_TTL_MS=24*60*60_000;
const MAX_ENTRIES = 32;
const memory = new Map<string, Entry>();
type Running={promise:Promise<Analysis>;controller:AbortController;waiters:number};
const inFlight=new Map<string,Running>();
const CACHE_VERSION = 'article-analysis-cache-14-body-revalidated';
function reusable(analysis:Analysis){
  const unavailableOnly=!releasedVoiceModel&&!releasedEmbeddingVoiceModel&&analysis.warnings.length>0
    &&analysis.warnings.every(warning=>warning.code==='VOICE_MODEL_UNAVAILABLE');
  return analysis.mode==='live'&&!!analysis.bodyPosition&&(analysis.status==='success'||analysis.status==='partial'&&unavailableOnly);
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
  const version = [CACHE_VERSION, ANALYSIS_PROMPT_VERSION, RUBRIC, SEGMENTER, config.AI_PROVIDER ?? 'groq', modelName(config),releasedVoiceModel?.version??null,releasedEmbeddingVoiceModel?.version??null];
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
