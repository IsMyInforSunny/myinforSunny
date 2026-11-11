import {sentences, naturalSentences, SEGMENTER} from './segmentation';
import {fomoSignals, FOMO_RULE_VERSION} from './fomo-signals';
import {reviewCitedSources, CITED_SOURCES_VERSION} from './cited-sources';
import {articleTextPrefix} from './server/article-document';

export const RELATIVE_METRICS_VERSION = 'relative-metrics-1.0';
export const RELATIVE_SCOPE_CHARACTERS = 2000;
export const RELATIVE_TOPICS = [
  {id:'medical_school_quota', label:'의대 정원', pattern:/의대|의과대|의사\s*정원/g},
  {id:'pension_reform', label:'국민연금 개혁', pattern:/국민연금|연금개혁|연금\s*개혁|소득대체율|보험료율/g},
  {id:'minimum_wage', label:'최저임금', pattern:/최저임금|생활임금/g},
  {id:'electricity_prices', label:'전기요금', pattern:/전기\s*(?:요금|료)|전력\s*요금/g},
  {id:'housing_supply', label:'주택 공급', pattern:/주택|부동산|아파트/g},
  {id:'nuclear_energy', label:'원자력 에너지', pattern:/원전|원자력|핵폐기/g},
] as const;
export type RelativeTopicId = typeof RELATIVE_TOPICS[number]['id'];
export const relativeMetricVersions = {
  metrics:RELATIVE_METRICS_VERSION, segmenter:SEGMENTER,
  fomo:FOMO_RULE_VERSION, citedSources:CITED_SOURCES_VERSION, topicRules:'policy-topics-1.0',
};
export type RelativeMetric = {count:number;total:number;value:number|null};

/** The same rule modules and body window run in the offline corpus builder and the site. */
export function computeRelativeMetrics(body:string) {
  const text = articleTextPrefix(body,RELATIVE_SCOPE_CHARACTERS);
  const source = {id:'body',kind:'body' as const,text,sentences:sentences(text,'body')};
  const groups = naturalSentences(source.sentences);
  const fomo = fomoSignals({sources:[source]});
  const cited = reviewCitedSources({sources:[source],claims:[]});
  const namedUnits = new Set(cited.sources.filter(item=>item.signals.named).map(item=>item.sentenceId));
  const namedSentences = groups.filter(group=>group.units.some(unit=>namedUnits.has(unit.id))).length;
  const metric = (count:number):RelativeMetric=>({count,total:groups.length,
    value:groups.length?Math.round(count/groups.length*1000)/10:null});
  return {scopeCharacters:RELATIVE_SCOPE_CHARACTERS,analyzedCharacters:text.length,totalSentences:groups.length,
    fomo:metric(fomo.flaggedSentences),attribution:metric(namedSentences)};
}

/** Ambiguous ties stay unassigned instead of selecting a comparison population arbitrarily. */
export function classifyRelativeTopic(body:string,title=''):RelativeTopicId|null {
  const text = articleTextPrefix(body,RELATIVE_SCOPE_CHARACTERS);
  const candidates = RELATIVE_TOPICS.map(topic=>({id:topic.id,
    count:[...text.matchAll(new RegExp(topic.pattern.source,'g'))].length
      +2*[...title.matchAll(new RegExp(topic.pattern.source,'g'))].length}))
    .filter(topic=>topic.count>0).sort((left,right)=>right.count-left.count);
  return candidates.length&&(!candidates[1]||candidates[0].count>candidates[1].count)?candidates[0].id:null;
}
