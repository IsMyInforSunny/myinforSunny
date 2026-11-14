'use client';
import RelativeTopicComparison from './relative-topic-comparison';

import {useId, useState, type ReactNode} from 'react';
import {ArrowUpRight, ChevronRight, FileSearch, Newspaper, Search} from 'lucide-react';
import type {Analysis, Check, Span} from '@/lib/contracts';
import type {ResearchStage, ResearchVerification} from '@/lib/research-contract';
import {recommendationLabel, verifiedRecommendations, researchProposition} from '@/lib/reliability';
import {currentResearch} from '@/lib/current-research';
import {analyzeBiasCoordinate, type BiasArticleCoordinate, type BiasOrientationSet} from '@/lib/bias-analysis';
import type {EvidenceObservation, PublisherWeightSet} from '@/lib/source-reliability';
import {buildAnalysisScores} from '@/lib/analysis-scores';
import {languageMetrics} from '@/lib/language-metrics';
import CollectedArticles from './collected-articles';
import {compareArticleViewpoints} from '@/lib/viewpoint-comparison';
import SentenceVoicePanel from './sentence-voice-panel';
import {mainVoiceIssue} from '@/lib/voice-comparison';
import {voiceAssessmentFromResearch} from '@/lib/voice-model-adapter';

type Props = {
  analysis: Analysis | null;
  researchResults: ResearchVerification[];
  checks?: Check[];
  researchStage?: ResearchStage;
  availability?: {biasModelReady: boolean; articleResearchReady: boolean; biasComparisonGroup?: string | null} | null;
  biasArticleCoordinates?: BiasArticleCoordinate[];
  biasOrientationSet?: BiasOrientationSet | null;
  selectedBiasArticleId?: string;
  reliabilityObservations?: EvidenceObservation[];
  sourceWeightSet?: PublisherWeightSet | null;
  stale?: boolean;
  inputPanel?: ReactNode;
  relativeBody?: string;
  relativeTitle?: string;
  articlePanel?: ReactNode;
  providerLabel?: string;
  onEvidence: () => void;
  onArticles: () => void;
  onInput?: () => void;
  onCoordinates?: () => void;
  onQuote?: (span: Span) => void;
};

const stanceLabels = {support: '찬성 관점', oppose: '반대 관점', mixed: '복합 관점', not_expressed: '입장 표현 없음', undetermined: '입장 판단 유보'};
const researchLabels: Record<ResearchStage, string> = {not_started: '추가 조사 전', planning: '조사 계획 중', searching: '관련 기사 검색 중', fetching: '기사 본문 수집 중', waiting: '다음 조사 대기 중', comparing: '자료 대조 중', completed: '자료 조사 완료', partial: '일부 자료 대조', unavailable: '조사 연결 준비 중', failed: '조사 연결 확인 필요', cancelled: '조사 중단'};
function percentageText(metric: {value: number | null; upperBound?: number | null} | null | undefined) {
  if (!metric || metric.value === null) return '분석 대기';
  return metric.upperBound != null && metric.upperBound !== metric.value ? `${metric.value}–${metric.upperBound}%` : `${metric.value}%`;
}

function PercentageBar({value, label}: {value: number | null; label: string}) {
  return <div className={`studio-meter${value === null ? ' is-pending' : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(value === null ? {'aria-valuetext': '분석 대기'} : {'aria-valuenow': value})}>
    {value !== null && <span style={{width: `${value}%`}} />}
  </div>;
}

export default function CanvaDashboard({analysis, researchResults, researchStage = 'not_started', availability,
  biasArticleCoordinates = [], biasOrientationSet = null, selectedBiasArticleId, reliabilityObservations = [], sourceWeightSet = null,
  stale = false, inputPanel, articlePanel, providerLabel, relativeBody, relativeTitle, onEvidence, onArticles, onInput, onCoordinates, onQuote}: Props) {
  const id = useId();
  const [axisMode, setAxisMode] = useState<'argument' | 'political'>('argument');
  const [recommendationMode, setRecommendationMode] = useState<'all' | 'similar' | 'opposing'>('all');
  const [includeComments, setIncludeComments] = useState(false);
  const results = analysis ? currentResearch(analysis, researchResults) : [];
  const bias = analyzeBiasCoordinate(biasArticleCoordinates, biasOrientationSet, selectedBiasArticleId);
  const viewpoints=analysis?compareArticleViewpoints(analysis,results):null;
  const voiceAssessment=voiceAssessmentFromResearch(stale?null:analysis,results);
  const scores = buildAnalysisScores(analysis, bias, {observations: reliabilityObservations, weightSet: sourceWeightSet},voiceAssessment);
  const language = analysis ? languageMetrics(analysis, includeComments ? 'all' : 'body') : null;
  const proposition = analysis ? researchProposition(analysis) : undefined;
  const groundedProposition = analysis ? researchProposition({bodyPosition: analysis.bodyPosition, sources: analysis.sources}) : undefined;
  const normal = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ');
  const position = proposition && groundedProposition && normal(groundedProposition) === normal(proposition) ? analysis!.bodyPosition! : null;
  const unexpressed = analysis?.bodyPosition?.label === 'not_expressed' && !analysis.bodyPosition.proposition.trim();
  const politicalReady = bias.status === 'ready' && bias.selectedCoordinate !== null && bias.classifierAxisSign !== null;
  const voiceBody=analysis?.sources.find(source=>source.kind==='body')?.text??'';
  const voiceIssue=analysis?.sentenceVoices?mainVoiceIssue(voiceBody,analysis.sentenceVoices):null;
  const voiceReady=voiceIssue?.eligible===true;
  const positionReady = !!position && ['support', 'oppose', 'mixed'].includes(position.label);
  const marker = axisMode === 'political'
    ? politicalReady ? (bias.selectedCoordinate! + 1) * 50 : null
    : analysis?.sentenceVoices ? voiceReady&&voiceIssue!.coordinate!==null ? (voiceIssue!.coordinate!+1)*50 : null : positionReady ? position!.label === 'support' ? 83 : position!.label === 'oppose' ? 17 : 50 : null;
  const voiceRange=axisMode==='argument'&&voiceReady&&voiceIssue?.coordinate===null?voiceIssue.bounds:null;
  const biasLabel = axisMode === 'political' ? politicalReady ? bias.directionLabel ?? '기준선 부근' : '비교 모델 준비 중' : analysis?.sentenceVoices ? voiceReady ? voiceRange?`인용 균형 ${voiceRange.lower.toFixed(2)} ~ ${voiceRange.upper.toFixed(2)}`:`인용 균형 ${voiceIssue!.coordinate!.toFixed(2)}` : '인용 방향 근거 부족' : position ? stanceLabels[position.label] : unexpressed ? '입장 표현 없음' : analysis ? '본문 입장 분석 대기' : '분석 대기';
  const biasNote = axisMode === 'political'
    ? politicalReady ? `검증된 비교 기준선과의 거리 ${bias.magnitude?.toFixed(2)} · ${bias.eligiblePublisherCount}개 매체` : '좌우 위치는 검증된 매체 좌표 모델과 비교 표본이 준비되어야 표시합니다.'
    : analysis?.sentenceVoices ? `${voiceIssue?.proposition??'기사의 주 쟁점을 확인합니다.'} · 취재원 인용 균형을 같은 쟁점·분기와 비교하며 기자 서술 방향은 별도로 표시합니다.`
    : position ? `비교 명제 · ${proposition} · 본문 입장 방향 표시입니다. 편향 강도 점수는 검증된 동일 논점 SVM이 준비되면 산출합니다.`
      : unexpressed ? '본문에서 비교 명제에 대한 작성자 입장이 드러나지 않았습니다. 편향 강도 점수는 산출하지 않습니다.'
        : analysis ? '본문 입장 근거를 확인하지 못했습니다. 편향 강도 점수는 산출하지 않습니다.'
          : '논점이 있는 모든 분야를 살펴봅니다. 작성자 입장과 인용 근거를 확인합니다.';
  const allCards = analysis?.mode === 'live' ? verifiedRecommendations(results, analysis) : [];
  const cards = allCards.filter(card => recommendationMode === 'all' || card.relationToArticle === recommendationMode).slice(0, 3);
  const sourceScore = scores.attribution;
  const sourceText = sourceScore.status === 'not_applicable' ? '해당 없음' : percentageText(sourceScore);
  const scope = includeComments ? '본문·댓글' : '본문';
  const status = !analysis ? '기사를 입력해 주세요' : stale ? '입력 변경 · 다시 분석해 주세요' : analysis.mode === 'demo' ? '가상 예시 결과' : analysis.status === 'partial' ? '분석 미완료 · 일부 결과만 표시' : analysis.warnings.some(warning=>warning.code==='CACHED_ANALYSIS') ? '최근 분석 재사용' : '본문 분석 완료';

  return <section className="article-studio" aria-label="기사 분석 화면">
    <div className="studio-statusbar"><span role="status"><i className={stale ? 'is-stale' : ''} />{status}</span><span>논점과 표현, 근거를 한눈에</span></div>
    <div className="studio-layout">
      <aside className="studio-input-column" aria-label="기사 입력과 본문">
        {inputPanel ?? <button type="button" className="studio-input-fallback" onClick={onInput}><Search size={18} /> 기사를 입력해 주세요</button>}
        <div className="studio-reader">
          {articlePanel ?? (analysis ? <><h2>{analysis.article?.title ?? '분석한 기사'}</h2>{analysis.sources.filter(source => source.kind === 'body').map(source => <p key={source.id}>{source.text}</p>)}</> : <div className="studio-reader-empty"><Newspaper size={38} strokeWidth={1.3} /><h2>오늘 읽은 기사를<br />다른 시선으로.</h2><p>링크나 본문을 입력하면<br />논점·표현·근거를 함께 살펴봅니다.</p><span>교육 · 과학 · 경제 · 사회 · 문화 · 정치</span></div>)}
        </div>
      </aside>

      <div className={`studio-results${stale ? ' is-stale' : ''}`}>
        {stale && <p className="studio-alert" role="status">아래는 이전 입력의 결과입니다. 현재 내용으로 다시 분석해 주세요.</p>}
        <section className="studio-metrics" aria-labelledby={`${id}-metrics`}>
          <div className="studio-section-heading"><h2 id={`${id}-metrics`}>기사의 세 가지 성분</h2><span>분석 기준과 근거를 함께 확인하세요</span></div>
          <div className="studio-metric studio-bias">
            <div className="studio-metric-heading"><h3>편향 <small>관점의 방향</small></h3><select aria-label="편향 축 선택" value={axisMode} onChange={event => setAxisMode(event.target.value as 'argument' | 'political')}><option value="argument">논점 관점</option><option value="political">정치 좌우</option></select><strong>{biasLabel}</strong></div>
            <div className={`studio-bipolar${marker === null&&!voiceRange ? ' is-pending' : ''}`} role="img" aria-label={`${axisMode === 'political' ? '좌익부터 우익' : '반대부터 찬성'} · ${biasLabel}`}>
              <span className="studio-axis-center" />{marker !== null && <span className="studio-axis-marker" style={{left: `${Math.max(0, Math.min(100, marker))}%`}} />}
              {voiceRange&&<span className="studio-axis-range" style={{position:'absolute',top:0,bottom:0,left:`${(voiceRange.lower+1)*50}%`,width:`${(voiceRange.upper-voiceRange.lower)*50}%`,background:'#323c2680',border:'2px solid #323c26'}}/>}
            </div>
            <div className="studio-axis-labels"><span>{axisMode === 'political' ? '좌익' : '반대 관점'}</span><span>{axisMode === 'political' ? '기준선' : '복합 관점'}</span><span>{axisMode === 'political' ? '우익' : '찬성 관점'}</span></div>
            <p className="studio-metric-note">{biasNote}</p>
            {analysis&&axisMode==='argument'&&<div className="studio-viewpoint-comparison" aria-label="같은 논점의 관점 비교">
              <p><strong>편향 강도 · {scores.bias.status==='partial'?`${scores.bias.lowerBound} ~ ${scores.bias.upperBound}점`:scores.bias.value===null?'같은 쟁점·분기 비교 표본 대기':`${scores.bias.value}점`}</strong></p>
              {analysis.sentenceVoices?.method==='svm'&&<p>{scores.bias.note}</p>}
              <p>{viewpoints?.status==='ready'
                ? `인용 확인된 비교 기사 ${viewpoints.total}건 · ${viewpoints.publisherCount}개 매체 · 명제 찬성 ${viewpoints.support}건 / 반대 ${viewpoints.oppose}건`
                : viewpoints?.status==='no_grounded_proposition'?'비교할 본문 명제와 입장 근거 확인이 필요합니다.'
                  : `같은 명제의 인용 확인 기사 ${viewpoints?.total??0}건 · ${viewpoints?.publisherCount??0}개 매체 · 비교에 최소 3건·2개 매체가 필요합니다.`}</p>
              <button type="button" className="studio-text-button" onClick={onArticles}>비교 기사와 입장 근거 확인 <ChevronRight size={12}/></button>
              {viewpoints&&<p className="studio-metric-note">{viewpoints.scopeNote}</p>}
            </div>}
          </div>
          <div className="studio-metric">
            <div className="studio-metric-heading"><h3>자극 <small>공포 유도·과도한 단정</small></h3><strong>{percentageText(language?.stimulation)}</strong></div>
            <PercentageBar value={language?.stimulation.value ?? null} label={`${scope} 자극 표현 비율`} />
            <div className="studio-metric-foot"><p>{language ? `${scope} ${language.stimulation.flagged}/${language.total}문장${language.unresolved ? ` · 미판정 ${language.unresolved}` : ''}` : '분석할 본문을 입력해 주세요'}</p><button type="button" onClick={onEvidence} disabled={!analysis}>공격성 {percentageText(language?.aggression)} <ChevronRight size={12} /></button></div>
            <label className="studio-scope"><input type="checkbox" checked={includeComments} onChange={event => setIncludeComments(event.target.checked)} /> 댓글도 함께 집계</label>
          </div>
          <div className="studio-metric">
            <div className="studio-metric-heading"><h3>신뢰 <small>근거 출처 명시</small></h3><strong>{sourceText}</strong></div>
            <PercentageBar value={sourceScore.value} label="사실 주장의 출처 명시 비율" />
            <div className="studio-metric-foot"><p>{sourceScore.denominator ? `분석된 사실 주장 ${sourceScore.numerator}/${sourceScore.denominator}개에 출처 표시` : analysis ? '출처를 확인할 사실 주장 없음' : '통계·발언·자료의 출처를 확인합니다'}</p><button type="button" disabled={!analysis} onClick={onArticles}>자료 대조 <ChevronRight size={12} /></button></div>
            {sourceScore.unresolvedCount ? <p className="studio-metric-note">화자 미확인 {sourceScore.unresolvedCount}개는 가능한 범위에 포함했습니다.</p> : null}
            {scores.reliability.value !== null && <p className="studio-metric-note">외부 대조 근거 {percentageText(scores.reliability)} · {scores.reliability.denominator}개 주장</p>}
          </div>
        </section>

        <section className="studio-interpretation" aria-labelledby={`${id}-interpretation`}>
          <div className="studio-section-heading"><h2 id={`${id}-interpretation`}>이 기사는 무엇을 말하나요?</h2><button type="button" className="studio-text-button" disabled={!analysis} onClick={onEvidence}><FileSearch size={15} /> 분석 근거</button></div>
          {!analysis ? <p className="studio-intro">주요 논점과 주장, 표현의 특징을 원문에 연결해 보여드립니다.</p> : <>
            <div className="studio-topic-tags">{analysis.topics.map(topic => <span key={topic.id}>{topic.label}</span>)}</div>
            <p className="studio-main-argument">{position?.reason || analysis.claims.find(claim => claim.kind === 'opinion')?.text || analysis.topics[0]?.description || '본문의 논점과 근거를 확인해 주세요.'}</p>
            {analysis.bodyPosition?.attributionSource==='server_rule'&&<p className="studio-metric-note">발화 주체·비교 명제는 서버의 원문 규칙으로 보정했습니다. {analysis.bodyPosition.reason}</p>}
            {position?.evidence[0] && <button className="studio-quote" type="button" onClick={() => onQuote ? onQuote(position.evidence[0]) : onEvidence()}>“{position.evidence[0].quote}” <ArrowUpRight size={13} /></button>}
            <div className="studio-claim-counts"><span>사실 주장 <b>{analysis.claims.filter(claim => claim.kind === 'factual').length}</b></span><span>의견 <b>{analysis.claims.filter(claim => claim.kind === 'opinion').length}</b></span><span>공격 표현 <b>{language?.aggression.flagged ?? 0}문장</b></span></div>
            {analysis.status === 'partial' && <p className="studio-metric-note">일부 항목을 판단하지 못했습니다. 분석 근거에서 해당 문장을 확인할 수 있습니다.</p>}
          </>}
          <RelativeTopicComparison body={relativeBody ?? (!stale ? analysis?.sources.find(source=>source.kind==='body')?.text ?? '' : '')} title={relativeTitle ?? (!stale ? analysis?.article?.title ?? '' : '')} publishedAt={!stale?analysis?.article?.publishedAt:undefined}/>
          {analysis&&!stale&&<SentenceVoicePanel analysis={analysis} researchResults={results}/>}
        </section>

        <section className="studio-recommendations" aria-labelledby={`${id}-recommendations`}>
          <div className="studio-section-heading"><h2 id={`${id}-recommendations`}>함께 읽을 기사</h2><button type="button" className="studio-text-button" disabled={!analysis} onClick={onArticles}>{researchLabels[researchStage]} <ChevronRight size={14} /></button></div>
          <div className="studio-filter" role="group" aria-label="추천 기사 관점 선택">{([['all', '관련 기사'], ['similar', '같은 관점'], ['opposing', '다른 관점']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={recommendationMode === value} onClick={() => setRecommendationMode(value)}>{label}</button>)}</div>
          {analysis?.mode === 'live' && recommendationMode === 'all' && allCards.length === 0 ? <CollectedArticles key={analysis.analysisId} analysis={analysis} stale={stale}/> : <div className="studio-card-grid">{cards.map(card => <a key={card.url} href={card.url} target="_blank" rel="noopener noreferrer" className="studio-article-card"><span>{recommendationLabel(card)}</span><h3>{card.title}</h3><p>{card.reason}</p><footer>{card.publisherDomain}<ArrowUpRight size={14} /></footer></a>)}{Array.from({length: Math.max(0, 3 - cards.length)}, (_, index) => <div key={index} className="studio-article-card is-empty"><Newspaper size={23} strokeWidth={1.3} /><p>{analysis ? '자료 대조에서 관련 기사와 본문 인용을 확인해 주세요.' : ['같은 논점의 기사', '함께 살펴볼 관점', '비교할 근거 자료'][index]}</p></div>)}</div>}
        </section>

        <details className="studio-method"><summary>분석 기준과 AI 처리 과정</summary><div>
          <p>AI가 한 번의 본문 분석에서 논점·사실과 의견·본문 입장·표현 후보와 인용을 추출합니다. 화면의 문장 비율은 원문과 대조한 결과로 계산합니다.</p>
          <p>자극은 공포 유도·과도한 단정, 공격은 인신공격·집단 일반화·조롱·위협을 따로 집계합니다. 같은 문장이 두 기준에 해당할 수 있습니다.</p>
          <p>신뢰 칸은 사실 주장에 출처가 명시된 비율을 보여줍니다. 자료 대조를 실행하면 출처 원문·시점·뒷받침과 상충을 추가로 확인합니다.</p>
          <p>논점 관점의 표시는 본문의 찬반 분류이며 막대 위치는 분류를 나타냅니다. 강도나 확률은 계산하지 않습니다. 정치 좌우 모드는 검증된 매체 좌표를 사용합니다. 현재 PCA는 연구용이며 추천은 확인한 본문 입장과 인용을 기준으로 구성합니다.</p>
          <p>추가 기사 조사는 별도 AI 계획·검색·대조를 수행합니다. 무료 호출 한도에 따른 대기 시간이 추가됩니다.</p>
          <small>{providerLabel ? `연결 서비스 ${providerLabel}` : '연결 상태 확인 중'}{analysis ? ` · 실행 모델 ${analysis.versions.model}` : ''}</small>
          {analysis?.mode === 'live' && <p>정치 좌표 {availability?.biasModelReady ? politicalReady ? `기준선 거리 ${bias.magnitude?.toFixed(2)} · 편향 강도 ${scores.bias.value}%` : '같은 논점의 비교 표본 준비 중' : '검증된 SVM 모델 준비 중'} · 기사 연결 {availability?.articleResearchReady ? researchLabels[researchStage] : '검색과 원문 연결 준비 중'}</p>}
          {onCoordinates && <button type="button" className="studio-text-button" onClick={onCoordinates}>비교 좌표와 표본 보기 <ChevronRight size={14} /></button>}
        </div></details>
      </div>
    </div>
  </section>;
}
