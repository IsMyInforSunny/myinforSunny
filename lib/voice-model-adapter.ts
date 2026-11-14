import type {Analysis} from './contracts';
import type {ResearchVerification} from './research-contract';
import {currentResearch} from './current-research';
import {normalizeSourceUrl} from './source-quality';
import {canonicalPublisherHost} from './source-reliability';
import {compareVoiceCoordinates,mainVoiceIssue,type VoiceCoordinate} from './voice-comparison';

/** Only current, fetched, server-classified references form a comparison set.
 * Model weights stay on the server; these records contain aggregates only. */
export function voiceAssessmentFromResearch(analysis:Analysis|null,results:readonly ResearchVerification[]){
  const empty={status:'model_unavailable' as string,score:null as number|null,magnitude:null as number|null,baseline:null as number|null,
    count:0,publisherCount:0,similar:[] as VoiceCoordinate[],opposing:[] as VoiceCoordinate[],issue:null as string|null};
  if(!analysis||analysis.mode!=='live'||analysis.sentenceVoices?.method!=='svm')return empty;
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const primary=mainVoiceIssue(body,analysis.sentenceVoices);
  if(!primary)return {...empty,status:'no_single_issue'};
  const input=analysis.voiceCoordinates?.find(item=>item.issue===primary.issue&&item.topic===primary.topic
    &&item.modelVersion===primary.modelVersion&&item.method==='svm'&&item.decisionPolicy===primary.decisionPolicy);
  if(!input)return {...empty,status:'no_coordinate',issue:primary.issue};
  if(!input.eventId)return {...empty,status:'event_missing',issue:primary.issue};
  const current=currentResearch(analysis,results);
  // A new signed plan supersedes all records from older plans. Multiple fetch
  // bundles within the latest plan still contribute independent articles.
  const latest=current.at(-1);
  const active=latest?.researchPlanId?current.filter(result=>result.researchPlanId===latest.researchPlanId):latest?[latest]:[];
  const references=active.flatMap(result=>result.references);
  const candidates=references.flatMap(reference=>{
    if(reference.provenance!=='web_fetched'||!reference.fetchedAt||!reference.publishedAt||reference.retrievedTruncated!==false)return [];
    const url=normalizeSourceUrl(reference.url);
    if(url.status!=='ok'||!url.url||!url.host)return [];
    const publisher=canonicalPublisherHost(url.host);
    const canonical=(value:string)=>{
      const normalized=normalizeSourceUrl(value);
      if(normalized.status!=='ok'||!normalized.url)return null;
      const parsed=new URL(normalized.url);parsed.hostname=canonicalPublisherHost(parsed.hostname);return parsed.href;
    };
    const identity=canonical(url.url);
    return (reference.voiceCoordinates??[]).filter(item=>item.publisher===publisher&&canonical(item.url)===identity);
  });
  return {...compareVoiceCoordinates(input,candidates),issue:primary.issue};
}
export type VoiceAssessment=ReturnType<typeof voiceAssessmentFromResearch>;
