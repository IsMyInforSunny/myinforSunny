import {summarizeVoices,type VoiceDocument,type VoiceTopic,VOICE_VERSION} from './sentence-voice';

export type VoiceCoordinate={id:string;url:string;publisher:string;bodyHash:string;eventId:string;topic:VoiceTopic;issue:string;
  method:'ai'|'svm';modelVersion:string;version:string;coordinate:number;directional:number;unresolved:number;trainingOriginal:boolean};
/** Same sub-issue, event, encoder/version and scope. Equal weight per publisher; never publisher rankings. */
export function compareVoiceCoordinates(input:VoiceCoordinate,articles:VoiceCoordinate[],trainingHashes:readonly string[]=[]){
  const empty={status:'insufficient' as 'insufficient'|'ready'|'input_unresolved',score:null as number|null,
    baseline:null as number|null,opposing:[] as VoiceCoordinate[],similar:[] as VoiceCoordinate[],count:0,publisherCount:0};
  const eligible=(item:VoiceCoordinate)=>Number.isFinite(item.coordinate)&&Math.abs(item.coordinate)<=1&&item.directional>=3
    &&item.unresolved===0&&!item.trainingOriginal&&!trainingHashes.includes(item.bodyHash)&&!!item.bodyHash&&!!item.eventId&&item.version===VOICE_VERSION;
  if(!eligible(input))return {...empty,status:'input_unresolved' as const};
  const seen=new Set([input.bodyHash]),urls=new Set([input.url]);
  const candidates=articles.filter(item=>{
    if(item.id===input.id||!eligible(item)||item.eventId!==input.eventId||item.topic!==input.topic||item.issue!==input.issue
      ||item.method!==input.method||item.modelVersion!==input.modelVersion||item.version!==input.version||seen.has(item.bodyHash)||urls.has(item.url))return false;
    seen.add(item.bodyHash);urls.add(item.url);return true;
  });
  const groups=new Map<string,VoiceCoordinate[]>();
  for(const item of candidates)groups.set(item.publisher,[...(groups.get(item.publisher)??[]),item]);
  // Preserve repository's stricter comparison gate: >=3 unique articles per eligible publisher, >=2 publishers.
  const publishers=[...groups.values()].filter(items=>items.length>=3),population=publishers.flat();
  if(publishers.length<2)return {...empty,count:population.length,publisherCount:publishers.length};
  const weighted=publishers.flatMap(items=>items.map(item=>({item,weight:1/publishers.length/items.length}))).sort((a,b)=>a.item.coordinate-b.item.coordinate);
  let sum=0,baseline=weighted[weighted.length-1].item.coordinate;
  for(let i=0;i<weighted.length;i++){
    sum+=weighted[i].weight;
    if(sum>=.5-1e-12){baseline=Math.abs(sum-.5)<1e-12&&weighted[i+1]?(weighted[i].item.coordinate+weighted[i+1].item.coordinate)/2:weighted[i].item.coordinate;break;}
  }
  const delta=input.coordinate-baseline,target=2*baseline-input.coordinate;
  const opposing=population.filter(item=>(item.coordinate-baseline)*delta<0).sort((a,b)=>Math.abs(a.coordinate-target)-Math.abs(b.coordinate-target));
  const similar=population.filter(item=>(item.coordinate-baseline)*delta>0).sort((a,b)=>Math.abs(a.coordinate-input.coordinate)-Math.abs(b.coordinate-input.coordinate));
  return {status:'ready' as const,score:Math.round(Math.abs(delta)/2*100),baseline,opposing,similar,count:population.length,publisherCount:publishers.length};
}
export function mainVoiceIssue(body:string,document:VoiceDocument){
  const summary=summarizeVoices(body,document);if(!summary)return null;
  const ranked=[...summary.issues].sort((a,b)=>b.directional-a.directional);
  // Tied leading issues must be selected explicitly; never collapse unrelated propositions.
  if(!ranked[0]?.directional||ranked[0].directional===ranked[1]?.directional)return null;
  return {...ranked[0],method:summary.method,modelVersion:summary.modelVersion,topic:summary.topic};
}
