import type {BodyPosition,InputSource,Span} from './contracts';
import {naturalSentences} from './segmentation';
import {sentenceAttributionSignals} from './cited-sources';

/** Only automatic propositions use this syntax gate; explicit user questions
 * are a separate contract. Reject factual summaries/forecasts as normal no-issue. */
export function isDebatableProposition(value:string){
  return /(?:[가-힣]야\s*(?:한다|합니다)|(?:이|가|것이)\s*바람직하다|(?:할|될|쓸|늘릴|줄일)\s*필요가\s*있다|[가-힣]서는\s*안\s*된다)[.!?。]?\s*$/.test(value.normalize('NFC').trim());
}

export function guardBodyPosition(candidate:BodyPosition,sources:InputSource[],automaticUnfixed:boolean):BodyPosition{
  if(automaticUnfixed&&!isDebatableProposition(candidate.proposition))return {
    ...candidate,proposition:'',label:'not_expressed',evidence:[],
    reason:'찬반으로 비교할 논점이 없는 기사입니다.',attribution:'unclear',attributionSource:'server_rule',
  };
  const isReported=(span:Span)=>{
    const source=sources.find(item=>item.id===span.sourceId);
    const group=source&&naturalSentences(source.sentences).find(item=>item.units.some(unit=>unit.id===span.sentenceId));
    if(!source||!group)return false;
    return sentenceAttributionSignals(source.text.slice(group.start,group.end),{start:span.start-group.start,end:span.end-group.start}).reported;
  };
  const reported=candidate.evidence.filter(isReported),direct=candidate.evidence.filter(span=>!isReported(span));
  let attribution=candidate.attribution,evidence=candidate.evidence;
  if(reported.length===candidate.evidence.length&&reported.length)attribution='reported_sources';
  else if(reported.length){evidence=direct;if(attribution==='reported_sources')attribution='unclear';}
  else if(attribution==='reported_sources')attribution='unclear';
  const directional=['support','oppose','mixed'].includes(candidate.label);
  const label=directional&&attribution==='reported_sources'?'not_expressed'
    :directional&&attribution==='unclear'?'undetermined':candidate.label;
  const changed=attribution!==candidate.attribution||evidence.length!==candidate.evidence.length||label!==candidate.label;
  return {...candidate,attribution,evidence,label,...(changed?{attributionSource:'server_rule' as const,
    reason:attribution==='reported_sources'?'기사에 인용된 취재원의 입장입니다. 기사 작성자의 찬반으로 집계하지 않습니다.'
      :attribution==='unclear'?'발화 주체를 원문 표지로 확인하지 못해 작성자 입장 판단을 유보합니다.'
        :'취재원 인용을 제외한 작성자 근거만 남겨 표시합니다.'}:{})};
}
