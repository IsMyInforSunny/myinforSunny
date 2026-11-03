import {describe, expect, it} from 'vitest';
import {makeSources, locate} from '../lib/domain';
import {reviewCitedSources} from '../lib/cited-sources';
import type {Analysis, Claim} from '../lib/contracts';

// Synthetic public examples only.
function review(body: string, factualSentences: number[] = [0]) {
  const sources = makeSources({kind: 'text', body, comments: []});
  const source = sources[0]!;
  const claims: Claim[] = factualSentences.map((index, i) => {
    const sentence = source.sentences[index]!;
    const origin = locate(sources, {sentenceId: sentence.id, quote: source.text.slice(sentence.start, sentence.end)})!;
    return {id: `c${i + 1}`, kind: 'factual', text: origin.quote, origin: [origin]};
  });
  return reviewCitedSources({sources, claims} as Pick<Analysis, 'sources' | 'claims'>);
}

describe('reviewCitedSources', () => {
  it('treats a named statistics agency with a dated survey as a traceable primary source', () => {
    const r = review('통계청이 2026년 3월 발표한 사회조사에 따르면 청소년 독서율은 52%로 집계됐다.');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({type: 'official_statistics', tier: 'traceable_primary'});
    expect(r.claims[0]).toMatchObject({claimId: 'c1', status: 'traceable_primary'});
    expect(r.summary).toMatchObject({factualClaims: 1, traceable_primary: 1});
  });

  it('keeps the attribution offsets on the original text', () => {
    const body = '교육부 자료에 따르면 학급당 학생 수는 22명이다.';
    const r = review(body);
    const s = r.sources[0]!;
    expect(body.slice(s.start, s.end)).toBe(s.quote);
    expect(s.quote).toContain('따르면');
  });

  it('marks anonymous officials and hearsay as weak', () => {
    expect(review('한 교육청 관계자는 예산이 30% 줄었다고 밝혔다.').claims[0]!.status).toBe('weak');
    const hearsay = review('내년부터 등교 시간이 늦춰지는 것으로 알려졌다.');
    expect(hearsay.claims[0]!.status).toBe('weak');
    expect(hearsay.sources[0]!.name).toBeNull();
  });

  it('treats re-quoted media reports as secondary and asks for the original', () => {
    const r = review('일부 외신 보도에 따르면 해당 정책은 3년간 시행됐다.');
    expect(r.sources[0]!.type).not.toBe('official_statistics');
    expect(r.claims[0]!.status === 'traceable_secondary' || r.claims[0]!.status === 'weak').toBe(true);
  });

  it('marks a named person speaking as secondary, not primary', () => {
    const r = review('김민수 교육감은 올해 급식 예산을 10% 늘렸다고 말했다.');
    expect(r.sources[0]).toMatchObject({type: 'named_person', tier: 'traceable_secondary'});
  });

  it('leaves a factual claim without any attribution as unattributed', () => {
    const r = review('학교 도서관은 오후 6시에 닫는다.');
    expect(r.sources).toHaveLength(0);
    expect(r.claims[0]).toMatchObject({status: 'unattributed', sourceIds: []});
    expect(r.summary.unattributed).toBe(1);
  });

  it('does not treat a pronoun subject as a new source', () => {
    const r = review('그는 예산이 늘었다고 말했다.');
    expect(r.sources).toHaveLength(0);
    expect(r.claims[0]!.status).toBe('unattributed');
  });

  it('only links sources in the claim sentence and ignores comments', () => {
    const r = review('통계청 조사에 따르면 독서율은 52%다. 도서관은 6시에 닫는다.', [1]);
    expect(r.sources).toHaveLength(1);
    expect(r.claims[0]!.status).toBe('unattributed');
  });

  it.each([
    ['서울시는 내년 청소년 교통비 지원을 확대한다고 발표했다.', 'public_agency', 'traceable_secondary'],
    ['삼성전자는 올해 반도체 투자를 20% 늘리겠다고 밝혔다.', 'organization', 'traceable_secondary'],
    ['김 교사는 "학생 수가 줄었다"고 말했다.', 'named_person', 'traceable_secondary'],
    ['연구팀은 학생 1200명을 조사했다고 밝혔다.', 'research', 'traceable_secondary'],
    ['조사 결과 응답자의 40%가 찬성한 것으로 나타났다.', 'anonymous', 'weak'],
    ['이 같은 내용은 국회 교육위원회 회의록에서 확인됐다.', 'public_agency', 'traceable_primary'],
  ])('classifies %s', (body, type, status) => {
    const r = review(body);
    expect(r.sources[0]?.type).toBe(type);
    expect(r.claims[0]!.status).toBe(status);
  });

  it('treats reported speech without a speaker ("~다고 한다") as weak hearsay', () => {
    const r = review('우리 학교 학생의 90%가 아침을 먹지 않는다고 한다.');
    expect(r.sources[0]).toMatchObject({type: 'anonymous', name: null, tier: 'weak'});
    expect(r.claims[0]!.status).toBe('weak');
  });

  it('strips the topic phrase from a cited document name', () => {
    expect(review('이 같은 내용은 국회 교육위원회 회의록에서 확인됐다.').sources[0]!.name).toBe('국회 교육위원회 회의록');
  });

  it('does not treat the subject of a counting verb as a source', () => {
    expect(review('학생 수는 22명으로 집계했다.').sources).toHaveLength(0);
  });

  describe('unresolved pronoun speakers', () => {
    it.each(['그는', '그녀는', '이들은'])('flags "%s ... 말했다" as unresolved without inventing a source', subject => {
      const r = review(`${subject} 급식 예산이 10% 늘었다고 말했다.`);
      expect(r.sources).toHaveLength(0);
      expect(r.claims[0]).toMatchObject({status: 'unattributed', sourceIds: [], unresolvedAttribution: true});
      expect(r.summary).toMatchObject({unattributed: 1, unresolvedAttributionClaims: 1});
    });

    it('does not link the earlier sentence\'s named speaker to the pronoun sentence', () => {
      const r = review('김민수 교육감은 브리핑을 열었다고 밝혔다. 그는 급식 예산이 10% 늘었다고 말했다.', [1]);
      expect(r.sources.map(s => s.sentenceId)).toEqual([r.sources[0]!.sentenceId]);
      expect(r.sources[0]!.name).toBe('김민수 교육감');
      expect(r.claims[0]).toMatchObject({status: 'unattributed', sourceIds: [], unresolvedAttribution: true});
    });

    it('keeps a named direct attribution resolved and unflagged', () => {
      const r = review('김민수 교육감은 급식 예산이 10% 늘었다고 말했다.');
      expect(r.claims[0]!.status).toBe('traceable_secondary');
      expect(r.claims[0]!.unresolvedAttribution).toBeUndefined();
      expect(r.summary.unresolvedAttributionClaims).toBe(0);
    });

    it('keeps a sourceless statement unflagged', () => {
      const r = review('급식 예산이 10% 늘었다.');
      expect(r.claims[0]).toMatchObject({status: 'unattributed'});
      expect(r.claims[0]!.unresolvedAttribution).toBeUndefined();
    });

    it('does not treat a connective subject with a speech verb as a pronoun speaker', () => {
      const r = review('이날 회의에서 예산이 늘었다고 말했다.');
      expect(r.claims[0]!.unresolvedAttribution).toBeUndefined();
    });

    it('does not flag a pronoun without a speech verb', () => {
      const r = review('그는 예산을 10% 늘렸다.');
      expect(r.claims[0]!.unresolvedAttribution).toBeUndefined();
    });

    it('preserves offsets of other sources in a mixed article', () => {
      const body = '통계청 조사에 따르면 독서율은 52%다. 그는 독서율이 낮다고 말했다.';
      const r = review(body, [0, 1]);
      const s = r.sources[0]!;
      expect(body.slice(s.start, s.end)).toBe(s.quote);
      expect(r.claims.map(c => c.unresolvedAttribution ?? false)).toEqual([false, true]);
      expect(r.summary).toMatchObject({factualClaims: 2, traceable_primary: 1, unattributed: 1, unresolvedAttributionClaims: 1});
    });
  });

  it('states that rule-based extraction can miss sources', () => {
    const note = review('도서관은 6시에 닫는다.').note;
    expect(note).toContain('찾지 못할 수 있어');
    expect(note).toContain('추측해 연결하지 않습니다');
  });

  it('never states truth or publisher reliability in its note', () => {
    expect(review('도서관은 6시에 닫는다.').note).toContain('사실인지는 이 분류만으로 확인되지 않습니다');
  });
});
