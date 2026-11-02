import type {MapPoint} from './reader-metrics';

/**
 * Bounded, observed-stance comparison across publishers for ONE explicit proposition at a time.
 * x codes: opposes_position=-1, adds_context=0, supports_position=1.
 * This is NOT a calibrated bias, ideology, credibility or truth measure; the baseline is provisional.
 */
export const MEDIA_POSITION_BASELINE='provisional' as const;
export const MIN_ARTICLES_PER_PUBLISHER=3;
export const MIN_ELIGIBLE_PUBLISHERS=2;
export const MAX_POSITION_POINTS=500;

export type PositionOptions={maxPoints?:number};
export type EvidenceCounts={factSupport:number;factConflict:number;unreviewed:number};
export type PublisherPosition={
 publisher:string;
 sampleCount:number;
 /** Mean stance code in [-1,1]; null until sampleCount >= MIN_ARTICLES_PER_PUBLISHER. */
 centroidX:number|null;
 eligible:boolean;
 evidence:EvidenceCounts;
};
export type PositionGroup={
 position:string;
 publishers:PublisherPosition[];
 eligiblePublishers:number;
 /** Article groups whose conflicting duplicate classifications were rejected for this position. */
 undetermined:number;
 /** Additional URLs with identical complete retrieved text within the same publisher. */
 duplicateContent:number;
};
export type PublisherPositionReport={
 baseline:typeof MEDIA_POSITION_BASELINE;
 note:string;
 minArticlesPerPublisher:number;
 minEligiblePublishers:number;
 inputCount:number;
 /** Points dropped by the sample limit (never silently ignored). */
 truncated:number;
 /** Points dropped for invalid URL / stance / empty position. */
 invalid:number;
 groups:PositionGroup[];
};
export type PositionDifference={
 baseline:typeof MEDIA_POSITION_BASELINE;
 note:string;
 /** abs(selected code - equal-weight mean of eligible publisher centroids), 0..2; null if insufficient. */
 value:number|null;
 status:'ok'|'insufficient';
 reason:'ok'|'no_selection'|'selected_not_found'|'selected_ambiguous'|'selected_undetermined'|'insufficient_publishers';
 position:string|null;
 selectedCode:number|null;
 referenceCentroid:number|null;
 publishersUsed:number;
};

export const MEDIA_POSITION_NOTE='관찰된 입장 차이이며 보정된 편향·진실·신뢰도 값이 아닙니다. 기준선은 잠정적입니다.';
const CODE:Record<MapPoint['stance'],number>={opposes_position:-1,adds_context:0,supports_position:1};
const normal=(v:string)=>v.trim().replace(/\s+/g,' ');

/** Shared article identity for observations and aggregation; tracking aliases are not new articles. */
export function canonicalArticleUrl(value:string|undefined){
 try{
  const u=new URL(value??'');
  const hostname=u.hostname.toLowerCase();
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||
    !hostname.includes('.')||hostname.endsWith('.local')||hostname.endsWith('.localhost')||/^[\d.:[\]]+$/.test(hostname))return null;
  u.hash='';u.hostname=u.hostname.toLowerCase();
  for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(k))u.searchParams.delete(k);
  const host=u.hostname.replace(/^www\./,'');
  if(!host.includes('.'))return null;
  u.searchParams.sort();
  const path=u.pathname.length>1?u.pathname.replace(/\/+$/,''):u.pathname;
  return {url:`${u.protocol}//${host}${path}${u.search}`,host};
 }catch{return null;}
}
const evidenceKind=(e:MapPoint['evidence'])=>e==='supports'?'factSupport':e==='unreviewed'?'unreviewed':'factConflict';

type Article={urls:string[];host:string;position:string;code:number;evidence:MapPoint['evidence']};
type Prepared={groups:Map<string,{articles:Article[];undetermined:number;duplicateContent:number;bad:Set<string>}>;invalid:number;truncated:number;inputCount:number};

/** A quote/excerpt or a shared 8,000-character prefix is not a complete content identity.
 * Missing metadata in older results deliberately falls back to URL-only counting.
 */
function completeContentKey(p:MapPoint){
 const length=p.retrievedTextLength;
 if(!/^[A-Za-z0-9_-]{43}$/.test(p.contentDigest??'')||typeof length!=='number'||!Number.isInteger(length)||length<200||length>8000||p.retrievedTruncated!==false||p.fullTextLength!==length||!p.extractionVersion?.trim())return null;
 return JSON.stringify([p.extractionVersion,length,p.contentDigest]);
}

function prepare(points:MapPoint[],options?:PositionOptions):Prepared{
 const list=Array.isArray(points)?points:[];
 const requested=options?.maxPoints;
 const max=typeof requested==='number'&&Number.isFinite(requested)?Math.min(MAX_POSITION_POINTS,Math.max(0,Math.floor(requested))):MAX_POSITION_POINTS;
 const used=list.slice(0,max);
 let invalid=0;
 // Union canonical URL aliases and complete-content duplicates for the same host/proposition.
 // All classifications survive until after grouping: array order must not choose a stance.
 const rows:{url:string;host:string;position:string;code:number;evidence:MapPoint['evidence']}[]=[];
 const parent:number[]=[];const identities=new Map<string,number>();
 const find=(n:number):number=>parent[n]===n?n:(parent[n]=find(parent[n]));
 for(const p of used){
  const c=canonicalArticleUrl(p?.url);const position=normal(p?.position??'');
  const code=p?CODE[p.stance]:undefined;
  if(!c||!position||code===undefined||!['supports','contradicts','mixed','unreviewed'].includes(p.evidence)){invalid++;continue;}
  const index=rows.length;rows.push({url:c.url,host:c.host,position,code,evidence:p.evidence});parent.push(index);
  const content=completeContentKey(p);
  for(const key of [JSON.stringify(['url',position,c.url]),...(content?[JSON.stringify(['content',position,c.host,content])]:[])]){
   const previous=identities.get(key);
   if(previous===undefined)identities.set(key,index);else parent[find(index)]=find(previous);
  }
 }
 const clusters=new Map<number,typeof rows>();
 rows.forEach((row,index)=>{const key=find(index);clusters.set(key,[...(clusters.get(key)??[]),row]);});
 const groups:Prepared['groups']=new Map();
 for(const cluster of clusters.values()){
  const first=cluster[0],urls=[...new Set(cluster.map(row=>row.url))].sort();
  const g=groups.get(first.position)??{articles:[],undetermined:0,duplicateContent:0,bad:new Set<string>()};groups.set(first.position,g);
  g.duplicateContent+=urls.length-1;
  if(cluster.some(row=>row.code!==first.code||row.evidence!==first.evidence)){
   g.undetermined++;for(const url of urls)g.bad.add(url);
  }else g.articles.push({urls,host:first.host,position:first.position,code:first.code,evidence:first.evidence});
 }
 return {groups,invalid,truncated:list.length-used.length,inputCount:list.length};
}

function summarize(articles:Article[]):PublisherPosition[]{
 const byHost=new Map<string,Article[]>();
 for(const a of articles)byHost.set(a.host,[...(byHost.get(a.host)??[]),a]);
 return [...byHost.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([publisher,items])=>{
  const evidence:EvidenceCounts={factSupport:0,factConflict:0,unreviewed:0};
  for(const a of items)evidence[evidenceKind(a.evidence)]++;
  const eligible=items.length>=MIN_ARTICLES_PER_PUBLISHER;
  return {publisher,sampleCount:items.length,centroidX:eligible?items.reduce((s,a)=>s+a.code,0)/items.length:null,eligible,evidence};
 });
}

/** Per-proposition publisher centroids from observed article stances; no invented values. */
export function publisherPositions(points:MapPoint[],options?:PositionOptions):PublisherPositionReport{
 const prep=prepare(points,options);
 const groups:PositionGroup[]=[...prep.groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([position,g])=>{
  const publishers=summarize(g.articles);
  return {position,publishers,eligiblePublishers:publishers.filter(p=>p.eligible).length,undetermined:g.undetermined,duplicateContent:g.duplicateContent};
 });
 return {baseline:MEDIA_POSITION_BASELINE,note:MEDIA_POSITION_NOTE,minArticlesPerPublisher:MIN_ARTICLES_PER_PUBLISHER,minEligiblePublishers:MIN_ELIGIBLE_PUBLISHERS,inputCount:prep.inputCount,truncated:prep.truncated,invalid:prep.invalid,groups};
}

/**
 * abs(selected article code - equal-weight mean of eligible publisher centroids) within the selected
 * article's own proposition. Observed stance difference only; null when evidence is insufficient.
 */
export function absolutePositionDifference(points:MapPoint[],selectedUrl?:string,options?:PositionOptions):PositionDifference{
 const empty=(reason:PositionDifference['reason'],extra:Partial<PositionDifference>={}):PositionDifference=>({baseline:MEDIA_POSITION_BASELINE,note:MEDIA_POSITION_NOTE,value:null,status:'insufficient',reason,position:null,selectedCode:null,referenceCentroid:null,publishersUsed:0,...extra});
 const sel=selectedUrl?canonicalArticleUrl(selectedUrl):null;
 if(!sel)return empty('no_selection');
 const prep=prepare(points,options);
 const hits=[...prep.groups.entries()].map(([position,g])=>({position,g,article:g.articles.find(a=>a.urls.includes(sel.url))})).filter(h=>h.article);
 // A selected URL rejected as undetermined must not silently fall through to "not found".
 const undetermined=hits.length===0&&[...prep.groups.values()].some(g=>g.bad.has(sel.url));
 if(hits.length===0)return empty(undetermined?'selected_undetermined':'selected_not_found');
 if(hits.length>1)return empty('selected_ambiguous');
 const {position,g,article}=hits[0];
 const publishers=summarize(g.articles).filter(p=>p.eligible);
 if(publishers.length<MIN_ELIGIBLE_PUBLISHERS)return empty('insufficient_publishers',{position,selectedCode:article!.code,publishersUsed:publishers.length});
 const ref=publishers.reduce((s,p)=>s+p.centroidX!,0)/publishers.length;
 return {baseline:MEDIA_POSITION_BASELINE,note:MEDIA_POSITION_NOTE,value:Math.abs(article!.code-ref),status:'ok',reason:'ok',position,selectedCode:article!.code,referenceCentroid:ref,publishersUsed:publishers.length};
}
