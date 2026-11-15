import type {IssueQuarterBaselines} from '../issue-quarter-baseline';
import type {IssueQuarterArticle} from '../issue-quarter-baseline';

/** Replaced only by the explicit isolated research plugin. Never a public artifact. */
const localResearchComparison:null|{precomputed:unknown;baselines:IssueQuarterBaselines|null;
  provenance:{corpusArticleHashes:string[];trainingHashes?:string[]}|null;recommendations:IssueQuarterArticle[]|null}=null;
export default localResearchComparison;
