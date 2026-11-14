import { Reference } from '../contracts';
import { RuntimeConfig } from './config';
import {scrapeFirecrawl} from './firecrawl';
import {ARTICLE_EXTRACTION_VERSION,articleTextPrefix,decodeArticleDocument,extractArticleDocument} from './article-document';
import {extractArticle} from './article-extraction';

// The initial web adapter deliberately supports exact, operator-approved hosts only.
// Arbitrary user URLs never become network destinations. At most two redirects
// are followed within the original HTTPS origin and exact operator allowlist.
// HTTPS only: plain HTTP is rejected and never silently upgraded to HTTPS.
export function allowedUrl(input:string,hosts:string[]):URL|null{
  try{const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.endsWith('.')||/^(localhost|.*\.localhost)$/i.test(url.hostname))return null;
    if(!hosts.some(h=>h.toLowerCase()===url.hostname.toLowerCase())||/^[\d.:[\]]+$/.test(url.hostname))return null;return url;
  }catch{return null;}
}
export async function retrieve(url:string,id:string,config:RuntimeConfig,signal:AbortSignal):Promise<Reference|null>{
  if(config.NEWS_PROVIDER==='firecrawl')return scrapeFirecrawl(url,id,config,signal);
  const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);let target=allowedUrl(url,hosts);if(!target)return null;
  // Use only trusted public publisher domains configured by the operator.
  const originalOrigin=target.origin,seen=new Set([target.href]);
  const fetchSignal=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
  let response:Response;
  for(let redirects=0;;redirects++){
    response=await fetch(target,{redirect:'manual',headers:{Accept:'text/html,text/plain','User-Agent':'NaeinfoClear/0.1 (article analysis; user-requested fetch)'},signal:fetchSignal});
    if(/\b(noai|nosnippet)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return null;}
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');await response.body?.cancel();
    if(redirects>=2||!location)return null;
    let next:URL|null;try{next=allowedUrl(new URL(location,target).href,hosts);}catch{return null;}
    if(!next||next.origin!==originalOrigin||seen.has(next.href))return null;
    seen.add(next.href);target=next;
  }
  if(!response.ok||response.status>=300||/\b(noai|nosnippet)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return null;}
  const type=response.headers.get('content-type')??'';if(!/^(text\/html|text\/plain)(;|$)/i.test(type)){await response.body?.cancel();return null;}
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();return null;}chunks.push(value);}
  const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  const document=decodeArticleDocument(data,type);if(document===null)return null;
  const extracted=/^text\/html(?:;|$)/i.test(type)?extractArticle(document,target.href):{...extractArticleDocument(document,false),extractionVersion:ARTICLE_EXTRACTION_VERSION};
  if(!extracted?.text)return null;
  const text=articleTextPrefix(extracted.text,8000);
  return {id,provenance:'web_fetched',url:target.href,text,title:extracted.title,publishedAt:extracted.publishedAt,fetchedAt:new Date().toISOString(),truncated:text.length<extracted.text.length,fullTextLength:extracted.text.length,extractionVersion:extracted.extractionVersion};
}
