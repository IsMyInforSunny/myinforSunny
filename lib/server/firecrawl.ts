import type {Reference} from '../contracts';
import type {NewsResult,RelatedArticle} from '../news-contract';
import type {RuntimeConfig} from './config';
import {AppError} from './errors';
import {articleTextPrefix,publicationDate} from './article-document';

const API='https://api.firecrawl.dev/v2/';
const positive=(s:string|undefined)=>!!s&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>0?Number(s):0;
export function approvedSourceUrl(input:unknown,config:RuntimeConfig):URL|null{
 if(typeof input!=='string'||input.length>2048)return null;
 try{const u=new URL(input),h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||h.endsWith('.')||!h.includes('.')||h.endsWith('.local')||h.endsWith('.localhost')||/^[\d.:[\]]+$/.test(h))return null;
  const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(!hosts.includes(h))return null;u.hash='';return u;
 }catch{return null;}
}
export function firecrawlBudget(c:RuntimeConfig){
 const allowance=positive(c.FIRECRAWL_CONSOLE_CREDITS),search=positive(c.FIRECRAWL_SEARCH_CREDIT_COST),scrape=positive(c.FIRECRAWL_SCRAPE_CREDIT_COST);
 const configured=positive(c.FIRECRAWL_CREDIT_BUDGET);
 return {limit:Math.min(configured,Math.floor(allowance*.8),800),search,scrape,verified:c.FIRECRAWL_CONSOLE_LIMITS_CONFIRMED==='true'&&allowance>0&&search>=2&&scrape>=1&&configured>0};
}
export function firecrawlReady(c:RuntimeConfig){
 return c.ENABLE_NEWS_SEARCH==='true'&&c.NEWS_TERMS_APPROVED==='true'&&c.FIRECRAWL_TERMS_APPROVED==='true'&&c.FIRECRAWL_FREE_PLAN_CONFIRMED==='true'&&c.FIRECRAWL_SOURCE_TERMS_APPROVED==='true'&&!!c.FIRECRAWL_API_KEY&&!!c.DB&&firecrawlBudget(c).verified&&!!(c.ALLOWED_RETRIEVAL_HOSTS??'').split(',').some(h=>approvedSourceUrl(`https://${h.trim()}/`,c));
}
/** Reserve before dispatch, atomically across Workers. Failed/unknown requests keep their reservation. */
export async function reserveFirecrawlCredits(c:RuntimeConfig,operation:'search'|'scrape',now=Date.now()){
 if(!firecrawlReady(c))throw new AppError(503,'SEARCH_UNAVAILABLE','Firecrawl 검색·본문 수집은 설정 확인 후 사용할 수 있습니다.');
 const budget=firecrawlBudget(c),cost=budget[operation],month=new Date(now).toISOString().slice(0,7),id=crypto.randomUUID();
 // The lifetime sum cap also protects a one-time free credit grant; it never resets automatically.
 const result=await c.DB!.prepare(`INSERT INTO firecrawl_credit_budget (id,month,operation,credits,created_at) SELECT ?,?,?,?,? WHERE (SELECT COALESCE(SUM(credits),0) FROM firecrawl_credit_budget)+?<=?`).bind(id,month,operation,cost,now,cost,budget.limit).run();
 if(!result.meta.changes)throw new AppError(429,'SEARCH_CREDIT_LIMIT','무료 기사 조사 크레딧의 안전 한도에 도달했습니다. 예시를 이용해 주세요.');
 return {id,cost};
}
async function readBounded(response:Response,limit=512000){
 const reader=response.body?.getReader();if(!reader)throw new AppError(502,'SEARCH_INVALID_RESPONSE','수집 서비스 응답을 확인하지 못했습니다.');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','수집 서비스 응답이 너무 큽니다.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,unknown>;}catch{throw new AppError(502,'SEARCH_INVALID_RESPONSE','수집 서비스 응답 형식이 올바르지 않습니다.');}
}
async function call(operation:'search'|'scrape',body:object,c:RuntimeConfig,signal:AbortSignal){
 const reserved=await reserveFirecrawlCredits(c,operation);
 let response:Response;
 try{response=await fetch(API+operation,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${c.FIRECRAWL_API_KEY}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(16000)])});}
 catch{throw new AppError(503,'SEARCH_UNAVAILABLE','외부 자료 수집에 연결하지 못했습니다. 다른 유료 서비스로 전환하지 않습니다.',true);}
 if(!response.ok){await response.body?.cancel();throw new AppError(response.status===429?429:503,response.status===429?'SEARCH_RATE_LIMITED':'SEARCH_UNAVAILABLE','외부 자료 수집이 중단되었습니다. 서비스 한도·설정을 확인해 주세요.',response.status===429);}
 const value=await readBounded(response);
 // Never reduce the conservative reservation, including on partial/failed results.
 const data=value.data&&typeof value.data==='object'?value.data as Record<string,unknown>:null;
 const metadata=data?.metadata&&typeof data.metadata==='object'?data.metadata as Record<string,unknown>:null;
 const actual=Math.max(reserved.cost,...[value.creditsUsed,data?.creditsUsed,metadata?.creditsUsed].filter((n):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0));
 if(actual>reserved.cost)await c.DB!.prepare('UPDATE firecrawl_credit_budget SET credits=? WHERE id=?').bind(actual,reserved.id).run();
 if(value.success!==true||!value.data||typeof value.data!=='object')throw new AppError(502,'SEARCH_INVALID_RESPONSE','외부 자료를 확보하지 못했습니다.');
 return value.data as Record<string,unknown>;
}
export async function searchFirecrawl(query:string,c:RuntimeConfig,signal:AbortSignal):Promise<NewsResult>{
 // No scrapeOptions, summaries, paid proxies, agents or model-generated answers.
 const includeDomains=[...new Set((c.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(h=>h.trim().toLowerCase()).filter(h=>approvedSourceUrl(`https://${h}/`,c)))];
 const data=await call('search',{query,includeDomains,sources:[{type:'web'},{type:'news'}],limit:5,country:'KR',timeout:12000},c,signal);
 const rows=[...(Array.isArray(data.web)?data.web:[]),...(Array.isArray(data.news)?data.news:[])];
 const seen=new Set<string>(),domains=new Map<string,number>(),articles:RelatedArticle[]=[];
 for(const item of rows.slice(0,20)){
  if(!item||typeof item!=='object')continue;const row=item as Record<string,unknown>,u=approvedSourceUrl(row.url,c);
  if(!u||typeof row.title!=='string'||!row.title.trim())continue;
  for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
  const domain=u.hostname.replace(/^www\./,'');if(seen.has(u.href)||(domains.get(domain)??0)>=2)continue;
  seen.add(u.href);domains.set(domain,(domains.get(domain)??0)+1);
  articles.push({id:`news_${articles.length}`,title:articleTextPrefix(row.title.trim(),250),url:u.href,publisherDomain:domain,language:'not_verified',provenance:'search_result',stance:'not_checked'});
  if(articles.length===5)break;
 }
 return {provider:'firecrawl',query,status:articles.length?'success':'empty',articles,searchedAt:new Date().toISOString(),scopeNote:'검색 결과 중 운영자가 이용 조건을 확인한 출처 후보만 표시합니다. 검색 결과는 본문 확인이나 신뢰성 검증 결과가 아닙니다.'};
}
export async function scrapeFirecrawl(url:string,id:string,c:RuntimeConfig,signal:AbortSignal):Promise<Reference|null>{
 if(!firecrawlReady(c))throw new AppError(503,'SEARCH_UNAVAILABLE','Firecrawl 수집 설정을 확인해 주세요.');
 const target=approvedSourceUrl(url,c);if(!target)return null;
 const data=await call('scrape',{url:target.href,formats:['markdown'],onlyMainContent:true,parsers:[],proxy:'basic',timeout:12000,maxAge:3600000,storeInCache:false},c,signal);
 const metadata=data.metadata;if(!metadata||typeof metadata!=='object')return null;const m=metadata as Record<string,unknown>;
 // Reject missing/changed final destination, including cross-domain redirects.
 const urls=[m.sourceURL,m.url].filter(v=>v!==undefined);if(typeof m.url!=='string'||urls.some(value=>approvedSourceUrl(value,c)?.href!==target.href))return null;
 if(m.statusCode!==undefined&&m.statusCode!==200||m.error)return null;
 const markdown=typeof data.markdown==='string'?data.markdown.trim():'';
 if(markdown.length<80||markdown.length>200000||/(paywall|robots.?txt|access denied|sign in to continue|구독 후|유료 회원|AI\s*(?:학습|활용|이용)(?:\s*(?:및|과|·|,|\/)?\s*(?:학습|활용|이용)){0,2}\s*금지|(?:no|prohibit(?:ed)?)\s+AI\s+(?:training|use))/i.test(`${String(data.warning??'')} ${markdown}`))return null;
 const title=typeof m.title==='string'?articleTextPrefix(m.title,250):undefined;
 const rawDate=m.publishedTime??m.publishedAt??m['article:published_time'];
 const dates=[...new Set((Array.isArray(rawDate)?rawDate:[rawDate]).filter((v):v is string=>typeof v==='string').map(publicationDate).filter((v):v is string=>v!==undefined))];
 const publishedAt=dates.length===1?dates[0]:undefined;
 const text=articleTextPrefix(markdown,8000);
 return {id,provenance:'web_fetched',url:target.href,text,title,publishedAt,fetchedAt:new Date().toISOString(),truncated:text.length<markdown.length,fullTextLength:markdown.length,extractionVersion:'firecrawl-markdown-1.1'};
}
