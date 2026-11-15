import type {NewsResult} from '../news-contract';
import {capabilities,type RuntimeConfig} from './config';
import {AppError} from './errors';
import {searchNews} from './news';
import {isSearchLockBusy} from './search-budget';

const TTL=10*60_000,MAX_ENTRIES=64;
type Entry={expiresAt:number;result:NewsResult};
type Running={controller:AbortController;promise:Promise<NewsResult>;waiters:number};
const memory=new Map<string,Entry>();
const running=new Map<string,Running>();
export function clearResearchSearchCache(){
  for(const entry of running.values())entry.controller.abort();
  running.clear();memory.clear();
}

async function cacheKey(query:string,config:RuntimeConfig,actor:string){
  if(!capabilities(config).webSearch)throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색의 운영 설정을 확인해 주세요.');
  // Actor isolation keeps queries derived from one person's input out of other users' responses.
  // Credentials participate only in the digest so changing accounts invalidates old results.
  const settings=[config.NEWS_PROVIDER??'gdelt',config.ALLOWED_RETRIEVAL_HOSTS??'',
    config.TAVILY_API_KEY??'',config.TAVILY_MONTHLY_CREDITS??'',config.FIRECRAWL_API_KEY??'',
    config.FIRECRAWL_CONSOLE_CREDITS??'',config.FIRECRAWL_CREDIT_BUDGET??'',
    config.FIRECRAWL_SEARCH_CREDIT_COST??'',config.FIRECRAWL_SCRAPE_CREDIT_COST??''];
  const payload=JSON.stringify(['research-search-1.0-results-5',actor,query.normalize('NFC').trim().replace(/\s+/g,' '),settings]);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function current(key:string){
  const entry=memory.get(key);
  if(entry&&entry.expiresAt>Date.now())return entry;
  if(entry)memory.delete(key);
  return undefined;
}
export async function isResearchSearchCached(query:string,config:RuntimeConfig,actor:string){
  return !!current(await cacheKey(query,config,actor));
}
function join(entry:Running,signal:AbortSignal):Promise<NewsResult>{
  signal.throwIfAborted();entry.waiters++;
  return new Promise((resolve,reject)=>{
    let finished=false;
    const release=()=>{
      if(finished)return false;
      finished=true;signal.removeEventListener('abort',cancel);entry.waiters--;
      if(!entry.waiters)entry.controller.abort();
      return true;
    };
    const cancel=()=>{if(release())reject(signal.reason??new DOMException('취소됨','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});
    entry.promise.then(value=>{if(release())resolve(structuredClone(value));},error=>{if(release())reject(error);});
  });
}

/** Reserve a search only for the single provider dispatch behind a cache miss. */
export async function cachedResearchSearch(query:string,config:RuntimeConfig,signal:AbortSignal,actor:string,beforeDispatch:()=>Promise<void>,releaseUndispatched:()=>Promise<void>,options:{cacheOnly?:boolean}={}):Promise<NewsResult>{
  signal.throwIfAborted();
  const key=await cacheKey(query,config,actor),entry=current(key);
  if(entry)return structuredClone(entry.result);
  const previous=running.get(key);
  if(previous)return join(previous,signal);
  if(options.cacheOnly)throw new AppError(409,'SEARCH_CACHE_MISS','검색 캐시가 만료되어 새 검색 간격을 확인합니다.');
  const work:Running={controller:new AbortController(),promise:undefined as unknown as Promise<NewsResult>,waiters:0};
  work.promise=Promise.resolve().then(async()=>{
    work.controller.signal.throwIfAborted();await beforeDispatch();
    if(work.controller.signal.aborted){await releaseUndispatched();work.controller.signal.throwIfAborted();}
    let result:NewsResult;
    try{result=await searchNews(query,config,work.controller.signal);}
    catch(error){if(isSearchLockBusy(error))await releaseUndispatched();throw error;}
    for(const [storedKey,value]of memory)if(value.expiresAt<=Date.now())memory.delete(storedKey);
    if(memory.size>=MAX_ENTRIES)memory.delete(memory.keys().next().value!);
    memory.set(key,{expiresAt:Date.now()+TTL,result:structuredClone(result)});
    return result;
  }).finally(()=>{if(running.get(key)===work)running.delete(key);});
  // A caller may cancel before it subscribes to the asynchronous provider rejection.
  void work.promise.catch(()=>{});
  running.set(key,work);
  return join(work,signal);
}
