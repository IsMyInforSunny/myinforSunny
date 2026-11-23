import type {Analysis} from './contracts';

const PRIORITY_PATHS=new Set(['/pages/articles/2026091808555217839','/pages/articles/2026110509224063406']);
export function priorityScoreArticle(analysis:Analysis|null){
 return priorityScoreUrl(analysis?.article?.url??'');
}
export function priorityScoreUrl(value:string){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname==='www.pressian.com'&&PRIORITY_PATHS.has(url.pathname.replace(/\/$/,''));}catch{return false;}}
export type CitationCounts={support:number;oppose:number;neutral:number;uncertain:number};
export type CitationDistribution={counts:CitationCounts;percentages:CitationCounts|null;denominator:number};
export type CitationComposition={method:'within_article';proposition:string;all:CitationDistribution;sources:CitationDistribution;journalist:CitationDistribution;unknownSpeaker:number;unrelated:number;note:string};

function distribution(labels:NonNullable<Analysis['citationBalance']>['labels']):CitationDistribution{
 const counts:CitationCounts={support:0,oppose:0,neutral:0,uncertain:0};
 for(const label of labels)counts[label.relevance==='uncertain'?'uncertain':label.direction]++;
 const denominator=labels.length;
 if(!denominator)return {counts,percentages:null,denominator};
 // Largest remainders keep the four displayed percentages at exactly100.
 const keys=Object.keys(counts) as (keyof CitationCounts)[];
 const percentages=Object.fromEntries(keys.map(key=>[key,Math.floor(counts[key]/denominator*100)])) as CitationCounts;
 let remainder=100-keys.reduce((n,key)=>n+percentages[key],0);
 const order=[...keys].sort((a,b)=>(counts[b]*100%denominator)-(counts[a]*100%denominator)||keys.indexOf(a)-keys.indexOf(b));
 for(const key of order){if(remainder===0)break;percentages[key]++;remainder--;}
 return {counts,percentages,denominator};
}

/** Counts only this article's model-labelled sentences; never a relative bias score. */
export function citationComposition(analysis:Analysis|null):CitationComposition|null{
 if(!analysis?.citationBalance)return null;
 const citation=analysis.citationBalance,body=analysis.sources.find(source=>source.kind==='body');
 if(!body)return null;
 const validIds=new Set(body.sentences.map(sentence=>sentence.id));
 const seen=new Set<string>();
 for(const label of citation.labels){if(!validIds.has(label.sentenceId)||seen.has(label.sentenceId))return null;seen.add(label.sentenceId);}
 if(seen.size!==validIds.size)return null;
 const related=citation.labels.filter(label=>label.relevance!=='unrelated');
 return {method:'within_article',proposition:citation.proposition,all:distribution(related),sources:distribution(related.filter(label=>label.speaker==='source')),
  journalist:distribution(related.filter(label=>label.speaker==='journalist')),unknownSpeaker:related.filter(label=>label.speaker==='mixed'||label.speaker==='unknown').length,
  unrelated:citation.labels.length-related.length,note:'이 기사 안에서 해당 명제에 관련된 문장의 찬성·반대·중립·유보 비율입니다. 취재원 인용과 기자 서술을 구분하며 작성자 성향·객관성·다른 매체와 비교한 편향 강도 점수가 아닙니다.'};
}
