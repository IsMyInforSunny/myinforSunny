/**
 * Cited-source review: which sources does the article itself rely on for its factual claims?
 * Deterministic pattern rules over the analysed body text. No network or model calls.
 * The result describes how traceable each claim's attribution is, never whether a claim is true
 * or how reliable a publisher is.
 */
import type {Analysis} from './contracts';

export const CITED_SOURCES_VERSION = 'cited-sources-0.1';

export type CitedSourceType =
  | 'official_statistics' // 통계청·한국은행 등 공식 통계
  | 'public_agency'       // 정부·공공기관·법원·국회
  | 'research'            // 대학·연구기관·논문·보고서
  | 'named_person'        // 실명과 직함이 있는 당사자·전문가
  | 'organization'        // 기업·단체·학교 등 이름이 있는 조직
  | 'media_report'        // 다른 언론 보도의 재인용
  | 'anonymous';          // 관계자·소식통·업계·일각 등 특정되지 않는 출처

/** How far a reader could trace the attribution back to its origin from the article alone. */
export type SourceTier = 'traceable_primary' | 'traceable_secondary' | 'weak';

export type CitedSource = {
  id: string;
  sourceId: string;
  sentenceId: string;
  /** Offsets of the attribution phrase inside the source text. */
  start: number;
  end: number;
  quote: string;
  name: string | null;
  type: CitedSourceType;
  signals: {named: boolean; primary: boolean; documentNamed: boolean; dated: boolean; quantified: boolean};
  tier: SourceTier;
  reasons: string[];
};

export type ClaimSourcingStatus = SourceTier | 'unattributed';

export type ClaimSourcing = {
  claimId: string;
  status: ClaimSourcingStatus;
  sourceIds: string[];
  /** A pronoun speaker ("그는 … 말했다") attributes the claim, but the name is not resolved. */
  unresolvedAttribution?: boolean;
};

export type CitedSourceReview = {
  version: typeof CITED_SOURCES_VERSION;
  sources: CitedSource[];
  claims: ClaimSourcing[];
  summary: {factualClaims: number; unresolvedAttributionClaims?: number} & Record<ClaimSourcingStatus, number>;
  note: string;
};

const NOTE = '기사 본문에 적힌 출처 표현을 정해진 문장 규칙으로 찾아 추적 가능성을 분류한 결과입니다. 규칙에 없는 표현이나 앞 문장에 적힌 출처는 찾지 못할 수 있어, 출처 표시 없음에는 미검출이 섞일 수 있습니다. "그는 ~라고 말했다"처럼 화자는 있으나 이름을 확인하지 못한 주장은 미해결 귀속으로 따로 표시하며, 앞 문장의 이름을 추측해 연결하지 않습니다. 같은 문장 안의 출처만 연결합니다. 출처가 실제로 그렇게 말했는지, 주장이 사실인지는 이 분류만으로 확인되지 않습니다.';

/* Name dictionaries, checked in order: the first matching type wins. */
const TYPE_RULES: {type: CitedSourceType; pattern: RegExp}[] = [
  {type: 'anonymous', pattern: /관계자|소식통|측근|업계|일각|정가|전문가들|누리꾼|네티즌|일부\s|익명|한\s?(?:교사|학생|주민|시민|직원|간부)/},
  {type: 'media_report', pattern: /보도|신문|방송|뉴스|일보|외신|통신사?$|매체/},
  {type: 'official_statistics', pattern: /통계청|국가데이터처|한국은행|KOSIS|통계|인구조사|센서스/},
  {type: 'research', pattern: /연구|대학교|대학|학회|논문|보고서|교수|박사|싱크탱크/},
  {type: 'named_person', pattern: /[가-힣]{1,4}\s?(?:장관|차관|의원|대표|위원장|회장|원장|소장|청장|총장|시장|도지사|교육감|변호사|기자|대변인|교사|교장|팀장|국장|과장|부장|이사|씨)$|^(?:장관|차관|의원|대표|위원장|회장|원장|소장|청장|총장|시장|교육감|대변인)\s[가-힣]{2,4}$/},
  {type: 'public_agency', pattern: /정부|부처?$|[가-힣]+부(?=\s|$)|[가-힣]+처(?=\s|$)|[가-힣]+청(?=\s|$)|[가-힣]{1,6}(?:시|도|군|구)$|위원회|국회|법원|검찰|경찰|교육청|시청|도청|구청|군청|공단|공사|진흥원|국무|대통령실|지방자치단체|지자체|회의록|관보|판결/},
  {type: 'organization', pattern: /협회|조합|노조|단체|재단|연맹|연합회|기업|회사|그룹|학교|병원|센터/},
];
const PRIMARY_TYPES = new Set<CitedSourceType>(['official_statistics', 'public_agency', 'research']);
/* Names that point to a kind of institution rather than a specific one a reader could look up. */
const GENERIC_NAME = /^(?:연구팀|연구진|정부|당국|학계|전문가|경찰|검찰|학교\s?측|시\s?당국|관련\s?기관|해외\s?연구|한\s?연구)$/;

/* Attribution phrases. Each yields the cited name (or none) and the phrase span. */
const ACCORDING_TO = /([^\s,.“”"'‘’「」(){}][^,.。“”"]{0,30}?)\s*(?:에\s?따르면|에\s?의하면|에\s?의해\s?발표된)/g;
const SAYING_VERB = /(?:밝혔다|발표했다|말했다|설명했다|전했다|강조했다|주장했다|덧붙였다|지적했다|공개했다|집계했다|추산했다|분석했다|예상했다|보도했다)(?=[.\s”"]|$)/;
/* Speech verbs whose subject is a speaker even when the name is not in a dictionary (e.g. a company). */
const SPEECH_VERB = /(?:밝혔다|발표했다|말했다|설명했다|전했다|강조했다|주장했다|덧붙였다|공개했다)(?=[.\s”"]|$)/;
/* "X에서 확인됐다/나타났다": the article points at a document as its basis. */
const FOUND_IN = /([^\s,.“”"][^,.“”"]{0,30}?)(?:에서|을\s?보면|를\s?보면)\s?(?:확인됐다|확인된다|나타났다|드러났다)/;
const SUBJECT_AT_START = /^\s*[“"]?([^,.\s“”"][^,.“”"]{0,24}?)(?:은|는|이|가|측은|측이)\s/;
const PRONOUN = /^(?:그|그녀|이들|그들|이|해당|이번|이날|당시|또|또한|한편|하지만|이에|이와\s?관련해)$/;
/* Pronouns that stand for a person or group who is speaking. Connectives in PRONOUN are not speakers. */
const SPEAKER_PRONOUN = /^(?:그|그녀|이들|그들|그녀들|그분|이분|저들)$/;
const UNATTRIBUTED_PASSIVE = /(?:으로|로)\s?(?:알려졌다|전해졌다|파악됐다|관측된다|보인다|예상된다|나타났다)|(?:라는|다는)\s?(?:지적|분석|관측|전망|평가|우려|주장)이\s?(?:나온다|나왔다|제기됐다|있다)|(?:다|라)고\s?(?:한다|들었다)(?=[.\s”"]|$)/;
const DOCUMENT = /자료|보고서|조사|통계|발표문|보도자료|백서|논문|판결문|공시|[「『《'‘].+?[」』》'’]/;
const DATED = /\d{4}\s?년|\d{1,2}\s?월|\d{1,2}\s?일|지난해|올해|작년|전년|분기/;
const QUANTIFIED = /\d/;

function classify(name: string): CitedSourceType | null {
  for (const rule of TYPE_RULES) if (rule.pattern.test(name)) return rule.type;
  return null;
}

function tierOf(type: CitedSourceType, documentNamed: boolean, dated: boolean, generic: boolean): {tier: SourceTier; reasons: string[]} {
  if (type === 'anonymous') return {tier: 'weak', reasons: ['출처가 특정되지 않아 독자가 확인할 수 없음']};
  if (generic) return {tier: 'traceable_secondary', reasons: ['기관 종류만 있고 구체적인 이름이 없음 · 원 자료 확인 필요']};
  if (PRIMARY_TYPES.has(type)) {
    if (documentNamed || dated) return {tier: 'traceable_primary', reasons: ['1차 자료 기관이 명시됨', documentNamed ? '자료·조사 이름이 있음' : '시점이 적혀 있음']};
    return {tier: 'traceable_secondary', reasons: ['1차 자료 기관이 명시됐지만 자료 이름·시점이 없음']};
  }
  if (type === 'media_report') return {tier: 'traceable_secondary', reasons: ['다른 언론 보도를 재인용함 · 원 출처 확인 필요']};
  return {tier: 'traceable_secondary', reasons: ['이름이 있는 당사자·조직의 발언 · 1차 자료는 아님']};
}

function cleanName(raw: string): string {
  return raw.replace(/^[\s“"'‘(]+|[\s”"'’)]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Extract cited sources from body sentences and link them to factual claims by sentence. */
export function reviewCitedSources(analysis: Pick<Analysis, 'sources' | 'claims'>): CitedSourceReview {
  const sources: CitedSource[] = [];
  /** Sentences where a pronoun speaker attributes the content but cannot be named. */
  const unresolvedSentences = new Set<string>();
  for (const source of analysis.sources) {
    if (source.kind !== 'body') continue;
    for (const sentence of source.sentences) {
      const text = source.text.slice(sentence.start, sentence.end);
      const signals = {documentNamed: DOCUMENT.test(text), dated: DATED.test(text), quantified: QUANTIFIED.test(text)};
      const found: {name: string | null; at: number; length: number; type: CitedSourceType}[] = [];

      for (const match of text.matchAll(ACCORDING_TO)) {
        const name = cleanName(match[1]!);
        const type = classify(name) ?? 'organization';
        found.push({name, at: match.index!, length: match[0].length, type});
      }
      const foundIn = !found.length ? FOUND_IN.exec(text) : null;
      if (foundIn) {
        // "이 같은 내용은 국회 회의록에서 확인됐다": the document name follows the topic marker.
        const name = cleanName(foundIn[1]!.replace(/^.*[은는]\s+/, ''));
        const type = classify(name);
        // The cited document itself names the record, so treat it as a named document.
        if (type) { found.push({name, at: foundIn.index, length: foundIn[0].length, type}); signals.documentNamed = true; }
      }
      if (!found.length && SAYING_VERB.test(text)) {
        const subject = SUBJECT_AT_START.exec(text);
        const name = subject ? cleanName(subject[1]!) : '';
        // A pronoun refers back to an earlier sentence. Record it as unresolved instead of guessing the name.
        if (name && SPEAKER_PRONOUN.test(name) && SPEECH_VERB.test(text)) unresolvedSentences.add(`${source.id}\u0000${sentence.id}`);
        if (name && !PRONOUN.test(name) && !SPEAKER_PRONOUN.test(name)) {
          // An unknown subject of a speech verb is still a named speaker (often a company or group).
          const type = classify(name) ?? (SPEECH_VERB.test(text) ? 'organization' : null);
          if (type) found.push({name, at: subject!.index + subject![0].indexOf(subject![1]!), length: subject![1]!.length, type});
        }
      }
      const passive = UNATTRIBUTED_PASSIVE.exec(text);
      if (!found.length && passive) found.push({name: null, at: passive.index, length: passive[0].length, type: 'anonymous'});

      for (const item of found) {
        const generic = !!item.name && GENERIC_NAME.test(item.name);
        const {tier, reasons} = tierOf(item.type, signals.documentNamed, signals.dated, generic);
        const start = sentence.start + item.at;
        sources.push({
          id: `cite_${sources.length + 1}`,
          sourceId: source.id,
          sentenceId: sentence.id,
          start,
          end: start + item.length,
          quote: source.text.slice(start, start + item.length),
          name: item.name,
          type: item.type,
          signals: {named: item.type !== 'anonymous' && !!item.name && !generic, primary: PRIMARY_TYPES.has(item.type), ...signals},
          tier,
          reasons: item.name === null ? ['출처 없이 전해 들은 형태의 서술'] : reasons,
        });
      }
    }
  }

  const rank: Record<ClaimSourcingStatus, number> = {traceable_primary: 3, traceable_secondary: 2, weak: 1, unattributed: 0};
  const claims: ClaimSourcing[] = analysis.claims.filter(claim => claim.kind === 'factual').map(claim => {
    const sentences = new Set(claim.origin.map(span => `${span.sourceId}\u0000${span.sentenceId}`));
    const linked = sources.filter(s => sentences.has(`${s.sourceId}\u0000${s.sentenceId}`));
    const status = linked.reduce<ClaimSourcingStatus>((best, s) => rank[s.tier] > rank[best] ? s.tier : best, 'unattributed');
    // Only flag when nothing in the sentence resolved to a source; the classification itself is unchanged.
    const unresolved = status === 'unattributed' && [...sentences].some(key => unresolvedSentences.has(key));
    return {claimId: claim.id, status, sourceIds: linked.map(s => s.id), ...(unresolved ? {unresolvedAttribution: true} : {})};
  });

  const summary = {factualClaims: claims.length, traceable_primary: 0, traceable_secondary: 0, weak: 0, unattributed: 0, unresolvedAttributionClaims: 0};
  for (const claim of claims) {
    summary[claim.status]++;
    if (claim.unresolvedAttribution) summary.unresolvedAttributionClaims++;
  }
  return {version: CITED_SOURCES_VERSION, sources, claims, summary, note: NOTE};
}
