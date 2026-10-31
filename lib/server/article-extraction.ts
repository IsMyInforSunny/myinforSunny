import {Readability} from '@mozilla/readability';
import {DOMParser} from 'linkedom/worker';

export const EXTRACTION_VERSION='readability-text-1.0';
export type ArticleText={text:string;title:string;publishedAt?:string;language?:string;extractionVersion:string};
const BLOCKS=new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','LI','BR','BLOCKQUOTE','TR']);
function plainText(root:Node){
 const output:string[]=[];const visit=(node:Node)=>{
  if(node.nodeType===3){output.push(node.textContent??'');return;}
  const block=BLOCKS.has(node.nodeName);if(block)output.push('\n');
  for(const child of Array.from(node.childNodes))visit(child);
  if(block)output.push('\n');
 };
 visit(root);return output.join('').replace(/[\t\f\v \u00a0]+/g,' ').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).join('\n');
}
function published(value:string|null|undefined){if(!value||!/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+Z-]+)?$/.test(value)||!Number.isFinite(Date.parse(value)))return undefined;return value;}
/** Inert parsing only. Output is plain text; no scripts/resources are executed or loaded. */
export function extractArticle(html:string,url:string):ArticleText|null{
 try{
  if((html.match(/</g)?.length??0)>30000)return null;
  const document=new DOMParser().parseFromString(html,'text/html') as unknown as Document;
  if(document.querySelectorAll('*').length>15000)return null;
  const robots=Array.from(document.querySelectorAll('meta[name="robots"],meta[name="googlebot"]')).map(m=>m.getAttribute('content')??'').join(',');
  if(/\b(noai|nosnippet)\b/i.test(robots))return null;
  for(const el of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))){
   try{
    const value=JSON.parse(el.textContent??'null');const entries=Array.isArray(value)?value:[value,...(Array.isArray(value?.['@graph'])?value['@graph']:[])];
    if(entries.some(v=>{if(!v)return false;const types:unknown[]=Array.isArray(v['@type'])?v['@type']:[v['@type']];return ['NewsArticle','Article','ReportageNewsArticle'].some(t=>types.includes(t))&&(v.isAccessibleForFree===false||v.isAccessibleForFree==='false');}))return null;
   }catch{/* Malformed metadata does not establish access rights. */}
  }
  const date=published(document.querySelector('meta[property="article:published_time"]')?.getAttribute('content'))??published(document.querySelector('time[datetime]')?.getAttribute('datetime'));
  const language=document.documentElement?.getAttribute('lang')??undefined;
  for(const node of Array.from(document.querySelectorAll('script,style,noscript,iframe,object,embed,form,nav,footer,header,aside,[hidden],[data-nosnippet]')))node.remove();
  Object.defineProperty(document,'documentURI',{value:url,configurable:true});
  const article=new Readability(document,{charThreshold:80,maxElemsToParse:15000,keepClasses:false}).parse();
  if(!article?.content)return null;
  const parsed=new DOMParser().parseFromString(`<html><body>${article.content}</body></html>`,'text/html') as unknown as Document;
  const text=plainText(parsed.body);
  if(text.length<80||(text.match(/\uFFFD/g)?.length??0)>Math.max(2,text.length*0.01))return null;
  return {text,title:(article.title??'').trim().slice(0,250),publishedAt:date,language,extractionVersion:EXTRACTION_VERSION};
 }catch{return null;}
}
export function decodeArticle(bytes:Uint8Array,contentType:string):string|null{
 const prefix=String.fromCharCode(...bytes.slice(0,2048));
 const declared=contentType.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]??prefix.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s/>;"']+)/i)?.[1]??'utf-8';
 const label=declared.toLowerCase();const charset=/^(?:utf-?8|unicode-1-1-utf-8)$/.test(label)?'utf-8':/^(?:euc-kr|cp949|windows-949|ks_c_5601-1987)$/.test(label)?'euc-kr':null;
 if(!charset)return null;
 try{return new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{return null;}
}
