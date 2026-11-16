import { Reference } from '../contracts';
import { RuntimeConfig } from './config';
import {scrapeFirecrawl} from './firecrawl';
import {ARTICLE_EXTRACTION_VERSION,articleTextPrefix,decodeArticleDocument,extractArticleDocument} from './article-document';
import {articleAmpUrl,articleRestriction,extractArticle,extractDaumPortalArticle} from './article-extraction';
import {isFetchDenylistedHost} from './open-retrieval';
import {getDomain} from 'tldts';

// The initial web adapter deliberately supports exact, operator-approved hosts only.
// Arbitrary user URLs never become network destinations. At most two redirects
// are followed within the original HTTPS origin and exact operator allowlist.
// HTTPS only: plain HTTP is rejected and never silently upgraded to HTTPS.
export function allowedUrl(input:string,hosts:string[]):URL|null{
  try{const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.endsWith('.')||/^(localhost|.*\.localhost)$/i.test(url.hostname))return null;
    const host=url.hostname.toLowerCase();if((host!=='v.daum.net'&&!hosts.some(h=>h.toLowerCase()===host))||/^[\d.:[\]]+$/.test(host))return null;return url;
  }catch{return null;}
}
export type RetrievalFailureCode='INVALID_URL'|'BLOCKED_DESTINATION'|'ROBOTS_DISALLOWED'|'ROBOTS_AI_RESTRICTED'|'ACCESS_RESTRICTED'|'NOT_HTML'|'TOO_LARGE'|'TIMEOUT'|'SCRIPT_RENDERED'|'TOO_SHORT'|'HOST_RATE_LIMITED';
export type RetrievalMetadata={mode:'allowlisted'|'open';host:string;robotsCheckedAt?:string;extractionMethod?:string;publisherUrl?:string;publisherHost?:string};
export type RetrievalResult={ok:true;reference:Reference;metadata:RetrievalMetadata}|{ok:false;reason:RetrievalFailureCode};
const failure=(reason:RetrievalFailureCode):RetrievalResult=>({ok:false,reason});
const ROBOTS_AI_BOTS=['ClaudeBot','anthropic-ai','GPTBot','CCBot','Google-Extended','PerplexityBot','Applebot-Extended','Bytespider'];
const robotsCache=new Map<string,{expiresAt:number;status:number;body?:string}>();
function ruleMatches(pattern:string,path:string){if(!pattern)return false;const anchored=pattern.endsWith('$');const body=pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\$$/,'');try{return new RegExp(`^${body}${anchored?'$':''}`).test(path);}catch{return false;}}
function robotsGroups(text:string){const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let current:{agents:string[];rules:{allow:boolean;path:string}[]}|null=null;for(const raw of text.split(/\r?\n/)){const line=raw.replace(/#.*/,'').trim();if(!line)continue;const at=line.indexOf(':');if(at<0)continue;const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();if(key==='user-agent'){if(!current||current.rules.length){current={agents:[],rules:[]};groups.push(current);}current.agents.push(value.toLowerCase());}else if((key==='allow'||key==='disallow')&&current&&value)current.rules.push({allow:key==='allow',path:value});}return groups;}
export function robotsDisallowed(text:string,path:string,agent='NaeinfoClear'){
 const groups=robotsGroups(text),token=agent.toLowerCase();
 for(const bot of ROBOTS_AI_BOTS){const groupsForBot=groups.filter(g=>g.agents.includes(bot.toLowerCase()));if(groupsForBot.some(g=>g.rules.some(r=>!r.allow&&r.path==='/')))return 'ROBOTS_AI_RESTRICTED' as const;}
 const direct=groups.filter(g=>g.agents.some(a=>a!=='*'&&token.includes(a))),selected=direct.length?direct:groups.filter(g=>g.agents.includes('*'));
 const rules=selected.flatMap(g=>g.rules).filter(r=>ruleMatches(r.path,path)).sort((a,b)=>b.path.length-a.path.length);
 return rules[0]?.allow?null:rules.length?'ROBOTS_DISALLOWED' as const:null;
}
async function ampRobotsAllowed(host:string,path:string,signal:AbortSignal){
 return !(await robotsRestriction(host,path,signal));
}
async function robotsRestriction(host:string,path:string,signal:AbortSignal):Promise<'ROBOTS_DISALLOWED'|'ROBOTS_AI_RESTRICTED'|null>{
 const now=Date.now(),cached=robotsCache.get(host);let result:{status:number;body?:string};if(cached&&cached.expiresAt>now)result=cached;else{
  try{const response=await fetch(`https://${host}/robots.txt`,{redirect:'manual',headers:{'User-Agent':'NaeinfoClear/0.1 (article analysis; user-requested fetch)'},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});if(response.status===404){await response.body?.cancel();result={status:404};}else if(response.ok){const text=await readLimitedText(response,256*1024);if(text===null)return 'ROBOTS_DISALLOWED';result={status:response.status,body:text};}else{await response.body?.cancel();return 'ROBOTS_DISALLOWED';}robotsCache.set(host,{...result,expiresAt:now+60*60*1000});}catch{signal.throwIfAborted();return 'ROBOTS_DISALLOWED';}
 }
 if(result.status===404)return null;
 return robotsDisallowed(result.body??'',path);
}
async function readLimitedText(response:Response,maxBytes:number){
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();return null;}chunks.push(value);}
 const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:false}).decode(body);
}
async function daumPortal(url:URL,id:string,signal:AbortSignal):Promise<RetrievalResult>{
 const host=url.hostname.toLowerCase();if(host!=='v.daum.net')return failure('ROBOTS_DISALLOWED');
 const ua='NaeinfoClear/0.1 (article analysis; user-requested fetch)';let robots:Response;
 try{robots=await fetch(`${url.origin}/robots.txt`,{redirect:'manual',headers:{'User-Agent':ua},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});}catch{signal.throwIfAborted();return failure('ROBOTS_DISALLOWED');}
  const checkedAt=new Date().toISOString();if(robots.status!==404){if(!robots.ok){await robots.body?.cancel();return failure('ROBOTS_DISALLOWED');}const rules=await readLimitedText(robots,256*1024);if(rules===null)return failure('ROBOTS_DISALLOWED');const restricted=robotsDisallowed(rules,url.pathname);if(restricted)return failure(restricted);}
 let response:Response;try{response=await fetch(url,{redirect:'manual',headers:{Accept:'text/html','User-Agent':ua},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});}catch{signal.throwIfAborted();return failure('TIMEOUT');}
 for(let redirects=0;[301,302,303,307,308].includes(response.status);redirects++){
  const location=response.headers.get('location');await response.body?.cancel();if(redirects>=2||!location)return failure('BLOCKED_DESTINATION');let next:URL;try{next=new URL(location,url);}catch{return failure('BLOCKED_DESTINATION');}if(next.protocol!=='https:'||next.hostname!==host||next.username||next.password||next.port)return failure('BLOCKED_DESTINATION');try{response=await fetch(next,{redirect:'manual',headers:{Accept:'text/html','User-Agent':ua},signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});}catch{signal.throwIfAborted();return failure('TIMEOUT');}
 }
 if([401,402,403,429].includes(response.status)){await response.body?.cancel();return failure('ACCESS_RESTRICTED');}if(!response.ok){await response.body?.cancel();return failure('ACCESS_RESTRICTED');}
 if(/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return failure('ROBOTS_AI_RESTRICTED');}
 if(!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();return failure('NOT_HTML');}
 const reader=response.body?.getReader();if(!reader)return failure('SCRIPT_RENDERED');const chunks:Uint8Array[]=[];let size=0;while(true){let part;try{part=await reader.read();}catch{signal.throwIfAborted();return failure('TIMEOUT');}if(part.done)break;size+=part.value.length;if(size>2*1024*1024){await reader.cancel();return failure('TOO_LARGE');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const html=decodeArticleDocument(bytes,'text/html');if(html===null)return failure('SCRIPT_RENDERED');const restriction=articleRestriction(html);if(restriction)return failure(restriction);const extracted=extractDaumPortalArticle(html,url.href);if(!extracted)return failure('TOO_SHORT');
 const text=articleTextPrefix(extracted.text,8000),reference:Reference={id,provenance:'web_fetched',url:extracted.sourceUrl??url.href,text,title:extracted.title,publishedAt:extracted.publishedAt,fetchedAt:new Date().toISOString(),truncated:text.length<extracted.text.length,fullTextLength:extracted.text.length,extractionVersion:extracted.extractionVersion,publisherGroup:extracted.publisherHost};
 return {ok:true,reference,metadata:{mode:'allowlisted',host:extracted.publisherHost??host,robotsCheckedAt:checkedAt,extractionMethod:'daum_portal',publisherUrl:extracted.sourceUrl,publisherHost:extracted.publisherHost}};
}
export async function retrieveDetailed(url:string,id:string,config:RuntimeConfig,signal:AbortSignal):Promise<RetrievalResult>{
  let parsed:URL;try{parsed=new URL(url);}catch{return failure('INVALID_URL');}
  if(parsed.hostname==='n.news.naver.com'||parsed.hostname==='news.naver.com')return failure('ROBOTS_DISALLOWED');
  if(parsed.hostname==='v.daum.net')return daumPortal(parsed,id,signal);
  if(config.NEWS_PROVIDER==='firecrawl'){
    const reference=await scrapeFirecrawl(url,id,config,signal);return reference?{ok:true,reference,metadata:{mode:'allowlisted',host:new URL(reference.url??url).hostname}}:failure('SCRIPT_RENDERED');
  }
  const hosts=(config.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);let target=allowedUrl(url,hosts);
  // Use only trusted public publisher domains configured by the operator.
  if(!target)return failure('INVALID_URL');
  if(isFetchDenylistedHost(target.hostname))return failure('ROBOTS_AI_RESTRICTED');
  const robotsFailure=await robotsRestriction(target.hostname,target.pathname,signal);if(robotsFailure)return failure(robotsFailure);
  const originalOrigin=target.origin,seen=new Set([target.href]);
  const fetchSignal=AbortSignal.any([signal,AbortSignal.timeout(5000)]);
  let response:Response,requestCount=0;
  for(let redirects=0;;redirects++){
    if(requestCount>=3)return failure('BLOCKED_DESTINATION');
    try{response=await fetch(target,{redirect:'manual',headers:{Accept:'text/html,text/plain','User-Agent':'NaeinfoClear/0.1 (article analysis; user-requested fetch)'},signal:fetchSignal});}
    catch{signal.throwIfAborted();return failure('TIMEOUT');}
    requestCount++;
    if(/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return failure('ROBOTS_AI_RESTRICTED');}
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');await response.body?.cancel();
    if(redirects>=2||!location)return failure('BLOCKED_DESTINATION');
    let next:URL|null;try{next=allowedUrl(new URL(location,target).href,hosts);}catch{return failure('BLOCKED_DESTINATION');}
    if(!next||next.origin!==originalOrigin||seen.has(next.href))return failure('BLOCKED_DESTINATION');
    seen.add(next.href);target=next;
  }
  if([401,403,402,429].includes(response.status)){await response.body?.cancel();return failure('ACCESS_RESTRICTED');}
  if(!response.ok||response.status>=300){await response.body?.cancel();return failure('ACCESS_RESTRICTED');}
  if(/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();return failure('ROBOTS_AI_RESTRICTED');}
  const type=response.headers.get('content-type')??'';if(!/^(text\/html|text\/plain)(;|$)/i.test(type)){await response.body?.cancel();return failure('NOT_HTML');}
  const reader=response.body?.getReader();if(!reader)return failure('SCRIPT_RENDERED');
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){let part;try{part=await reader.read();}catch{signal.throwIfAborted();return failure('TIMEOUT');}const {done,value}=part;if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();return failure('TOO_LARGE');}chunks.push(value);}
  const data=new Uint8Array(bytes);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  const document=decodeArticleDocument(data,type);if(document===null)return failure('SCRIPT_RENDERED');
  const restriction=articleRestriction(document);if(restriction)return failure(restriction);
  let extracted=/^text\/html(?:;|$)/i.test(type)?extractArticle(document,target.href):{...extractArticleDocument(document,false),extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:'plain_text' as const};
  if((extracted?.text.length??0)<300&&/^text\/html(?:;|$)/i.test(type)&&requestCount<3){
   const ampHref=extracted?.ampUrl??articleAmpUrl(document,target.href);
   if(ampHref){try{const amp=new URL(ampHref),root=getDomain(target.hostname),ampRoot=getDomain(amp.hostname);const approvedDomain=hosts.some(host=>getDomain(host)===root);
    if(root&&root===ampRoot&&approvedDomain&&amp.protocol==='https:'&&!amp.username&&!amp.password&&!amp.port&&!amp.hostname.endsWith('.')&&await ampRobotsAllowed(amp.hostname,amp.pathname,fetchSignal)){
     let ampResponse=await fetch(amp,{redirect:'manual',headers:{Accept:'text/html','User-Agent':'NaeinfoClear/0.1 (article analysis; user-requested fetch)'},signal:fetchSignal});requestCount++;
     if([301,302,303,307,308].includes(ampResponse.status)&&requestCount<3){const location=ampResponse.headers.get('location');await ampResponse.body?.cancel();if(location){const next=new URL(location,amp);if(next.protocol==='https:'&&getDomain(next.hostname)===root&&!next.username&&!next.password&&!next.port&&await ampRobotsAllowed(next.hostname,next.pathname,fetchSignal)){ampResponse=await fetch(next,{redirect:'manual',headers:{Accept:'text/html','User-Agent':'NaeinfoClear/0.1 (article analysis; user-requested fetch)'},signal:fetchSignal});requestCount++;}}}
     if([401,402,403,429].includes(ampResponse.status)){await ampResponse.body?.cancel();return failure('ACCESS_RESTRICTED');}
     if(/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(ampResponse.headers.get('x-robots-tag')??'')){await ampResponse.body?.cancel();return failure('ROBOTS_AI_RESTRICTED');}
     if(ampResponse.ok&&/^text\/html(?:;|$)/i.test(ampResponse.headers.get('content-type')??'')){const ampReader=ampResponse.body?.getReader();if(ampReader){const chunks:Uint8Array[]=[];let length=0;while(true){const part=await ampReader.read();if(part.done)break;length+=part.value.length;if(length>2*1024*1024){await ampReader.cancel();break;}chunks.push(part.value);}if(length<=2*1024*1024){const bytes=new Uint8Array(length);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}const ampHtml=decodeArticleDocument(bytes,'text/html');if(ampHtml&&!articleRestriction(ampHtml)){const ampExtract=extractArticle(ampHtml,amp.href);if(ampExtract?.text&&ampExtract.text.length>(extracted?.text.length??0))extracted={...ampExtract,extractionMethod:'amp'};}}}}
    }
   }catch{/* Invalid AMP candidates leave the original extraction result intact. */}}
  }
  if(!extracted?.text)return failure('SCRIPT_RENDERED');
  if(extracted.text.trim().length<100)return failure('TOO_SHORT');
  const text=articleTextPrefix(extracted.text,8000);
  const reference={id,provenance:'web_fetched' as const,url:target.href,text,title:extracted.title,publishedAt:extracted.publishedAt,fetchedAt:new Date().toISOString(),truncated:text.length<extracted.text.length,fullTextLength:extracted.text.length,extractionVersion:extracted.extractionVersion};
  return {ok:true,reference,metadata:{mode:'allowlisted',host:target.hostname,extractionMethod:extracted.extractionMethod}};
}
/** Compatibility adapter for evidence pipelines that still consume Reference|null. */
export async function retrieve(url:string,id:string,config:RuntimeConfig,signal:AbortSignal):Promise<Reference|null>{
 const result=await retrieveDetailed(url,id,config,signal);return result.ok?result.reference:null;
}
