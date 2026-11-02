import type {Analysis, Check, Verification} from './contracts';
import type {ResearchStage, ResearchVerification} from './research-contract';
import {currentResearch} from './current-research';
import {completedFactualChecks, expressionSummary} from './domain';
import {reliabilityReview} from './reliability';

// Export completed review data only, never signed plans, evidence tokens or runtime settings.
function reviewData(v: Verification) {
  return {
    schemaVersion: v.schemaVersion, requestId: v.requestId,
    parentAnalysisId: v.parentAnalysisId, mode: v.mode, status: v.status,
    versions: v.versions, scope: v.scope, references: v.references,
    checks: v.checks, attempts: v.attempts, warnings: v.warnings, createdAt: v.createdAt,
    ...('perspectiveChecks' in v ? {perspectiveChecks: (v as ResearchVerification).perspectiveChecks} : {}),
  };
}

export function buildReviewExport({analysis, checks, feedback, includeRaw, includeRefs,
  verifications, researchResults, researchStage}: {
  analysis: Analysis | null; checks: Check[]; feedback: string;
  includeRaw: boolean; includeRefs: boolean; verifications: Verification[];
  researchResults: ResearchVerification[]; researchStage: ResearchStage;
}) {
  const research = analysis ? currentResearch(analysis, researchResults) : [];
  const manual = analysis ? currentResearch(analysis, verifications) : [];
  const expression = analysis ? expressionSummary(analysis) : null;
  // Match the on-screen summaries: count natural sentences once and let the
  // latest attempt supersede an older completed check for the same claim.
  const completedResearch = analysis?.mode === 'live'
    ? reliabilityReview(analysis, research, researchStage).completedClaims
    : analysis ? completedFactualChecks(analysis.claims, research.flatMap(v => v.checks)).length : 0;
  return {
    schemaVersion: '2.2', rubric: analysis?.versions.rubric, mode: analysis?.mode, feedback,
    summary: analysis ? {
      topics: analysis.topics.length, sentences: expression!.total,
      flagged: expression!.flagged,
      claims: analysis.claims.length, completedChecks: completedFactualChecks(analysis.claims, checks).length,
    } : null,
    research: {
      stage: analysis ? researchStage : 'not_started', resultCount: research.length,
      completedClaims: completedResearch,
      note: '취소·실패·부분 완료는 전체 조사 완료가 아닙니다. 자료·인용은 선택한 경우에만 포함됩니다.',
      ...(includeRefs ? {results: research.map(reviewData)} : {}),
    },
    ...(includeRaw ? {analysis} : {}),
    ...(includeRefs ? {verifications: manual.map(reviewData)} : {}),
    note: '사용자가 직접 내보낸 검토 기록입니다. 팀에 자동 접수되지 않습니다.',
  };
}
