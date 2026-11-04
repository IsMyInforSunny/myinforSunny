'use client';

import {useId} from 'react';
import {ArrowUpRight, FileSearch, FileText, MapPinned, Newspaper} from 'lucide-react';
import type {Analysis, Check} from '@/lib/contracts';
import type {ResearchStage, ResearchVerification} from '@/lib/research-contract';
import {expressionSummary} from '@/lib/domain';
import {verifiedRecommendations} from '@/lib/reliability';
import {currentResearch} from '@/lib/current-research';
import {analyzeBiasCoordinate, type BiasAnalysisResult, type BiasArticleCoordinate, type BiasOrientationSet} from '@/lib/bias-analysis';
import {assessWeightedClaimEvidence, type EvidenceObservation, type PublisherWeightSet, type WeightedClaimEvidence} from '@/lib/source-reliability';
import {MIN_N_FOR_PERCENT} from '@/lib/display';
import {reviewCitedSources, type ClaimSourcingStatus, type CitedSourceType} from '@/lib/cited-sources';
import {buildAnalysisScores} from '@/lib/analysis-scores';
import {reviewedCitedSources} from '@/lib/cited-source-confirmations';

type Props = {
  analysis: Analysis | null;
  researchResults: ResearchVerification[];
  /** Kept for existing preview and report consumers; not used as gauge input. */
  checks?: Check[];
  researchStage?: ResearchStage;
  /** Known service/model availability; null means it has not been checked yet. */
  availability?: {biasModelReady:boolean;articleResearchReady:boolean;biasComparisonGroup?:string|null} | null;
  biasArticleCoordinates?: BiasArticleCoordinate[];
  biasOrientationSet?: BiasOrientationSet | null;
  selectedBiasArticleId?: string;
  reliabilityObservations?: EvidenceObservation[];
  sourceWeightSet?: PublisherWeightSet | null;
  /** 입력이 바뀌어 화면의 결과가 이전 입력의 것일 때 true. */
  stale?: boolean;
  /** 분석근거 창을 연다. */
  onEvidence: () => void;
  /** 추천 기사·자동 조사 영역을 연다. */
  onArticles: () => void;
  /** 기사 입력 창을 연다. 메인 화면에는 입력 영역을 두지 않는다. */
  onInput?: () => void;
  /** 매체 좌표 창을 연다. 편향 항목의 조작이다. */
  onCoordinates?: () => void;
};

/* Canva 원본 3페이지(25×20)의 게이지 비율. viewBox 단위로 계산한다. */
const CX = 250;
const CY = 232;
const RING_OUTER = 226;
const RING_INNER = 197;
const FAN_INNER = 64;
const NEEDLE = 178;

const bands = ['#087b42', '#40b74a', '#e6e619', '#ffb53c', '#f35a22'];
/* 바깥 띠는 검증된 편향 강도 구간이다. */
const ringLabels = ['0–20점', '20–40점', '40–60점', '60–80점', '80–100점'];

const axisHelp = {
  bias: '같은 비교 주제의 매체 기사를 검증된 모델의 상대 좌표에 놓고, 매체별 기사 중심의 동일가중 중간지점과 입력 기사를 비교합니다. Claude의 매체 구분은 좌익·우익 축 방향을 정하고 검증하는 데만 사용합니다. 매체별 고유 기사 3개와 적격 매체 2곳 이상, 모델 평가가 필요합니다. 자료가 없으면 계산을 기다립니다.',
  expression: '자극 점수는 인신공격·조롱·공포 유도 등의 표현이 발견된 자연 문장 수를 본문·댓글의 전체 자연 문장 수로 나누고 100을 곱합니다. 미판정 문장은 가능한 점수 범위로 표시합니다. 인용과 문맥을 함께 확인해야 하며, 독자의 감정이나 심리 상태를 측정하지 않습니다.',
  trust: '먼저 기사가 사실 주장의 근거로 든 출처를 봅니다. 공식 통계·공공기관·연구처럼 자료 이름이나 시점까지 적힌 1차 자료인지, 이름 있는 당사자·단체인지, 관계자·전언처럼 확인할 수 없는 출처인지, 출처 표시가 없는지를 문장에서 찾아 분류합니다. 출처가 실제로 그렇게 말했는지와 주장의 참·거짓은 이 분류만으로 알 수 없습니다. 외부 자료를 조사한 경우에는 Reuters Institute 2025 한국 매체별 이용자 신뢰 응답을 확인된 14개 매체의 출처 가중치로 사용합니다. 실제 기사에서는 인용 위치·발행 시점·원문 출처를 확인하고, 서로 독립된 자료의 뒷받침·상충·충돌 결과를 함께 집계합니다. 이용자 신뢰는 정확도와 같지 않습니다. 가중치가 없는 출처가 섞이면 계산을 보류합니다.',
} as const;

/* 기사가 사실 주장의 근거로 든 출처가 어디까지 추적 가능한지. 점수가 아니라 분류다. */
const sourcingLabels: Record<ClaimSourcingStatus, string> = {
  traceable_primary: '1차 자료 출처',
  traceable_secondary: '이름 있는 출처',
  weak: '익명·전언 출처',
  unattributed: '출처 표시 없음',
};
const citedTypeLabels: Record<CitedSourceType, string> = {
  official_statistics: '공식 통계',
  public_agency: '공공기관·공식 기록',
  research: '연구·학술',
  named_person: '실명 당사자',
  organization: '기업·단체',
  media_report: '다른 언론 재인용',
  anonymous: '익명·불특정',
};

/* 주장별 가중 구성이 아직 계산되지 않은 이유. 값이 없다는 것을 기사 판단으로 읽지 않게 사유를 그대로 보인다. */
const weightedPendingLabels: Record<Exclude<WeightedClaimEvidence['status'], 'weighted_evidence_available'>, string> = {
  weight_missing: '가중치가 없는 출처가 있어 계산 보류',
  insufficient_publishers: '가중치가 있는 출처가 2곳 미만',
  insufficient_evidence_groups: '독립 근거 집단이 2개 미만',
  no_eligible_evidence: '인용·시점이 확인된 근거 없음',
};

/* 편향 계산 대기 사유. bias-analysis의 실제 reason과 표본 수를 그대로 보여 주며, 기준을 낮추지 않는다. */
function biasPendingText(bias: BiasAnalysisResult, availability: Props['availability']): string {
  if (availability?.biasModelReady === false) return '편향: 실제 기사로 학습·홀드아웃 평가·축 검토를 통과한 SVM 모델이 아직 공개되지 않아 계산을 기다려요.';
  switch (bias.reason) {
    case 'no_selected_article':
    case 'selected_article_missing':
      return availability?.biasComparisonGroup
        ? `편향: 이 기사의 명제가 공개 모델의 비교 주제(“${availability.biasComparisonGroup}”)와 같지 않거나 본문 좌표를 산출하지 못했어요.`
        : '편향: 입력 기사의 모델 좌표가 아직 없어요.';
    case 'selected_article_ambiguous': return '편향: 입력 기사 좌표가 중복되어 어느 값을 쓸지 정할 수 없어요.';
    case 'no_orientation_profiles':
    case 'invalid_orientation_profiles': return '편향: 좌익·우익 축 방향을 정할 매체 기준표가 없거나 유효하지 않아요.';
    case 'model_coordinate_mismatch': return '편향: 비교 기사 좌표가 현재 공개 모델과 다른 모델·평가 버전에서 산출되어 함께 쓸 수 없어요.';
    case 'insufficient_publisher_samples':
      return `편향: 매체별 고유 기사 ${bias.minArticlesPerPublisher}개 이상인 적격 매체가 ${bias.eligiblePublisherCount}/${bias.minEligiblePublishers}곳이에요 (같은 명제 비교 기사 ${Math.max(0, bias.uniqueArticleCount - 1)}개 확보).`;
    case 'model_not_validated': return '편향: 비교 매체 중 모델 홀드아웃 평가 지표가 없는 곳이 있거나 검증 정보가 부족해요.';
    case 'axis_orientation_validation_failed': return '편향: 좌익·우익 기준 매체의 모델 좌표 순서가 검증되지 않아 방향과 기준선을 정할 수 없어요.';
    default: return '편향: 같은 명제의 비교 기사나 모델 검증 조건이 부족해요. 매체 좌표에서 준비 상태를 확인해 주세요.';
  }
}

const recommendationLabels = {
  opposing_view: '다른 입장',
  supporting_view: '같은 입장',
  different_evidence: '다른 근거',
  context: '맥락 더하기',
} as const;

function point(radius: number, angle: number) {
  const radians = angle * Math.PI / 180;
  return [
    Number((CX + radius * Math.cos(radians)).toFixed(3)),
    Number((CY + radius * Math.sin(radians)).toFixed(3)),
  ];
}

function sector(from: number, to: number, outer: number, inner: number) {
  const [x1, y1] = point(outer, from);
  const [x2, y2] = point(outer, to);
  const [x3, y3] = point(inner, to);
  const [x4, y4] = point(inner, from);
  return `M ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x4} ${y4} Z`;
}

function needle(angle: number) {
  const radians = angle * Math.PI / 180;
  const [tipX, tipY] = point(NEEDLE, angle);
  const [tailX, tailY] = point(-18, angle);
  const dx = Number((-Math.sin(radians) * 10).toFixed(3));
  const dy = Number((Math.cos(radians) * 10).toFixed(3));
  return `${tipX},${tipY} ${Number((tailX + dx).toFixed(3))},${Number((tailY + dy).toFixed(3))} ${Number((tailX - dx).toFixed(3))},${Number((tailY - dy).toFixed(3))}`;
}

export default function CanvaDashboard({analysis, researchResults, biasArticleCoordinates = [], biasOrientationSet = null, selectedBiasArticleId,
  reliabilityObservations = [], sourceWeightSet = null, researchStage = 'not_started', availability = null, stale = false, onEvidence, onArticles, onInput, onCoordinates}: Props) {
  const id = useId();
  const isDemo = analysis?.mode === 'demo';
  const results = analysis ? currentResearch(analysis, researchResults) : [];
  const total = analysis?.claims.filter(claim => claim.kind === 'factual').length ?? 0;
  const bias = analyzeBiasCoordinate(biasArticleCoordinates, biasOrientationSet, selectedBiasArticleId);
  const scores = buildAnalysisScores(analysis,bias,{observations:reliabilityObservations,weightSet:sourceWeightSet});
  const scoreLabel = (score:typeof scores.bias) => score.value === null ? score.status === 'not_applicable' ? '해당 없음' : '산출 대기'
    : score.status === 'partial' && score.upperBound !== undefined && score.upperBound !== score.value ? `${score.value}–${score.upperBound}점` : `${score.value}점`;
  const weightedReliability = assessWeightedClaimEvidence(reliabilityObservations, sourceWeightSet,
    analysis?.claims.filter(claim => claim.kind === 'factual').map(claim => claim.id) ?? []);
  const cited = analysis ? reviewCitedSources(analysis) : null;
  const sourceAssessment = analysis ? reviewedCitedSources(analysis,results,sourceWeightSet) : null;
  const tracedClaims = scores.attribution.numerator ?? 0;
  const weightedReady = weightedReliability.claims.filter(claim => claim.status === 'weighted_evidence_available').length;
  const evidenceGroups = new Set(reliabilityObservations.map(item=>item.originId??item.articleId)).size;
  const weightedObserved = weightedReliability.claims.filter(claim => claim.publisherCounts.length > 0);
  const expression = analysis ? expressionSummary(analysis) : null;
  const cards = analysis?.mode === 'live' ? verifiedRecommendations(results, analysis) : [];
  const visibleCards = cards.slice(0, 3);
  const emptySlots = Math.max(0, 3 - visibleCards.length);
  const measured = bias.status === 'ready' && bias.gaugePercent !== null;
  const partial = analysis?.status === 'partial';
  const pendingReasons:string[]=[];
  if(analysis?.mode==='live'&&!stale){
    if(scores.bias.status==='pending')pendingReasons.push(biasPendingText(bias,availability));
    if(scores.stimulation.status==='pending')pendingReasons.push('자극: 표현을 판단할 수 있는 분석 결과가 부족해요. 분석근거에서 미판정 문장을 확인해 주세요.');
    if(scores.reliability.status==='pending'){
      const reasons=[...new Set(weightedObserved.flatMap(claim=>claim.status==='weighted_evidence_available'?[]:[weightedPendingLabels[claim.status]]))];
      pendingReasons.push(reasons.length?`신뢰: ${reasons.join(' · ')}.`
        :availability?.articleResearchReady===false?'신뢰: 관련 기사 검색과 원문 수집을 연결 중이에요. 아직 외부 근거를 대조하지 못했어요.'
        :['planning','searching','fetching','waiting','comparing'].includes(researchStage)?'신뢰: 외부 자료를 조사하고 있어요. 조사 진행 상태는 추천·조사 창에서 확인해 주세요.'
        :'신뢰: 외부 근거 대조가 필요해요. 추천·조사 창에서 조사 상태와 확보한 자료를 확인해 주세요.');
    }
  }
  const angle = measured ? 180 + 180 * bias.gaugePercent! / 100 : null;
  const prefix = `${stale ? '이전 입력 결과: ' : ''}${isDemo ? '가상 예시: ' : ''}`;
  const gaugeLabel = measured
    ? `${prefix}편향 정도 ${scores.bias.value}점, 100점 만점, 방향 ${bias.directionLabel ?? '불확실 구간'}. 참·거짓 확률이 아닙니다.`
    : `${prefix}편향 정도 계산 대기. 검증된 매체 기사 좌표와 비교 표본이 아직 없습니다.`;
  const gaugeNote = measured
    ? `${prefix}편향 강도 ${scores.bias.value}점 / 100 · ${bias.directionLabel ?? '방향 유보'} · 좌표 차이 ${bias.magnitude!.toFixed(2)}/2 (평가 오차 ±${bias.coordinateUncertainty!.toFixed(2)})`
    : `${prefix}편향 분석 대기 · 검증된 기사 모델·매체별 평가·비교 표본 필요`;
  const recommendationGuide = cards.length
    ? `확인된 ${cards.length}개 중 ${visibleCards.length}개 · 본문 인용 확인 · 기사 전체의 정확성 보증 아님`
    : isDemo
      ? '가상 예시에는 실제 추천 기사를 넣지 않아요.'
      : analysis
        ? '본문과 인용을 확인한 기사가 아직 없어요. 추천이 없다고 기사를 판단하지 마세요.'
        : '분석 후, 본문과 인용을 확인한 기사만 보여드려요.';

  return (
    <section className="cv3" aria-label="기사 분석 화면">
      <div className="cv3-topbar">
        <span className="cv3-status" role="status">
          {isDemo
            ? `가상 예시 · 실제 웹 조사 아님${stale ? ' · 이전 입력' : ''}`
            : analysis
              ? stale ? '이전 입력의 분석 결과' : '현재 입력의 분석 결과'
              : '분석을 기다리고 있어요'}
          {partial && ' · 일부만 분석됨'}
        </span>
        <span className="cv3-tagline">점수보다 중요한 건, 확인한 근거</span>
        {onInput && (
          <button type="button" className={`cv3-input-button${analysis ? '' : ' is-primary'}`} onClick={onInput}>
            <FileText size={16} aria-hidden="true" /> {analysis ? '기사 다시 입력' : '기사 입력하기'}
          </button>
        )}
      </div>

      {analysis && stale && (
        <p className="cv3-notice cv3-notice-stale" role="status">
          아래 지표·게이지·추천은 <strong>이전 입력</strong>으로 분석한 결과입니다. 기사 본문이 수정되어 지금 입력과 일치하지 않으니, 다시 분석한 뒤 확인해주세요.
        </p>
      )}
      {partial && <p className="cv3-notice" role="note">일부 분석만 완료된 결과입니다. 빠진 내용과 분석 한계를 근거 화면에서 확인해주세요.</p>}
      {!!pendingReasons.length&&<aside className="cv3-notice" aria-label="산출 대기 이유"><strong>산출 대기 이유</strong>{pendingReasons.map(reason=><p key={reason}>{reason}</p>)}</aside>}

      <div className="cv3-frame">
        <div className={`cv3-board${measured ? '' : ' is-waiting'}${analysis && stale ? ' is-stale' : ''}`}>
          <div className="cv3-gauge">
            <svg className="cv3-gauge-svg" viewBox="0 0 500 252" role="img" aria-label={gaugeLabel}>
              <path d={sector(180, 360, RING_OUTER, RING_INNER)} className="cv3-ring" />
              {ringLabels.map((label, index) => {
                const labelAngle = 198 + index * 36;
                const [x, y] = point((RING_OUTER + RING_INNER) / 2, labelAngle);
                return (
                  <text key={label} x={x} y={y} className="cv3-ring-label" textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(${labelAngle + 90} ${x} ${y})`}>
                    {label}
                  </text>
                );
              })}
              <g className="cv3-fan">
                {bands.map((color, index) => (
                  <path key={color} d={sector(180 + index * 36, 180 + (index + 1) * 36, RING_INNER, FAN_INNER)} fill={color} />
                ))}
              </g>
              <path d={`M ${CX - FAN_INNER} ${CY} A ${FAN_INNER} ${FAN_INNER} 0 0 1 ${CX + FAN_INNER} ${CY} Z`} className="cv3-hub" />
              {angle !== null && (
                <g className="cv3-needle">
                  <polygon points={needle(angle)} />
                  <circle cx={CX} cy={CY} r="15" className="cv3-needle-cap" />
                  <circle cx={CX} cy={CY} r="5" />
                </g>
              )}
            </svg>

            <ul className="cv3-axes" aria-label={analysis && stale ? '편향·자극·신뢰 (이전 입력의 결과)' : '편향·자극·신뢰'}>
              <li className="cv3-axis cv3-axis-bias">
                <span className="cv3-axis-label">편향</span>
                <strong className={`cv3-axis-value${scores.bias.value === null ? ' cv3-axis-value-text' : ''}`}>{scoreLabel(scores.bias)}</strong>
                {onCoordinates ? (
                  <button type="button" className="cv3-axis-action cv3-score-coordinate" onClick={onCoordinates}>
                    <MapPinned size={18} aria-hidden="true" /> 좌표 보기
                  </button>
                ) : null}
                <small className="cv3-axis-caption">{measured ? `${bias.directionLabel ?? (bias.reason === 'within_uncertainty' ? '평가 오차 이내 · 방향 유보' : '방향 유보')} · ${bias.eligiblePublisherCount}개 매체 기준`
                  : availability?.biasModelReady === false ? '검증 모델 미공개 · 계산 대기'
                  : bias.reason === 'insufficient_publisher_samples' ? `적격 매체 ${bias.eligiblePublisherCount}/${bias.minEligiblePublishers}곳 · 계산 대기`
                  : '상대 매체 좌표 · 기사 모델 대기'}</small>
              </li>
              <li className="cv3-axis cv3-axis-expression">
                <span className="cv3-axis-label">자극</span>
                <strong className={`cv3-axis-value${scores.stimulation.value === null ? ' cv3-axis-value-text' : ''}`}>{scoreLabel(scores.stimulation)}{scores.stimulation.denominator !== null && <span className="cv3-score-sample">n={scores.stimulation.denominator}</span>}</strong>
                <small className="cv3-axis-caption">{expression ? `검출 ${expression.flagged}/${expression.total}문장 · 100점 만점${expression.undetermined ? ` · 미판정 ${expression.undetermined}` : ''}` : '표현 분석 대기'}</small>
              </li>
              <li className="cv3-axis cv3-axis-trust">
                <span className="cv3-axis-label">신뢰</span>
                <strong className={`cv3-axis-value${scores.reliability.value === null ? ' cv3-axis-value-text' : ''}`}>{scoreLabel(scores.reliability)}{scores.reliability.denominator !== null && scores.reliability.denominator > 0 && <span className="cv3-score-sample">n={scores.reliability.denominator}</span>}</strong>
                <small className="cv3-axis-measure">출처 가중 근거</small>
                <small className="cv3-axis-caption">{!analysis ? '근거 출처 분석 대기' : !total ? '대조할 사실 주장 없음' : `대조 ${weightedReady}/${total}주장 · 근거 ${evidenceGroups}집단`}</small>
                {analysis&&total>0&&<small className="cv3-axis-caption">출처 명시 {scoreLabel(scores.attribution)} ({tracedClaims}/{total})</small>}
              </li>
            </ul>
          </div>

          <div className="cv3-gauge-caption">
            <h2>편향 정도</h2>
            <p>{gaugeNote}</p>
          </div>

          <section className="cv3-recs" aria-labelledby={`${id}-recs`}>
            <div className="cv3-recs-heading">
              <h3 id={`${id}-recs`}>: 다른 추천기사</h3>
            </div>
            <ul className="cv3-recs-row">
              {visibleCards.map(card => (
                <li key={card.url}>
                  <a href={card.url} target="_blank" rel="noopener noreferrer" className={`cv3-tile cv3-tile-${card.kind}`}
                    title={`${card.title}\n${card.reason}`}>
                    <span className="cv3-tile-kind">{recommendationLabels[card.kind]}</span>
                    <strong className="cv3-tile-title">{card.title}</strong>
                    <small className="cv3-tile-publisher"><span>{card.publisherDomain}</span> <ArrowUpRight size={12} aria-hidden="true" /><span className="sr-only"> (새 탭에서 열림)</span></small>
                  </a>
                </li>
              ))}
              {Array.from({length: emptySlots}, (_, index) => (
                <li key={`empty-${index}`} className="cv3-tile cv3-tile-empty" aria-hidden="true">
                  <Newspaper size={22} />
                </li>
              ))}
            </ul>
            <p className="cv3-recs-guide">{recommendationGuide}</p>
          </section>

          <div className="cv3-actions">
            {!analysis && <span id={`${id}-locked`} className="sr-only">기사를 분석한 뒤에 열 수 있어요.</span>}
            <button type="button" className="cv3-articles-button" disabled={!analysis} aria-describedby={analysis ? undefined : `${id}-locked`} onClick={onArticles}>
              추천·조사 열기
            </button>
            <button type="button" className="cv3-evidence-button" disabled={!analysis} aria-describedby={analysis ? undefined : `${id}-locked`} onClick={onEvidence}>
              <FileSearch size={22} aria-hidden="true" /> 분석근거 표시
            </button>
          </div>
        </div>
      </div>

      {isDemo && <p className="cv3-notice" role="note">체험용 가상 데이터입니다. 위 건수는 예시이며 실제 기사나 외부 자료를 검증한 결과가 아닙니다.</p>}

      <details className="cv3-help">
        <summary>편향·자극·신뢰와 게이지는 이렇게 읽어요</summary>
        <dl>
          <dt>편향</dt><dd>{axisHelp.bias}</dd>
          <dt>점수 기준</dt><dd>모든 점수는 0–100점입니다. 편향·자극은 높을수록 해당 특성이 많이 관찰됐고, 신뢰는 현재 대조한 자료에서 출처 가중치를 반영한 뒷받침 근거의 비중이 높다는 뜻입니다. 사실 정확도나 진실 확률로 해석하지 않습니다. 출처 명시 점수는 이름 있는 출처가 적혀 있는지를 나타내는 별도 보조 정보입니다. 표본 건수와 외부 자료 대조 결과를 함께 확인해 주세요.</dd>
          <dt>신뢰 점수 산식·범위</dt><dd>{scores.reliability.note}</dd>
          <dt>자극</dt>
          <dd>
            {axisHelp.expression}
            {expression && expression.undetermined > 0 && ` 아직 판단하지 못한 문장 ${expression.undetermined}개가 있어요. 표시가 없다고 모두 자극적인 표현이 없는 것은 아닙니다.`}
          </dd>
          <dt>신뢰</dt><dd>{axisHelp.trust}</dd>
          <dt>반원 게이지</dt><dd>바늘은 적격 매체별 기사 중심의 상대 중간지점에서 입력 기사 좌표가 벗어난 강도(0–2)를 0–100점으로 환산해 표시합니다. 좌익·우익 방향은 별도로 표시합니다. 사실 대조 진행률이나 진실 확률이 아닙니다. 데이터와 검증 결과가 없으면 계산 대기입니다.</dd>
        </dl>
        {analysis && cited && total > 0 && <section aria-label="사실 주장의 근거 출처">
          <h3>사실 주장의 근거 출처 · 출처 특정 {tracedClaims}/{total}</h3>
          <p>1차 자료 {cited.summary.traceable_primary} · 2차·일반 명칭 출처 {cited.summary.traceable_secondary} · 익명·전언 {cited.summary.weak} · 출처 표시 없음 {cited.summary.unattributed}{!!cited.summary.unresolvedAttributionClaims && ` (화자 미확인 ${cited.summary.unresolvedAttributionClaims})`}</p>
          <p>{cited.note}</p>
          {cited.claims.map(item => {
            const linked = cited.sources.filter(source => item.sourceIds.includes(source.id));
            return <article key={item.claimId}>
              <p>{analysis.claims.find(claim => claim.id === item.claimId)?.text ?? '사실 주장'}</p>
              <small>{item.unresolvedAttribution ? '화자 미확인 · 앞 문장의 출처를 추측하지 않았습니다' : sourcingLabels[item.status]}{linked.map(source => ` · ${citedTypeLabels[source.type]}${source.name ? `: ${source.name}` : ''} (${source.reasons.join(', ')})`).join('')}</small>
            </article>;
          })}
        </section>}
        {analysis && sourceAssessment && total > 0 && <section aria-label="인용 출처의 원문 확인과 공개 가중">
          <h3>인용 출처 원문 확인 · {sourceAssessment.summary.originalVerifiedClaims}/{total}주장</h3>
          <p>{sourceAssessment.note}</p>
          {sourceAssessment.sources.map(source=><article key={source.citedSourceId}>
            <h4>{source.confirmedFromText.name??'익명·불특정 출처'}</h4>
            <p>{source.originalCheck.status==='verified'?'동일 출처의 취득 원문에서 인용 구절 확인':'원문 미확인'} · {source.originalCheck.reason}</p>
            {source.originalCheck.status==='verified'&&source.originalCheck.url&&<p><a href={source.originalCheck.url} target="_blank" rel="noopener noreferrer">확인한 출처 원문 ↗</a></p>}
            <p>{source.publicPrior.status==='applied'?`공개 이용자 신뢰 보조 가중 ${source.publicPrior.value?.toFixed(2)} · ${source.publicPrior.version}`:'적용 가능한 공개 출처 가중치 없음'}</p>
            <p>미확인: {source.unconfirmed.join(' · ')}</p>
          </article>)}
          {!sourceAssessment.sources.length&&<p>구체적인 인용 출처를 찾지 못했습니다. 원문이 없다는 뜻으로 단정하지 않습니다.</p>}
        </section>}
        {analysis && total > 0 && weightedObserved.length > 0 && <section aria-label="주장별 출처 가중 근거 구성">
          <h3>주장별 출처 가중 근거 구성 · {weightedReady}/{total} 주장 계산 가능</h3>
          <p>{weightedReliability.note}</p>
          {weightedReliability.methodology && <details><summary>가중치표 방법과 버전 ({weightedReliability.methodologyVersion})</summary>
            <p>{weightedReliability.methodology}</p>
          </details>}
          {weightedObserved.map(claim => <article key={claim.claimId}>
            <p>{analysis.claims.find(item => item.id === claim.claimId)?.text ?? '사실 주장'}</p>
            {claim.status !== 'weighted_evidence_available'
              ? <p>계산 대기 · {weightedPendingLabels[claim.status]}{claim.missingWeightPublishers.length > 0 && ` · 가중치 없는 출처: ${claim.missingWeightPublishers.join(', ')}`}</p>
              : claim.eligibleEvidenceGroupCount < MIN_N_FOR_PERCENT
                ? <p>표본 부족 · 독립 근거 집단 {claim.eligibleEvidenceGroupCount}개 · 분모(독립 근거 집단)가 {MIN_N_FOR_PERCENT}개 미만이라 비율을 표시하지 않습니다.</p>
                : <p>분모: 독립 근거 집단 {claim.eligibleEvidenceGroupCount}개 · 가중 근거 중 뒷받침 {(claim.shares!.supports * 100).toFixed(0)}% · 상충 {(claim.shares!.contradicts * 100).toFixed(0)}% · 충돌 {(claim.shares!.conflicting * 100).toFixed(0)}%</p>}
            <small>가중치 합 {claim.weightSum.toFixed(2)} · 가중치 있는 출처 {claim.eligiblePublisherCount}곳 · 독립 근거 집단 {claim.eligibleEvidenceGroupCount}개 · 맥락만 있는 근거 {claim.insufficientEvidenceCount}개</small>
            {claim.weightsUsed.length > 0 && <small> · 적용 가중치: {claim.weightsUsed.map(weight => `${weight.publisher} ${weight.value.toFixed(2)}`).join(', ')} ({claim.weightsUsed[0]!.version})</small>}
          </article>)}
        </section>}
      </details>
    </section>
  );
}
