import type {Analysis, Check, Verification} from './contracts';
import type {ResearchStage, ResearchVerification} from './research-contract';
import {currentResearch} from './current-research';

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
  const completedIds = new Set(research.flatMap(v => v.checks)
    .filter(c => c.execution === 'completed').map(c => c.claimId));
  return {
    schemaVersion: '2.2', rubric: analysis?.versions.rubric, mode: analysis?.mode, feedback,
    summary: analysis ? {
      topics: analysis.topics.length, sentences: analysis.coverage.totalSentences,
      flagged: analysis.expressions.filter(e => e.status === 'flagged').length,
      claims: analysis.claims.length, completedChecks: checks.filter(c => c.execution === 'completed').length,
    } : null,
    research: {
      stage: analysis ? researchStage : 'not_started', resultCount: research.length,
      completedClaims: completedIds.size,
      note: '취소·실패·부분 완료는 전체 조사 완료가 아닙니다. 자료·인용은 선택한 경우에만 포함됩니다.',
      ...(includeRefs ? {results: research.map(reviewData)} : {}),
    },
    ...(includeRaw ? {analysis} : {}),
    ...(includeRefs ? {verifications: verifications.filter(v => analysis && v.mode === analysis.mode &&
      (v.parentAnalysisId === analysis.analysisId || (analysis.mode === 'demo' && !v.parentAnalysisId))).map(reviewData)} : {}),
    note: '사용자가 직접 내보낸 검토 기록입니다. 팀에 자동 접수되지 않습니다.',
  };
}
