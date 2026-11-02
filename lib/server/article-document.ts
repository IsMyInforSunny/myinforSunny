/** Bounded, offline document decoding/extraction for explicitly allowlisted publishers.
 * This does not establish that a page is an article or that its contents are accurate.
 */
export const ARTICLE_EXTRACTION_VERSION = 'semantic-text-1.1';

/** Keep the UTF-16 size ceiling without returning half of an astral character. */
export function articleTextPrefix(text:string,limit:number){
 let end=Math.min(text.length,Math.max(0,Math.floor(limit)));
 if(end>0&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
 return text.slice(0,end);
}
const entities:Record<string,string>={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',middot:'·',copy:'©'};

function unescapeHtml(value:string){
 return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(original,key:string)=>{
  if(key[0]!=='#')return entities[key.toLowerCase()]??original;
  const code=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);
  return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):'�';
 });
}
function plainText(html:string){return unescapeHtml(html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
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
 const pattern=/<(\/?)(head|nav|footer|header|aside|form|button)(?=[\s/>])[^>]*>/gi;
 const stack:string[]=[],parts:string[]=[];let cursor=0;
 for(const match of html.matchAll(pattern)){
  const tag=match[2].toLowerCase(),closing=!!match[1],start=match.index!;
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
 for(const tag of prefix.match(/<meta(?=[\s/>])[^>]*>/gi)??[]){
  const a=attributes(tag);meta=a.get('charset')??(a.get('http-equiv')?.toLowerCase()==='content-type'?/charset\s*=\s*([^\s;]+)/i.exec(a.get('content')??'')?.[1]:undefined);
  if(meta)break;
 }
 const bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?'utf-8':bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':undefined;
 try{return new TextDecoder(bom??header??meta??'utf-8',{fatal:true}).decode(bytes);}catch{return null;}
}

function semanticBodies(html:string,tag:'article'|'main'){
 const bodies:string[]=[];const pattern=new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*>`,'gi');let depth=0,start=0;
 for(const match of html.matchAll(pattern)){
  if(!match[1]){if(depth++===0)start=match.index!+match[0].length;}
  else if(depth>0&&--depth===0)bodies.push(html.slice(start,match.index));
 }
 return bodies;
}
function publicationDate(value:string|undefined){
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
 for(const tag of visible.match(/<meta(?=[\s/>])[^>]*>/gi)??[]){const a=attributes(tag),name=a.get('property')??a.get('name');if(name&&a.get('content')&&!metadata.has(name.toLowerCase()))metadata.set(name.toLowerCase(),a.get('content')!);}
 const title=metadata.get('og:title')??plainText(/<title(?=[\s/>])[^>]*>([\s\S]*?)<\/title\s*>/i.exec(visible)?.[1]??'');
 const publishedAt=publicationDate(metadata.get('article:published_time')??metadata.get('datepublished')??metadata.get('date'));
 const cleaned=removeExcludedRegions(visible);
 const candidates=semanticBodies(cleaned,'article');
 if(!candidates.length)candidates.push(...semanticBodies(cleaned,'main'));
 // Prefer one substantive semantic body; never join unrelated article cards.
 const text=(candidates.length?candidates:[cleaned]).map(plainText).sort((a,b)=>b.length-a.length)[0]??'';
 return {text,title:title?articleTextPrefix(title.trim(),250)||undefined:undefined,publishedAt};
}
