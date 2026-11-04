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
 const url=new URL(ENDPOINT);Object.entries({query:`${searchTerm} sourcelang:korean`,mode:'artlist',format:'json',maxrecords:'20',timespan:'30d',sort:'hybridrel'}).forEach(([k,v])=>url.searchParams.set(k,v));
 let response:Response;
 try{response=await fetch(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});}
 catch{throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 서비스에 연결하지 못했습니다. 검색 결과를 만들어 대신 표시하지 않습니다.',true);}
 if(response.status===429){await response.body?.cancel();await config.DB.prepare(`UPDATE provider_backoff SET until_at=MAX(until_at,?) WHERE id='gdelt'`).bind(Date.now()+60000).run();throw new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 서비스의 요청 한도에 도달했습니다. 1분 후 다시 시도해 주세요.',true);}
 if(!response.ok){await response.body?.cancel();throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 서비스가 응답하지 않습니다.',true);}
 const reader=response.body?.getReader();if(!reader)throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답이 없습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답의 크기를 확인하지 못했습니다.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 let parsed:unknown;try{parsed=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 응답 형식을 확인하지 못했습니다.',true);}
 if(!parsed||typeof parsed!=='object'||!('articles' in parsed))throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 목록을 확인하지 못했습니다.');
 const articles=normalizeArticles((parsed as {articles:unknown}).articles);
 return {provider:'gdelt',query:searchTerm,status:articles.length?'success':'empty',articles,searchedAt:new Date().toISOString(),scopeNote:'최근 30일간 GDELT에 수집된 한국어 기사 중 검색어와 관련된 후보입니다. 본문·반대 입장·내용의 정확성을 확인한 결과가 아닙니다. 수집 시각은 발행일과 다를 수 있습니다.'};
}
