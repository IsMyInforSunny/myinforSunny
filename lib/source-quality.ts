import type {Reference} from './contracts';

/**
 * 수집 자료의 품질 "관찰 정보"를 계산하는 순수 모듈 (서버/브라우저 공용).
 * - 네트워크·LLM·저장소·로그를 사용하지 않는다. 원문과 URL은 반환값 밖으로 나가지 않는다.
 * - 신뢰 점수가 아니다. 원자료 여부, 사실의 참거짓, 매체 성향, 독립성은 판단하지 않는다.
 */

export const SOURCE_QUALITY_VERSION = 'source-quality-1.0';

/** `Reference`와 호환되는 최소 입력. 없는 필드는 "불명"으로 처리한다. */
export type SourceInput = Pick<Reference, 'id' | 'text'> & Partial<Omit<Reference, 'id' | 'text'>>;

export type SourceQualityOptions = {
  /** `Claim.targetTime`과 같은 자유 서식 문자열. 해석할 수 없으면 시점 판정은 unknown. */
  targetTime?: string;
  /** 판정 기준 시각(ms). 미래 발행일 검사에만 쓰이며 시험에서는 고정한다. 기본 Date.now(). */
  now?: number;
  /** 이 글자 수 미만이면 'short'. 기본 200. */
  shortBodyChars?: number;
  /** 본문 중복 판정에 필요한 정규화 본문 최소 글자 수. 기본 200. 이보다 짧은 공통 문구는 비교하지 않는다. */
  minComparableChars?: number;
  /** 거의 동일 판정의 자카드 유사도 하한. 기본 0.9. */
  nearIdenticalThreshold?: number;
  /** 대상 기간보다 늦게 발행된 자료를 mismatch로 보기 전 허용 일수. 기본 365. */
  lateToleranceDays?: number;
};

export type UrlStatus = 'ok' | 'missing' | 'invalid' | 'not_https' | 'not_public';
export type DateStatus = 'present' | 'missing' | 'invalid' | 'future';
export type LengthStatus = 'empty' | 'short' | 'ok';
export type TruncationStatus = 'truncated' | 'complete' | 'unknown';
export type TemporalStatus = 'within_period' | 'later_than_period' | 'mismatch_candidate' | 'unknown';
export type TemporalReason =
  | 'no_target_time' | 'unparsable_target_time' | 'no_published_date'
  | 'published_before_target' | 'published_long_after_target' | 'published_after_target' | 'published_in_target';
export type DuplicateKind = 'same_url' | 'identical_text' | 'contained_text' | 'near_identical_text';

export type SourceObservation = {
  id: string;
  url: {status: UrlStatus; normalized?: string; host?: string};
  publishedAt: {status: DateStatus; iso?: string};
  fetchedAt: {status: DateStatus; iso?: string};
  body: {chars: number; lengthStatus: LengthStatus; truncation: TruncationStatus; fullTextLength?: number};
  /** 본문 안에서 발견된 https 링크 수. 링크가 원자료라는 뜻도, 없다는 것이 원자료라는 뜻도 아니다. */
  sourceLinks: {status: 'present' | 'none_found'; count: number; otherHostCount: number};
  temporal: {status: TemporalStatus; reason: TemporalReason};
};

export type DuplicateLink = {
  ids: [string, string];
  kinds: DuplicateKind[];
  /** false인 중복은 다른 도메인이 같은 보도자료·전재 기사를 실었을 수 있다는 표시이며 독립 출처가 아니다. */
  sameHost: boolean;
  /** 본문 정규화 유사도(0~1). 본문 비교 대상이 아니면 null. */
  similarity: number | null;
};

export type ContentCluster = {ids: string[]; hosts: string[]; crossHost: boolean};
export type SameHostGroup = {host: string; ids: string[]};

export type SourceQualitySummary = {
  total: number;
  validUrl: number; missingUrl: number; invalidUrl: number;
  withPublishedAt: number; withFetchedAt: number; missingPublishedAt: number;
  empty: number; short: number; truncated: number; truncationUnknown: number;
  withSourceLinks: number; noSourceLinksFound: number;
  temporalMismatchCandidates: number; temporalUnknown: number;
  duplicateLinkCount: number;
};

export type SourceQualityAssessment = {
  version: typeof SOURCE_QUALITY_VERSION;
  interpretation: 'observations_only';
  /** 항상 'not_determined': 도메인 수·중복 여부로 독립성을 확정하지 않는다. */
  independence: 'not_determined';
  items: SourceObservation[];
  duplicates: DuplicateLink[];
  contentClusters: ContentCluster[];
  sameHostGroups: SameHostGroup[];
  summary: SourceQualitySummary;
  notes: string[];
};

export type SelectionSkipReason = 'empty_text' | 'duplicate_of_selected' | 'over_limit';
export type SourceSelection<T extends SourceInput> = {
  selected: T[];
  skipped: {id: string; reason: SelectionSkipReason; duplicateOf?: string}[];
};

const NOTES = [
  '이 결과는 수집 자료의 관찰 정보이며 신뢰 점수나 사실 판정이 아니다.',
  '도메인이 달라도 같은 보도자료·전재일 수 있고, 같은 도메인이어도 독립성은 알 수 없다.',
  '링크·날짜·본문 길이의 유무는 원자료 여부나 정확성을 뜻하지 않는다.',
];

// ───────────────────────── URL ─────────────────────────

const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|_ga|_gl|ocid)$/i;

export type NormalizedUrl = {status: UrlStatus; url?: string; host?: string};

/** HTTPS 공개 출처 주소만 정규화한다. 추적 파라미터·fragment 제거, 나머지 쿼리는 유지(다른 기사 구분)하고 정렬한다. */
export function normalizeSourceUrl(input: unknown): NormalizedUrl {
  if (typeof input !== 'string' || !input.trim()) return {status: 'missing'};
  const raw = input.trim();
  if (raw.length > 2048) return {status: 'invalid'};
  let u: URL;
  try { u = new URL(raw); } catch { return {status: 'invalid'}; }
  if (u.protocol !== 'https:') return {status: u.protocol === 'http:' ? 'not_https' : 'invalid'};
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.username || u.password || u.port || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')
    || /\.(local|localhost|internal|lan|home|invalid)$/.test(host)) return {status: 'not_public'};
  const bare = host.replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.searchParams.sort();
  const query = u.searchParams.toString();
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  const url = `https://${bare}${path}${query ? `?${query}` : ''}`.replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase());
  return {status: 'ok', url, host: bare};
}

const LINK = /https:\/\/[^\s<>()[\]"'`]+/gi;
function linkStats(text: string, own: NormalizedUrl) {
  const all = new Set<string>(), hosts = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    const n = normalizeSourceUrl(m[0].replace(/[.,;:!?*_]+$/, ''));
    if (n.status !== 'ok' || n.url === own.url) continue;
    all.add(n.url!);
    if (n.host !== own.host) hosts.add(n.host!);
  }
  return {count: all.size, otherHostCount: hosts.size};
}

// ───────────────────────── 날짜·시점 ─────────────────────────

const DAY = 86400000, KST = 9 * 3600000;
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;
const kstDay = (ms: number) => Math.floor((ms + KST) / DAY);

function parseInstant(value: unknown): number | 'missing' | 'invalid' {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return 'missing';
  if (typeof value !== 'string') return 'invalid';
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) && ms >= Date.parse('1990-01-01T00:00:00Z') ? ms : 'invalid';
}

function dateObservation(value: unknown, ceiling: number): {status: DateStatus; iso?: string; ms?: number} {
  const ms = parseInstant(value);
  if (ms === 'missing' || ms === 'invalid') return {status: ms};
  return {status: ms > ceiling ? 'future' : 'present', iso: new Date(ms).toISOString(), ms};
}

type Period = {start: number; end: number};
const DATE_RE = /(?<!\d)((?:19|20)\d{2})(?:\s*(?:[-./]|년)\s*(0?[1-9]|1[0-2])(?!\d)(?:\s*(?:[-./]|월)\s*(0?[1-9]|[12]\d|3[01])(?!\d)\s*일?)?)?(?!\d)/g;

/** "2024", "2024년 10월", "2024-10-03", "2020~2022년" 같은 명확한 형식만 해석한다. 그 밖은 null(=불명). */
export function parseTargetPeriod(target: string | undefined): Period | null {
  if (!target) return null;
  const found = [...target.matchAll(DATE_RE)];
  const toPeriod = (m: RegExpMatchArray): Period | null => {
    const y = Number(m[1]), mo = m[2] ? Number(m[2]) : 0, d = m[3] ? Number(m[3]) : 0;
    if (d) {
      const t = new Date(Date.UTC(y, mo - 1, d));
      if (t.getUTCMonth() !== mo - 1) return null;
      const n = dayNumber(y, mo, d);
      return {start: n, end: n};
    }
    if (mo) return {start: dayNumber(y, mo, 1), end: dayNumber(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1) - 1};
    return {start: dayNumber(y, 1, 1), end: dayNumber(y + 1, 1, 1) - 1};
  };
  if (found.length === 1) return toPeriod(found[0]);
  if (found.length === 2) {
    const between = target.slice(found[0].index! + found[0][0].length, found[1].index!);
    if (!/^\s*(?:~|–|—|-|∼|부터|에서|to|until)\s*$/i.test(between)) return null;
    const a = toPeriod(found[0]), b = toPeriod(found[1]);
    return a && b && a.start <= b.end ? {start: a.start, end: b.end} : null;
  }
  return null;
}

function temporal(published: number | undefined, target: string | undefined, lateTolerance: number): SourceObservation['temporal'] {
  if (!target?.trim()) return {status: 'unknown', reason: 'no_target_time'};
  const period = parseTargetPeriod(target);
  if (!period) return {status: 'unknown', reason: 'unparsable_target_time'};
  if (published === undefined) return {status: 'unknown', reason: 'no_published_date'};
  const day = kstDay(published);
  if (day < period.start) return {status: 'mismatch_candidate', reason: 'published_before_target'};
  if (day <= period.end) return {status: 'within_period', reason: 'published_in_target'};
  if (day - period.end > lateTolerance) return {status: 'mismatch_candidate', reason: 'published_long_after_target'};
  return {status: 'later_than_period', reason: 'published_after_target'};
}

// ───────────────────────── 본문 ─────────────────────────

/** 비교용 정규화: NFKC·소문자·링크 주소 제거 후 글자와 숫자만 남긴다(한글·숫자 보존). */
export function normalizeForComparison(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 20000);
}

const SHINGLE = 6;
function shingles(s: string) {
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE <= s.length; i++) set.add(s.slice(i, i + SHINGLE));
  return set;
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

type Prepared = {index: number; src: SourceInput; url: NormalizedUrl; norm: string; grams?: Set<string>};

function compare(a: Prepared, b: Prepared, minChars: number, threshold: number): DuplicateLink | null {
  const kinds: DuplicateKind[] = [];
  let similarity: number | null = null;
  if (a.url.status === 'ok' && a.url.url === b.url.url) kinds.push('same_url');
  if (a.norm.length >= minChars && b.norm.length >= minChars) {
    if (a.norm === b.norm) { kinds.push('identical_text'); similarity = 1; }
    else {
      const [short, long] = a.norm.length <= b.norm.length ? [a, b] : [b, a];
      a.grams ??= shingles(a.norm); b.grams ??= shingles(b.norm);
      similarity = Math.round(jaccard(a.grams, b.grams) * 1000) / 1000;
      if (long.norm.includes(short.norm)) kinds.push('contained_text');
      else if (similarity >= threshold) kinds.push('near_identical_text');
    }
  }
  if (!kinds.length) return null;
  return {ids: [a.src.id, b.src.id], kinds, sameHost: !!a.url.host && a.url.host === b.url.host, similarity};
}

function prepare(items: readonly SourceInput[]): Prepared[] {
  return items.map((src, index) => ({index, src, url: normalizeSourceUrl(src.url), norm: normalizeForComparison(typeof src.text === 'string' ? src.text : '')}));
}

function findLinks(p: Prepared[], minChars: number, threshold: number) {
  const links: {a: number; b: number; link: DuplicateLink}[] = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    const link = compare(p[i], p[j], minChars, threshold);
    if (link) links.push({a: i, b: j, link});
  }
  return links;
}

// ───────────────────────── 공개 API ─────────────────────────

export function assessSources(references: readonly SourceInput[], options: SourceQualityOptions = {}): SourceQualityAssessment {
  const now = options.now ?? Date.now();
  const shortChars = options.shortBodyChars ?? 200;
  const minChars = options.minComparableChars ?? 200;
  const threshold = options.nearIdenticalThreshold ?? 0.9;
  const lateTolerance = options.lateToleranceDays ?? 365;
  const prepared = prepare(references);

  const items: SourceObservation[] = prepared.map(({src, url}) => {
    const fetched = dateObservation(src.fetchedAt, now + DAY);
    const published = dateObservation(src.publishedAt, (fetched.ms ?? now) + DAY);
    const text = typeof src.text === 'string' ? src.text : '';
    const chars = text.trim().length;
    const full = typeof src.fullTextLength === 'number' && Number.isFinite(src.fullTextLength) && src.fullTextLength >= 0 ? src.fullTextLength : undefined;
    const truncation: TruncationStatus = src.truncated === true || (full !== undefined && full > text.length) ? 'truncated'
      : src.truncated === false ? 'complete' : 'unknown';
    const links = linkStats(text, url);
    return {
      id: src.id,
      url: url.status === 'ok' ? {status: 'ok', normalized: url.url, host: url.host} : {status: url.status},
      publishedAt: {status: published.status, ...(published.iso ? {iso: published.iso} : {})},
      fetchedAt: {status: fetched.status, ...(fetched.iso ? {iso: fetched.iso} : {})},
      body: {chars, lengthStatus: chars === 0 ? 'empty' : chars < shortChars ? 'short' : 'ok', truncation, ...(full !== undefined ? {fullTextLength: full} : {})},
      sourceLinks: {status: links.count ? 'present' : 'none_found', ...links},
      // 미래·잘못된 발행일은 시점 판정에 쓰지 않는다.
      temporal: temporal(published.status === 'present' ? published.ms : undefined, options.targetTime, lateTolerance),
    };
  });

  const links = findLinks(prepared, minChars, threshold);
  const parent = prepared.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const {a, b} of links) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  prepared.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const contentClusters: ContentCluster[] = [...groups.values()].filter(g => g.length > 1).map(g => {
    const hosts = [...new Set(g.map(i => prepared[i].url.host).filter((h): h is string => !!h))];
    return {ids: g.map(i => prepared[i].src.id), hosts, crossHost: hosts.length > 1};
  });

  const byHost = new Map<string, string[]>();
  for (const p of prepared) if (p.url.host) byHost.set(p.url.host, [...(byHost.get(p.url.host) ?? []), p.src.id]);
  const sameHostGroups = [...byHost].filter(([, ids]) => ids.length > 1).map(([host, ids]) => ({host, ids}));

  const count = (f: (o: SourceObservation) => boolean) => items.filter(f).length;
  const summary: SourceQualitySummary = {
    total: items.length,
    validUrl: count(o => o.url.status === 'ok'),
    missingUrl: count(o => o.url.status === 'missing'),
    invalidUrl: count(o => o.url.status !== 'ok' && o.url.status !== 'missing'),
    withPublishedAt: count(o => o.publishedAt.status === 'present'),
    withFetchedAt: count(o => o.fetchedAt.status === 'present'),
    missingPublishedAt: count(o => o.publishedAt.status !== 'present'),
    empty: count(o => o.body.lengthStatus === 'empty'),
    short: count(o => o.body.lengthStatus === 'short'),
    truncated: count(o => o.body.truncation === 'truncated'),
    truncationUnknown: count(o => o.body.truncation === 'unknown'),
    withSourceLinks: count(o => o.sourceLinks.status === 'present'),
    noSourceLinksFound: count(o => o.sourceLinks.status === 'none_found'),
    temporalMismatchCandidates: count(o => o.temporal.status === 'mismatch_candidate'),
    temporalUnknown: count(o => o.temporal.status === 'unknown'),
    duplicateLinkCount: links.length,
  };

  return {version: SOURCE_QUALITY_VERSION, interpretation: 'observations_only', independence: 'not_determined',
    items, duplicates: links.map(l => l.link), contentClusters, sameHostGroups, summary, notes: [...NOTES]};
}

/**
 * 입력 순서(검색 순위)를 존중하며 서로 중복 후보가 아닌 자료를 최대 limit개 고른다.
 * 1순위: 이미 고른 자료와 호스트가 다름. 부족하면 같은 호스트의 다른 기사로 채운다.
 * 중복 후보(같은 URL·동일/포함/거의 동일 본문)는 호스트가 달라도 고르지 않는다.
 * 호스트가 다르다는 것이 독립 출처라는 뜻은 아니다.
 */
export function selectDiverseSources<T extends SourceInput>(candidates: readonly T[], limit = 2, options: SourceQualityOptions = {}): SourceSelection<T> {
  const minChars = options.minComparableChars ?? 200, threshold = options.nearIdenticalThreshold ?? 0.9;
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const prepared = prepare(candidates);
  const chosen: Prepared[] = [];
  const skipped: SourceSelection<T>['skipped'] = [];
  const settled = new Set<number>();
  const dupOf = (p: Prepared) => chosen.find(c => compare(c, p, minChars, threshold));
  for (const p of prepared) if (!p.src.text?.trim()) { settled.add(p.index); skipped.push({id: p.src.id, reason: 'empty_text'}); }
  for (const strict of [true, false]) {
    for (const p of prepared) {
      if (chosen.length >= max) break;
      if (settled.has(p.index)) continue;
      if (dupOf(p)) continue; // 최종 사유는 아래에서 기록
      if (strict && p.url.host && chosen.some(c => c.url.host === p.url.host)) continue;
      chosen.push(p); settled.add(p.index);
    }
  }
  for (const p of prepared) {
    if (settled.has(p.index)) continue;
    const dup = dupOf(p);
    skipped.push(dup ? {id: p.src.id, reason: 'duplicate_of_selected', duplicateOf: dup.src.id} : {id: p.src.id, reason: 'over_limit'});
  }
  return {selected: chosen.sort((a, b) => a.index - b.index).map(c => candidates[c.index]), skipped};
}
