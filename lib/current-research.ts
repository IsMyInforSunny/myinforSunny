import type {Analysis} from './contracts';
import type {ResearchVerification} from './research-contract';

/** Never promote unbound, stale or synthetic results into the current article's evidence. */
export function currentResearch(analysis:Pick<Analysis,'analysisId'|'mode'>,results:readonly ResearchVerification[]):ResearchVerification[]{
 return results.filter(result=>result.parentAnalysisId===analysis.analysisId&&result.mode===analysis.mode);
}
