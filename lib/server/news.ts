import type {NewsResult,RelatedArticle} from '../news-contract';
import type {RuntimeConfig} from './config';
import {AppError} from './errors';
import {searchFirecrawl} from './firecrawl';
import {searchTavily} from './tavily-search';
import {searchPublisherFeeds} from './publisher-feeds';

// No article URL is fetched here. Only this fixed search endpoint is a network destination.
const ENDPOINT='https://api.gdeltproject.org/api/v2/doc/doc';
export function publicArticleUrl(value:unknown):URL|null{
 if(typeof value!=='string'||value.length>2048)return null;
 try{const u=new URL(value);const host=u.hostname.toLowerCase();
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||host.endsWith('.')||!host.includes('.')||host.endsWith('.localhost')||host.endsWith('.local')||/^[\d.:[\]]+$/.test(host))return null;
  u.hash='';return u;
 }catch{return null;}
}
export function normalizeArticles(value:unknown):RelatedArticle[]{
 if(!Array.isArray(value))throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답을 확인하지 못했습니다.');
 const seen=new Set<string>();const perDomain=new Map<string,number>();const accepted:RelatedArticle[]=[];
 for(const row of value.slice(0,50)){
  if(!row||typeof row!=='object')continue;const a=row as Record<string,unknown>;const url=publicArticleUrl(a.url);
  if(!url||typeof a.title!=='string'||!a.title.trim()||a.language!=='Korean')continue;
  for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
  const canonical=url.href;const domain=url.hostname.replace(/^www\./,'');
  if(seen.has(canonical)||(perDomain.get(domain)??0)>=2)continue;
  seen.add(canonical);perDomain.set(domain,(perDomain.get(domain)??0)+1);
  const date=typeof a.seendate==='string'&&/^\d{8}T\d{6}Z$/.test(a.seendate)?a.seendate:undefined;
  accepted.push({id:`news_${accepted.length}`,title:a.title.trim().slice(0,250),url:canonical,publisherDomain:domain,indexedAt:date,language:'Korean',provenance:'search_result',stance:'not_checked'});
  if(accepted.length===5)break;
 }
 return accepted;
}
export function gdeltRequestUrl(searchTerm:string):URL{
 const url=new URL(ENDPOINT);
 Object.entries({query:`${searchTerm} sourcelang:korean`,mode:'artlist',format:'json',maxrecords:'20',timespan:'30d',sort:'HybridRel'}).forEach(([k,v])=>url.searchParams.set(k,v));
 return url;
}
/** Classifies a non-JSON GDELT body. The provider text is never echoed to the client. */
export function gdeltTextFailure(text:string):AppError{
 const t=text.slice(0,2000).toLowerCase();
 if(/limit requests|rate limit|too many requests/.test(t))return new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 서비스의 요청 한도에 도달했습니다. 1분 후 다시 시도해 주세요.',true);
 if(/too short|too long|too common|keyword|phrase|invalid query|illegal character|must be surrounded/.test(t))return new AppError(422,'SEARCH_QUERY_REJECTED','기사 검색 서비스가 이 검색어를 처리하지 않았습니다. 세 글자 이상의 더 구체적인 핵심어로 바꿔 직접 다시 검색해 주세요.',false);
 return new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답 형식을 확인하지 못했습니다.',true);
}
function fetchFailure(error:unknown,caller:AbortSignal,timeout:AbortSignal):AppError{
 if(caller.aborted)return new AppError(503,'SEARCH_CANCELLED','기사 검색 요청이 취소되었습니다.',false);
 if(timeout.aborted||(error instanceof Error&&error.name==='TimeoutError'))return new AppError(504,'SEARCH_TIMEOUT','기사 검색 서비스가 제한 시간 안에 응답하지 않았습니다. 검색 결과를 만들어 대신 표시하지 않습니다.',true);
 return new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 서비스에 연결하지 못했습니다. 검색 결과를 만들어 대신 표시하지 않습니다.',true);
}
async function rateLimited(db:D1Database):Promise<AppError>{
 await db.prepare(`UPDATE provider_backoff SET until_at=MAX(until_at,?) WHERE id='gdelt'`).bind(Date.now()+60000).run();
 return new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 서비스의 요청 한도에 도달했습니다. 1분 후 다시 시도해 주세요.',true);
}
export async function searchNews(query:string,config:RuntimeConfig,signal:AbortSignal):Promise<NewsResult>{
 const searchTerm=query.normalize('NFC');
 if(config.NEWS_PROVIDER==='firecrawl')return searchFirecrawl(searchTerm,config,signal);
 if(config.NEWS_PROVIDER==='tavily')return searchTavily(searchTerm,config,signal);
 if(config.NEWS_PROVIDER==='publisher_feeds')return searchPublisherFeeds(searchTerm,config,signal);
 if(config.NEWS_PROVIDER&&config.NEWS_PROVIDER!=='gdelt')throw new AppError(503,'SEARCH_UNAVAILABLE','검색 제공자 설정을 확인해 주세요.');
 if(config.ENABLE_NEWS_SEARCH!=='true'||config.NEWS_TERMS_APPROVED!=='true'||!config.DB)throw new AppError(503,'SEARCH_UNAVAILABLE','관련 기사 검색을 준비 중입니다. 잠시 후 다시 확인해 주세요.');
 const now=Date.now();
 // Atomic across Worker instances. No query text, original article, or identity is stored.
 const lock=await config.DB.prepare(`INSERT INTO provider_backoff (id,until_at) VALUES ('gdelt',?) ON CONFLICT(id) DO UPDATE SET until_at=excluded.until_at WHERE provider_backoff.until_at<=?`).bind(now+6000,now).run();
 // Lock contention happens before any network dispatch, so callers may release the
 // site reservation for this code only. External 429/network failures keep it.
 if(!lock.meta.changes)throw new AppError(429,'SEARCH_LOCK_BUSY','다른 기사 검색이 진행 중입니다. 잠시 기다린 후 직접 다시 검색해 주세요.',true);
 const url=gdeltRequestUrl(searchTerm);
 const timeout=AbortSignal.timeout(12000);
 let response:Response;
 // Cloudflare workerd throws a TypeError before dispatch for the "error" redirect
 // mode ('"error" won't be implemented ... use "manual"'). That made every production
 // search a 503 although capabilities were ready. Use manual and refuse 3xx below.
 try{response=await fetch(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.any([signal,timeout])});}
 catch(e){throw fetchFailure(e,signal,timeout);}
 if(response.status===429){await response.body?.cancel();throw await rateLimited(config.DB);}
 if(response.type==='opaqueredirect'||(response.status>=300&&response.status<400)){await response.body?.cancel();throw new AppError(502,'SEARCH_UNEXPECTED_REDIRECT','기사 검색 서비스가 다른 주소로 이동을 요청해 따라가지 않았습니다. 운영 설정을 확인해야 합니다.',false);}
 if(!response.ok){await response.body?.cancel();throw response.status>=500?new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 서비스가 일시적으로 응답하지 않습니다.',true):new AppError(502,'SEARCH_REQUEST_INVALID','기사 검색 요청 형식이 거부되었습니다. 운영 설정을 확인해야 합니다.',false);}
 const reader=response.body?.getReader();if(!reader)throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답이 없습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답의 크기를 확인하지 못했습니다.');}chunks.push(value);}}
 catch(e){if(e instanceof AppError)throw e;throw fetchFailure(e,signal,timeout);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const text=new TextDecoder().decode(bytes).trim();
 // GDELT reports query and throttling problems as HTTP 200 plain text, not JSON.
 if(!text.startsWith('{')){const failure=gdeltTextFailure(text);if(failure.code==='SEARCH_RATE_LIMITED')throw await rateLimited(config.DB);throw failure;}
 let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답 형식을 확인하지 못했습니다.',true);}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 목록을 확인하지 못했습니다.');
 if(!('articles' in parsed)&&Object.keys(parsed).length)throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 목록을 확인하지 못했습니다.');
 // A search with no matches is returned as `{}` without an articles key.
 const articles='articles' in parsed?normalizeArticles((parsed as {articles:unknown}).articles):[];
 return {provider:'gdelt',query:searchTerm,status:articles.length?'success':'empty',articles,searchedAt:new Date().toISOString(),scopeNote:'최근 30일간 GDELT에 수집된 한국어 기사 중 검색어와 관련된 후보입니다. 본문·반대 입장·내용의 정확성을 확인한 결과가 아닙니다. 수집 시각은 발행일과 다를 수 있습니다.'};
}
