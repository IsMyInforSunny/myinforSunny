import {DOMParser} from 'linkedom/worker';
import type {NewsResult,RelatedArticle} from '../news-contract';
import type {RuntimeConfig} from './config';
import {AppError} from './errors';
import {articleTextPrefix} from './article-document';

/** Exact public publisher endpoints; neither a query nor a user URL can change
 * the network destination. MBC's former news_00.xml redirected to an error page
 * during setup and is intentionally not included in the runtime request list. */
export const PUBLISHER_FEEDS=[
 {id:'sbs',name:'SBS',url:'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01',articleHosts:['news.sbs.co.kr']},
 {id:'donga',name:'동아일보',url:'https://rss.donga.com/total.xml',articleHosts:['www.donga.com','donga.com']},
] as const;
export type PublisherFeedId=typeof PUBLISHER_FEEDS[number]['id'];
export const MAX_FEED_BYTES=512*1024;
const MAX_FEED_ITEMS=100,MAX_RESULTS=5,MAX_PER_PUBLISHER=2;
const XML_TYPES=new Set(['application/rss+xml','application/xml','text/xml']);

export function publisherFeedsReady(config:RuntimeConfig){
 return config.NEWS_PROVIDER==='publisher_feeds'&&config.ENABLE_NEWS_SEARCH==='true'
  &&config.NEWS_TERMS_APPROVED==='true'&&!!config.DB;
}

function articleUrl(value:string,hosts:readonly string[]){
 try{
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))return null;
  url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
  return url;
 }catch{return null;}
}

/** Metadata only: descriptions/full article text and scripts never become
 * search evidence. Published RSS dates are not relabeled as index timestamps. */
export function parsePublisherFeed(xml:string,sourceId:PublisherFeedId):RelatedArticle[]{
 const source=PUBLISHER_FEEDS.find(feed=>feed.id===sourceId);
 if(!source||xml.length>MAX_FEED_BYTES||/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록의 형식을 확인하지 못했습니다.');
 const withoutComments=xml.replace(/<!--[\s\S]*?-->/g,'').trim();
 if(!/<\/rss\s*>\s*$/i.test(withoutComments))throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록을 완전히 받지 못했습니다.');
 const document=new DOMParser().parseFromString(xml,'text/xml') as unknown as Document;
 if(document.documentElement?.nodeName.toLowerCase()!=='rss'||document.querySelector('parsererror')||document.querySelectorAll('*').length>15000)throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록의 형식을 확인하지 못했습니다.');
 for(const node of Array.from(document.querySelectorAll('script,style')))node.remove();
 const seen=new Set<string>(),articles:RelatedArticle[]=[];
 for(const item of Array.from(document.querySelectorAll('channel > item')).slice(0,MAX_FEED_ITEMS)){
  const title=item.querySelector('title')?.textContent?.trim(),link=item.querySelector('link')?.textContent?.trim();
  if(!title||!link)continue;
  const url=articleUrl(link,source.articleHosts);if(!url||seen.has(url.href))continue;
  seen.add(url.href);
  articles.push({id:`feed_${source.id}_${articles.length}`,title:articleTextPrefix(title,250),url:url.href,publisherDomain:url.hostname.replace(/^www\./,''),language:'Korean',provenance:'search_result',stance:'not_checked'});
 }
 return articles;
}

async function readFeed(source:typeof PUBLISHER_FEEDS[number],signal:AbortSignal){
 signal.throwIfAborted();
 const response=await fetch(source.url,{redirect:'manual',headers:{Accept:'application/rss+xml,application/xml,text/xml'},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
 if(!response.ok||response.status>=300){await response.body?.cancel();throw new AppError(503,'SEARCH_UNAVAILABLE','공식 기사 목록에 연결하지 못했습니다.');}
 const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
 if(!XML_TYPES.has(type)){await response.body?.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록의 응답 형식을 확인하지 못했습니다.');}
 const reader=response.body?.getReader();if(!reader)throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록 응답이 없습니다.');
 const chunks:Uint8Array[]=[];let bytes=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_FEED_BYTES){await reader.cancel();throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록의 크기 제한을 초과했습니다.');}chunks.push(value);}
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 let xml:string;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw new AppError(502,'SEARCH_INVALID_RESPONSE','공식 기사 목록의 문자 인코딩을 확인하지 못했습니다.');}
 return parsePublisherFeed(xml,source.id);
}

const STOP_WORDS=new Set(['기사','뉴스','관련','보도','자료','확인','최근','이번','대한','대해','위한','그리고']);
function queryTerms(query:string){
 return [...new Set((query.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+(?:\.\d+)?/gu)??[])
  .filter(term=>(term.length>=2||/^\d+$/.test(term))&&!STOP_WORDS.has(term)))];
}
function relevance(title:string,terms:string[]){
 const normalized=title.normalize('NFC').toLowerCase();
 const numbers=new Set(normalized.match(/\d+(?:\.\d+)?/g)??[]);
 return terms.reduce((count,term)=>count+Number(/^\d+(?:\.\d+)?$/.test(term)?numbers.has(term):normalized.includes(term)),0);
}

/** Two bounded feed GETs, no accounts, model calls, automatic retries or provider
 * fallbacks. This searches recent feed titles, never the whole web or archives. */
export async function searchPublisherFeeds(query:string,config:RuntimeConfig,signal:AbortSignal):Promise<NewsResult>{
 if(!publisherFeedsReady(config))throw new AppError(503,'SEARCH_UNAVAILABLE','공식 기사 목록 검색의 운영 설정을 확인해야 합니다.');
 const normalized=query.normalize('NFC'),terms=queryTerms(normalized);
 if(!terms.length)throw new AppError(422,'VALIDATION_ERROR','기사 제목에서 찾을 구체적인 주제·이름·수치를 입력해 주세요.');
 signal.throwIfAborted();
 const feeds=await Promise.allSettled(PUBLISHER_FEEDS.map(source=>readFeed(source,signal)));
 if(signal.aborted)throw new AppError(408,'REQUEST_ABORTED','기사 목록 검색을 취소했습니다.');
 const successful=feeds.flatMap((result,index)=>result.status==='fulfilled'?[PUBLISHER_FEEDS[index].name]:[]);
 const unavailable=feeds.flatMap((result,index)=>result.status==='rejected'?[PUBLISHER_FEEDS[index].name]:[]);
 if(!successful.length)throw new AppError(503,'SEARCH_UNAVAILABLE','공식 기사 목록에 연결하지 못했습니다. 관련 없는 기사를 대신 표시하지 않습니다.',true);
 const required=terms.length===1?1:Math.max(2,Math.ceil(terms.length/2));
 const ranked=feeds.flatMap((result,sourceIndex)=>result.status==='fulfilled'?result.value.map((article,index)=>({article,sourceIndex,index,score:relevance(article.title,terms)})):[])
  .filter(candidate=>candidate.score>=required).sort((a,b)=>b.score-a.score||a.index-b.index||a.sourceIndex-b.sourceIndex);
 const counts=new Map<number,number>(),seen=new Set<string>(),articles:RelatedArticle[]=[];
 for(const candidate of ranked){
  if(articles.length>=MAX_RESULTS)break;
  const count=counts.get(candidate.sourceIndex)??0;
  if(count>=MAX_PER_PUBLISHER||seen.has(candidate.article.url))continue;
  counts.set(candidate.sourceIndex,count+1);seen.add(candidate.article.url);articles.push(candidate.article);
 }
 return {provider:'publisher_feeds',query:normalized,status:articles.length?'success':'empty',articles,searchedAt:new Date().toISOString(),scopeNote:`${successful.join('·')} 공식 RSS의 최근 기사 제목에서 입력 핵심어와 관련된 후보만 찾았습니다. 전체 웹·과거 기사 검색이 아니며 검색 결과만으로 본문·사실·입장을 확인한 것은 아닙니다.${unavailable.length?` 연결하지 못한 피드: ${unavailable.join('·')}. 해당 매체의 기사는 이번 결과에 포함되지 않았습니다.`:''}${!articles.length?' 조건에 맞는 제목을 찾지 못했으며 관련 없는 기사는 채우지 않았습니다.':''}`};
}
