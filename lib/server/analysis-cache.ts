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
const MAX_ENTRIES = 32;
const memory = new Map<string, Entry>();
const inFlight=new Map<string,Promise<Analysis>>();
const CACHE_VERSION = 'article-analysis-4.18-cache-13-voice-readiness';

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function delivered(analysis: Analysis, requestId: string,coalesced=false): Analysis {
  return {...structuredClone(analysis), analysisId: crypto.randomUUID(), requestId,
    warnings: [...analysis.warnings, coalesced?{code:'SHARED_ANALYSIS',message:'동시에 요청한 동일 기사 분석을 한 번의 AI 호출로 처리했습니다.'}:{code:'CACHED_ANALYSIS', message:`최근 저장된 분석을 재사용했습니다. 원문 취득·분석 시각은 ${analysis.createdAt}입니다.`}]};
}

/** Text stays in bounded, short-lived worker memory. Shared cache contains only fetched public articles. */
export async function cachedAnalysis(
  request: Request, input: LiveRequest, config: RuntimeConfig, requestId: string,
  action: () => Promise<Analysis>,
): Promise<{analysis: Analysis; cache:'hit'|'miss'|'coalesced'}> {
  const cap = capabilities(config);
  if (!cap.live || (input.kind === 'url' && !cap.directFetch)) return {analysis:await action(),cache:'miss'};
  const hosts = (config.ALLOWED_RETRIEVAL_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean);
  const url = input.kind === 'url' ? allowedUrl(input.url, hosts) : null;
  if (input.kind === 'url' && !url) return {analysis:await action(),cache:'miss'};
  const version = [CACHE_VERSION, ANALYSIS_PROMPT_VERSION, RUBRIC, SEGMENTER, config.AI_PROVIDER ?? 'groq', modelName(config),releasedVoiceModel?.version??null,releasedEmbeddingVoiceModel?.version??null];
  const payload = {...input, ...(url ? {url:url.href} : {})};
  const key = await digest([version, hosts, await actorHash(request, config), payload]);
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
      const publicKey = await digest([version,hosts,url!.href]);
      edgeRequest = new Request(`https://article-cache.invalid/${publicKey}`);
      const response = await edge.match(edgeRequest);
      if (response) {
        const stored = await response.json() as Entry;
        if (stored.expiresAt > now && stored.analysis.mode === 'live' && stored.analysis.status === 'success'
          && stored.analysis.article?.url === url!.href && stored.analysis.versions.prompt === ANALYSIS_PROMPT_VERSION
          && stored.analysis.sources.length === 1 && stored.analysis.sources[0].kind === 'body' && !stored.analysis.proposition) {
          assertAnalysis(stored.analysis);
          return {analysis:delivered(stored.analysis,requestId),cache:'hit'};
        }
      }
    } catch { /* Cache availability cannot prevent a fresh analysis. */ }
  }
  const running=inFlight.get(key);
  if(running)return {analysis:delivered(await running,requestId,true),cache:'coalesced'};
  const computation=Promise.resolve().then(action);
  inFlight.set(key,computation);
  try{
  const analysis = await computation;
  if (analysis.mode === 'live' && analysis.status === 'success' && analysis.bodyPosition) {
    const stored = {expiresAt:Date.now()+TTL_MS,analysis:structuredClone(analysis)};
    if (memory.size >= MAX_ENTRIES) memory.delete(memory.keys().next().value!);
    memory.set(key,stored);
    if (edge && edgeRequest && analysis.sources.length === 1 && !analysis.proposition) {
      try { await edge.put(edgeRequest, Response.json(stored,{headers:{'Cache-Control':`public, max-age=${TTL_MS/1000}`}})); }
      catch { /* A completed analysis remains usable if cache storage fails. */ }
    }
  }
  return {analysis,cache:'miss'};
  }finally{if(inFlight.get(key)===computation)inFlight.delete(key);}
}
