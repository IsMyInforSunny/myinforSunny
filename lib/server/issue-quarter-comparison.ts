import storedBaseline from '../data/issue-quarter-baselines.json';
import storedProvenance from '../data/issue-quarter-provenance.json';
import type {Analysis} from '../contracts';
import {compareAgainstIssueQuarterArticles,compareIssueQuarterBaseline,issueQuarterCoordinateRange,issueQuarterPeriods,recommendIssueQuarterArticles,type IssueQuarterBaselines,type IssueQuarterArticle,type IssueQuarterRecommendation} from '../issue-quarter-baseline';
import {mainVoiceIssue} from '../voice-comparison';
import type {VoiceDocument} from '../sentence-voice';
import localResearchComparison from './local-research-comparison';

export type IssueQuarterComparison = ReturnType<typeof compareIssueQuarterBaseline> & {
  parentAnalysisId:string;
  modelVersion:string;
  opposingArticles:IssueQuarterRecommendation[];
  similarArticles:IssueQuarterRecommendation[];
  sourceComposition?:{classificationBasis:string;inputCategory:'support'|'oppose'|'mixed';counts:{support:number;oppose:number;mixed:number};
    histogram:{lower:number;upper:number;count:number;includesInput:boolean}[];differentCompositionArticles:IssueQuarterRecommendation[]};
};
type Provenance={corpusArticleHashes:string[];trainingHashes?:string[]};
function sourceClass(range:{lower:number;upper:number}):'support'|'oppose'|'mixed'{
  return range.lower>.2?'support':range.upper<-.2?'oppose':'mixed';
}
function sourceComposition(input:IssueQuarterArticle,comparison:ReturnType<typeof compareIssueQuarterBaseline>,population:IssueQuarterArticle[],trainingHashes:readonly string[]=[]){
  if(comparison.status!=='ready'||!comparison.period||!comparison.publisherCounts.length)return undefined;
  const inputRange=issueQuarterCoordinateRange(input);if(!inputRange)return undefined;
  const eligiblePublishers=new Set(comparison.publisherCounts.map(item=>item.publisher));
  const eligible=population.filter(row=>row.topic===input.topic&&row.issue===input.issue&&row.axis==='source'&&row.modelVersion===input.modelVersion
    &&row.version===input.version&&row.decisionPolicy===input.decisionPolicy&&row.issuePolicy===input.issuePolicy&&!row.trainingOriginal
    &&!trainingHashes.includes(row.bodyHash)&&row.bodyHash!==input.bodyHash&&eligiblePublishers.has(row.publisher)
    &&issueQuarterPeriods(row.publishedAt).some(period=>period.key===comparison.period!.key)&&!!issueQuarterCoordinateRange(row));
  const counts={support:0,oppose:0,mixed:0};const histogram=Array.from({length:8},(_,i)=>({lower:-1+i*.25,upper:-.75+i*.25,count:0,includesInput:false}));
  for(const row of eligible){counts[sourceClass(issueQuarterCoordinateRange(row)!)]++;const range=issueQuarterCoordinateRange(row)!;
    for(const point of [range.lower,range.upper]){const index=point===-1?0:Math.min(7,Math.max(0,Math.ceil((point+1)/.25)-1));histogram[index].count++;}}
  for(const bin of histogram)bin.includesInput=inputRange.upper>=bin.lower&&inputRange.lower<=bin.upper;
  const inputCategory=sourceClass(inputRange);
  const candidates=eligible.filter(row=>sourceClass(issueQuarterCoordinateRange(row)!)!==inputCategory&&row.url&&row.title)
    .sort((a,b)=>(Date.parse(b.publishedAt??'')||0)-(Date.parse(a.publishedAt??'')||0));
  const diverse=inputCategory==='mixed'
    ?(['support','oppose'] as const).flatMap(category=>candidates.filter(row=>sourceClass(issueQuarterCoordinateRange(row)!)===category).slice(0,2))
    :candidates.slice(0,3);
  return {classificationBasis:'찬반 문장 수 기준 분류 (좌표 하한 > 0.2: 찬성 우세, 상한 < -0.2: 반대 우세, 그 외: 혼합·불확실)',inputCategory,counts,histogram,
    differentCompositionArticles:diverse.map(row=>({id:row.id,title:row.title!,url:row.url!,publisher:row.publisher,publishedAt:row.publishedAt}))};
}

/** Research summaries are supplied explicitly for local validation until usage review is decided. */
export function attachIssueQuarterComparison(
  analysis:Analysis,
  bundle:IssueQuarterBaselines|null=localResearchComparison?.baselines??storedBaseline,
  provenance:Provenance|null=localResearchComparison?.provenance??storedProvenance,
  population:IssueQuarterArticle[]|null=localResearchComparison?.recommendations??null,
):Analysis {
  delete analysis.issueQuarterComparison;
  delete analysis.issueQuarterComparisons;
  const documents=[analysis.sentenceVoices,...analysis.additionalSentenceVoices??[]]
    .filter((document):document is VoiceDocument=>!!document&&document.method==='svm');
  if(!bundle||!provenance||analysis.mode!=='live'||!documents.length)return analysis;
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const comparisons=documents.flatMap(document=>{
    const primary=mainVoiceIssue(body,document);
    const input=primary&&analysis.voiceCoordinates?.find(item=>item.axis==='source'&&item.issue===primary.issue
      &&item.topic===primary.topic&&item.modelVersion===primary.modelVersion&&item.issuePolicy===document.issuePolicy);
    if(!input)return [];
    const isMember=provenance.corpusArticleHashes.includes(input.bodyHash);
    const comparison=isMember&&population?.length
      ?compareAgainstIssueQuarterArticles(input,population,provenance.trainingHashes??[])
      :compareIssueQuarterBaseline(input,bundle,provenance);
    const ranked=population?.length
      ?recommendIssueQuarterArticles(input,population,{trainingHashes:provenance.trainingHashes,localOnly:true})
      :{opposing:[],similar:[]};
    return [{...comparison,parentAnalysisId:analysis.analysisId,modelVersion:input.modelVersion,
      opposingArticles:ranked.opposing,similarArticles:ranked.similar,
      ...(population?.length?{sourceComposition:sourceComposition(input,comparison,population,provenance.trainingHashes)}:{})}];
  });
  if(comparisons.length){analysis.issueQuarterComparisons=comparisons;analysis.issueQuarterComparison=comparisons[0];}
  return analysis;
}
