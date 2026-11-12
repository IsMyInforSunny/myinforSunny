import eventData from '../data/event-baselines.json';
import {findEventComparison,type EventBaselineIndex} from '../article-comparison-groups';
import {classifyRelativeTopic,computeRelativeMetrics,relativeMetricVersions} from '../relative-metrics';
import {percentilePosition} from '../relative-baselines';

/** Large hashed event vectors stay on the server, away from the initial UI bundle. */
export function compareEventBaseline(input:{body:string;title?:string;publishedAt?:string},index=eventData as unknown as EventBaselineIndex){
  const metrics=computeRelativeMetrics(input.body);
  const compatible=Object.entries(relativeMetricVersions).every(([key,value])=>index.metricVersions[key]===value);
  const result=findEventComparison({...input,topicId:classifyRelativeTopic(input.body,input.title)},index);
  const ready=compatible&&result.status==='matched';
  const event=ready?result.event:null;
  return {status:compatible?result.status:'incompatible',version:index.version,metricVersions:index.metricVersions,
    scopeCharacters:index.scopeCharacters,articlePeriod:index.articlePeriod,
    event:event?{id:event.id,n:event.n,publisherCount:event.publisherCount,start:event.start,through:event.through}:null,
    fomo:{...metrics.fomo,position:event&&metrics.fomo.value!==null?percentilePosition(metrics.fomo.value,event.metrics.fomo.boundaries):null},
    attribution:{...metrics.attribution,position:event&&metrics.attribution.value!==null?percentilePosition(metrics.attribution.value,event.metrics.attribution.boundaries):null}};
}
export type EventComparisonResult=ReturnType<typeof compareEventBaseline>;
