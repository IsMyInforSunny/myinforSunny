import storedBaseline from '../data/issue-quarter-baselines.json';
import storedProvenance from '../data/issue-quarter-provenance.json';
import type {Analysis} from '../contracts';
import {compareIssueQuarterBaseline,recommendIssueQuarterArticles,type IssueQuarterBaselines,type IssueQuarterRecommendation} from '../issue-quarter-baseline';
import {mainVoiceIssue} from '../voice-comparison';
import type {VoiceDocument} from '../sentence-voice';
import localResearchComparison from './local-research-comparison';

export type IssueQuarterComparison = ReturnType<typeof compareIssueQuarterBaseline> & {
  parentAnalysisId:string;
  modelVersion:string;
  opposingArticles:IssueQuarterRecommendation[];
  similarArticles:IssueQuarterRecommendation[];
};
type Provenance={corpusArticleHashes:string[];trainingHashes?:string[]};

/** Research summaries are supplied explicitly for local validation until usage review is decided. */
export function attachIssueQuarterComparison(
  analysis:Analysis,
  bundle:IssueQuarterBaselines|null=localResearchComparison?.baselines??storedBaseline,
  provenance:Provenance|null=localResearchComparison?.provenance??storedProvenance,
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
    const comparison=compareIssueQuarterBaseline(input,bundle,provenance);
    const ranked=localResearchComparison?.recommendations?.length
      ?recommendIssueQuarterArticles(input,localResearchComparison.recommendations,{trainingHashes:provenance.trainingHashes,localOnly:true})
      :{opposing:[],similar:[]};
    return [{...comparison,parentAnalysisId:analysis.analysisId,modelVersion:input.modelVersion,
      opposingArticles:ranked.opposing,similarArticles:ranked.similar}];
  });
  if(comparisons.length){analysis.issueQuarterComparisons=comparisons;analysis.issueQuarterComparison=comparisons[0];}
  return analysis;
}
