import data from './data/relative-baselines.json';
import {classifyRelativeTopic, computeRelativeMetrics, relativeMetricVersions, RELATIVE_SCOPE_CHARACTERS} from './relative-metrics';
import {ARTICLE_FORMAT_VERSION,classifyArticleFormat,type ArticleFormatId} from './article-comparison-groups';

export type PercentileBoundary = {percentile:number;value:number;belowPercent:number;atOrBelowPercent:number};
export type RelativeBaselines = {
  schemaVersion:string;version:string;generatedAt:string;scopeCharacters:number;
  metricVersions:typeof relativeMetricVersions;
  articlePeriod:{from:string;through:string;timeZone:string};sourceArticleCount:number;publisherCount:number;
  formatRulesVersion?:string;
  formatCounts?:{id:ArticleFormatId;label:string;n:number}[];
  topics:{id:string;label:string;n:number;publisherCount:number;
    metrics:{fomo:{boundaries:PercentileBoundary[]};attribution:{boundaries:PercentileBoundary[]}};
    formats?:{id:ArticleFormatId;label:string;n:number;publisherCount:number;metrics:{fomo:{boundaries:PercentileBoundary[]};attribution:{boundaries:PercentileBoundary[]}}}[]}[];
};
const baseline = data as RelativeBaselines;

/** Ties use the midpoint of their weighted ranks. Between stored boundaries show a range. */
export function percentilePosition(value:number,boundaries:PercentileBoundary[]) {
  if(!Number.isFinite(value)||!boundaries.length)return null;
  const equal=boundaries.find(boundary=>boundary.value===value);
  const round=(number:number)=>Math.round(number*10)/10;
  if(equal)return {lower:round((equal.belowPercent+equal.atOrBelowPercent)/2),
    upper:round((equal.belowPercent+equal.atOrBelowPercent)/2),ties:round(equal.atOrBelowPercent-equal.belowPercent)};
  const lower=[...boundaries].reverse().find(boundary=>boundary.value<value)?.atOrBelowPercent??0;
  const upper=boundaries.find(boundary=>boundary.value>value)?.belowPercent??100;
  return {lower:round(lower),upper:round(upper),ties:null};
}

export function compareRelativeBaseline(body:string,title='',reference:RelativeBaselines=baseline) {
  const metrics=computeRelativeMetrics(body);
  const topicId=classifyRelativeTopic(body,title);
  const topic=reference.topics.find(item=>item.id===topicId);
  const format=classifyArticleFormat({body,title});
  const sameFormat=reference.formatRulesVersion===ARTICLE_FORMAT_VERSION&&format.id!=='unknown'
    ?topic?.formats?.find(item=>item.id===format.id):undefined;
  const formatEligible=!!sameFormat&&sameFormat.n>=30;
  const population=formatEligible?sameFormat!:topic;
  const compatible=reference.scopeCharacters===RELATIVE_SCOPE_CHARACTERS
    && Object.entries(relativeMetricVersions).every(([key,value])=>reference.metricVersions[key as keyof typeof relativeMetricVersions]===value);
  const status=!compatible?'incompatible':!topic?'unknown_topic':population!.n<(formatEligible?30:100)?'insufficient':!metrics.totalSentences?'empty':'ready';
  return {status,version:reference.version,metricVersions:reference.metricVersions,scopeCharacters:reference.scopeCharacters,
    articlePeriod:reference.articlePeriod,topic:topic?{id:topic.id,label:topic.label,n:topic.n,publisherCount:topic.publisherCount}:null,
    format:{...format,used:formatEligible,n:sameFormat?.n??0,note:formatEligible?'같은 형식끼리 비교':'형식 구분 없이 비교'},
    population:population?{n:population.n,publisherCount:population.publisherCount}:null,
    fomo:{...metrics.fomo,position:status==='ready'&&metrics.fomo.value!==null?percentilePosition(metrics.fomo.value,population!.metrics.fomo.boundaries):null},
    attribution:{...metrics.attribution,position:status==='ready'&&metrics.attribution.value!==null?percentilePosition(metrics.attribution.value,population!.metrics.attribution.boundaries):null}};
}
