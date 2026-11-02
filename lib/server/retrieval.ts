import { Reference } from '../contracts';
import { RuntimeConfig } from './config';
import {scrapeFirecrawl} from './firecrawl';
import {ARTICLE_EXTRACTION_VERSION,decodeArticleDocument,extractArticleDocument} from './article-document';

// The initial web adapter deliberately supports exact, operator-approved hosts only.
// Arbitrary user URLs never become network destinations. Redirects are never followed.
export function allowedUrl(input:string,hosts:string[]):URL|null{
  try{const url=new URL(input);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||url.hostname.endsWith('.')||/^(localhost|.*\.localhost)$/i.test(url.hostname))return null;
    if(!hosts.some(h=>h.toLowerCase()===url.hostname.toLowerCase())||/^[\d.:[\]]+$/.test(url.hostname))return null;return url;
  }catch{return null;}
}
export async function retrieve(url:string,id:string,config:RuntimeConfig,signal:AbortSignal):Promise<Reference|null>{
  if(config.NEWS_PROVIDER==='firecrawl')return scrapeFirecrawl(url,id,config,signal);
  const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);const target=allowedUrl(url,hosts);if(!target)return null;
  // Use only trusted public publisher domains configured by the operator.
  const response=await fetch(target,{redirect:'manual',headers:{Accept:'text/html,text/plain'},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
  if(!response.ok||response.status>=300){await response.body?.cancel();return null;}
  const type=response.headers.get('content-type')??'';if(!/^(text\/html|text\/plain)(;|$)/i.test(type)){await response.body?.cancel();return null;}
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();return null;}chunks.push(value);}
  const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  const document=decodeArticleDocument(data,type);if(document===null)return null;
  const extracted=extractArticleDocument(document,/^text\/html(?:;|$)/i.test(type));
  if(!extracted.text)return null;
  return {id,provenance:'web_fetched',url:target.href,text:extracted.text.slice(0,8000),title:extracted.title,publishedAt:extracted.publishedAt,fetchedAt:new Date().toISOString(),truncated:extracted.text.length>8000,fullTextLength:extracted.text.length,extractionVersion:ARTICLE_EXTRACTION_VERSION};
}
