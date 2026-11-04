/** Bounded, offline document decoding/extraction for explicitly allowlisted publishers.
 * This does not establish that a page is an article or that its contents are accurate.
 */
export const ARTICLE_EXTRACTION_VERSION = 'semantic-text-1.3';

/** Keep the UTF-16 size ceiling without returning half of an astral character. */
export function articleTextPrefix(text:string,limit:number){
 let end=Math.min(text.length,Math.max(0,Math.floor(limit)));
 if(end>0&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
 return text.slice(0,end);
}
const entities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',middot:'·',copy:'©'};
// Match full tags without treating '<' or '>' inside quoted attributes as boundaries.
const TAG_PATTERN=/<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
const htmlTags=(html:string)=>html.matchAll(TAG_PATTERN);

function unescapeHtml(value:string){
 return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(original,key:string)=>{
  if(key[0]!=='#')return entities[key.toLowerCase()]??original;
  const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';
 });
}
function plainText(html:string){return unescapeHtml(html.replace(/<!doctype\b[^>]*>/gi,' ').replace(TAG_PATTERN,' ')).replace(/\s+/g,' ').trim();}
function attributes(tag:string){
 const out=new Map<string,string>();
 for(const match of tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))out.set(match[1].toLowerCase(),unescapeHtml(match[2]??match[3]??match[4]??''));
 return out;
}
// Metadata-looking strings inside comments or script templates are not page
// declarations. The prefix used for charset discovery can end inside a block.
function removeInertMarkup(html:string){
 return html.replace(/<!--[\s\S]*?(?:-->|$)/g,' ').replace(/<(script|style|noscript)(?=[\s/>])[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,' ');
}

/** Drop the entire excluded region, including nested regions of the same tag.
 * Unclosed excluded content is withheld rather than promoted into article text.
 */
function removeExcludedRegions(html:string){
 // Consume every complete tag, including quoted attributes, so a literal
 // "<body>" inside metadata cannot implicitly close the real head.
 const excluded=new Set(['head','nav','footer','header','aside','form','button']);
 // Some ASP.NET news pages place their whole document inside this framework
 // form. Only retain that exact wrapper when a real article-body marker exists;
 // ordinary search/comment forms remain excluded, including nested forms.
 const hasDocumentArticle=[...htmlTags(html)].some(match=>!match[1]&&match[2].toLowerCase()==='article'&&isArticleBodyMarker(match[0]));
 const formWrappers:boolean[]=[];
 const stack:string[]=[],parts:string[]=[];let cursor=0;
 for(const match of htmlTags(html)){
  const tag=match[2].toLowerCase(),closing=!!match[1],start=match.index!;
  if(tag==='form'){
   if(!closing){const a=attributes(match[0]);const wrapper=hasDocumentArticle&&!formWrappers.length&&!stack.length&&a.get('id')==='aspnetForm'&&a.get('name')==='aspnetForm';formWrappers.push(wrapper);if(wrapper)continue;}
   else if(formWrappers.pop()===true)continue;
  }
  // HTML permits omitting </head> before the body. Do not apply this to
  // unclosed advertising/menu regions, whose contents remain withheld.
  if(!closing&&['body','article','main'].includes(tag)&&stack.length===1&&stack[0]==='head'){
   stack.pop();cursor=start;
  }
  if(!excluded.has(tag))continue;
  if(!closing){
   if(!stack.length){parts.push(html.slice(cursor,start),' ');cursor=start+match[0].length;}
   if(!/\/\s*>$/.test(match[0]))stack.push(tag);
  }else{
   const ancestor=stack.lastIndexOf(tag);
   if(ancestor>=0){stack.length=ancestor;if(!stack.length)cursor=start+match[0].length;}
  }
 }
 if(!stack.length)parts.push(html.slice(cursor));
 return parts.join('');
}

/** Honor a BOM, HTTP charset, then a bounded HTML declaration. Never silently
 * decode legacy Korean bytes as UTF-8 replacement characters.
 */
export function decodeArticleDocument(bytes:Uint8Array,contentType:string):string|null{
 const header=/charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
 // ASCII scanning is only for the charset declaration, not the final document.
 const prefix=/^text\/html(?:;|$)/i.test(contentType)?removeInertMarkup(Array.from(bytes.subarray(0,2048),b=>b<128?String.fromCharCode(b):' ').join('')):'';
 let meta:string|undefined;
 for(const match of htmlTags(prefix)){
  if(match[2].toLowerCase()!=='meta')continue;
  const a=attributes(match[0]);meta=a.get('charset')??(a.get('http-equiv')?.toLowerCase()==='content-type'?/charset\s*=\s*([^\s;]+)/i.exec(a.get('content')??'')?.[1]:undefined);
  if(meta)break;
 }
 const bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'utf-8':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':undefined;
 try{return new TextDecoder(bom??header??meta??'utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}

function semanticBodies(html:string,tag:'article'|'main'|'title'){
 const bodies:string[]=[];let depth=0,start=0;
 for(const match of htmlTags(html)){
  if(match[2].toLowerCase()!==tag)continue;
  if(!match[1]){if(depth++===0)start=match.index!+match[0].length;}
  else if(depth>0&&--depth===0)bodies.push(html.slice(start,match.index));
 }
 return bodies;
}
function isArticleBodyMarker(tag:string){
 const a=attributes(tag);
 return (a.get('itemprop')??'').split(/\s+/).includes('articleBody')
  ||(a.get('class')??'').split(/\s+/).some(value=>value==='article_body'||value==='news_view');
}
/** Prefer explicit body regions over unrelated semantic article cards. */
function markedArticleBodies(html:string){
 const bodies:string[]=[];let found=false,activeTag:string|undefined,depth=0,start=0;
 for(const match of htmlTags(html)){
  const tag=match[2].toLowerCase(),closing=!!match[1];
  if(activeTag){
   if(tag!==activeTag)continue;
   if(!closing&&!/\/\s*>$/.test(match[0]))depth++;
   else if(closing&&--depth===0){bodies.push(html.slice(start,match.index));activeTag=undefined;}
  }else if(!closing&&['article','section','div'].includes(tag)&&isArticleBodyMarker(match[0])){
   found=true;
   if(!/\/\s*>$/.test(match[0])){activeTag=tag;depth=1;start=match.index!+match[0].length;}
  }
 }
 return {bodies,found};
}
export function publicationDate(value:string|undefined){
 // A date alone stays a calendar date: do not invent a timezone or time of day.
 if(!value)return undefined;
 const day=/^\d{4}-\d\d-\d\d/.exec(value)?.[0];if(!day)return undefined;
 const calendar=new Date(`${day}T00:00:00Z`);if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==day)return undefined;
 if(value===day)return value;
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value))return undefined;
 const parsed=Date.parse(value);return Number.isFinite(parsed)?new Date(parsed).toISOString():undefined;
}

export function extractArticleDocument(document:string,isHtml:boolean){
 if(!isHtml)return {text:document.trim(),title:undefined,publishedAt:undefined};
 const visible=removeInertMarkup(document);
 const metadata=new Map<string,string>();
 for(const match of htmlTags(visible)){if(match[2].toLowerCase()!=='meta')continue;const a=attributes(match[0]),name=a.get('property')??a.get('name');if(name&&a.get('content')&&!metadata.has(name.toLowerCase()))metadata.set(name.toLowerCase(),a.get('content')!);}
 const title=metadata.get('og:title')??plainText(semanticBodies(visible,'title')[0]??'');
 const publishedAt=publicationDate(metadata.get('article:published_time')??metadata.get('datepublished')??metadata.get('date'));
 const cleaned=removeExcludedRegions(visible);
 const marked=markedArticleBodies(cleaned);
 const candidates=marked.found?marked.bodies:semanticBodies(cleaned,'article');
 if(!marked.found&&!candidates.length)candidates.push(...semanticBodies(cleaned,'main'));
 // Prefer one substantive semantic body; never join unrelated article cards.
 const text=(marked.found||candidates.length?candidates:[cleaned]).map(plainText).sort((a,b)=>b.length-a.length)[0]??'';
 return {text,title:title?articleTextPrefix(title.trim(),250)||undefined:undefined,publishedAt};
}
