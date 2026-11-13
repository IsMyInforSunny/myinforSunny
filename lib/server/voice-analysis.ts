import artifact from '../data/voice-model.json';
import type {Analysis} from '../contracts';
import {classifyRelativeTopic} from '../relative-metrics';
import {inferVoices,parseVoiceModel,summarizeVoices,voiceArticleHash,type VoiceDocument,type VoiceModel} from '../sentence-voice';
import type {VoiceCoordinate} from '../voice-comparison';
import {compareEventBaseline} from './event-comparison';
import {canonicalPublisherHost} from '../source-reliability';

// Experimental weights never enter this module or the browser bundle.
export const releasedVoiceModel=parseVoiceModel(artifact);
type Article={url?:string;title?:string;publishedAt?:string};

/** Full retrieved body, before a research excerpt is selected. No AI call. */
export async function analyzeArticleVoices(body:string,article:Article={},model:VoiceModel|null=releasedVoiceModel){
  const topic=classifyRelativeTopic(body,article.title);
  if(!model||!topic||!model.topics[topic])return null;
  const document=inferVoices(model,body,topic);
  return document?{document,coordinates:await articleVoiceCoordinates(body,document,article,model.trainingArticleHashes)}:null;
}

/** Server-owned event ID and training-original exclusion travel with the result.
 * A matching topic alone never establishes the same event. */
export async function articleVoiceCoordinates(body:string,document:VoiceDocument,article:Article,trainingHashes:readonly string[]):Promise<VoiceCoordinate[]>{
  const summary=summarizeVoices(body,document);
  if(!summary||document.method!=='svm')return [];
  const bodyHash=await voiceArticleHash(body);
  const event=compareEventBaseline({body,title:article.title,publishedAt:article.publishedAt});
  let url='',publisher='input';
  if(article.url){
    try{
      const parsed=new URL(article.url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)return [];
      parsed.hash='';publisher=canonicalPublisherHost(parsed.hostname);parsed.hostname=publisher;url=parsed.href;
    }catch{return [];}
  }
  return summary.issues.flatMap(issue=>issue.coordinate===null?[]:[{
    id:url||bodyHash,url,publisher,bodyHash,eventId:event.event?.id??'',topic:document.topic,issue:issue.issue,
    method:document.method,modelVersion:document.modelVersion,version:document.version,
    coordinate:issue.coordinate,directional:issue.directional,unresolved:summary.unresolved,
    trainingOriginal:trainingHashes.includes(bodyHash),
  }]);
}

/** URL import adds publication metadata after core analysis without another inference. */
export async function attachVoiceCoordinates(analysis:Analysis,model:VoiceModel|null=releasedVoiceModel){
  const body=analysis.sources.find(source=>source.kind==='body')?.text;
  if(model&&body&&analysis.sentenceVoices)
    analysis.voiceCoordinates=await articleVoiceCoordinates(body,analysis.sentenceVoices,analysis.article??{},model.trainingArticleHashes);
  return analysis;
}
