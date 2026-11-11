import {compareRelativeBaseline} from './relative-baselines';
import type {Analysis, Check, Verification} from './contracts';
import type {ResearchStage, ResearchVerification} from './research-contract';
import {currentResearch} from './current-research';
import {completedFactualChecks, expressionSummary} from './domain';
import {reliabilityReview} from './reliability';
import {reviewCitedSources} from './cited-sources';
import {buildAnalysisScores} from './analysis-scores';
import type {BiasAnalysisResult} from './bias-analysis';
import {observationsFromResearch} from './source-reliability-adapter';
import {SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025} from './public-trust-prior';
import {reviewedCitedSources} from './cited-source-confirmations';
import {languageMetrics} from './language-metrics';

// Export completed review data only, never signed plans, evidence tokens or runtime settings.
function reviewData(v: Verification) {
  return {
    schemaVersion: v.schemaVersion, requestId: v.requestId,
    parentAnalysisId: v.parentAnalysisId, mode: v.mode, status: v.status,
    versions: v.versions, scope: v.scope, references: v.references,
    checks: v.checks, attempts: v.attempts, warnings: v.warnings, createdAt: v.createdAt,
    ...('perspectiveChecks' in v ? {perspectiveChecks: (v as ResearchVerification).perspectiveChecks} : {}),
    ...('researchPlanId' in v ? {researchPlanId: (v as ResearchVerification).researchPlanId} : {}),
  };
}

export function buildReviewExport({analysis, checks, feedback, includeRaw, includeRefs,
  verifications, researchResults, researchStage, biasAssessment, stale=false}: {
  analysis: Analysis | null; checks: Check[]; feedback: string;
  includeRaw: boolean; includeRefs: boolean; verifications: Verification[];
  researchResults: ResearchVerification[]; researchStage: ResearchStage;
  biasAssessment?: BiasAnalysisResult | null;
  stale?: boolean;
}) {
  const research = analysis ? currentResearch(analysis, researchResults) : [];
  const manual = analysis ? currentResearch(analysis, verifications) : [];
  const expression = analysis ? expressionSummary(analysis) : null;
  const external = analysis ? reliabilityReview(analysis, research, researchStage) : null;
  const sourcing = analysis ? reviewCitedSources(analysis) : null;
  const assessedSources = analysis ? reviewedCitedSources(analysis,research,SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025) : null;
  // Input details and fetched reference URLs have separate consent controls.
  const exportedAssessment=assessedSources?{...assessedSources,sources:assessedSources.sources.map(source=>({...source,
    originalCheck:includeRefs?source.originalCheck:{...source.originalCheck,url:null,host:null},
    media:!includeRefs&&source.media.via==='confirmed_url_host'?{...source.media,host:null}:source.media}))}:null;
  // Match the on-screen summaries: count natural sentences once and let the
  // latest attempt supersede an older completed check for the same claim.
  const completedResearch = analysis?.mode === 'live'
    ? external!.completedClaims
    : analysis ? completedFactualChecks(analysis.claims, research.flatMap(v => v.checks)).length : 0;
  return {
    schemaVersion: '2.5', rubric: analysis?.versions.rubric, mode: analysis?.mode, feedback,
    parentAnalysisId: analysis?.analysisId ?? null,
    stale: !!analysis && stale,
    inputState: !analysis ? 'no_analysis' : stale ? 'stale' : 'current',
    scores: buildAnalysisScores(analysis,biasAssessment,{observations:analysis?observationsFromResearch(analysis,research):[],weightSet:SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025}),
    articleOverview: analysis ? {
      version: 'article-overview-1.0',
      relativeComparison: compareRelativeBaseline(analysis.sources.find(source=>source.kind==='body')?.text??'',analysis.article?.title),
      primaryTrustMetric: 'attribution',
      bodyLanguage: languageMetrics(analysis, 'body'),
      includingCommentsLanguage: languageMetrics(analysis, 'all'),
      bodyPosition: analysis.bodyPosition ? {label: analysis.bodyPosition.label, evidenceCount: analysis.bodyPosition.evidence.length} : null,
    } : null,
    sourcing: sourcing ? {version: sourcing.version, summary: sourcing.summary, note: sourcing.note} : null,
    sourceAssessment:assessedSources?{version:assessedSources.version,summary:assessedSources.summary,note:assessedSources.note}:null,
    summary: analysis ? {
      topics: analysis.topics.length, sentences: expression!.total,
      flagged: expression!.flagged,
      claims: analysis.claims.length,
      // The main gauge combines manual checks with the current external review.
      // Preserve that same order, including later external failures/skips.
      completedChecks: completedFactualChecks(analysis.claims, [...checks, ...external!.checks]).length,
    } : null,
    research: {
      stage: analysis ? researchStage : 'not_started', resultCount: research.length,
      completedClaims: completedResearch,
      note: '취소·실패·부분 완료는 전체 조사 완료가 아닙니다. 자료·인용은 선택한 경우에만 포함됩니다.',
      ...(includeRefs ? {results: research.map(reviewData)} : {}),
    },
    ...(includeRaw ? {analysis, citedSources: sourcing, citedSourceAssessment:exportedAssessment} : {}),
    ...(includeRefs ? {verifications: manual.map(reviewData)} : {}),
    note: `${analysis&&stale?'입력이 수정되어 이전 입력의 분석 결과를 내보냅니다. 현재 입력의 점수가 아닙니다. ':''}사용자가 직접 내보낸 검토 기록입니다. 팀에 자동 접수되지 않습니다.`,
  };
}
