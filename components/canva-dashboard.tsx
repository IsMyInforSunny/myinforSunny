'use client';

import {useId} from 'react';
import {ArrowUpRight, FileSearch, FileText, MapPinned, Newspaper} from 'lucide-react';
import type {Analysis, Check} from '@/lib/contracts';
import type {ResearchStage, ResearchVerification} from '@/lib/research-contract';
import {completedFactualChecks, expressionSummary} from '@/lib/domain';
import {reliabilityReview, verifiedRecommendations} from '@/lib/reliability';
import {currentResearch} from '@/lib/current-research';

type Props = {
  analysis: Analysis | null;
  checks: Check[];
  researchResults: ResearchVerification[];
  /** 실제 자동 조사 진행 단계. 지정하지 않으면 조사 전으로 본다. */
  researchStage?: ResearchStage;
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

const bands = ['#f35a22', '#ffb53c', '#e6e619', '#40b74a', '#087b42'];
/* 바깥 띠는 원본의 VERY POOR~EXCELLENT 자리에 품질 등급 대신 대조 진행 구간을 적는다. */
const ringLabels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];

const axisHelp = {
  bias: '같은 명제에 대한 기사 입장을 매체별로 모아 잠정 기준선을 만들고, 입력 기사와의 차이를 매체 좌표에서 비교합니다. 매체별 고유 기사 3개, 적격 매체 2곳 이상이 필요하며 자료가 부족하면 계산을 기다립니다.',
  expression: '인신공격·조롱·공포 유도 등의 표현이 발견된 문장 수입니다. 인용과 문맥을 함께 확인해야 하며, 독자의 감정이나 심리 상태를 측정하지 않습니다.',
  trust: '추출된 사실 주장 중 자료와 대조를 완료한 건수입니다. 완료된 검토에도 근거 부족이나 상충 결과가 포함될 수 있습니다. 진실일 확률이나 기사 전체의 신뢰 점수가 아닙니다.',
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

export default function CanvaDashboard({analysis, checks, researchResults, researchStage = 'not_started', stale = false, onEvidence, onArticles, onInput, onCoordinates}: Props) {
  const id = useId();
  const isDemo = analysis?.mode === 'demo';
  const results = analysis ? currentResearch(analysis, researchResults) : [];
  const external = analysis ? reliabilityReview(analysis, results, researchStage) : null;
  const completed = analysis
    ? completedFactualChecks(analysis.claims, [...checks, ...(external?.checks ?? [])])
    : [];
  const total = analysis?.claims.filter(claim => claim.kind === 'factual').length ?? 0;
  const count = completed.length;
  const expression = analysis ? expressionSummary(analysis) : null;
  const cards = analysis?.mode === 'live' ? verifiedRecommendations(results) : [];
  const visibleCards = cards.slice(0, 3);
  const emptySlots = Math.max(0, 3 - visibleCards.length);
  const measured = Boolean(analysis && total);
  const angle = measured ? 180 + 180 * count / total : null;
  const prefix = `${stale ? '이전 입력 결과: ' : ''}${isDemo ? '가상 예시: ' : ''}`;
  const gaugeLabel = !analysis
    ? '분석 대기: 아직 검토 진행 정보가 없습니다.'
    : !total
      ? `${prefix}추출된 사실 주장이 없어 검토 진행도를 계산하지 않습니다.`
      : `${prefix}사실 주장 ${total}개 중 ${count}개 대조 완료. 진실일 확률이 아닙니다.`;
  const gaugeNote = !analysis
    ? '기사를 분석하면 사실 주장 대조 진행을 표시해요.'
    : !total
      ? '추출된 사실 주장이 없어 계산하지 않아요.'
      : `${prefix}사실 주장 ${total}개 중 ${count}개 대조 · 진실 점수 아님`;
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

      <div className="cv3-frame">
        <div className={`cv3-board${measured ? '' : ' is-waiting'}`}>
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

            <ul className="cv3-axes" aria-label="편향·자극·신뢰">
              <li className="cv3-axis cv3-axis-bias">
                <span className="cv3-axis-label">편향</span>
                {onCoordinates ? (
                  <button type="button" className="cv3-axis-action" onClick={onCoordinates}>
                    <MapPinned size={18} aria-hidden="true" /> 좌표 보기
                  </button>
                ) : (
                  <strong className="cv3-axis-value cv3-axis-value-text">좌표 비교</strong>
                )}
                <small className="cv3-axis-caption">매체 기준선과 입장 차이</small>
              </li>
              <li className="cv3-axis cv3-axis-expression">
                <span className="cv3-axis-label">자극</span>
                <strong className="cv3-axis-value">{expression ? `${expression.flagged}문장` : '—'}</strong>
                <small className="cv3-axis-caption">{expression ? `전체 ${expression.total}문장 중 표현 표시` : '표현 분석 대기'}</small>
              </li>
              <li className="cv3-axis cv3-axis-trust">
                <span className="cv3-axis-label">신뢰</span>
                <strong className="cv3-axis-value">{analysis ? (total ? `${count}/${total}` : '해당 없음') : '—'}</strong>
                <small className="cv3-axis-caption">대조 완료 / 추출된 사실 주장</small>
              </li>
            </ul>
          </div>

          <div className="cv3-gauge-caption">
            <h2>검토 진행도</h2>
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
                    <small className="cv3-tile-publisher">{card.publisherDomain} <ArrowUpRight size={12} aria-hidden="true" /></small>
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
            <button type="button" className="cv3-articles-button" disabled={!analysis} onClick={onArticles}>
              추천·조사 열기
            </button>
            <button type="button" className="cv3-evidence-button" disabled={!analysis} onClick={onEvidence}>
              <FileSearch size={22} aria-hidden="true" /> 분석근거 표시
            </button>
          </div>
        </div>
      </div>

      {analysis?.status === 'partial' && <p className="cv3-notice" role="note">일부 분석만 완료된 결과입니다. 빠진 내용과 분석 한계를 근거 화면에서 확인해주세요.</p>}
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
          <dt>검토 진행도</dt><dd>색과 바늘은 사실 주장 대조 진행을 나타냅니다. 바깥 띠의 숫자는 진행 구간입니다. 진실일 확률·종합 신뢰도·편향 점수가 아닙니다.</dd>
        </dl>
      </details>
    </section>
  );
}
