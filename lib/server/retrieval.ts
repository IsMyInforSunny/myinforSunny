import type {Reference} from '../contracts';
import type {RuntimeConfig} from './config';
import {decodeArticle,extractArticle} from './article-extraction';
export type RetrievedArticle=Reference&{fullTextLength:number;extractionVersion:string};
// Exact operator-approved public hosts only. User URLs cannot broaden this list.
export function allowedUrl(input:string,hosts:string[]):URL|null{
 try{const u=new URL(input);const host=u.hostname.toLowerCase();if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||host.endsWith('.')||/^(localhost|.*\.localhost)$/i.test(host)||!host.includes('.')||host.endsWith('.local'))return null;
  if(!hosts.some(h=>h.toLowerCase()===host)||/^[\d.:[\]]+$/.test(host))return null;return u;
 }catch{return null;}
}
export async function retrieve(url:string,id:string,config:RuntimeConfig,signal:AbortSignal):Promise<RetrievedArticle|null>{
 const target=allowedUrl(url,(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean));if(!target)return null;
 const response=await fetch(target,{redirect:'manual',headers:{Accept:'text/html,text/plain'},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
 if(!response.ok||response.status>=300||/\b(noai|nosnippet)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return null;}
 const type=(response.headers.get('content-type')??'').toLowerCase();if(!/^(text\/html|text\/plain)(;|$)/.test(type)){await response.body?.cancel();return null;}
 const reader=response.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let bytes=0;
 while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();return null;}chunks.push(value);}
 const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
 const decoded=decodeArticle(data,type);if(!decoded)return null;
 const article=type.startsWith('text/html')?extractArticle(decoded,target.href):{text:decoded.trim(),title:'',extractionVersion:'plain-text-1.0',publishedAt:undefined};
 if(!article?.text.trim())return null;
 let end=Math.min(article.text.length,8000);if(end<article.text.length&&/[\uD800-\uDBFF]/.test(article.text[end-1]))end--;
 return {id,provenance:'web_fetched',url:target.href,text:article.text.slice(0,end),title:article.title||undefined,publishedAt:article.publishedAt,fetchedAt:new Date().toISOString(),truncated:article.text.length>end,fullTextLength:article.text.length,extractionVersion:article.extractionVersion};
}
