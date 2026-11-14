import {normalizeBiasText} from './bias-model';

/** Arithmetic helper only. It does not approve/release a model or call a provider. */
export const DENSE_VOICE_DIMENSIONS=2048;
export const DENSE_VOICE_MARGIN_GAP=.15;
export type DenseVoiceHead={classes:string[];coefficients:number[][];intercepts:number[]};
export type DenseVoiceHeads={directionality:DenseVoiceHead;polarity:DenseVoiceHead;speaker:DenseVoiceHead;issue:DenseVoiceHead};
type HeadName=keyof DenseVoiceHeads;
export type DenseVoiceResult={direction:'neutral'|'support'|'oppose'|null;speaker:'journalist'|'source'|null;issue:string|null;
  directionality:'directional'|'neutral'|null;polarity:'support'|'oppose'|null;
  margins:Record<HeadName,Record<string,number>>};

/** Identical semantic input to prepare_voice_embeddings.natural_text.
 * Preserve digits and nuclear aliases; char-SVM replacements do not apply.
 */
export function denseVoiceInputText(text:string):string{
  return normalizeBiasText(text.replace(/데일리안|뉴데일리|오마이뉴스|프레시안|(?:www\.)?(?:dailian|newdaily|ohmynews|pressian)\.(?:co\.kr|com)/gi,''));
}

const names:HeadName[]=['directionality','polarity','speaker','issue'];
const expected:Partial<Record<HeadName,readonly string[]>>={directionality:['directional','neutral'],polarity:['oppose','support'],speaker:['journalist','source']};
function validHead(value:unknown,name:HeadName):value is DenseVoiceHead{
  if(!value||typeof value!=='object')return false;
  const head=value as DenseVoiceHead;
  if(!Array.isArray(head.classes)||head.classes.length<2||head.classes.some(label=>typeof label!=='string'||!label.trim())
    ||new Set(head.classes).size!==head.classes.length||!Array.isArray(head.coefficients)||!Array.isArray(head.intercepts)
    ||head.coefficients.length!==head.classes.length||head.intercepts.length!==head.classes.length
    ||head.intercepts.some(value=>!Number.isFinite(value))
    ||head.coefficients.some(row=>!Array.isArray(row)||row.length!==DENSE_VOICE_DIMENSIONS||row.some(value=>!Number.isFinite(value)))
    ||!head.coefficients.some(row=>row.some(value=>value!==0)))return false;
  const allowed=expected[name];
  if(allowed&&(head.classes.length!==allowed.length||head.classes.some(label=>!allowed.includes(label))))return false;
  return name!=='issue'||head.classes.every(label=>!['unknown','uncertain'].includes(label));
}

export function inferDenseVoiceHeads(value:unknown,input:unknown):DenseVoiceResult|null{
  if(!value||typeof value!=='object'||!names.every(name=>validHead((value as DenseVoiceHeads)[name],name)))return null;
  if(!Array.isArray(input)||input.length!==DENSE_VOICE_DIMENSIONS||input.some(value=>typeof value!=='number'||!Number.isFinite(value)))return null;
  // Scaling before hypot keeps extreme finite components from overflowing
  // into an intercept-only decision. Actual embeddings have modest values.
  const scale=input.reduce((maximum,value)=>Math.max(maximum,Math.abs(value)),0);
  if(!Number.isFinite(scale)||scale===0)return null;
  const scaled=input.map(value=>value/scale),norm=Math.hypot(...scaled);
  if(!Number.isFinite(norm)||norm===0)return null;
  const vector=scaled.map(value=>value/norm),heads=value as DenseVoiceHeads;
  const labels={} as Record<HeadName,string|null>,margins={} as DenseVoiceResult['margins'];
  for(const name of names){
    const head=heads[name];
    const scores=head.classes.map((label,index)=>({label,value:vector.reduce((sum,value,column)=>sum+value*head.coefficients[index][column],head.intercepts[index])}));
    if(scores.some(score=>!Number.isFinite(score.value)))return null;
    margins[name]=Object.fromEntries(scores.map(score=>[score.label,score.value]));
    scores.sort((a,b)=>b.value-a.value);
    labels[name]=scores[0].value-scores[1].value>=DENSE_VOICE_MARGIN_GAP?scores[0].label:null;
  }
  const gate=labels.directionality as DenseVoiceResult['directionality'],polarity=labels.polarity as DenseVoiceResult['polarity'];
  return {direction:gate===null?null:gate==='neutral'?'neutral':polarity,
    speaker:labels.speaker as DenseVoiceResult['speaker'],issue:labels.issue,directionality:gate,polarity,margins};
}
