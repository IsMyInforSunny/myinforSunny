'use client';

import {useId} from 'react';
import {ArrowUpRight, FileSearch, FileText, MapPinned, Newspaper} from 'lucide-react';
import type {Analysis, Check} from '@/lib/contracts';
import type {ResearchStage, ResearchVerification} from '@/lib/research-contract';
import {expressionSummary} from '@/lib/domain';
import {verifiedRecommendations} from '@/lib/reliability';
import {currentResearch} from '@/lib/current-research';
import {analyzeBiasCoordinate, type BiasArticleCoordinate, type BiasOrientationSet} from '@/lib/bias-analysis';
import {assessWeightedClaimEvidence, type EvidenceObservation, type PublisherWeightSet} from '@/lib/source-reliability';

type Props = {
  analysis: Analysis | null;
  researchResults: ResearchVerification[];
  /** Kept for existing preview and report consumers; not used as gauge input. */
  checks?: Check[];
  researchStage?: ResearchStage;
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
const ringLabels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];

const axisHelp = {
  bias: '같은 비교 주제의 매체 기사를 검증된 모델의 상대 좌표에 놓고, 매체별 기사 중심의 동일가중 중간지점과 입력 기사를 비교합니다. Claude의 매체 구분은 좌익·우익 축 방향을 정하고 검증하는 데만 사용합니다. 매체별 고유 기사 3개와 적격 매체 2곳 이상, 모델 평가가 필요합니다. 자료가 없으면 계산을 기다립니다.',
  expression: '인신공격·조롱·공포 유도 등의 표현이 발견된 문장 수입니다. 인용과 문맥을 함께 확인해야 하며, 독자의 감정이나 심리 상태를 측정하지 않습니다.',
  trust: 'Reuters Institute 2025 한국 매체별 이용자 신뢰 응답을 확인된 14개 매체의 출처 가중치로 사용합니다. 실제 기사에서는 인용 위치·발행 시점·원문 출처를 확인하고, 서로 독립된 자료의 뒷받침·상충·충돌 결과를 함께 집계합니다. 이용자 신뢰는 정확도와 같지 않습니다. 가중치가 없는 출처가 섞이면 계산을 보류합니다.',
} as const;

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
  reliabilityObservations = [], sourceWeightSet = null, stale = false, onEvidence, onArticles, onInput, onCoordinates}: Props) {
  const id = useId();
  const isDemo = analysis?.mode === 'demo';
  const results = analysis ? currentResearch(analysis, researchResults) : [];
  const total = analysis?.claims.filter(claim => claim.kind === 'factual').length ?? 0;
  const bias = analyzeBiasCoordinate(biasArticleCoordinates, biasOrientationSet, selectedBiasArticleId);
  const weightedReliability = assessWeightedClaimEvidence(reliabilityObservations, sourceWeightSet,
    analysis?.claims.filter(claim => claim.kind === 'factual').map(claim => claim.id) ?? []);
  const expression = analysis ? expressionSummary(analysis) : null;
  const cards = analysis?.mode === 'live' ? verifiedRecommendations(results, analysis) : [];
  const visibleCards = cards.slice(0, 3);
  const emptySlots = Math.max(0, 3 - visibleCards.length);
  const measured = bias.status === 'ready' && bias.gaugePercent !== null;
  const partial = analysis?.status === 'partial';
  const angle = measured ? 180 + 180 * bias.gaugePercent! / 100 : null;
  const prefix = `${stale ? '이전 입력 결과: ' : ''}${isDemo ? '가상 예시: ' : ''}`;
  const gaugeLabel = measured
    ? `${prefix}편향 정도 ${bias.gaugePercent!.toFixed(0)}%, 방향 ${bias.directionLabel ?? '불확실 구간'}. 참·거짓 확률이 아닙니다.`
    : `${prefix}편향 정도 계산 대기. 검증된 매체 기사 좌표와 비교 표본이 아직 없습니다.`;
  const gaugeNote = measured
    ? `${prefix}편향 강도 ${bias.gaugePercent!.toFixed(0)}% · ${bias.directionLabel ?? '방향 유보'} · 좌표 차이 ${bias.magnitude!.toFixed(2)}/2 (평가 오차 ±${bias.coordinateUncertainty!.toFixed(2)})`
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
                {onCoordinates ? (
                  <button type="button" className="cv3-axis-action" onClick={onCoordinates}>
                    <MapPinned size={18} aria-hidden="true" /> 좌표 보기
                  </button>
                ) : (
                <strong className="cv3-axis-value cv3-axis-value-text">{measured ? `${bias.gaugePercent!.toFixed(0)}%` : '계산 대기'}</strong>
                )}
                <small className="cv3-axis-caption">{measured ? `${bias.directionLabel ?? '방향 유보'} · ${bias.eligiblePublisherCount}개 매체 기준` : `상대 매체 좌표 · 기사 모델 대기`}</small>
              </li>
              <li className="cv3-axis cv3-axis-expression">
                <span className="cv3-axis-label">자극</span>
                <strong className="cv3-axis-value">{expression ? `${expression.flagged}문장` : '—'}</strong>
                <small className="cv3-axis-caption">{expression ? `전체 ${expression.total}문장 중 표현 표시` : '표현 분석 대기'}</small>
              </li>
              <li className="cv3-axis cv3-axis-trust">
                <span className="cv3-axis-label">신뢰</span>
                <strong className="cv3-axis-value">{!analysis ? '—' : !total ? '해당 없음' : weightedReliability.status === 'ready' ? `가중 근거 ${weightedReliability.claims.length}건` : weightedReliability.status === 'pending_weights' ? '출처 가중치 대기' : '근거 표본 대기'}</strong>
                <small className="cv3-axis-caption">{!analysis ? '출처 가중 분석 대기' : !total ? '대조할 사실 주장 없음' : '이용자 신뢰 가중 · 인용·시점·독립 근거 대조'}</small>
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
          <dt>자극</dt>
          <dd>
            {axisHelp.expression}
            {expression && expression.undetermined > 0 && ` 아직 판단하지 못한 문장 ${expression.undetermined}개가 있어요. 표시가 없다고 모두 자극적인 표현이 없는 것은 아닙니다.`}
          </dd>
          <dt>신뢰</dt><dd>{axisHelp.trust}</dd>
          <dt>반원 게이지</dt><dd>바늘은 적격 매체별 기사 중심의 상대 중간지점에서 입력 기사 좌표가 벗어난 강도(0–2)를 0–100%로 환산해 표시합니다. 좌익·우익 방향은 별도로 표시합니다. 사실 대조 진행률이나 진실 확률이 아닙니다. 데이터와 검증 결과가 없으면 계산 대기입니다.</dd>
        </dl>
        {weightedReliability.claims.some(claim => claim.shares) && <section aria-label="주장별 출처 가중 근거 구성">
          <h3>주장별 출처 가중 근거 구성</h3>
          {weightedReliability.claims.filter(claim => claim.shares).map(claim => <article key={claim.claimId}>
            <p>{analysis?.claims.find(item => item.id === claim.claimId)?.text ?? '사실 주장'} · 뒷받침 {(claim.shares!.supports * 100).toFixed(0)}% · 상충 {(claim.shares!.contradicts * 100).toFixed(0)}% · 충돌 {(claim.shares!.conflicting * 100).toFixed(0)}%</p>
            <small>가중치 합 {claim.weightSum.toFixed(2)} · 출처 {claim.eligiblePublisherCount}곳 · 기사 {claim.eligibleArticleCount}건 · 독립 근거 집단 {claim.eligibleEvidenceGroupCount}개</small>
            <details><summary>적용한 출처 가중치 근거와 버전</summary>
              <ul>{claim.weightsUsed.map(weight => <li key={weight.publisher}>{weight.publisher}: {weight.value.toFixed(2)} · {weight.version} · {weight.evidence}</li>)}</ul>
            </details>
          </article>)}
        </section>}
      </details>
    </section>
  );
}
