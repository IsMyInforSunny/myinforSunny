import {eventTermCounts,normalizeEventVector,eventSimilarity,EVENT_RULES} from './article-comparison-groups';
import type {EventDocument,EventVector} from './article-comparison-groups';
import {articleTextPrefix} from './server/article-document';

export type LiveVoiceEventArticle={body:string;title?:string;publishedAt?:string};
export type LiveVoiceEventMatch={
  status:'matched'|'date_missing'|'out_of_period'|'low_similarity';
  similarity:number|null;
  titleSimilarity:number|null;
  dayDistance:number|null;
};

/** Pure pairwise comparison. Callers supply server-verified metadata and check
 * topic/issue eligibility separately. A matched pair does not authenticate it.
 * Cohorts must also enforce a total publication window of at most three days.
 */
export function matchLiveVoiceEvent(anchor:LiveVoiceEventArticle,candidate:LiveVoiceEventArticle):LiveVoiceEventMatch {
  const times=[anchor,candidate].map(article=>article.publishedAt?Date.parse(article.publishedAt):NaN);
  if(times.some(time=>!Number.isFinite(time)))
    return {status:'date_missing',similarity:null,titleSimilarity:null,dayDistance:null};
  const dayDistance=Math.abs(times[0]-times[1])/86400000;
  if(dayDistance>EVENT_RULES.maximumDayDistance)
    return {status:'out_of_period',similarity:null,titleSimilarity:null,dayDistance};

  const counts=[anchor,candidate].map(article=>({
    body:eventTermCounts(articleTextPrefix(article.body,2000)),
    title:eventTermCounts(article.title??''),
  }));
  const frequencies=new Map<string,number>();
  for(const document of counts)
    for(const term of new Set([...Object.keys(document.body),...Object.keys(document.title)]))
      frequencies.set(term,(frequencies.get(term)??0)+1);
  const vector=(terms:Record<string,number>,limit:number):EventVector=>normalizeEventVector(
    Object.entries(terms).map(([term,count])=>[
      term,(1+Math.log(count))*(Math.log(3/(1+frequencies.get(term)!))+1),
    ]),limit);
  const documents:EventDocument[]=counts.map(document=>({
    body:vector(document.body,EVENT_RULES.bodyFeatures),
    title:vector(document.title,EVENT_RULES.titleFeatures),
  }));
  const similarity=eventSimilarity(documents[0],documents[1]);
  const matched=similarity.value>=EVENT_RULES.minimumSimilarity&&
    (similarity.title===null||similarity.title>=EVENT_RULES.minimumTitleSimilarity);
  return {status:matched?'matched':'low_similarity',similarity:similarity.value,
    titleSimilarity:similarity.title,dayDistance};
}

/** Uses a supplied body digest; this function does not hash or verify a body. */
export function liveVoiceEventId(bodyHash:string):string {
  if(!/^[a-f0-9]{64}$/i.test(bodyHash))throw new Error('Live voice event requires a SHA-256 hex digest');
  return `live:${bodyHash.toLowerCase()}`;
}
