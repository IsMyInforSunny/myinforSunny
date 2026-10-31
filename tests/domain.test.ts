import { describe,it,expect } from 'vitest';
import { assertAnalysis, indicators, locate, makeSources, ratio, sentences, validSpan } from '../lib/domain';
import { demoAnalysis, demoVerification, fixtures } from '../lib/fixtures';
import { analyzeRequestSchema, verifyRequestSchema } from '../lib/contracts';
import { buildChecks, validateVerifyInput } from '../lib/server/verify';
import { allowedUrl } from '../lib/server/retrieval';
import { assembleAnalysis } from '../lib/server/analyze';
import { readJson } from '../lib/server/errors';
describe('원문과 인용',()=>{
  it('한글·이모지·반복 문장을 UTF-16 위치로 구분한다',()=>{const src=makeSources({kind:'text',body:'🌤️ 오늘은 맑아요.\n오늘은 맑아요.',comments:[]});const second=src[0].sentences[1];const span=locate(src,{sentenceId:second.id,quote:'오늘은 맑아요.'})!;expect(span.start).toBeGreaterThan(10);expect(validSpan(src,span)).toBe(true);expect(validSpan(src,{...span,quote:'없는 문장'})).toBe(false);});
  it('긴 문장 분리에서 서로게이트 쌍을 잘라내지 않는다',()=>{const text='가'.repeat(499)+'🌱'+'나'.repeat(501);const parts=sentences(text,'body');expect(parts.map(s=>text.slice(s.start,s.end)).join('')).toBe(text);expect(parts.every(p=>!/[\uD800-\uDBFF]$/.test(text.slice(p.start,p.end)))).toBe(true);});
});
describe('성분 지표',()=>{
  for(const f of fixtures)it(`${f.id}: 예시의 인용과 참조가 유효하다`,()=>{expect(()=>assertAnalysis(demoAnalysis(f.id))).not.toThrow();});
  it('다중 논점 집계는 100%를 넘을 수 있다',()=>{const a=demoAnalysis('mixed');a.topicAssignments[0].topicIds=['topic_0','topic_1'];a.topicAssignments[1].topicIds=['topic_0'];a.topicAssignments[2].topicIds=['topic_1'];expect(indicators(a).topics.reduce((n,t)=>n+(t.coverage.percent??0),0)).toBeGreaterThan(100);});
  it('0 분모는 0점 대신 null이다',()=>{expect(ratio(0,0).percent).toBeNull();expect(demoAnalysis('no_comments').indicators.topics[0].coverage.percent).toBeNull();expect(demoAnalysis('neutral').indicators.evidenceSupport.percent).toBeNull();});
  it('재대조를 중복 합산하지 않고 실패를 완료로 세지 않는다',()=>{const a=demoAnalysis('conflict');const completed=demoVerification('conflict').checks[0];expect(indicators(a,[completed,completed]).verificationProgress.numerator).toBe(1);expect(indicators(a,[completed,{...completed,execution:'failed',outcome:'inaccessible'}]).verificationProgress.numerator).toBe(0);});
  it('검증되지 않은 표현은 정상 대신 유보한다',()=>{const result=assembleAnalysis({kind:'text',body:'근거를 살펴보자.',comments:[]},{topics:[],topicAssignments:[],stances:[],bodyAssigned:[],bodyOtherIds:[],bodyUndeterminedIds:[],expressions:[],claims:[],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:false},'test','test-model');expect(result.expressions[0].status).toBe('undetermined');expect(result.status).toBe('partial');});
});
describe('자료 대조',()=>{
  it('가짜 인용으로 뒷받침을 만들지 않는다',()=>{const a=demoAnalysis('conflict');const result=buildChecks({checks:[{claimId:'claim_0',originMatches:true,outcome:'supported',relations:[{referenceId:'r',quote:'없는 인용',relation:'supports',explanation:'예시'}],explanation:'대조',temporalFit:'matched',limitations:[]}]},a.claims,[{id:'r',provenance:'provided_text',text:'다른 문장',truncated:false}]);expect(result.checks[0].outcome).toBe('insufficient');expect(result.checks[0].relations).toHaveLength(0);expect(result.damaged).toBe(true);});
  it('원문 위치를 바꿔 보내면 거절한다',()=>{const a=demoAnalysis('conflict');const req={kind:'text' as const,sources:a.sources,claims:a.claims,references:[],useWebSearch:false as const};expect(()=>validateVerifyInput(req)).not.toThrow();req.sources[0].sentences[0].start=1;expect(()=>validateVerifyInput(req)).toThrow();});
  it('시점이 다른 자료로 뒷받침을 확정하지 않는다',()=>{const a=demoAnalysis('conflict');const result=buildChecks({checks:[{claimId:'claim_0',originMatches:true,outcome:'supported',relations:[{referenceId:'r',quote:'작년 공지',relation:'supports',explanation:'작년의 내용'}],explanation:'올해 자료 아님',temporalFit:'mismatched',limitations:[]}]},a.claims,[{id:'r',text:'작년 공지',provenance:'provided_text',truncated:false}]);expect(result.checks[0].outcome).toBe('insufficient');});
});
describe('입력·네트워크 경계',()=>{
  it('본문 한도와 스키마를 확인한다',()=>{expect(analyzeRequestSchema.safeParse({kind:'text',body:' ',comments:[]}).success).toBe(false);expect(analyzeRequestSchema.safeParse({kind:'text',body:'가'.repeat(8001),comments:[]}).success).toBe(false);expect(verifyRequestSchema.safeParse({kind:'text',sources:[],claims:[],references:[],useWebSearch:false}).success).toBe(false);});
  it('허용 목록 밖의 URL·로컬 주소·인증 URL·유사 도메인을 차단한다',()=>{expect(allowedUrl('https://example.com/page',['example.com'])?.hostname).toBe('example.com');for(const url of ['http://127.0.0.1','http://localhost','https://example.com.evil.test','https://user@example.com','https://example.com:9000'])expect(allowedUrl(url,['example.com'])).toBeNull();});
  it('다른 출처의 요청과 너무 큰 본문을 거절한다',async()=>{await expect(readJson(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'}))).rejects.toMatchObject({status:403});await expect(readJson(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'가'.repeat(140000)})}))).rejects.toMatchObject({status:413});});
});
