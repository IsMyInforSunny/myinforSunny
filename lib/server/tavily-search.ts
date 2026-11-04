import type {NewsResult,RelatedArticle} from '../news-contract';
import type {RuntimeConfig} from './config';
import {AppError} from './errors';
import {reserveTavilyCredit,searchProviderReady} from './search-settings';

function articleUrl(value:unknown){try{if(typeof value!=='string'||value.length>2048)return null;const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!u.hostname.includes('.')||u.hostname.endsWith('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.localhost')||/^[\d.:[\]]+$/.test(u.hostname))return null;u.hash='';return u;}catch{return null;}}
export function tavilyArticles(value:unknown):RelatedArticle[]{
 if(!Array.isArray(value))throw new AppError(502,'SEARCH_INVALID_RESPONSE','기사 검색 목록을 확인하지 못했습니다.');
 const articles:RelatedArticle[]=[],seen=new Set<string>(),domains=new Map<string,number>();
 for(const row of value.slice(0,20)){
  if(!row||typeof row!=='object')continue;const a=row as Record<string,unknown>,u=articleUrl(a.url);
  if(!u||typeof a.title!=='string'||!a.title.trim())continue;
  for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
  const domain=u.hostname.replace(/^www\./,'');if(seen.has(u.href)||(domains.get(domain)??0)>=2)continue;
  seen.add(u.href);domains.set(domain,(domains.get(domain)??0)+1);
  articles.push({id:`news_${articles.length}`,title:a.title.trim().slice(0,250),url:u.href,publisherDomain:domain,language:'Korean',provenance:'search_result',stance:'not_checked'});
  if(articles.length>=5)break;
 }
 return articles;
}
/** Basic search only: no paid research/extraction endpoint, automatic parameters, or fallback. */
export async function searchTavily(query:string,c:RuntimeConfig,signal:AbortSignal):Promise<NewsResult>{
 if(c.ENABLE_NEWS_SEARCH!=='true'||c.NEWS_TERMS_APPROVED!=='true'||c.NEWS_PROVIDER!=='tavily'||!searchProviderReady(c))throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 계정·무료 한도·이용 조건 확인이 필요합니다.');
 signal.throwIfAborted();
 const reservation=await reserveTavilyCredit(c);
 let response:Response;
 try{response=await fetch('https://api.tavily.com/search',{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${c.TAVILY_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({query,topic:'news',search_depth:'basic',auto_parameters:false,max_results:5,include_answer:false,include_raw_content:false,include_images:false,include_usage:true,language:'ko',filter_by_language:true,include_domains:(c.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean)}),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});}catch{throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색에 연결하지 못했습니다. 결과를 만들어 대신 표시하지 않습니다.',true);}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new AppError(502,'SEARCH_UNEXPECTED_REDIRECT','기사 검색 서비스가 다른 주소로 이동을 요청했습니다. 운영 설정을 확인해 주세요.');}
 if(!response.ok){await response.body?.cancel();if(response.status===429)throw new AppError(429,'SEARCH_RATE_LIMITED','기사 검색 요청이 많습니다. 잠시 후 다시 시작해 주세요.',true);if(response.status===432||response.status===433)throw new AppError(429,'SEARCH_QUOTA_EXHAUSTED','기사 검색 무료 한도를 다 썼어요. 본문 분석과 예시 체험을 이용해 주세요.');throw new AppError(503,'SEARCH_UNAVAILABLE','기사 검색 계정 또는 서비스 응답을 확인해야 합니다.');}
 const reader=response.body?.getReader();if(!reader)throw new AppError(502,'SEARCH_INVALID_RESPONSE','검색 응답이 없습니다.');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','검색 응답의 크기를 확인하지 못했습니다.');}chunks.push(value);}
 const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}
 let result:Record<string,unknown>;try{result=JSON.parse(new TextDecoder().decode(data));}catch{throw new AppError(502,'SEARCH_INVALID_RESPONSE','검색 응답 형식이 올바르지 않습니다.');}
 if(!result||typeof result!=='object')throw new AppError(502,'SEARCH_INVALID_RESPONSE','검색 응답 형식이 올바르지 않습니다.');
 const usage=result.usage&&typeof result.usage==='object'?result.usage as Record<string,unknown>:null;
 if(typeof usage?.credits==='number'&&Number.isSafeInteger(usage.credits)&&usage.credits>1)await c.DB!.prepare('UPDATE search_monthly_budget SET reserved=reserved+? WHERE id=?').bind(usage.credits-1,reservation).run();
 const articles=tavilyArticles(result.results);
 return {provider:'tavily',query,status:articles.length?'success':'empty',articles,searchedAt:new Date().toISOString(),scopeNote:'한국어 뉴스 검색으로 찾은 후보입니다. 검색 결과만으로 사실이나 반대 입장을 확인한 것은 아닙니다. 본문 취득과 실제 인용·주장 대조를 통과한 자료만 분석 근거로 사용합니다.'};
}
