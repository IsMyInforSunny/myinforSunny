import storedBaseline from '../data/issue-quarter-baselines.json';
import storedProvenance from '../data/issue-quarter-provenance.json';
import type {Analysis} from '../contracts';
import {compareIssueQuarterBaseline, type IssueQuarterBaselines} from '../issue-quarter-baseline';
import {mainVoiceIssue} from '../voice-comparison';

export type IssueQuarterComparison = ReturnType<typeof compareIssueQuarterBaseline> & {
  parentAnalysisId:string;
  modelVersion:string;
};
type Provenance={corpusArticleHashes:string[];trainingHashes?:string[]};

/** Research summaries are supplied explicitly for local validation until usage review is decided. */
export function attachIssueQuarterComparison(
  analysis:Analysis,
  bundle:IssueQuarterBaselines|null=storedBaseline,
  provenance:Provenance|null=storedProvenance,
):Analysis {
  delete analysis.issueQuarterComparison;
  if(!bundle||!provenance||analysis.mode!=='live'||analysis.sentenceVoices?.method!=='svm')return analysis;
  const body=analysis.sources.find(source=>source.kind==='body')?.text??'';
  const primary=mainVoiceIssue(body,analysis.sentenceVoices);
  const input=primary&&analysis.voiceCoordinates?.find(item=>item.axis==='source'&&item.issue===primary.issue
    &&item.topic===primary.topic&&item.modelVersion===primary.modelVersion&&item.issuePolicy===analysis.sentenceVoices?.issuePolicy);
  if(!input)return analysis;
  const comparison=compareIssueQuarterBaseline(input,bundle,provenance);
  analysis.issueQuarterComparison={...comparison,parentAnalysisId:analysis.analysisId,modelVersion:input.modelVersion};
  return analysis;
}
