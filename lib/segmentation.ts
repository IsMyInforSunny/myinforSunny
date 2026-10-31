import type { InputSource } from './contracts';

/** Bump whenever boundaries, ids or unit metadata change: verify re-segments and rejects mismatching (stale) analyses. */
export const SEGMENTER='sentence-3.1';
/** Processing fragments are a cost/safety bound, never a linguistic sentence. */
export const FRAGMENT_LIMIT=500;
type Unit=InputSource['sentences'][number];

const TERMINATOR=/[.!?。！？…‥]/u;
const OPENERS:Record<string,string>={'“':'”','‘':'’','「':'」','『':'』','《':'》','〈':'〉','（':'）','(':')','[':']','【':'】','"':'"'};
// Straight quotes are ambiguous, so only curly/CJK closers may attach to a terminator without a matching opener.
const STRAY_CLOSERS='”’」』》〉）)]】';
const GLUED=/[A-Za-z0-9=&%#/_@-]/;
const EMOJI=/(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[️‍⃣])+/uy;
// A quoted sentence continues into the Korean quotation particle that follows its closing quote.
const QUOTE_CONTINUATION=/^[ \t]?(?:라고|라며|라면서|라는|이라고|이라며|이라는|하고|고(?=[\s,.]|$)|며(?=[\s,.]|$))/;
const ABBREVIATION=/(?:^|[^A-Za-z])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|No)$/;

function emojiLength(text:string,at:number){EMOJI.lastIndex=at;const m=EMOJI.exec(text);return m?m[0].length:0;}
/** Decimals, list numbers, abbreviations and Korean dotted dates are not sentence ends. */
function dotEndsSentence(text:string,dot:number,sentenceStart:number){
  const before=text.slice(sentenceStart,dot),after=text.slice(dot+1);
  if(/^\s*\d{1,3}$/.test(before))return false;
  if(ABBREVIATION.test(before))return false;
  if(/(?:^|\D)\d{4}$/.test(before)&&/^[ \t]*\d{1,2}[ \t]*\./.test(after))return false;
  if(/(?:^|\D)\d{4}[ \t]*\.[ \t]*\d{1,2}$/.test(before)&&/^[ \t]*\d{1,2}(?!\d)/.test(after))return false;
  if(/(?:^|\D)\d{4}[ \t]*\.[ \t]*\d{1,2}[ \t]*\.[ \t]*\d{1,2}$/.test(before)&&/^[ \t]*[가-힣]/.test(after))return false;
  return true;
}
/** Raw natural-sentence ranges of one line. `balanced` is false when a quote/bracket never closed. */
function scanLine(text:string,trackQuotes:boolean){
  const ranges:[number,number][]=[];let start=0,i=0;const stack:string[]=[];
  while(i<text.length){
    const c=text[i];
    if(TERMINATOR.test(c)){
      let j=i;while(j<text.length&&TERMINATOR.test(text[j]))j++;
      let k=j;
      while(k<text.length){
        const d=text[k];
        if(trackQuotes&&stack.length&&stack[stack.length-1]===d){stack.pop();k++;continue;}
        if(!stack.length&&STRAY_CLOSERS.includes(d)){k++;continue;}
        const e=emojiLength(text,k);if(e){k+=e;continue;}
        break;
      }
      const next=text[k];
      const inQuote=trackQuotes&&stack.length>0;
      const glued=next!==undefined&&GLUED.test(next);
      const dotOnly=text.slice(i,j)==='.';
      const continues=k>j&&QUOTE_CONTINUATION.test(text.slice(k));
      if(!inQuote&&!glued&&!continues&&!(dotOnly&&k===j&&!dotEndsSentence(text,i,start))){ranges.push([start,k]);start=k;}
      i=k;continue;
    }
    if(trackQuotes){
      if(stack.length&&stack[stack.length-1]===c)stack.pop();
      else if(OPENERS[c])stack.push(OPENERS[c]);
    }
    i++;
  }
  if(start<text.length)ranges.push([start,text.length]);
  return {ranges,balanced:!stack.length};
}
function naturalRanges(text:string){
  const out:[number,number][]=[];
  // Line breaks always end a sentence and reset any dangling quote.
  for(const line of text.matchAll(/[^\r\n]+/g)){
    let scan=scanLine(line[0],true);if(!scan.balanced)scan=scanLine(line[0],false);
    for(const [s,e] of scan.ranges)out.push([line.index!+s,line.index!+e]);
  }
  return out;
}
const REGIONAL=/^\p{Regional_Indicator}/u;
/** True when `at` would separate the two halves of a regional-indicator flag pair (pairs counted from `from`). */
function splitsFlag(text:string,from:number,at:number){
  if(!REGIONAL.test(text.slice(at,at+2)))return false;
  let n=0,p=at;
  while(p-2>=from&&REGIONAL.test(text.slice(p-2,p))){n++;p-=2;}
  return n%2===1;
}
function badSplit(text:string,from:number,at:number){
  const prev=text.charCodeAt(at-1);
  return (prev>=0xD800&&prev<=0xDBFF)||text[at-1]==='‍'||/^(?:\p{M}|[️‍⃣]|\p{Emoji_Modifier})/u.test(text.slice(at,at+2))||splitsFlag(text,from,at);
}
/** Narrow exception to FRAGMENT_LIMIT: at most this many trailing punctuation/closer/space units may ride on the last fragment. */
const TAIL_ALLOWANCE=8;
const PUNCT_TAIL=/^[\s.!?。！？…‥"'“”‘’」』》〉）)\]】]*$/u;
function fragments(text:string,start:number,end:number){
  const out:[number,number][]=[];let from=start;
  while(from<end){
    let to=Math.min(from+FRAGMENT_LIMIT,end);
    if(to<end){
      if(end-to<=TAIL_ALLOWANCE&&PUNCT_TAIL.test(text.slice(to,end)))to=end;
      else{
        // Prefer a whitespace boundary in the second half of the window; otherwise fall back to a safe code-unit split.
        let w=to;while(w>from+FRAGMENT_LIMIT/2&&!(/\s/.test(text[w-1])&&!badSplit(text,from,w)))w--;
        if(w>from+FRAGMENT_LIMIT/2)to=w;
        else while(to>from+1&&badSplit(text,from,to))to--;
      }
    }
    const raw=text.slice(from,to),s=from+raw.length-raw.trimStart().length,e=from+raw.trimEnd().length;
    if(e>s)out.push([s,e]);
    from=to;
  }
  return out;
}
/**
 * Splits into processing units with exact UTF-16 offsets (no normalization). A natural sentence longer than
 * FRAGMENT_LIMIT becomes several units that share `natural.index`; short sentences have part=0, parts=1.
 */
export function sentences(text:string,sourceId:string):InputSource['sentences']{
  const parts:InputSource['sentences']=[];let natural=0;
  for(const [rawStart,rawEnd] of naturalRanges(text)){
    const raw=text.slice(rawStart,rawEnd),trim=raw.trim();if(!/[\p{L}\p{N}]/u.test(trim))continue;
    const start=rawStart+raw.length-raw.trimStart().length;
    const pieces=fragments(text,start,start+trim.length);
    pieces.forEach(([s,e],part)=>parts.push({id:`${sourceId}_s${parts.length}`,start:s,end:e,natural:{index:natural,part,parts:pieces.length}}));
    if(pieces.length)natural++;
  }
  return parts;
}
export type NaturalSentence={index:number;units:Unit[];start:number;end:number;fragmented:boolean};
/** Groups units back into natural sentences. Units without metadata (older exports) stay individual. */
export function naturalSentences(units:Unit[]):NaturalSentence[]{
  const groups:NaturalSentence[]=[];
  for(const unit of units){
    const last=groups[groups.length-1];
    if(unit.natural&&last&&last.units[0].natural?.index===unit.natural.index){last.units.push(unit);last.end=unit.end;last.fragmented=true;}
    else groups.push({index:groups.length,units:[unit],start:unit.start,end:unit.end,fragmented:false});
  }
  return groups;
}
export function naturalSentenceCount(sources:Pick<InputSource,'sentences'>[]){return sources.reduce((n,s)=>n+naturalSentences(s.sentences).length,0);}
