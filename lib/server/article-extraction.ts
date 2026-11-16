import {Readability} from '@mozilla/readability';
import {DOMParser} from 'linkedom/worker';
import {ARTICLE_EXTRACTION_VERSION,articleTextPrefix,extractArticleDocument,publicationDate} from './article-document';

export const EXTRACTION_VERSION='readability-text-1.2';
export type ArticleText={text:string;title?:string;publishedAt?:string;language?:string;extractionVersion:string;extractionMethod:'semantic'|'readability'|'json_ld'|'next_data'|'amp'|'paragraph_density'|'plain_text';ampUrl?:string;sourceUrl?:string;publisherHost?:string};
const BODY_SELECTOR='article[itemprop~="articleBody"],section[itemprop~="articleBody"],div[itemprop~="articleBody"],article.article_body,section.article_body,div.article_body,article.news_view,section.news_view,div.news_view,div.at_contents';
const BLOCKS=new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','LI','BR','BLOCKQUOTE','TR']);
export function articleAmpUrl(html:string,pageUrl:string){try{const doc=new DOMParser().parseFromString(html,'text/html') as unknown as Document;const href=doc.querySelector('link[rel="amphtml"]')?.getAttribute('href');if(!href)return undefined;const amp=new URL(href,pageUrl);return amp.protocol==='https:'&&!amp.username&&!amp.password&&!amp.port&&!amp.hostname.endsWith('.')?amp.href:undefined;}catch{return undefined;}}

export function extractDaumPortalArticle(html:string,portalUrl:string):ArticleText|null{
 try{
  const doc=new DOMParser().parseFromString(html,'text/html') as unknown as Document;
  const root=doc.querySelector('div.article_view');if(!root)return null;
  for(const node of Array.from(root.querySelectorAll('script,style,nav,aside,button,[hidden]')))node.remove();
  const text=plainText(root).trim();if(text.length<300)return null;
  const sourceLink=Array.from(doc.querySelectorAll('a[href]')).find(a=>/기사\s*원문|원문\s*기사|언론사\s*기사/.test((a.textContent??'').trim()));
  let sourceUrl:string|undefined,publisherHost:string|undefined;
  if(sourceLink){try{const source=new URL(sourceLink.getAttribute('href')!,portalUrl);if(source.protocol==='https:'&&!source.username&&!source.password&&!source.port&&!source.hostname.endsWith('.')&&source.hostname!==new URL(portalUrl).hostname){sourceUrl=source.href;publisherHost=source.hostname;}}catch{}}
  const title=doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()??doc.querySelector('title')?.textContent?.trim();
  const publishedAt=publicationDate(doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')??undefined);
  return {text,title:title?articleTextPrefix(title,250):undefined,publishedAt,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:'semantic',sourceUrl,publisherHost};
 }catch{return null;}
}

/** Access metadata is inspected before either text extractor; a fallback never
 * overrides an explicit restriction. JSON-LD is parsed as data, never executed. */
function accessAllowed(document:Document){
 for(const meta of Array.from(document.querySelectorAll('meta'))){
  const name=meta.getAttribute('name')?.trim().toLowerCase();
  if((name==='robots'||name==='googlebot')&&/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(meta.getAttribute('content')??''))return false;
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
export function articleRestriction(html:string):'ROBOTS_AI_RESTRICTED'|'ACCESS_RESTRICTED'|null{
 try{
  const document=new DOMParser().parseFromString(html,'text/html') as unknown as Document;
  for(const meta of Array.from(document.querySelectorAll('meta[name="robots"],meta[name="googlebot"]'))){
   if(/\b(noai|noimageai|nosnippet|noarchive)\b/i.test(meta.getAttribute('content')??''))return 'ROBOTS_AI_RESTRICTED';
  }
  for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))){
   let data:unknown;try{data=JSON.parse(script.textContent??'null');}catch{continue;}
   const pending:unknown[]=[data];let count=0;while(pending.length&&count++<15000){const value=pending.pop();if(!value||typeof value!=='object')continue;if(Array.isArray(value)){pending.push(...value);continue;}const row=value as Record<string,unknown>;
    if(row.isAccessibleForFree===false||typeof row.isAccessibleForFree==='string'&&row.isAccessibleForFree.trim().toLowerCase()==='false')return 'ACCESS_RESTRICTED';
    pending.push(...Object.values(row));
   }
  }
  const visible=(document.body?.textContent??'').slice(0,50000);
  if(/로그인(?:하|후)|구독(?:하고|후|해야)|회원(?:가입|로그인)|subscribe to read|sign in to read|subscriber only/i.test(visible))return 'ACCESS_RESTRICTED';
  return null;
 }catch{return null;}
}

const NOISE=/^(?:관련\s*기사|추천\s*기사|많이\s*본\s*뉴스|오늘의\s*뉴스|구독\s*신청|기자\s*구독|무단\s*전재|저작권자|Copyright|All rights reserved)/i;
function cleanArticleText(value:string){return value.split(/\n+/).map(line=>line.trim()).filter(line=>line.length>0&&!NOISE.test(line)).join('\n').trim();}
function jsonLdBody(document:Document){
 const values:string[]=[];const queue:unknown[]=[...Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(node=>{
   try{return JSON.parse(node.textContent??'null') as unknown;}catch{return null;}
 })];let visited=0;
 while(queue.length&&visited++<15000){const value=queue.pop();if(!value||typeof value!=='object')continue;if(Array.isArray(value)){queue.push(...value);continue;}
  const row=value as Record<string,unknown>;const types=Array.isArray(row['@type'])?row['@type']:[row['@type']];
  if(types.some(type=>typeof type==='string'&&['NewsArticle','Article','ReportageNewsArticle'].includes(type))&&typeof row.articleBody==='string')values.push(row.articleBody);
  queue.push(...Object.values(row));
 }
 return values.map(cleanArticleText).sort((a,b)=>b.length-a.length)[0]??'';
}
function nextDataBody(document:Document){
 const script=document.querySelector('script#__NEXT_DATA__[type="application/json"]');if(!script)return '';
 let data:unknown;try{data=JSON.parse(script.textContent??'null');}catch{return '';}const values:string[]=[];const queue:unknown[]=[data];let visited=0;
 const keys=new Set(['articleBody','content','body','text']);
 while(queue.length&&visited++<30000){const value=queue.pop();if(!value||typeof value!=='object')continue;if(Array.isArray(value)){queue.push(...value);continue;}
  for(const [key,child] of Object.entries(value)){if(keys.has(key)&&typeof child==='string')values.push(plainText(new DOMParser().parseFromString(child,'text/html').body));else if(child&&typeof child==='object')queue.push(child);}
 }
 return values.map(cleanArticleText).sort((a,b)=>b.length-a.length)[0]??'';
}
function paragraphDensity(document:Document){
 const root=document.querySelector('article')??document.querySelector('main')??document.body;if(!root)return '';
 const groups:string[][]=[];let group:string[]=[],parent:Element|null=null;let previous:Element|null=null;
 for(const paragraph of Array.from(root.querySelectorAll('p'))){
  const text=(paragraph.textContent??'').trim();const links=Array.from(paragraph.querySelectorAll('a')).reduce((n,node)=>n+(node.textContent??'').trim().length,0);
  const siblings=paragraph.parentElement===previous?.parentElement&&previous?.nextElementSibling===paragraph;
  if(!text||links/text.length>.3||NOISE.test(text)){if(group.length)groups.push(group);group=[];parent=null;previous=paragraph;continue;}
  if(parent&&parent!==paragraph.parentElement||parent&&!siblings){if(group.length)groups.push(group);group=[];}
  parent=paragraph.parentElement;group.push(text);previous=paragraph;
 }
 if(group.length)groups.push(group);
 return groups.map(lines=>cleanArticleText(lines.join('\n'))).sort((a,b)=>b.length-a.length)[0]??'';
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
  const title=original.title??document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim()??document.querySelector('title')?.textContent?.trim();
  const language=document.documentElement?.getAttribute('lang')??undefined;
  // Publication dates come from the existing strict calendar/timezone parser.
  // A generic <time> could be an update or another article's timestamp.
  const publishedAt=publicationDate(original.publishedAt??document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')??undefined);
  const ampUrl=articleAmpUrl(html,url);
  const fallback:{value:{text:string;method:ArticleText['extractionMethod']}|null}={value:null};
  const contactAnchors=Array.from(document.querySelectorAll('a[href^="mailto:"],a[href^="tel:"]'));
  for(const anchor of contactAnchors)anchor.remove();
  const explicitBody=document.querySelector(BODY_SELECTOR);
  if(explicitBody){const text=cleanArticleText(contactAnchors.length?plainText(explicitBody):original.text||plainText(explicitBody));if(text)return {text,title:title?articleTextPrefix(title,250):undefined,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:'semantic',ampUrl};}
  if((document.querySelector('article')||document.querySelector('main p,main blockquote'))&&original.text.trim())fallback.value={text:cleanArticleText(original.text),method:'semantic'};
  const accept=(text:string,method:ArticleText['extractionMethod'])=>{
   const cleaned=cleanArticleText(text);if(!cleaned)return null;
   const result={text:cleaned,method};if(!fallback.value||cleaned.length>fallback.value.text.length)fallback.value=result;
   return cleaned.length>=300?{text:cleaned,title:title?articleTextPrefix(title,250):undefined,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:method,ampUrl} satisfies ArticleText:null;
  };
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
   if(original.text){const semanticText=cleanArticleText(original.text);if(semanticText.length>=300)return {text:semanticText,title:title?articleTextPrefix(title,250):undefined,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:'semantic'};fallback.value={text:semanticText,method:'semantic'};}
   const semanticNodes=marked?Array.from(document.querySelectorAll(BODY_SELECTOR))
     :semanticArticle?Array.from(document.querySelectorAll('article')):main?[main]:[];
   const text=semanticNodes.map(node=>plainText(node)).sort((a,b)=>b.length-a.length)[0]??'';
    const result=accept(text,'semantic');if(result)return result;
  }
  const structured=accept(jsonLdBody(document),'json_ld');if(structured)return structured;
  const nextData=accept(nextDataBody(document),'next_data');if(nextData)return nextData;
  const dense=accept(paragraphDensity(document),'paragraph_density');if(dense)return dense;
  Object.defineProperty(document,'documentURI',{value:url,configurable:true});
  const readable=new Readability(document,{charThreshold:80,maxElemsToParse:15000,keepClasses:false}).parse();
  const resolvedTitle=title??readable?.title?.trim();
  if(!readable?.content)return fallback.value?{text:fallback.value.text,title:resolvedTitle?articleTextPrefix(resolvedTitle,250):undefined,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:fallback.value.method}:null;
  const parsed=new DOMParser().parseFromString(`<html><body>${readable.content}</body></html>`,'text/html') as unknown as Document;
  const text=plainText(parsed.body);
  if((text.match(/\uFFFD/g)?.length??0)>Math.max(2,text.length*.01))return null;
  const readableText=cleanArticleText(text);
  if(readableText.length>=300)return {text:readableText,title:resolvedTitle?articleTextPrefix(resolvedTitle,250):undefined,publishedAt,language,extractionVersion:EXTRACTION_VERSION,extractionMethod:'readability',ampUrl};
  if(readableText&&(!fallback.value||readableText.length>fallback.value.text.length))fallback.value={text:readableText,method:'readability'};
  return fallback.value?{text:fallback.value.text,title:resolvedTitle?articleTextPrefix(resolvedTitle,250):undefined,publishedAt,language,extractionVersion:ARTICLE_EXTRACTION_VERSION,extractionMethod:fallback.value.method}:null;
 }catch{return null;}
}
