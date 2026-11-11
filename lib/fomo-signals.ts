import type {Analysis} from './contracts';
import {naturalSentences} from './segmentation';

export const FOMO_RULE_VERSION='fomo-lexical-1.0';
export type FomoSignal={sourceId:string;start:number;end:number;quote:string;category:'urgency'|'scarcity'|'social_pressure'};
const fomoRules:{category:FomoSignal['category'];pattern:RegExp}[]=[
 {category:'urgency',pattern:/지금\s*당장|오늘만|마감\s*임박|놓치면(?:\s*(?:후회|손해))?/gu},
 {category:'scarcity',pattern:/한정\s*수량|품절\s*임박|마지막\s*기회|이번이\s*마지막/gu},
 {category:'social_pressure',pattern:/나만\s*뒤처[지질]|남들(?:은|이)?\s*다\s*(?:하는|한다|샀)|모두(?:가)?\s*(?:하고|사고)\s*있/gu},
];
function quotedAt(text:string,at:number){
 const pairs:[string,string][]=[['“','”'],['「','」'],['‘','’'],['"','"']];
 return pairs.some(([left,right])=>{let start=0;while(start<text.length){const a=text.indexOf(left,start);if(a<0)return false;const b=text.indexOf(right,a+1);if(b<0)return false;if(at>a&&at<b)return true;start=b+1;}return false;});
}
/** A transparent lexical screen of body sentences, never a psychological or reliability score. */
export function fomoSignals(analysis:Pick<Analysis,'sources'>){
 const body=analysis.sources.find(s=>s.kind==='body');
 if(!body)return {version:FOMO_RULE_VERSION,totalSentences:0,flaggedSentences:0,signals:[] as FomoSignal[]};
 const groups=naturalSentences(body.sentences);const signals:FomoSignal[]=[];let flaggedSentences=0;
 for(const sentence of groups){const chunk=body.text.slice(sentence.start,sentence.end);const found:FomoSignal[]=[];
  for(const rule of fomoRules){const regex=new RegExp(rule.pattern.source,rule.pattern.flags);for(const hit of chunk.matchAll(regex)){
   const at=hit.index!,after=chunk.slice(at+hit[0].length,at+hit[0].length+24),before=chunk.slice(Math.max(0,at-12),at);
   // Exclude directly quoted slogans and obvious negated/metalinguistic examples.
   if(quotedAt(body.text,sentence.start+at)||/^\s*(?:가|이|는|은|라고|라는|이라는)?\s*(?:아니|않|없|금지|표현|문구)/u.test(after)||/(?:말라는|않도록|아닌)\s*$/u.test(before))continue;
   found.push({sourceId:body.id,start:sentence.start+at,end:sentence.start+at+hit[0].length,quote:hit[0],category:rule.category});
  }}
  if(found.length)flaggedSentences++;signals.push(...found);
 }
 return {version:FOMO_RULE_VERSION,totalSentences:groups.length,flaggedSentences,signals};
}
