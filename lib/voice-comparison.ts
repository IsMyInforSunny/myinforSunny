import {summarizeVoices,type VoiceDocument,type VoiceTopic,VOICE_VERSION,VOICE_ARTICLE_ISSUE} from './sentence-voice';

export type VoiceCoordinate={id:string;url:string;publisher:string;bodyHash:string;eventId:string;topic:VoiceTopic;issue:string;
  method:'ai'|'svm';modelVersion:string;version:string;coordinate:number|null;directional:number;unresolved:number;trainingOriginal:boolean;publishedAt?:string;
  decisionPolicy?:VoiceDocument['decisionPolicy'];issuePolicy?:VoiceDocument['issuePolicy'];axis?:'source'|'journalist';
  bounds?:{lower:number;upper:number}};

/** The range is retained as a range. A legacy unresolved scalar is never eligible. */
export function voiceCoordinateBounds(item:Pick<VoiceCoordinate,'coordinate'|'directional'|'unresolved'|'bounds'>){
  if(!Number.isSafeInteger(item.directional)||item.directional<3||!Number.isSafeInteger(item.unresolved)||item.unresolved<0)return null;
  const lower=item.bounds?.lower??item.coordinate,upper=item.bounds?.upper??item.coordinate;
  if(lower===null||upper===null||!Number.isFinite(lower)||!Number.isFinite(upper)||lower< -1||upper>1||lower>upper
    ||upper-lower>.5+1e-12||item.unresolved>0&&!item.bounds)return null;
  if(item.coordinate!==null&&(!Number.isFinite(item.coordinate)||item.coordinate<lower-1e-12||item.coordinate>upper+1e-12))return null;
  return {lower,upper};
}

/** Same sub-issue, event, model and policy. Equal weight per publisher. */
export function compareVoiceCoordinates(input:VoiceCoordinate,articles:VoiceCoordinate[],trainingHashes:readonly string[]=[]){
  const empty={status:'insufficient' as 'insufficient'|'ready'|'input_unresolved'|'inconsistent_period',score:null as number|null,
    magnitude:null as number|null,scoreBounds:null as {lower:number;upper:number}|null,
    direction:null as 'support'|'oppose'|'center'|'undetermined'|null,
    baseline:null as number|null,opposing:[] as VoiceCoordinate[],similar:[] as VoiceCoordinate[],count:0,publisherCount:0,
    rangeCount:0,distributionCount:0};
  const eligible=(item:VoiceCoordinate)=>voiceCoordinateBounds(item)!==null&&!item.trainingOriginal
    &&!trainingHashes.includes(item.bodyHash)&&!!item.bodyHash&&!!item.eventId&&item.version===VOICE_VERSION;
  if(!eligible(input))return {...empty,status:'input_unresolved' as const};
  const inputBounds=voiceCoordinateBounds(input)!;
  const live=input.eventId.startsWith('live:'),inputTime=input.publishedAt?Date.parse(input.publishedAt):NaN;
  if(live&&!Number.isFinite(inputTime))return {...empty,status:'input_unresolved' as const};
  const seen=new Set([input.bodyHash]),urls=new Set([input.url]);
  const candidates=articles.filter(item=>{
    if(item.id===input.id||!eligible(item)||item.eventId!==input.eventId||item.topic!==input.topic||item.issue!==input.issue
      ||item.method!==input.method||item.modelVersion!==input.modelVersion||item.version!==input.version
      ||item.decisionPolicy!==input.decisionPolicy||item.issuePolicy!==input.issuePolicy||item.axis!==input.axis
      ||seen.has(item.bodyHash)||urls.has(item.url)
      ||live&&(!item.publishedAt||!Number.isFinite(Date.parse(item.publishedAt))||Math.abs(Date.parse(item.publishedAt)-inputTime)>3*86400000))return false;
    seen.add(item.bodyHash);urls.add(item.url);return true;
  });
  const groups=new Map<string,VoiceCoordinate[]>();
  for(const item of candidates)groups.set(item.publisher,[...(groups.get(item.publisher)??[]),item]);
  const publishers=[...groups.values()].filter(items=>items.length>=3),population=publishers.flat();
  const pointGroups=publishers.map(items=>items.filter(item=>{
    const bounds=voiceCoordinateBounds(item)!;return bounds.lower===bounds.upper;
  }));
  const points=pointGroups.flat();
  const counts={count:population.length,publisherCount:publishers.length,rangeCount:population.length-points.length,distributionCount:points.length};
  if(publishers.length<2||pointGroups.some(items=>!items.length))return {...empty,...counts};
  if(live){const times=[inputTime,...population.map(item=>Date.parse(item.publishedAt!))];
    if(Math.max(...times)-Math.min(...times)>3*86400000)return {...empty,...counts,status:'inconsistent_period' as const};}
  const weighted=pointGroups.flatMap(items=>items.map(item=>({item,value:voiceCoordinateBounds(item)!.lower,weight:1/publishers.length/items.length})))
    .sort((a,b)=>a.value-b.value);
  let sum=0,baseline=weighted[weighted.length-1].value;
  for(let i=0;i<weighted.length;i++){
    sum+=weighted[i].weight;
    if(sum>=.5-1e-12){baseline=Math.abs(sum-.5)<1e-12&&weighted[i+1]?(weighted[i].value+weighted[i+1].value)/2:weighted[i].value;break;}
  }
  const lowerDistance=inputBounds.lower<=baseline&&inputBounds.upper>=baseline?0:Math.min(Math.abs(inputBounds.lower-baseline),Math.abs(inputBounds.upper-baseline));
  const upperDistance=Math.max(Math.abs(inputBounds.lower-baseline),Math.abs(inputBounds.upper-baseline));
  const point=inputBounds.lower===inputBounds.upper;
  const score=point?Math.round(lowerDistance/2*100):null;
  const scoreBounds=point?{lower:score!,upper:score!}:{lower:Math.floor(lowerDistance/2*100),upper:Math.ceil(upperDistance/2*100)};
  const direction=inputBounds.lower>baseline?'support' as const:inputBounds.upper<baseline?'oppose' as const
    :point?'center' as const:'undetermined' as const;
  // Range inputs can rank whole candidate intervals, without inventing a center point.
  const opposite=points.filter(item=>direction==='support'?voiceCoordinateBounds(item)!.upper<baseline
    :direction==='oppose'?voiceCoordinateBounds(item)!.lower>baseline:false);
  const distanceToRange=(value:number,lower:number,upper:number)=>value<lower?lower-value:value>upper?value-upper:0;
  const targetLower=2*baseline-inputBounds.upper,targetUpper=2*baseline-inputBounds.lower;
  const opposing=opposite.sort((a,b)=>distanceToRange(voiceCoordinateBounds(a)!.lower,targetLower,targetUpper)
    -distanceToRange(voiceCoordinateBounds(b)!.lower,targetLower,targetUpper));
  const similar=points.filter(item=>direction==='support'?voiceCoordinateBounds(item)!.lower>=baseline
    :direction==='oppose'?voiceCoordinateBounds(item)!.upper<=baseline:direction==='center')
    .sort((a,b)=>distanceToRange(voiceCoordinateBounds(a)!.lower,inputBounds.lower,inputBounds.upper)
      -distanceToRange(voiceCoordinateBounds(b)!.lower,inputBounds.lower,inputBounds.upper));
  return {status:'ready' as const,score,scoreBounds,direction,magnitude:point?lowerDistance:null,baseline,opposing,similar,...counts};
}

export function mainVoiceIssue(body:string,document:VoiceDocument){
  const summary=summarizeVoices(body,document);if(!summary)return null;
  const ranked=[...summary.issues].sort((a,b)=>b.source.directional-a.source.directional);
  const selected=document.issuePolicy===VOICE_ARTICLE_ISSUE
    ?summary.issues.find(issue=>issue.issue===document.articleIssue)
    :ranked[0]?.source.directional&&ranked[0].source.directional!==ranked[1]?.source.directional?ranked[0]:undefined;
  if(!selected)return null;
  const evidence=selected.source.evidence;
  const bounds=evidence.lower===null||evidence.upper===null?undefined:{lower:evidence.lower,upper:evidence.upper};
  const eligible=bounds!==undefined&&voiceCoordinateBounds({coordinate:null,directional:evidence.directional,unresolved:evidence.unresolved,bounds})!==null;
  return {...selected,...selected.source,coordinate:eligible&&bounds!.lower===bounds!.upper?bounds!.lower:null,
    bounds:eligible?bounds:null,eligible,axis:'source' as const,
    unresolved:evidence.unresolved,method:summary.method,modelVersion:summary.modelVersion,topic:summary.topic,
    decisionPolicy:document.decisionPolicy,issuePolicy:document.issuePolicy};
}
