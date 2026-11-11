import {Readability} from '@mozilla/readability';
import {DOMParser} from 'linkedom/worker';
import {ARTICLE_EXTRACTION_VERSION,articleTextPrefix,extractArticleDocument,publicationDate} from './article-document';

export const EXTRACTION_VERSION='readability-text-1.2';
export type ArticleText={text:string;title?:string;publishedAt?:string;language?:string;extractionVersion:string};
const BODY_SELECTOR='article[itemprop~="articleBody"],section[itemprop~="articleBody"],div[itemprop~="articleBody"],article.article_body,section.article_body,div.article_body,article.news_view,section.news_view,div.news_view,div.at_contents';
const BLOCKS=new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','LI','BR','BLOCKQUOTE','TR']);

/** Access metadata is inspected before either text extractor; a fallback never
 * overrides an explicit restriction. JSON-LD is parsed as data, never executed. */
function accessAllowed(document:Document){
 for(const meta of Array.from(document.querySelectorAll('meta'))){
  const name=meta.getAttribute('name')?.trim().toLowerCase();
  if((name==='robots'||name==='googlebot')&&/\b(noai|nosnippet)\b/i.test(meta.getAttribute('content')??''))return false;
 }
 for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))){
  let data:unknown;try{data=JSON.parse(script.textContent??'null');}catch{continue;}
  const pending:unknown[]=[data];let visited=0;
  while(pending.length){
   if(++visited>15000)return false;
   const item=pending.pop();if(!item||typeof item!=='object')continue;
   if(Array.isArray(item)){pending.push(...item);continue;}
   const record=item as Record<string,unknown>;
   if(record.isAccessibleForFree===false||typeof record.isAccessibleForFree==='string'&&record.isAccessibleForFree.trim().toLowerCase()==='false')return false;
   pending.push(...Object.values(record));
  }
 }
 return true;
}

function plainText(root:Node){
 const output:string[]=[];
 const visit=(node:Node)=>{
  if(node.nodeType===3){output.push(node.textContent??'');return;}
  const block=BLOCKS.has(node.nodeName);if(block)output.push('\n');
  for(const child of Array.from(node.childNodes))visit(child);
  if(block)output.push('\n');
 };
 visit(root);
 return output.join('').replace(/[\t\f\v \u00a0]+/g,' ').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).join('\n');
}

/** Inert DOM + Readability recovered from the original backend. Explicit body
 * markers and real semantic bodies retain semantic-text-1.3 extraction; generic
 * page-wide text is never accepted just because the old fallback was nonempty. */
export function extractArticle(html:string,url:string):ArticleText|null{
 try{
  if(html.length>2*1024*1024||(html.match(/</g)?.length??0)>30000)return null;
  const document=new DOMParser().parseFromString(html,'text/html') as unknown as Document;
  if(document.querySelectorAll('*').length>15000||!accessAllowed(document))return null;
  const original=extractArticleDocument(html,true);
  const language=document.documentElement?.getAttribute('lang')??undefined;
  // Publication dates come from the existing strict calendar/timezone parser.
  // A generic <time> could be an update or another article's timestamp.
  const publishedAt=publicationDate(original.publishedAt);
  for(const node of Array.from(document.querySelectorAll('script,style,noscript,iframe,object,embed,nav,footer,header,aside,button,[hidden],[data-nosnippet],a[href^="mailto:"],a[href^="tel:"]')))node.remove();
  // ASP.NET can wrap the whole article in a form. Keep only the exact outer
  // framework wrapper with an explicit article body, never nested comment forms.
  for(const form of Array.from(document.querySelectorAll('form'))){
   const wrapper=form.id==='aspnetForm'&&form.getAttribute('name')==='aspnetForm'&&!form.parentElement?.closest('form')&&!!form.querySelector(BODY_SELECTOR);
   if(!wrapper)form.replaceWith(document.createTextNode(' '));
  }
  const marked=!!document.querySelector(BODY_SELECTOR);
  // Recommendation cards are not the semantic article body. In particular,
  // some publishers use <article class="news_card"> around every related link.
  for(const article of Array.from(document.querySelectorAll('article'))){
   if(!article.matches(BODY_SELECTOR)&&/(?:^|[\s_-])(?:card|recommend|related|ranking|list)(?:$|[\s_-])/i.test(article.className))article.remove();
  }
  const semanticArticle=!!document.querySelector('article');
  const main=document.querySelector('main');
  const semanticMain=!!main&&Array.from(main.querySelectorAll('p,blockquote')).reduce((length,node)=>length+(node.textContent??'').trim().length,0)>=80;
  if(marked||semanticArticle||semanticMain){
   // Do not repair a rejected/unclosed marked region by falling back to cards.
   if(!original.text)return null;
   const semanticNodes=marked?Array.from(document.querySelectorAll(BODY_SELECTOR))
     :semanticArticle?Array.from(document.querySelectorAll('article')):main?[main]:[];
   const text=semanticNodes.map(node=>plainText(node)).sort((a,b)=>b.length-a.length)[0]??'';
   return text?{text,title:original.title,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION}:null;
  }
  Object.defineProperty(document,'documentURI',{value:url,configurable:true});
  const readable=new Readability(document,{charThreshold:80,maxElemsToParse:15000,keepClasses:false}).parse();
  if(!readable?.content)return null;
  const parsed=new DOMParser().parseFromString(`<html><body>${readable.content}</body></html>`,'text/html') as unknown as Document;
  const text=plainText(parsed.body);
  if(text.length<80||(text.match(/\uFFFD/g)?.length??0)>Math.max(2,text.length*.01))return null;
  const title=original.title??readable.title?.trim();
  return {text,title:title?articleTextPrefix(title,250):undefined,publishedAt,language,extractionVersion:EXTRACTION_VERSION};
 }catch{return null;}
}
