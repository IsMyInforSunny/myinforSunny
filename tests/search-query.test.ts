import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {searchQuerySchema} from '../lib/contracts';
import {newsRequestSchema} from '../lib/news-contract';
import {researchQuerySchema} from '../lib/research-contract';
import {searchNews} from '../lib/server/news';

afterEach(()=>vi.unstubAllGlobals());

describe('한국어 기사 검색어의 입력 경계',()=>{
 it.each(['통계청','학교 도서관 운영 시간','MBC 도서관 2025','school library 2025','COVID-19 예방접종','도서관'.normalize('NFD')])('핵심어를 번역하거나 바꾸지 않고 허용한다: %s',query=>{
  expect(searchQuerySchema.parse(query)).toBe(query);
  expect(newsRequestSchema.parse({query,searchConsent:true}).query).toBe(query);
  expect(researchQuerySchema.parse({claimId:'c1',label:'운영 시간',query,purpose:'fact_check'}).query).toBe(query);
 });
 it('바깥 공백만 제거하고 한국어·영문·숫자 및 내부 단어 간격은 유지한다',()=>{
  expect(searchQuerySchema.parse('  MBC 도서관  2025  ')).toBe('MBC 도서관  2025');
  expect(searchQuerySchema.safeParse('가'.repeat(100)).success).toBe(true);
  expect(searchQuerySchema.safeParse('가'.repeat(101)).success).toBe(false);
  expect(searchQuerySchema.safeParse('가나').success).toBe(false);
 });
 it.each(['교육 예산 3.5%','서울·부산 비교','MBC 1.2조 지원'])('안전한 수치 표기와 가운뎃점을 허용한다: %s',query=>{
  expect(searchQuerySchema.parse(query)).toBe(query);
 });
 it.each([
  'https://news.example/a','site:news.example 도서관','학교 OR 도서관','학교 AND 도서관','학교 NOT 도서관',
  '학교 -도서관','-도서관','도서관-','학교 (도서관)','학교 "도서관"','학교*','학교 | 도서관','학교 + 도서관','학교 & 도서관',
  '학교\n도서관','\n학교 도서관','학교 도서관\n','\t학교 도서관','학교\u0000도서관','학교\u200B도서관','\uFEFF학교 도서관','학교\u202E도서관',
 ])('주소·검색 연산자·기호·제어문자를 거부한다: %j',query=>{
  expect(searchQuerySchema.safeParse(query).success).toBe(false);
 });
 it('생성형 모델용 JSON 스키마에도 한국어 단어 범위가 유지된다',()=>{
  const schema=z.toJSONSchema(searchQuerySchema,{target:'draft-7'});
  expect(schema.pattern).toBeDefined();
  expect(new RegExp(schema.pattern as string).test('통계청 인구 2025')).toBe(true);
  expect(new RegExp(schema.pattern as string).test('school -library')).toBe(false);
 });
 it('GDELT 요청에서 한국어 검색어를 보존하고 서버의 언어 필터만 추가한다',async()=>{
  const query='통계청 인구 2025'.normalize('NFD');
  const fetch=vi.fn().mockResolvedValue(Response.json({articles:[]}));vi.stubGlobal('fetch',fetch);
  const statement={bind:()=>statement,run:async()=>({meta:{changes:1}})};
  const result=await searchNews(searchQuerySchema.parse(query),{ENABLE_NEWS_SEARCH:'true',NEWS_TERMS_APPROVED:'true',DB:{prepare:()=>statement} as unknown as D1Database},AbortSignal.timeout(1000));
  expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('query')).toBe(`${query.normalize('NFC')} sourcelang:korean`);
  expect(result.query).toBe(query.normalize('NFC'));
 });
});
