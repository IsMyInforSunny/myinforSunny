import {describe, it, expect} from 'vitest';
import {assessSources, selectDiverseSources, normalizeSourceUrl, parseTargetPeriod, type SourceInput} from '../lib/source-quality';
import type {Reference} from '../lib/contracts';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const para = (seed: string, n = 12) => Array.from({length: n}, (_, i) => `${seed} 문장 ${i + 1}번은 가상의 시립 도서관 운영 시간 ${i + 9}시 변경 내용을 설명한다.`).join(' ');
const A = para('가상기사A');
const src = (id: string, url: string | undefined, text: string, extra: Partial<SourceInput> = {}): SourceInput => ({id, url, text, ...extra});

describe('URL 정규화', () => {
  it('추적 파라미터·fragment·www·끝 슬래시를 제거하고 쿼리는 정렬한다', () => {
    const a = normalizeSourceUrl('https://www.News.example/a/1/?utm_source=x&b=2&a=1&fbclid=z#top');
    expect(a).toEqual({status: 'ok', url: 'https://news.example/a/1?a=1&b=2', host: 'news.example'});
    expect(normalizeSourceUrl('https://news.example/a/1?b=2&a=1').url).toBe(a.url);
  });
  it('기사를 구분하는 경로·쿼리는 유지한다', () => {
    expect(normalizeSourceUrl('https://n.example/view?id=1').url).not.toBe(normalizeSourceUrl('https://n.example/view?id=2').url);
    expect(normalizeSourceUrl('https://n.example/a').url).not.toBe(normalizeSourceUrl('https://n.example/b').url);
  });
  it('한글 경로와 퍼센트 인코딩 대소문자를 같게 본다', () => {
    const k = normalizeSourceUrl('https://n.example/뉴스/도서관-2024');
    expect(k.url).toMatch(/%EB%89%B4/);
    expect(normalizeSourceUrl(k.url!.replace(/%EB/g, '%eb')).url).toBe(k.url);
  });
  it('HTTPS 공개 주소가 아니면 상태로 구분한다', () => {
    expect(normalizeSourceUrl(undefined).status).toBe('missing');
    expect(normalizeSourceUrl('').status).toBe('missing');
    expect(normalizeSourceUrl('http://n.example/a').status).toBe('not_https');
    expect(normalizeSourceUrl('not a url').status).toBe('invalid');
    expect(normalizeSourceUrl('https://localhost/a').status).toBe('not_public');
    expect(normalizeSourceUrl('https://127.0.0.1/a').status).toBe('not_public');
    expect(normalizeSourceUrl('https://user:pw@n.example/a').status).toBe('not_public');
    expect(normalizeSourceUrl('https://n.example:8443/a').status).toBe('not_public');
    expect(normalizeSourceUrl('ftp://n.example/a').status).toBe('invalid');
  });
});

describe('중복 후보', () => {
  it('추적 파라미터만 다른 주소는 같은 URL 후보, 다른 페이지는 후보가 아니다', () => {
    const r = assessSources([
      src('a', 'https://n.example/a?utm_medium=x', A),
      src('b', 'https://www.n.example/a#c', para('전혀다른내용B')),
      src('c', 'https://n.example/other', para('또다른내용C')),
    ], {now: NOW});
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ids: ['a', 'b'], kinds: ['same_url'], sameHost: true});
  });
  it('같은 매체의 다른 기사는 중복이 아니며 같은 호스트 묶음으로만 표시한다', () => {
    const r = assessSources([src('a', 'https://n.example/1', para('기사하나')), src('b', 'https://n.example/2', para('기사둘'))], {now: NOW});
    expect(r.duplicates).toEqual([]);
    expect(r.contentClusters).toEqual([]);
    expect(r.sameHostGroups).toEqual([{host: 'n.example', ids: ['a', 'b']}]);
    expect(r.independence).toBe('not_determined');
  });
  it('다른 매체의 동일 본문은 중복 후보이며 독립 출처로 세지 않는다', () => {
    const r = assessSources([
      src('a', 'https://one.example/x', A),
      src('b', 'https://two.example/y', `  ${A.toUpperCase()}\n\n`),
    ], {now: NOW});
    expect(r.duplicates[0]).toMatchObject({kinds: ['identical_text'], sameHost: false, similarity: 1});
    expect(r.contentClusters[0]).toMatchObject({ids: ['a', 'b'], crossHost: true});
    expect(r.interpretation).toBe('observations_only');
    expect(JSON.stringify(r)).not.toMatch(/score|trust/i);
  });
  it('일부만 바뀐 본문은 거의 동일, 발췌는 포함 후보', () => {
    const near = A.replace('9시', '10시');
    const r = assessSources([src('a', 'https://one.example/x', A), src('b', 'https://two.example/y', near), src('c', 'https://three.example/z', A.slice(0, 300))], {now: NOW});
    const kind = (x: string, y: string) => r.duplicates.find(d => d.ids[0] === x && d.ids[1] === y)?.kinds;
    expect(kind('a', 'b')).toEqual(['near_identical_text']);
    expect(kind('a', 'c')).toEqual(['contained_text']);
  });
  it('짧은 공통 문구나 문맥이 다른 본문은 전재로 확정하지 않는다', () => {
    const shared = '시청은 올해 도서관 운영 시간을 바꾸지 않았다고 밝혔다.';
    const r = assessSources([
      src('a', 'https://one.example/x', shared),
      src('b', 'https://two.example/y', shared),
      src('c', 'https://three.example/z', `${para('긴글C')} ${shared}`),
      src('d', 'https://four.example/w', `${para('긴글D')} ${shared}`),
    ], {now: NOW});
    expect(r.duplicates).toEqual([]);
  });
  it('한글·숫자가 다르면 같은 본문이 아니다', () => {
    const r = assessSources([src('a', 'https://one.example/x', A), src('b', 'https://two.example/y', A.replace(/9시/g, '19시').replace(/10시/g, '20시').replace(/11시/g, '21시'))], {now: NOW});
    expect(r.duplicates.every(d => !d.kinds.includes('identical_text'))).toBe(true);
  });
});

describe('길이·잘림·링크', () => {
  it('빈 본문·짧은 본문·잘림 상태를 건수로 반환한다', () => {
    const r = assessSources([
      src('e', 'https://a.example/1', '  '),
      src('s', 'https://b.example/1', '짧다', {truncated: false}),
      src('t', 'https://c.example/1', A, {truncated: true, fullTextLength: 9000}),
      src('l', 'https://d.example/1', A, {truncated: false, fullTextLength: A.length}),
      src('m', 'https://e.example/1', para('길이불일치'), {fullTextLength: 99999}),
    ], {now: NOW});
    expect(r.items.map(i => i.body.lengthStatus)).toEqual(['empty', 'short', 'ok', 'ok', 'ok']);
    expect(r.items.map(i => i.body.truncation)).toEqual(['unknown', 'complete', 'truncated', 'complete', 'truncated']);
    expect(r.summary).toMatchObject({empty: 1, short: 1, truncated: 2, truncationUnknown: 1});
  });
  it('Reference 타입을 그대로 받는다', () => {
    const ref: Reference = {id: 'r', provenance: 'web_fetched', text: A, url: 'https://n.example/a', truncated: false};
    expect(assessSources([ref], {now: NOW}).items[0].url.status).toBe('ok');
  });
  it('출처 링크가 없음/있음과 다른 호스트 링크 수를 센다', () => {
    const r = assessSources([
      src('n', 'https://n.example/1', para('링크없음')),
      src('y', 'https://n.example/2', `${para('링크있음')} 자료: https://stat.example/report?utm_source=a. 참고 [원문](https://n.example/2) https://other.example/p`),
    ], {now: NOW});
    expect(r.items[0].sourceLinks).toEqual({status: 'none_found', count: 0, otherHostCount: 0});
    expect(r.items[1].sourceLinks).toEqual({status: 'present', count: 2, otherHostCount: 2});
    expect(r.summary).toMatchObject({withSourceLinks: 1, noSourceLinksFound: 1});
  });
  it('출처가 하나도 없는 입력', () => {
    const r = assessSources([], {now: NOW});
    expect(r.items).toEqual([]);
    expect(r.summary).toMatchObject({total: 0, duplicateLinkCount: 0});
    const noUrl = assessSources([src('a', undefined, A)], {now: NOW});
    expect(noUrl.items[0].url.status).toBe('missing');
    expect(noUrl.summary).toMatchObject({missingUrl: 1, validUrl: 0});
  });
});

describe('날짜와 시점', () => {
  it('날짜 불명은 unknown이지 mismatch가 아니다', () => {
    const r = assessSources([src('a', 'https://n.example/1', A), src('b', 'https://n.example/2', A, {publishedAt: '어제'})], {now: NOW, targetTime: '2026년 10월'});
    expect(r.items.map(i => i.temporal)).toEqual([{status: 'unknown', reason: 'no_published_date'}, {status: 'unknown', reason: 'no_published_date'}]);
    expect(r.items[1].publishedAt.status).toBe('invalid');
    expect(r.summary).toMatchObject({temporalMismatchCandidates: 0, missingPublishedAt: 2});
  });
  it('대상 시점이 없거나 해석할 수 없으면 unknown', () => {
    const d = {publishedAt: '2020-01-01T00:00:00Z'};
    expect(assessSources([src('a', undefined, A, d)], {now: NOW}).items[0].temporal.reason).toBe('no_target_time');
    for (const t of ['현재', '올해', '작년 겨울', '2024년과 2026년']) expect(assessSources([src('a', undefined, A, d)], {now: NOW, targetTime: t}).items[0].temporal.status).toBe('unknown');
  });
  it('명확히 다를 때만 mismatch 후보', () => {
    const at = (publishedAt: string, targetTime: string) => assessSources([src('a', undefined, A, {publishedAt})], {now: Date.parse('2029-01-01'), targetTime}).items[0].temporal;
    expect(at('2026-10-15T03:00:00Z', '2026년 10월').status).toBe('within_period');
    expect(at('2022-05-01T00:00:00Z', '2026년 10월')).toEqual({status: 'mismatch_candidate', reason: 'published_before_target'});
    expect(at('2026-11-20T00:00:00Z', '2026년 10월').status).toBe('later_than_period');
    expect(at('2025-03-01T00:00:00Z', '2022년')).toEqual({status: 'mismatch_candidate', reason: 'published_long_after_target'});
    expect(at('2023-02-01T00:00:00Z', '2022년').status).toBe('later_than_period');
    expect(at('2026-10-31T16:00:00Z', '2026-11-01').status).toBe('within_period'); // KST 기준 날짜
    expect(at('2021-06-01T00:00:00Z', '2020~2022년').status).toBe('within_period');
  });
  it('미래 발행일은 시점 판정에 쓰지 않는다', () => {
    const r = assessSources([src('a', undefined, A, {publishedAt: '2030-01-01T00:00:00Z'})], {now: NOW, targetTime: '2030년'});
    expect(r.items[0].publishedAt.status).toBe('future');
    expect(r.items[0].temporal.status).toBe('unknown');
  });
  it('대상 시점 해석', () => {
    expect(parseTargetPeriod('2024-02-30')).toBeNull();
    expect(parseTargetPeriod('2024')).not.toBeNull();
    expect(parseTargetPeriod('2024.10.03')).toMatchObject({start: expect.any(Number)});
    const y = parseTargetPeriod('2024-2025')!;
    expect(y.end - y.start + 1).toBe(366 + 365); // 2024(윤년)~2025
  });
});

describe('다양한 자료 선택', () => {
  const pool = [
    src('a1', 'https://one.example/1', para('하나')),
    src('a2', 'https://one.example/2', para('둘')),
    src('dup', 'https://mirror.example/1', para('하나')),
    src('b1', 'https://two.example/1', para('셋')),
    src('empty', 'https://three.example/1', ''),
  ];
  it('호스트가 다른 비중복 자료를 우선한다', () => {
    const s = selectDiverseSources(pool);
    expect(s.selected.map(x => x.id)).toEqual(['a1', 'b1']);
    expect(s.skipped).toContainEqual({id: 'dup', reason: 'duplicate_of_selected', duplicateOf: 'a1'});
    expect(s.skipped).toContainEqual({id: 'empty', reason: 'empty_text'});
  });
  it('다른 호스트가 없으면 같은 호스트의 다른 기사로 채우되 중복은 제외한다', () => {
    const s = selectDiverseSources([pool[0], pool[1], pool[2]], 3);
    expect(s.selected.map(x => x.id)).toEqual(['a1', 'a2']);
  });
  it('limit 경계', () => {
    expect(selectDiverseSources(pool, 0).selected).toEqual([]);
    expect(selectDiverseSources(pool, -3).selected).toEqual([]);
    expect(selectDiverseSources(pool, 1).selected.map(x => x.id)).toEqual(['a1']);
    expect(selectDiverseSources([]).selected).toEqual([]);
  });
  it('입력 객체를 변경하지 않고 원래 타입을 유지한다', () => {
    const before = JSON.stringify(pool);
    const s = selectDiverseSources(pool);
    expect(JSON.stringify(pool)).toBe(before);
    expect(s.selected[0]).toBe(pool[0]);
  });
});

describe('개인정보·원문 비포함', () => {
  it('결과에 본문·원본 URL이 들어 있지 않다', () => {
    const text = para('비밀본문표시');
    const r = assessSources([src('a', 'https://n.example/a?utm_source=secret&id=7', text)], {now: NOW});
    const json = JSON.stringify(r);
    expect(json).not.toContain('비밀본문표시');
    expect(json).not.toContain('secret');
    expect(r.items[0].url.normalized).toBe('https://n.example/a?id=7');
  });
});
