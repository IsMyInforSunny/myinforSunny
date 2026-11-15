import {summarizeVoices,type VoiceDocument,type VoiceTopic,VOICE_VERSION,VOICE_ARTICLE_ISSUE} from './sentence-voice';

import {intervalDistance,weightedIntervalDistribution,type CoordinateInterval} from './issue-quarter-baseline';

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
    baseline:null as number|null,baselineBounds:null as CoordinateInterval|null,baselineUncertain:false,opposing:[] as VoiceCoordinate[],similar:[] as VoiceCoordinate[],count:0,publisherCount:0,
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
  const counts={count:population.length,publisherCount:publishers.length,rangeCount:population.length-points.length,distributionCount:population.length};
  if(publishers.length<2)return {...empty,...counts};
  if(live){const times=[inputTime,...population.map(item=>Date.parse(item.publishedAt!))];
    if(Math.max(...times)-Math.min(...times)>3*86400000)return {...empty,...counts,status:'inconsistent_period' as const};}
  const weighted=publishers.flatMap(items=>items.map(item=>({bounds:voiceCoordinateBounds(item)!,weight:1/publishers.length/items.length})));
  const {median:baseline,baselineBounds}=weightedIntervalDistribution(weighted);
  const baselineUncertain=baselineBounds.upper-baselineBounds.lower>.5+1e-12;
  const {lower:lowerDistance,upper:upperDistance}=intervalDistance(inputBounds,baselineBounds);
  const point=inputBounds.lower===inputBounds.upper&&baselineBounds.lower===baselineBounds.upper;
  const score=point?Math.round(lowerDistance/2*100):null;
  const scoreBounds=point?{lower:score!,upper:score!}:{lower:Math.floor(lowerDistance/2*100+1e-10),upper:Math.ceil(upperDistance/2*100-1e-10)};
  const direction=baselineUncertain?'undetermined' as const:inputBounds.lower>baselineBounds.upper?'support' as const:inputBounds.upper<baselineBounds.lower?'oppose' as const
    :point?'center' as const:'undetermined' as const;
  // Range inputs can rank whole candidate intervals, without inventing a center point.
  const opposite=population.filter(item=>direction==='support'?voiceCoordinateBounds(item)!.upper<baselineBounds.lower
    :direction==='oppose'?voiceCoordinateBounds(item)!.lower>baselineBounds.upper:false);
  const target={lower:2*baselineBounds.lower-inputBounds.upper,upper:2*baselineBounds.upper-inputBounds.lower};
  const opposing=opposite.sort((a,b)=>intervalDistance(voiceCoordinateBounds(a)!,target).lower
    -intervalDistance(voiceCoordinateBounds(b)!,target).lower);
  const samePoint=(bounds:CoordinateInterval)=>baseline!==null&&bounds.lower===bounds.upper&&bounds.lower===baseline;
  const similar=population.filter(item=>{
    const bounds=voiceCoordinateBounds(item)!;
    return direction==='support'?bounds.lower>baselineBounds.upper||samePoint(bounds)
      :direction==='oppose'?bounds.upper<baselineBounds.lower||samePoint(bounds):direction==='center';
  })
    .sort((a,b)=>intervalDistance(voiceCoordinateBounds(a)!,inputBounds).lower
      -intervalDistance(voiceCoordinateBounds(b)!,inputBounds).lower);
  return {status:'ready' as const,score,scoreBounds,direction,magnitude:point?lowerDistance:null,baseline,baselineBounds,baselineUncertain,opposing,similar,
    ...counts};
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
