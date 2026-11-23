import {naturalSentences,sentences} from './segmentation';

/** Standalone publisher furniture; offsets and IDs in the retained original stay intact. */
export function nonEditorialRanges(text:string){
 const ranges:{start:number;end:number}[]=[];let offset=0;
 for(const line of text.split('\n')){
  const value=line.trim();
  if(/^(?:©|ⓒ|Copyright\b|저작권자\s*[:：])/i.test(value)
   ||/^▲[^\n]*(?:ⓒ|©|사진\s*[=:：])/.test(value)
   ||/^구글에서\s+.{1,30}더\s*자주\s*만나기[.!\s]*$/.test(value))ranges.push({start:offset,end:offset+line.length});
  offset+=line.length+1;
 }
 return ranges;
}

export function editorialSentences(text:string,sourceId:string){
 const excluded=nonEditorialRanges(text);
 const kept=sentences(text,sourceId).filter(unit=>!excluded.some(range=>unit.start>=range.start&&unit.end<=range.end));
 return naturalSentences(kept).flatMap((group,index)=>group.units.map((unit,part)=>({...unit,natural:{index,part,parts:group.units.length}})));
}

export function editorialRange(text:string,start:number,end:number){
 return !nonEditorialRanges(text).some(range=>start>=range.start&&end<=range.end);
}
