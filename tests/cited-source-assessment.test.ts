import {describe, expect, it} from 'vitest';
import {makeSources, locate} from '../lib/domain';
import {assessCitedSources, MEDIA_NAME_MAP, type SourceConfirmation} from '../lib/cited-source-assessment';
import {SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025} from '../lib/public-trust-prior';
import type {Analysis, Claim} from '../lib/contracts';

// Synthetic public sentences only.
function article(body: string, factualSentences: number[] = [0]): Pick<Analysis, 'sources' | 'claims'> {
  const sources = makeSources({kind: 'text', body, comments: []});
  const source = sources[0]!;
  const claims: Claim[] = factualSentences.map((index, i) => {
    const sentence = source.sentences[index]!;
    const origin = locate(sources, {sentenceId: sentence.id, quote: source.text.slice(sentence.start, sentence.end)})!;
    return {id: `c${i + 1}`, kind: 'factual', text: origin.quote, origin: [origin]};
  });
  return {sources, claims};
}
const assess = (body: string, confirmations: SourceConfirmation[] = [], factual = [0]) =>
  assessCitedSources(article(body, factual), {weightSet: SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025, confirmations});

describe('assessCitedSources', () => {
  it('keeps what the text shows and leaves an unchecked primary source unverified', () => {
    const body = '통계청 2025년 사회조사에 따르면 독서율은 52%다.';
    const r = assess(body);
    const s = r.sources[0]!;
    expect(s.confirmedFromText).toMatchObject({type: 'official_statistics', name: '통계청 2025년 사회조사', attribution: 'named', tier: 'traceable_primary', primarySignal: true, dated: true});
    expect(body.slice(s.start, s.end)).toBe(s.quote);
    expect(s.claimIds).toEqual(['c1']);
    expect(s.originalCheck.status).toBe('unverified');
    expect(s.publicPrior.status).toBe('not_applicable');
    expect(s.media.status).toBe('not_media');
    expect(s.unconfirmed).toContain('출처가 실제로 그렇게 말했는지(원문 미확인)');
    expect(r.claims[0]).toMatchObject({sourcing: 'traceable_primary', originalVerified: false, publicPriorApplied: false});
  });

  it('marks a source verified only with a fetched public original whose content matched', () => {
    const body = '통계청 조사에 따르면 독서율은 52%다.';
    const ok = assess(body, [{citedSourceId: 'cite_1', url: 'https://kostat.go.kr/report/1', provenance: 'web_fetched', quoteMatched: true}]);
    expect(ok.sources[0]!.originalCheck).toMatchObject({status: 'verified', host: 'kostat.go.kr'});
    expect(ok.claims[0]!.originalVerified).toBe(true);
    expect(ok.summary.originalVerifiedClaims).toBe(1);

    for (const c of [
      {citedSourceId: 'cite_1', url: 'https://kostat.go.kr/report/1', provenance: 'web_fetched', quoteMatched: false},
      {citedSourceId: 'cite_1', url: 'https://kostat.go.kr/report/1', provenance: 'user_supplied', quoteMatched: true},
      {citedSourceId: 'cite_1', url: 'https://kostat.go.kr/report/1', provenance: 'demo', quoteMatched: true},
      {citedSourceId: 'cite_1', url: 'http://kostat.go.kr/report/1', provenance: 'web_fetched', quoteMatched: true},
      {citedSourceId: 'cite_9', url: 'https://kostat.go.kr/report/1', provenance: 'web_fetched', quoteMatched: true},
    ] as SourceConfirmation[]) {
      const r = assess(body, [c]);
      expect(r.sources[0]!.originalCheck.status).toBe('unverified');
      expect(r.claims[0]!.originalVerified).toBe(false);
    }
  });

  it('applies the public prior to an exactly named outlet and records the mapping version', () => {
    const r = assess('MBC 보도에 따르면 학급 수가 줄었다.');
    const s = r.sources[0]!;
    expect(s.media).toMatchObject({status: 'matched', host: 'imnews.imbc.com', via: 'name_mapping', mappingVersion: MEDIA_NAME_MAP.version});
    expect(s.publicPrior).toMatchObject({status: 'applied', value: 0.61, version: SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025.version});
    expect(s.unconfirmed).toContain('재인용한 보도의 원 출처');
    expect(r.claims[0]!.publicPriorApplied).toBe(true);
  });

  it.each([
    ['연합뉴스 보도에 따르면 학급 수가 줄었다.', 'unmatched', 'not_applicable'],
    ['연합뉴스TV 보도에 따르면 학급 수가 줄었다.', 'matched', 'applied'],
    ['TV조선 보도에 따르면 학급 수가 줄었다.', 'matched', 'applied'],
    ['조선일보 보도에 따르면 학급 수가 줄었다.', 'matched', 'applied'],
    ['KBS 뉴스에 따르면 학급 수가 줄었다.', 'matched', 'applied'],
    ['MBC의 보도에 따르면 학급 수가 줄었다.', 'matched', 'applied'],
    ['일부 외신 보도에 따르면 학급 수가 줄었다.', 'not_media', 'not_applicable'],
  ])('matches outlet names exactly, never by substring: %s', (body, media, prior) => {
    const s = assess(body).sources[0]!;
    expect(s.media.status).toBe(media);
    expect(s.publicPrior.status).toBe(prior);
  });

  it('keeps 연합뉴스TV and TV조선 on their own hosts', () => {
    expect(assess('연합뉴스TV 보도에 따르면 학급 수가 줄었다.').sources[0]!.media.host).toBe('yonhapnewstv.co.kr');
    expect(assess('TV조선 보도에 따르면 학급 수가 줄었다.').sources[0]!.media.host).toBe('news.tvchosun.com');
    expect(assess('조선일보 보도에 따르면 학급 수가 줄었다.').sources[0]!.media.host).toBe('chosun.com');
  });

  it('does not treat a company or agency whose name contains an outlet name as that outlet', () => {
    for (const body of ['SBS콘텐츠허브는 매출이 늘었다고 밝혔다.', '조선일보사 노조는 임금이 올랐다고 밝혔다.', '한겨레교육 측은 수강생이 늘었다고 밝혔다.']) {
      const s = assess(body).sources[0]!;
      expect(s).toBeDefined();
      expect(s.media.host).toBeNull();
      expect(s.publicPrior).toMatchObject({status: 'not_applicable', value: null});
    }
  });

  it('does not turn an anonymous source into the outlet that published its words', () => {
    const r = assess('관계자에 따르면 예산이 늘었다.', [{citedSourceId: 'cite_1', url: 'https://www.hani.co.kr/arti/1', provenance: 'web_fetched', quoteMatched: true}]);
    const s = r.sources[0]!;
    expect(s.confirmedFromText.attribution).toBe('anonymous');
    expect(s.media).toMatchObject({status: 'not_media', host: null});
    expect(s.publicPrior).toMatchObject({status: 'not_applicable', value: null});
    expect(s.unconfirmed).toContain('출처가 누구인지');
  });

  it('reports an unmapped verified host as not media and without a prior', () => {
    const r = assess('교육부 자료에 따르면 학급당 학생 수는 22명이다.', [{citedSourceId: 'cite_1', url: 'https://www.moe.go.kr/x', provenance: 'web_fetched', quoteMatched: true}]);
    expect(r.sources[0]!.media.status).toBe('not_media');
    expect(r.sources[0]!.publicPrior.status).toBe('not_applicable');
    expect(r.sources[0]!.originalCheck.status).toBe('verified');
  });

  it('separates generic, anonymous and unresolved attributions', () => {
    expect(assess('연구팀은 학생 1200명을 조사했다고 밝혔다.').sources[0]!.confirmedFromText.attribution).toBe('generic');
    expect(assess('한 교육청 관계자는 예산이 30% 줄었다고 밝혔다.').sources[0]!.confirmedFromText.attribution).toBe('anonymous');
    const unresolved = assess('이 보고서에 따르면 예산이 증가했다.');
    expect(unresolved.sources).toHaveLength(0);
    expect(unresolved.claims[0]).toMatchObject({sourcing: 'unattributed', unresolvedAttribution: true, originalVerified: false});
    expect(unresolved.claims[0]!.unconfirmed).toContain('화자는 있으나 누구인지 확인되지 않음');
    expect(unresolved.summary.unresolvedAttributionClaims).toBe(1);
  });

  it('marks a claim with no attribution and never emits a score or probability', () => {
    const r = assess('학교 도서관은 오후 6시에 닫는다.');
    expect(r.claims[0]!.unconfirmed).toContain('기사에 근거 출처가 표시되지 않음(규칙 미검출 가능)');
    expect(JSON.stringify(r)).not.toMatch(/"(score|probability|confidence)"/);
    expect(r.note).toContain('점수나 확률이 아닙니다');
  });

  it('returns no prior when no weight set is supplied', () => {
    const r = assessCitedSources(article('MBC 보도에 따르면 학급 수가 줄었다.'));
    expect(r.sources[0]!.media.status).toBe('matched');
    expect(r.sources[0]!.publicPrior.status).toBe('unavailable');
  });

  it.each(['MBC','KBS'])('matches an exact bare %s name even when classified as an organization',name=>{
    const s=assess(`${name}는 학급 수가 줄었다고 밝혔다.`).sources[0]!;
    expect(s.confirmedFromText.type).toBe('organization');
    expect(s.media.status).toBe('matched');expect(s.publicPrior.status).toBe('applied');
  });
  it('rejects an MBC confirmation from another publisher without changing its identity',()=>{
    const s=assess('MBC 보도에 따르면 학급 수가 줄었다.',[{citedSourceId:'cite_1',url:'https://hani.co.kr/arti/1',provenance:'web_fetched',quoteMatched:true}]).sources[0]!;
    expect(s.originalCheck.status).toBe('unverified');expect(s.originalCheck.reason).toContain('일치하지');
    expect(s.media.host).toBe('imnews.imbc.com');expect(s.publicPrior.value).toBe(.61);
  });
  it('keeps a government source separate from a news site carrying the statement',()=>{
    const s=assess('교육부 자료에 따르면 학급당 학생 수는 22명이다.',[{citedSourceId:'cite_1',url:'https://hani.co.kr/arti/1',provenance:'web_fetched',quoteMatched:true}]).sources[0]!;
    expect(s.media.status).toBe('not_media');expect(s.publicPrior.status).toBe('not_applicable');
  });
  it.each(['version','methodology','evidence','nan','zero','above-one','duplicate','alias-duplicate'])('does not apply an invalid weight set (%s)',kind=>{
    const set={...SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025,weights:SOUTH_KOREA_PUBLIC_TRUST_PRIOR_2025.weights.map(w=>({...w}))};
    if(kind==='version')set.version='';
    if(kind==='methodology')set.methodology=' ';
    if(kind==='evidence')set.weights[0].evidence='';
    if(kind==='nan')set.weights[0].value=NaN;
    if(kind==='zero')set.weights[0].value=0;
    if(kind==='above-one')set.weights[0].value=1.01;
    if(kind==='duplicate')set.weights.push({...set.weights[0],publisher:`www.${set.weights[0].publisher}`});
    if(kind==='alias-duplicate')set.weights.push({publisher:'news.donga.com',value:.41,evidence:'synthetic alias duplicate'});
    const s=assessCitedSources(article('MBC 보도에 따르면 학급 수가 줄었다.'),{weightSet:set}).sources[0]!;
    expect(s.media.status).toBe('matched');expect(s.publicPrior).toMatchObject({status:'unavailable',value:null});
  });
  it.each([['동아일보','news.donga.com','donga.com'],['경향신문','m.khan.co.kr','khan.co.kr']])('uses the same explicit %s host alias as the confirmation adapter',(name,host,canonical)=>{
    const s=assess(`${name} 보도에 따르면 학급 수가 줄었다.`,[{citedSourceId:'cite_1',url:`https://${host}/article/1`,provenance:'web_fetched',quoteMatched:true}]).sources[0]!;
    expect(s.originalCheck.status).toBe('verified');expect(s.media.host).toBe(canonical);expect(s.publicPrior.status).toBe('applied');
  });
});
