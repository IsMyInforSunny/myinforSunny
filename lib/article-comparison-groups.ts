import {articleTextPrefix} from './server/article-document';

export const ARTICLE_FORMAT_VERSION = 'article-format-1.0';
export const EVENT_GROUPING_VERSION = 'event-groups-1.0';
export const EVENT_TOKENIZER_VERSION = 'event-terms-1.0';
export const ARTICLE_FORMATS = [
  {id:'report',label:'보도'}, {id:'opinion',label:'사설·칼럼·기고'},
  {id:'interview',label:'인터뷰'}, {id:'other',label:'기타'}, {id:'unknown',label:'형식 미확인'},
] as const;
export type ArticleFormatId = typeof ARTICLE_FORMATS[number]['id'];
export type ArticleFormat = {id:ArticleFormatId;label:string;evidence:'title_prefix'|'section'|'body_prefix'|'qa'|'none';opinion:boolean};

/** Explicit editorial markers precede section and body cues. Missing cues stay unknown. */
export function classifyArticleFormat({title='',section='',body=''}:{title?:string;section?:string;body?:string}):ArticleFormat {
  const patterns: [ArticleFormatId, RegExp][] = [
    ['opinion', /사설|칼럼|기고|시론|논단|논평|기자수첩|오피니언|editorial|column/i],
    ['interview', /인터뷰|interview|대담|문답/i],
    ['other', /포토|사진|영상|만평|인사|부고|날씨|동정|공지/i],
    ['report', /보도|일반기사|스트레이트|news\s?report/i],
  ];
  const result=(id:ArticleFormatId,evidence:ArticleFormat['evidence']):ArticleFormat=>({id,
    label:ARTICLE_FORMATS.find(item=>item.id===id)!.label,evidence,opinion:id==='opinion'});
  const prefix=/^\s*[\[［(（【〈<]([^\]］)）】〉>]{1,45})[\]］)）】〉>]/.exec(title)?.[1]
    ?? /^\s*([^:：—]{1,15})[:：—]/.exec(title)?.[1];
  if(prefix)for(const [id,pattern] of patterns)if(pattern.test(prefix))return result(id,'title_prefix');
  const sections=section.split(/[\/|>,·]/).map(value=>value.trim());
  if(section)for(const [id,pattern] of patterns)
    if(sections.some(value=>new RegExp(`^(?:${pattern.source})$`,pattern.flags).test(value)))return result(id,'section');
  const opening=body.slice(0,400);
  const bodyMarker=/^\s*(사설|칼럼|기고|인터뷰|대담|문답|보도자료)\s*[:：—-]/.exec(opening)?.[1];
  if(bodyMarker)for(const [id,pattern] of patterns)if(pattern.test(bodyMarker))return result(id,'body_prefix');
  if(/(?:^|\n)\s*(?:Q[.：:]|질문[：:])[\s\S]{1,300}(?:\n|\s)(?:A[.：:]|답변[：:])/.test(opening))return result('interview','qa');
  if(/^\s*\([^\n)]{2,30}=\s*[^\n)]{2,20}\)\s*[^\n=]{1,30}기자\s*=/.test(opening))return result('report','body_prefix');
  return result('unknown','none');
}

const STOP_WORDS=new Set('그리고 그러나 하지만 또는 대한 대해 위해 통해 관련 이번 지난 올해 기자 기사 뉴스 보도 따르면 밝혔다 말했다 한다 있다 있는 것으로 것이다 이다 입니다 합니다 등의 것을 같이 부터 까지 우리 그동안 이날 때문 경우 위해서 the and for with from this that have has was were are not into more will said news'.split(' '));
const PARTICLE=/(?:으로부터|으로서|에서는|에서도|으로|에서|에게|부터|까지|이라고|라고|은|는|이|가|을|를|의|와|과|도|로)$/;

/** Deterministic 64-bit digest avoids publishing original token strings. */
function tokenHash(token:string) {
  let hash=BigInt('14695981039346656037');
  const prime=BigInt('1099511628211'),mask=BigInt('18446744073709551615');
  for(let at=0;at<token.length;at++)hash=((hash^BigInt(token.charCodeAt(at)))*prime)&mask;
  return hash.toString(16).padStart(16,'0');
}

export function eventTermCounts(text:string):Record<string,number> {
  const counts:Record<string,number>={};
  for(const original of text.normalize('NFKC').toLowerCase().match(/[가-힣a-z][가-힣a-z0-9]{1,29}/g)??[]){
    const stripped=original.replace(PARTICLE,'');
    const term=stripped.length>=2?stripped:original;
    if(STOP_WORDS.has(term))continue;
    const hash=tokenHash(term);counts[hash]=(counts[hash]??0)+1;
  }
  return counts;
}

export type EventVector=[string,number][];
export type EventDocument={body:EventVector;title:EventVector};
export const EVENT_RULES={version:EVENT_GROUPING_VERSION,tokenizer:EVENT_TOKENIZER_VERSION,
  maximumDayDistance:3,minimumSimilarity:0.56,minimumTitleSimilarity:0.12,
  minimumArticles:3,minimumPublishers:2,bodyFeatures:128,titleFeatures:48,ambiguityMargin:0.04};

export function normalizeEventVector(values:EventVector,limit:number):EventVector {
  const selected=values.filter(([,value])=>Number.isFinite(value)&&value>0)
    .sort((left,right)=>right[1]-left[1]||left[0].localeCompare(right[0])).slice(0,limit);
  const length=Math.sqrt(selected.reduce((sum,[,value])=>sum+value*value,0));
  return length?selected.map(([token,value])=>[token,value/length]):[];
}

export function eventDocument(body:string,title:string,idf:Record<string,number>):EventDocument {
  const vector=(text:string,limit:number)=>{
    const weighted:EventVector=[];
    for(const [token,count] of Object.entries(eventTermCounts(text)))
      if(idf[token]!==undefined)weighted.push([token,(1+Math.log(count))*idf[token]]);
    return normalizeEventVector(weighted,limit);
  };
  return {body:vector(articleTextPrefix(body,2000),EVENT_RULES.bodyFeatures),title:vector(title,EVENT_RULES.titleFeatures)};
}

export function eventCosine(left:EventVector,right:EventVector):number {
  const lookup=new Map(right);
  return Math.min(1,Math.max(0,left.reduce((sum,[token,value])=>sum+value*(lookup.get(token)??0),0)));
}

export function eventSimilarity(left:EventDocument,right:EventDocument) {
  const body=eventCosine(left.body,right.body);
  if(!left.title.length||!right.title.length)return {value:body,title:null};
  const title=eventCosine(left.title,right.title);
  return {value:0.65*body+0.35*title,title};
}

export type EventMetric={boundaries:{percentile:number;value:number;belowPercent:number;atOrBelowPercent:number}[]};
export type EventBaseline={id:string;topicId:string;start:string;through:string;n:number;publisherCount:number;
  centroid:EventVector;titleCentroid:EventVector;metrics:{fomo:EventMetric;attribution:EventMetric}};
export type EventBaselineIndex={schemaVersion:string;version:string;generatedAt:string;scopeCharacters:number;
  metricVersions:Record<string,string>;articlePeriod:{from:string;through:string;timeZone:string};
  sourceArticleCount:number;publisherCount:number;rules:typeof EVENT_RULES;idf:Record<string,number>;events:EventBaseline[]};

/** Publication time and topic are required, so an old event cannot match a current article by vocabulary alone. */
export function findEventComparison(input:{body:string;title?:string;publishedAt?:string;topicId:string|null},index:EventBaselineIndex) {
  if(index.rules.version!==EVENT_GROUPING_VERSION||index.rules.tokenizer!==EVENT_TOKENIZER_VERSION||index.scopeCharacters!==2000)
    return {status:'incompatible' as const,event:null,similarity:null};
  if(!input.topicId)return {status:'unknown_topic' as const,event:null,similarity:null};
  const time=input.publishedAt?Date.parse(input.publishedAt):NaN;
  if(!Number.isFinite(time))return {status:'date_missing' as const,event:null,similarity:null};
  const document=eventDocument(input.body,input.title??'',index.idf);
  const days=index.rules.maximumDayDistance*86400000;
  const matches=index.events.flatMap(event=>{
    const start=Date.parse(event.start),through=Date.parse(event.through);
    if(event.topicId!==input.topicId||event.n<index.rules.minimumArticles||event.publisherCount<index.rules.minimumPublishers
      ||!Number.isFinite(start)||!Number.isFinite(through)||through<start||through-start>days
      ||time<through-days||time>start+days)return [];
    const similarity=eventSimilarity(document,{body:event.centroid,title:event.titleCentroid});
    if(similarity.value<index.rules.minimumSimilarity
      ||similarity.title!==null&&similarity.title<index.rules.minimumTitleSimilarity)return [];
    return [{event,similarity:similarity.value}];
  }).sort((left,right)=>right.similarity-left.similarity||left.event.id.localeCompare(right.event.id));
  if(!matches.length)return {status:'no_match' as const,event:null,similarity:null};
  if(matches[1]&&matches[0].similarity-matches[1].similarity<index.rules.ambiguityMargin)
    return {status:'ambiguous' as const,event:null,similarity:matches[0].similarity};
  return {status:'matched' as const,...matches[0]};
}
