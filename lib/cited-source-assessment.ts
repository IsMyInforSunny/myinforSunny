/**
 * Structured assessment of the sources an article cites for its factual claims.
 * Separates what the article text itself shows (type, name, document, date) from what is
 * still unconfirmed (that the institution exists, that it said this, that it is accurate).
 * A public trust prior is attached only when the cited outlet is identified exactly.
 * No network or model calls; no new scores, coefficients or probabilities.
 */
import type {Analysis} from './contracts';
import {reviewCitedSources, type CitedSource, type CitedSourceReview, type CitedSourceType, type ClaimSourcingStatus, type SourceTier} from './cited-sources';
import type {PublisherWeightSet} from './source-reliability';
import {canonicalPublisherHost, isValidPublisherWeightSet} from './source-reliability';
import {normalizeSourceUrl} from './source-quality';

export const CITED_SOURCE_ASSESSMENT_VERSION = 'cited-source-assessment-0.2';

/**
 * Exact outlet names → publisher host used by the public trust prior.
 * Names are the brands of the Reuters Institute Digital News Report 2025 South Korea brand-trust table
 * as recorded in `lib/public-trust-prior.ts`. Matching is whole-name equality after removing a
 * trailing "보도"/"뉴스"/"의 보도"; substrings never match (TV조선 ≠ 조선일보, 연합뉴스 ≠ 연합뉴스TV).
 */
export const MEDIA_NAME_MAP = {
  version: 'claude-media-name-map-2026-11-03',
  evidence: 'Reuters Institute Digital News Report 2025 South Korea brand trust table brand names, mapped to the publisher hosts in lib/public-trust-prior.ts. 연합뉴스(통신사, yna.co.kr)는 표에 없어 매핑하지 않는다.',
  entries: [
    {names: ['MBC', '엠비씨'], host: 'imnews.imbc.com'},
    {names: ['KBS', '케이비에스'], host: 'news.kbs.co.kr'},
    {names: ['SBS', '에스비에스'], host: 'news.sbs.co.kr'},
    {names: ['JTBC'], host: 'news.jtbc.co.kr'},
    {names: ['YTN'], host: 'ytn.co.kr'},
    {names: ['MBN'], host: 'mbn.co.kr'},
    {names: ['채널A', '채널에이'], host: 'ichannela.com'},
    {names: ['TV조선'], host: 'news.tvchosun.com'},
    {names: ['연합뉴스TV'], host: 'yonhapnewstv.co.kr'},
    {names: ['한겨레', '한겨레신문'], host: 'hani.co.kr'},
    {names: ['경향신문'], host: 'khan.co.kr'},
    {names: ['동아일보'], host: 'donga.com'},
    {names: ['중앙일보'], host: 'joongang.co.kr'},
    {names: ['조선일보'], host: 'chosun.com'},
  ],
} as const;

/** A caller-supplied record that a cited source's original was actually retrieved and matched. */
export type SourceConfirmation = {
  citedSourceId: string;
  url: string;
  provenance: 'web_fetched' | 'user_supplied' | 'demo';
  /** True only when the cited content was found verbatim in the retrieved original. */
  quoteMatched: boolean;
};

export type AttributionState = 'named' | 'generic' | 'anonymous';

export type CitedSourceAssessment = {
  citedSourceId: string;
  claimIds: string[];
  /** Location and text of the attribution in the analysed article; unchanged from reviewCitedSources. */
  sourceId: string;
  sentenceId: string;
  start: number;
  end: number;
  quote: string;
  /** What the article text shows. */
  confirmedFromText: {
    type: CitedSourceType;
    name: string | null;
    attribution: AttributionState;
    tier: SourceTier;
    primarySignal: boolean;
    documentNamed: boolean;
    dated: boolean;
    reasons: string[];
  };
  media: {
    status: 'matched' | 'not_media' | 'unmatched';
    host: string | null;
    via: 'confirmed_url_host' | 'name_mapping' | null;
    mappingVersion: string | null;
  };
  publicPrior: {
    status: 'applied' | 'not_applicable' | 'unavailable';
    value: number | null;
    version: string | null;
    evidence: string | null;
  };
  originalCheck: {
    status: 'verified' | 'unverified';
    url: string | null;
    host: string | null;
    reason: string;
  };
  /** Things this assessment does not establish, stated explicitly. */
  unconfirmed: string[];
};

export type ClaimSourceAssessment = {
  claimId: string;
  sourcing: ClaimSourcingStatus;
  unresolvedAttribution: boolean;
  citedSourceIds: string[];
  /** At least one cited source's original was retrieved and the cited content matched. */
  originalVerified: boolean;
  /** At least one cited outlet carries a public trust prior. Auxiliary only. */
  publicPriorApplied: boolean;
  unconfirmed: string[];
};

export type CitedSourceAssessmentResult = {
  version: typeof CITED_SOURCE_ASSESSMENT_VERSION;
  sourcingVersion: CitedSourceReview['version'];
  sources: CitedSourceAssessment[];
  claims: ClaimSourceAssessment[];
  summary: {
    factualClaims: number;
    citedSources: number;
    originalVerifiedClaims: number;
    unresolvedAttributionClaims: number;
    publicPriorAppliedSources: number;
  };
  note: string;
};

const NOTE = '기사 본문에서 찾은 출처 표현(유형·이름·자료명·시점)과, 원문을 실제로 확인했는지를 나눠 보여 줍니다. 기관의 실재, 출처가 실제로 그렇게 말했는지, 자료의 정확성은 원문 확인 전까지 미확인입니다. 공개 이용자 신뢰 가중치는 매체가 정확히 확인된 경우에만 보조 정보로 붙이며, 출처나 주장의 정확도를 뜻하지 않습니다. 이 결과는 점수나 확률이 아닙니다.';

const hostKey = canonicalPublisherHost;
const normalizeMediaName = (name: string) => name.replace(/\s+/g, '').replace(/(?:의)?(?:보도|뉴스)$/, '');

function mediaHostByName(name: string | null): string | null {
  if (!name) return null;
  const key = normalizeMediaName(name);
  for (const entry of MEDIA_NAME_MAP.entries) if ((entry.names as readonly string[]).some(n => n.replace(/\s+/g, '') === key)) return entry.host;
  return null;
}

function attributionOf(source: CitedSource): AttributionState {
  if (source.type === 'anonymous') return 'anonymous';
  return source.signals.named ? 'named' : 'generic';
}

/**
 * Builds the assessment from the article and optional confirmation records. Confirmations are
 * trusted only when they are fetched web originals with an exact cited-content match.
 */
export function assessCitedSources(
  analysis: Pick<Analysis, 'sources' | 'claims'>,
  options: {weightSet?: PublisherWeightSet | null; confirmations?: readonly SourceConfirmation[]} = {},
): CitedSourceAssessmentResult {
  const review = reviewCitedSources(analysis);
  const validWeights=isValidPublisherWeightSet(options.weightSet)?options.weightSet:null;
  const weights = new Map((validWeights?.weights ?? []).map(w => [hostKey(w.publisher), w]));
  const confirmations = options.confirmations ?? [];

  const claimIdsBySource = new Map<string, string[]>();
  for (const claim of review.claims) for (const id of claim.sourceIds) claimIdsBySource.set(id, [...(claimIdsBySource.get(id) ?? []), claim.claimId]);

  const sources: CitedSourceAssessment[] = review.sources.map(source => {
    const mappedHost=source.signals.named?mediaHostByName(source.name):null;
    // Original check: only a fetched public HTTPS page whose content matched counts as verified.
    const candidates = confirmations.filter(c => c.citedSourceId === source.id);
    let originalCheck: CitedSourceAssessment['originalCheck'] = {status: 'unverified', url: null, host: null, reason: '원문을 확인한 기록이 없음'};
    for (const c of candidates) {
      const normalized = normalizeSourceUrl(c.url);
      if (normalized.status !== 'ok' || !normalized.url || !normalized.host) { originalCheck = {status: 'unverified', url: null, host: null, reason: '공개 HTTPS 원문 주소가 아님'}; continue; }
      if (c.provenance !== 'web_fetched') { originalCheck = {status: 'unverified', url: normalized.url, host: normalized.host, reason: c.provenance === 'demo' ? '가상 예시 자료는 원문 확인이 아님' : '사용자가 붙여 넣은 자료는 원문 취득 확인이 아님'}; continue; }
      if (!c.quoteMatched) { originalCheck = {status: 'unverified', url: normalized.url, host: normalized.host, reason: '원문에서 해당 내용을 찾지 못함'}; continue; }
      if(mappedHost&&hostKey(normalized.host)!==mappedHost){originalCheck={status:'unverified',url:normalized.url,host:normalized.host,reason:'인용한 매체 이름과 원문 사이트가 일치하지 않음'};continue;}
      originalCheck = {status: 'verified', url: normalized.url, host: normalized.host, reason: '취득한 공개 원문에서 해당 내용 일치를 확인함'};
      break;
    }

    // A fetched publisher cannot replace the identity of the source it quotes.
    const verifiedHost = originalCheck.status === 'verified' && originalCheck.host ? hostKey(originalCheck.host) : null;
    const media: CitedSourceAssessment['media'] = mappedHost && verifiedHost === mappedHost
      ? {status: 'matched', host: verifiedHost, via: 'confirmed_url_host', mappingVersion: null}
      : mappedHost
        ? {status: 'matched', host: mappedHost, via: 'name_mapping', mappingVersion: MEDIA_NAME_MAP.version}
        : {status: source.type === 'media_report' ? 'unmatched' : 'not_media', host: null, via: null, mappingVersion: null};

    const weight = media.host ? weights.get(hostKey(media.host)) : undefined;
    const publicPrior: CitedSourceAssessment['publicPrior'] = media.status !== 'matched'
      ? {status: 'not_applicable', value: null, version: null, evidence: null}
      : weight && validWeights
        ? {status: 'applied', value: weight.value, version: validWeights.version, evidence: weight.evidence}
        : {status: 'unavailable', value: null, version: null, evidence: null};

    const attribution = attributionOf(source);
    const unconfirmed = [
      ...(attribution === 'anonymous' ? ['출처가 누구인지'] : []),
      ...(attribution === 'generic' ? ['어느 기관인지(일반 명칭)'] : []),
      ...(attribution === 'named' ? ['기관·인물의 실재와 명칭 정확성'] : []),
      ...(originalCheck.status === 'verified' ? [] : ['출처가 실제로 그렇게 말했는지(원문 미확인)']),
      '자료·발언 내용의 사실 정확성',
      ...(source.type === 'media_report' && originalCheck.status !== 'verified' ? ['재인용한 보도의 원 출처'] : []),
    ];

    return {
      citedSourceId: source.id,
      claimIds: claimIdsBySource.get(source.id) ?? [],
      sourceId: source.sourceId, sentenceId: source.sentenceId, start: source.start, end: source.end, quote: source.quote,
      confirmedFromText: {type: source.type, name: source.name, attribution, tier: source.tier, primarySignal: source.signals.primary,
        documentNamed: source.signals.documentNamed, dated: source.signals.dated, reasons: source.reasons},
      media, publicPrior, originalCheck, unconfirmed,
    };
  });

  const byId = new Map(sources.map(s => [s.citedSourceId, s]));
  const claims: ClaimSourceAssessment[] = review.claims.map(claim => {
    const linked = claim.sourceIds.map(id => byId.get(id)!).filter(Boolean);
    const originalVerified = linked.some(s => s.originalCheck.status === 'verified');
    const unresolved = !!claim.unresolvedAttribution;
    return {
      claimId: claim.claimId,
      sourcing: claim.status,
      unresolvedAttribution: unresolved,
      citedSourceIds: claim.sourceIds,
      originalVerified,
      publicPriorApplied: linked.some(s => s.publicPrior.status === 'applied'),
      unconfirmed: [
        ...(claim.status === 'unattributed' && !unresolved ? ['기사에 근거 출처가 표시되지 않음(규칙 미검출 가능)'] : []),
        ...(unresolved ? ['화자는 있으나 누구인지 확인되지 않음'] : []),
        ...(originalVerified ? [] : ['근거 원문 미확인']),
        '주장의 참·거짓',
      ],
    };
  });

  return {
    version: CITED_SOURCE_ASSESSMENT_VERSION,
    sourcingVersion: review.version,
    sources,
    claims,
    summary: {
      factualClaims: claims.length,
      citedSources: sources.length,
      originalVerifiedClaims: claims.filter(c => c.originalVerified).length,
      unresolvedAttributionClaims: claims.filter(c => c.unresolvedAttribution).length,
      publicPriorAppliedSources: sources.filter(s => s.publicPrior.status === 'applied').length,
    },
    note: NOTE,
  };
}
