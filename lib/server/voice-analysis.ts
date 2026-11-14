import artifact from '../data/voice-model.json';
import type {Analysis} from '../contracts';
import {classifyRelativeTopic} from '../relative-metrics';
import {inferVoices,parseVoiceModel,summarizeVoices,voiceArticleHash,type VoiceDocument,type VoiceModel} from '../sentence-voice';
import type {VoiceCoordinate} from '../voice-comparison';
import {compareEventBaseline} from './event-comparison';
import {canonicalPublisherHost} from '../source-reliability';
import {liveVoiceEventId,matchLiveVoiceEvent} from '../live-voice-event';
import type {VoiceArticleContext} from './voice-article-context';
import {inferEmbeddingVoices,releasedEmbeddingVoiceModel} from './voice-embedding';
import type {RuntimeConfig} from './config';
import {AppError} from './errors';

// Experimental weights never enter this module or the browser bundle.
export const releasedVoiceModel=parseVoiceModel(artifact);
export {releasedEmbeddingVoiceModel};
export const releasedVoiceTopics=[...new Set([...Object.keys(releasedVoiceModel?.topics??{}),...Object.keys(releasedEmbeddingVoiceModel?.topics??{})])];
type Article={url?:string;title?:string;publishedAt?:string};

/** Full retrieved body, before an excerpt is selected; the released semantic
 * model requires the provider lease and never silently uses another model. */
export async function analyzeArticleVoices(body:string,article:Article={},model:VoiceModel|null=releasedVoiceModel,anchor?:VoiceArticleContext&{body:string},runtime?:{config:RuntimeConfig;signal:AbortSignal}){
  const topic=classifyRelativeTopic(body,article.title);
  if(releasedEmbeddingVoiceModel&&topic&&releasedEmbeddingVoiceModel.topics[topic]){
    if(!runtime)throw new AppError(503,'FEATURE_UNAVAILABLE','편향 모델의 서버 연결을 확인해 주세요.');
    const document=await inferEmbeddingVoices(body,topic,runtime.config,runtime.signal,`public:${article.url??''}`);
    return document?{document,coordinates:await articleVoiceCoordinates(body,document,article,releasedEmbeddingVoiceModel.trainingArticleHashes,anchor)}:null;
  }
  if(!model||!topic||!model.topics[topic])return null;
  const document=inferVoices(model,body,topic);
  return document?{document,coordinates:await articleVoiceCoordinates(body,document,article,model.trainingArticleHashes,anchor)}:null;
}

/** Server-owned event ID and training-original exclusion travel with the result.
 * A matching topic alone never establishes the same event. */
export async function articleVoiceCoordinates(body:string,document:VoiceDocument,article:Article,trainingHashes:readonly string[],anchor?:VoiceArticleContext&{body:string}):Promise<VoiceCoordinate[]>{
  const summary=summarizeVoices(body,document);
  if(!summary||document.method!=='svm')return [];
  const bodyHash=await voiceArticleHash(body);
  const event=compareEventBaseline({body,title:article.title,publishedAt:article.publishedAt});
  const liveMatch=anchor?matchLiveVoiceEvent({body:anchor.body,...anchor.article},{body,...article}):null;
  const eventId=anchor?(liveMatch?.status==='matched'?liveVoiceEventId(anchor.bodyHash):''):event.event?.id??'';
  let url='',publisher='input';
  if(article.url){
    try{
      const parsed=new URL(article.url);
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)return [];
      parsed.hash='';publisher=canonicalPublisherHost(parsed.hostname);parsed.hostname=publisher;url=parsed.href;
    }catch{return [];}
  }
  return summary.issues.flatMap(issue=>issue.coordinate===null?[]:[{
    id:url||bodyHash,url,publisher,bodyHash,eventId,topic:document.topic,issue:issue.issue,publishedAt:article.publishedAt,
    method:document.method,modelVersion:document.modelVersion,version:document.version,
    coordinate:issue.coordinate,directional:issue.directional,unresolved:summary.unresolved,
    trainingOriginal:trainingHashes.includes(bodyHash),
  }]);
}

/** URL import adds publication metadata after core analysis without another inference. */
export async function attachVoiceCoordinates(analysis:Analysis,model?:{trainingArticleHashes:string[]}|null){
  const body=analysis.sources.find(source=>source.kind==='body')?.text;
  const selected=model===undefined?(analysis.sentenceVoices?.modelVersion===releasedEmbeddingVoiceModel?.version?releasedEmbeddingVoiceModel:releasedVoiceModel):model;
  if(selected&&body&&analysis.sentenceVoices)
    analysis.voiceCoordinates=await articleVoiceCoordinates(body,analysis.sentenceVoices,analysis.article??{},selected.trainingArticleHashes);
  if(analysis.article?.url&&analysis.article.publishedAt&&Number.isFinite(Date.parse(analysis.article.publishedAt)))
    analysis.voiceCoordinates=analysis.voiceCoordinates?.map(item=>({...item,eventId:liveVoiceEventId(item.bodyHash),publishedAt:analysis.article!.publishedAt}));
  return analysis;
}
