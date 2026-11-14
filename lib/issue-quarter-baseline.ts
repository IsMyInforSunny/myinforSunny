import definition from './data/voice-issues.json' with {type:'json'};
import type {VoiceTopic} from './sentence-voice';

export const ISSUE_QUARTER_BASELINE_VERSION = 'issue-quarter-baselines-1.0';
export const ARTICLE_ISSUE_POLICY = 'voice-article-issue-1.0';
export const MAX_COORDINATE_WIDTH = 0.5;
const DAY_MS = 86400000;
const PUBLISHERS = new Set(['dailian.co.kr','newdaily.co.kr','ohmynews.com','pressian.com']);

export type IssueQuarterArticle = {
  id:string; bodyHash:string; publisher:string; topic:VoiceTopic; issue:string;
  method:'ai'|'svm'; modelVersion:string; version:string; decisionPolicy?:string; issuePolicy?:string;
  axis?:'source'|'journalist'; coordinate:number|null; bounds?:{lower:number|null;upper:number|null}|null;
  directional:number; unresolved:number; trainingOriginal:boolean; publishedAt?:string;
  url?:string; title?:string; usageApproved?:boolean;
};
export type BaselinePeriod = {kind:'quarter'|'half'|'all'; key:string; label:string};
export type BaselineGroup = {
  topic:VoiceTopic; issue:string; method:'ai'|'svm'; modelVersion:string; version:string;
  decisionPolicy:string; issuePolicy:string; axis:'source'; period:BaselinePeriod;
  status:'ready'|'insufficient'; count:number; pointCount:number; rangeCount:number; publisherCount:number;
  publisherCounts:{publisher:string;pointCount:number;rangeCount:number}[];
  median:number|null; boundaries:{percentile:number;coordinate:number}[];
};
export type IssueQuarterBaselines = {
  schemaVersion:typeof ISSUE_QUARTER_BASELINE_VERSION; generatedAt:string; definitionVersion:string;
  researchOnly:true; usageReviewed:false; minimumArticlesPerPublisher:3; minimumPublishers:2;
  maximumRangeWidth:0.5; percentileBasis:'coordinate'; distributionPopulation:'point-coordinates-only';
  inputArticleCount:number; acceptedArticleCount:number; pointArticleCount:number; rangeArticleCount:number;
  exclusions:Record<string,number>; groups:BaselineGroup[];
};

function publisherIdentity(value:string) {
  const host=value.trim().toLowerCase().replace(/^(?:www\.|m\.)/,'');
  return host==='biz.newdaily.co.kr'?'newdaily.co.kr':host;
}
function issueExists(topic:string,issue:string) {
  const topics=definition.topics as Record<string,{issues:Record<string,string>}>;
  return !!topics[topic] && Object.hasOwn(topics[topic].issues,issue);
}
function versionKey(article:IssueQuarterArticle) {
  return [article.topic,article.issue,article.method,article.modelVersion,article.version,
    article.decisionPolicy??'voice-joint-1.0',article.issuePolicy??'legacy',article.axis??'combined'].join('\u001f');
}
/** Bounds remain bounds. An unresolved article without a bound cannot be a point. */
export function issueQuarterCoordinateRange(article:IssueQuarterArticle):{lower:number;upper:number}|null {
  if(!article||typeof article!=='object'||typeof article.id!=='string'||typeof article.bodyHash!=='string'
    ||!(/^[a-f0-9]{64}$/i.test(article.bodyHash))||typeof article.publisher!=='string'||!['svm','ai'].includes(article.method)
    ||typeof article.modelVersion!=='string'||article.axis!=='source'||article.issuePolicy!==ARTICLE_ISSUE_POLICY||article.trainingOriginal
    ||!article.bodyHash||!article.id||!article.modelVersion||article.version!==definition.version
    ||!issueExists(article.topic,article.issue)||!Number.isSafeInteger(article.directional)||article.directional<3
    ||!Number.isSafeInteger(article.unresolved)||article.unresolved<0)return null;
  if(article.bounds){
    const {lower,upper}=article.bounds;
    if(typeof lower!=='number'||typeof upper!=='number'||!Number.isFinite(lower)||!Number.isFinite(upper)
      ||lower < -1||upper > 1||lower>upper||upper-lower>MAX_COORDINATE_WIDTH+1e-12)return null;
    if(article.coordinate!==null&&(!Number.isFinite(article.coordinate)||article.coordinate<lower-1e-12||article.coordinate>upper+1e-12))return null;
    if(lower===upper&&article.unresolved>0)return null;
    return {lower,upper};
  }
  return article.unresolved===0&&typeof article.coordinate==='number'&&Number.isFinite(article.coordinate)&&Math.abs(article.coordinate)<=1
    ?{lower:article.coordinate,upper:article.coordinate}:null;
}

/** Calendar dates are checked before conversion, so invalid dates never normalize into another quarter. */
export function issueQuarterPeriods(publishedAt?:string):BaselinePeriod[] {
  if(!publishedAt)return [{kind:'all',key:'all',label:'전체 기간'}];
  const match=/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))?$/.exec(publishedAt);
  if(!match)return [{kind:'all',key:'all',label:'전체 기간'}];
  const [,yearText,monthText,dayText,hourText,minuteText,secondText]=match;
  const year=Number(yearText),month=Number(monthText),day=Number(dayText);
  const calendar=new Date(Date.UTC(year,month-1,day));
  if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day
    ||Number(hourText??0)>23||Number(minuteText??0)>59||Number(secondText??0)>59)return [{kind:'all',key:'all',label:'전체 기간'}];
  // Date-only publisher values identify a Korean calendar date.
  const timestamp=Date.parse(hourText===undefined?publishedAt+'T00:00:00+09:00':publishedAt);
  if(!Number.isFinite(timestamp))return [{kind:'all',key:'all',label:'전체 기간'}];
  const korean=new Date(timestamp+9*60*60*1000),y=korean.getUTCFullYear(),m=korean.getUTCMonth();
  const quarter=Math.floor(m/3)+1,half=Math.floor(m/6)+1;
  return [{kind:'quarter',key:`${y}-Q${quarter}`,label:`${y}년 ${quarter}분기`},
    {kind:'half',key:`${y}-H${half}`,label:`${y}년 ${half===1?'상반기':'하반기'}`},
    {kind:'all',key:'all',label:'전체 기간'}];
}

function weightedQuantile(points:{coordinate:number;weight:number}[],probability:number) {
  if(probability<=0)return points[0].coordinate;
  if(probability>=1)return points[points.length-1].coordinate;
  let sum=0;
  for(let index=0;index<points.length;index++){
    sum+=points[index].weight;
    if(sum>=probability-1e-12)return Math.abs(sum-probability)<1e-12&&points[index+1]
      ?(points[index].coordinate+points[index+1].coordinate)/2:points[index].coordinate;
  }
  return points[points.length-1].coordinate;
}

export function buildIssueQuarterBaselines(articles:IssueQuarterArticle[],options:{trainingHashes?:readonly string[];excludeInput?:IssueQuarterArticle;generatedAt?:string}={}):IssueQuarterBaselines {
  const exclusions:Record<string,number>={},accepted:IssueQuarterArticle[]=[],seenHashes=new Set<string>(),seenUrls=new Set<string>();
  const training=new Set(options.trainingHashes??[]),input=options.excludeInput;
  const reject=(reason:string)=>{exclusions[reason]=(exclusions[reason]??0)+1;};
  for(const article of articles){
    if(!article||typeof article!=='object'){reject('invalid_record');continue;}
    if(training.has(article.bodyHash)||article.trainingOriginal){reject('training_original');continue;}
    if(input&&(article.id===input.id||article.bodyHash===input.bodyHash||!!input.url&&article.url===input.url)){reject('input_article');continue;}
    const range=issueQuarterCoordinateRange(article);
    if(!range){reject('ineligible_coordinate');continue;}
    const publisher=publisherIdentity(article.publisher);
    if(!PUBLISHERS.has(publisher)){reject('outside_four_publishers');continue;}
    const identity=[article.method,article.modelVersion,article.version,article.decisionPolicy??'voice-joint-1.0',article.issuePolicy,article.axis].join('|');
    const hashKey=identity+'|'+article.bodyHash,urlKey=article.url?identity+'|'+article.url:null;
    if(seenHashes.has(hashKey)||!!urlKey&&seenUrls.has(urlKey)){reject('duplicate_article');continue;}
    seenHashes.add(hashKey);if(urlKey)seenUrls.add(urlKey);
    accepted.push({...article,publisher});
  }
  const grouped=new Map<string,{period:BaselinePeriod;rows:IssueQuarterArticle[]}>();
  for(const article of accepted)for(const period of issueQuarterPeriods(article.publishedAt)){
    const key=versionKey(article)+'\u001f'+period.key;
    const current=grouped.get(key)??{period,rows:[]};current.rows.push(article);grouped.set(key,current);
  }
  const groups:BaselineGroup[]=[];
  for(const {period,rows} of grouped.values()){
    const publishers=new Map<string,{points:IssueQuarterArticle[];ranges:IssueQuarterArticle[]}>();
    for(const row of rows){
      const group=publishers.get(row.publisher)??{points:[],ranges:[]};
      const range=issueQuarterCoordinateRange(row)!;
      (range.lower===range.upper?group.points:group.ranges).push(row);publishers.set(row.publisher,group);
    }
    // A range cannot satisfy the point-distribution sample threshold by its midpoint.
    const eligible=[...publishers.entries()].filter(([,group])=>group.points.length>=3);
    const ready=eligible.length>=2;
    const selected=ready?eligible:[...publishers.entries()];
    const publisherCounts=selected.map(([publisher,group])=>({publisher,pointCount:group.points.length,rangeCount:group.ranges.length})).sort((a,b)=>a.publisher.localeCompare(b.publisher));
    const pointCount=publisherCounts.reduce((sum,group)=>sum+group.pointCount,0),rangeCount=publisherCounts.reduce((sum,group)=>sum+group.rangeCount,0);
    const weighted=ready?eligible.flatMap(([,group])=>group.points.map(row=>({coordinate:issueQuarterCoordinateRange(row)!.lower,weight:1/eligible.length/group.points.length}))).sort((a,b)=>a.coordinate-b.coordinate):[];
    const first=rows[0];
    groups.push({topic:first.topic,issue:first.issue,method:first.method,modelVersion:first.modelVersion,version:first.version,
      decisionPolicy:first.decisionPolicy??'voice-joint-1.0',issuePolicy:first.issuePolicy!,axis:'source',period,
      status:ready?'ready':'insufficient',count:pointCount+rangeCount,pointCount,rangeCount,publisherCount:eligible.length,publisherCounts,
      median:ready?weightedQuantile(weighted,.5):null,
      boundaries:ready?Array.from({length:21},(_,index)=>({percentile:index*5,coordinate:weightedQuantile(weighted,index/20)})):[]});
  }
  groups.sort((a,b)=>[a.topic,a.issue,a.modelVersion,a.decisionPolicy,a.period.key].join('|').localeCompare([b.topic,b.issue,b.modelVersion,b.decisionPolicy,b.period.key].join('|')));
  const rangeArticleCount=accepted.filter(row=>{const range=issueQuarterCoordinateRange(row)!;return range.lower!==range.upper;}).length;
  return {schemaVersion:ISSUE_QUARTER_BASELINE_VERSION,generatedAt:options.generatedAt??new Date().toISOString(),definitionVersion:definition.version,
    researchOnly:true,usageReviewed:false,minimumArticlesPerPublisher:3,minimumPublishers:2,maximumRangeWidth:.5,
    percentileBasis:'coordinate',distributionPopulation:'point-coordinates-only',inputArticleCount:articles.length,
    acceptedArticleCount:accepted.length,pointArticleCount:accepted.length-rangeArticleCount,rangeArticleCount,exclusions,groups};
}

/** Boundary precision is 5 percentage points. Ties retain the full compatible rank interval. */
function rankBounds(value:number,boundaries:BaselineGroup['boundaries']) {
  let lower=0,upper=100;
  for(const boundary of boundaries){
    if(boundary.coordinate<value)lower=Math.max(lower,boundary.percentile);
    if(boundary.coordinate>value)upper=Math.min(upper,boundary.percentile);
  }
  return {lower,upper};
}
function groupMatches(input:IssueQuarterArticle,group:BaselineGroup) {
  return group.topic===input.topic&&group.issue===input.issue&&group.method===input.method&&group.modelVersion===input.modelVersion
    &&group.version===input.version&&group.decisionPolicy===(input.decisionPolicy??'voice-joint-1.0')
    &&group.issuePolicy===input.issuePolicy&&group.axis===input.axis;
}
function emptyComparison(status:'input_unresolved'|'insufficient'|'version_mismatch'|'membership_unverified'|'input_in_population') {
  return {status,score:null as number|null,scoreRange:null as {lower:number;upper:number}|null,
    baseline:null as number|null,direction:'undetermined' as 'above'|'below'|'at_baseline'|'undetermined',
    percentile:null as {lower:number;upper:number}|null,topPercentile:null as {lower:number;upper:number}|null,
    count:0,pointCount:0,rangeCount:0,publisherCount:0,publisherCounts:[] as BaselineGroup['publisherCounts'],
    period:null as BaselinePeriod|null,widened:false,comparisonLabel:'비교 기사 부족',fallbackReason:null as string|null};
}
function validDistribution(group:BaselineGroup) {
  if(group.publisherCount<2||group.publisherCounts.length!==group.publisherCount
    ||new Set(group.publisherCounts.map(item=>item.publisher)).size!==group.publisherCount
    ||group.publisherCounts.some(item=>!PUBLISHERS.has(item.publisher)||!Number.isSafeInteger(item.pointCount)||item.pointCount<3
      ||!Number.isSafeInteger(item.rangeCount)||item.rangeCount<0)
    ||group.pointCount!==group.publisherCounts.reduce((sum,item)=>sum+item.pointCount,0)
    ||group.rangeCount!==group.publisherCounts.reduce((sum,item)=>sum+item.rangeCount,0)
    ||group.count!==group.pointCount+group.rangeCount||group.median===null||!Number.isFinite(group.median)||Math.abs(group.median)>1
    ||group.boundaries.length!==21)return false;
  return group.boundaries.every((item,index)=>item.percentile===index*5&&Number.isFinite(item.coordinate)&&Math.abs(item.coordinate)<=1
    &&(!index||item.coordinate>=group.boundaries[index-1].coordinate))&&group.boundaries[10].coordinate===group.median;
}
export function compareIssueQuarterBaseline(input:IssueQuarterArticle,bundle:IssueQuarterBaselines,options:{corpusArticleHashes?:readonly string[];trainingHashes?:readonly string[];inputExcluded?:boolean}={}) {
  const range=issueQuarterCoordinateRange(input);
  if(!range||options.trainingHashes?.includes(input.bodyHash))return emptyComparison('input_unresolved');
  if(bundle.schemaVersion!==ISSUE_QUARTER_BASELINE_VERSION||bundle.definitionVersion!==definition.version)return emptyComparison('version_mismatch');
  if(!options.inputExcluded){
    if(!options.corpusArticleHashes)return emptyComparison('membership_unverified');
    if(options.corpusArticleHashes.includes(input.bodyHash))return emptyComparison('input_in_population');
  }
  const matching=bundle.groups.filter(group=>groupMatches(input,group));
  if(!matching.length)return emptyComparison(bundle.groups.some(group=>group.topic===input.topic&&group.issue===input.issue)?'version_mismatch':'insufficient');
  const periods=issueQuarterPeriods(input.publishedAt);
  const selected=periods.flatMap(period=>matching.filter(group=>group.period.key===period.key&&group.status==='ready'))[0];
  if(!selected||!validDistribution(selected)||selected.median===null)return emptyComparison('insufficient');
  const baseline=selected.median,point=range.lower===range.upper;
  const near=range.lower<=baseline&&range.upper>=baseline?0:Math.min(Math.abs(range.lower-baseline),Math.abs(range.upper-baseline));
  const far=Math.max(Math.abs(range.lower-baseline),Math.abs(range.upper-baseline));
  const scoreRange={lower:Math.max(0,Math.floor(near*50+1e-10)),upper:Math.min(100,Math.ceil(far*50-1e-10))};
  const lowRank=rankBounds(range.lower,selected.boundaries),highRank=rankBounds(range.upper,selected.boundaries);
  const percentile={lower:lowRank.lower,upper:highRank.upper},topPercentile={lower:100-percentile.upper,upper:100-percentile.lower};
  const direction=range.lower>baseline?'above' as const:range.upper<baseline?'below' as const:point?'at_baseline' as const:'undetermined' as const;
  const widened=selected.period.key!==periods[0].key;
  const proposition=(definition.topics[input.topic].issues as Record<string,string>)[input.issue];
  return {status:'ready' as const,score:point?Math.round(near*50):null,scoreRange,baseline,direction,percentile,topPercentile,
    count:selected.count,pointCount:selected.pointCount,rangeCount:selected.rangeCount,publisherCount:selected.publisherCount,publisherCounts:selected.publisherCounts,
    period:selected.period,widened,comparisonLabel:`같은 쟁점(${proposition})을 다룬 ${selected.publisherCount}개 매체 기사 ${selected.count}건(${selected.period.label})과 비교`,
    fallbackReason:widened?`${periods[0].label} 표본 부족으로 ${selected.period.label}과 비교`:null};
}
export function compareAgainstIssueQuarterArticles(input:IssueQuarterArticle,articles:IssueQuarterArticle[],trainingHashes:readonly string[]=[]) {
  const bundle=buildIssueQuarterBaselines(articles,{trainingHashes,excludeInput:input});
  return compareIssueQuarterBaseline(input,bundle,{trainingHashes,inputExcluded:true});
}

export type IssueQuarterRecommendation = {id:string;title:string;url:string;publisher:string;publishedAt?:string};
/** Recommendations remain local unless each item's existing usage flag permits display. */
export function recommendIssueQuarterArticles(input:IssueQuarterArticle,articles:IssueQuarterArticle[],options:{trainingHashes?:readonly string[];localOnly?:boolean}={}) {
  const comparison=compareAgainstIssueQuarterArticles(input,articles,options.trainingHashes);
  const empty={comparison,opposing:[] as IssueQuarterRecommendation[],similar:[] as IssueQuarterRecommendation[]};
  if(comparison.status!=='ready'||comparison.baseline===null||!comparison.period)return empty;
  const range=issueQuarterCoordinateRange(input)!;
  if(comparison.direction!=='above'&&comparison.direction!=='below')return empty;
  const baseline=comparison.baseline;
  const mirror={lower:2*baseline-range.upper,upper:2*baseline-range.lower};
  const distance=(candidate:{lower:number;upper:number},target:{lower:number;upper:number})=>Math.max(0,target.lower-candidate.upper,candidate.lower-target.upper);
  const side=(candidate:{lower:number;upper:number})=>candidate.lower>baseline?'above':candidate.upper<baseline?'below':'undetermined';
  const publishers=new Set(comparison.publisherCounts.map(group=>group.publisher)),seenHashes=new Set([input.bodyHash]),seenUrls=new Set(input.url?[input.url]:[]);
  const candidates=articles.filter(article=>{
    const coordinate=issueQuarterCoordinateRange(article);
    if(!coordinate||article.id===input.id||!article.url||!article.title
      ||!options.localOnly&&article.usageApproved!==true||options.trainingHashes?.includes(article.bodyHash)
      ||!publishers.has(publisherIdentity(article.publisher))||versionKey(article)!==versionKey(input)
      ||!issueQuarterPeriods(article.publishedAt).some(period=>period.key===comparison.period!.key)
      ||seenHashes.has(article.bodyHash)||seenUrls.has(article.url))return false;
    try{const url=new URL(article.url);if(url.protocol!=='https:'||url.username||url.password||url.port)return false;}catch{return false;}
    seenHashes.add(article.bodyHash);seenUrls.add(article.url);return true;
  });
  const display=(article:IssueQuarterArticle):IssueQuarterRecommendation=>({id:article.id,title:article.title!,url:article.url!,publisher:publisherIdentity(article.publisher),publishedAt:article.publishedAt});
  return {comparison,
    opposing:candidates.filter(article=>{const candidateSide=side(issueQuarterCoordinateRange(article)!);return candidateSide!=='undetermined'&&candidateSide!==comparison.direction;})
      .sort((a,b)=>distance(issueQuarterCoordinateRange(a)!,mirror)-distance(issueQuarterCoordinateRange(b)!,mirror)||a.id.localeCompare(b.id)).slice(0,3).map(display),
    similar:candidates.filter(article=>side(issueQuarterCoordinateRange(article)!)===comparison.direction)
      .sort((a,b)=>distance(issueQuarterCoordinateRange(a)!,range)-distance(issueQuarterCoordinateRange(b)!,range)||a.id.localeCompare(b.id)).slice(0,3).map(display)};
}
