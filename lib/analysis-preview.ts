import type {TextRequest} from './contracts';
import {makeSources,naturalSentenceCount} from './domain';
import {fomoSignals} from './fomo-signals';
import {reviewCitedSources} from './cited-sources';
import {classifyRelativeTopic} from './relative-metrics';
import {VOICE_TOPICS} from './sentence-voice';

export type AnalysisPreview={characters:number;sentences:number;fomoSentences:number;namedSources:number;topic:string|null};
export function buildAnalysisPreview(input:TextRequest,title?:string):AnalysisPreview{
  const sources=makeSources(input);
  const topic=classifyRelativeTopic(input.body,title);
  const cited=reviewCitedSources({sources,claims:[]});
  return {characters:input.body.length,sentences:naturalSentenceCount(sources),
    fomoSentences:fomoSignals({sources}).flaggedSentences,
    namedSources:new Set(cited.sources.filter(source=>source.signals.named).map(source=>source.name)).size,
    topic:topic?VOICE_TOPICS[topic].label:null};
}
