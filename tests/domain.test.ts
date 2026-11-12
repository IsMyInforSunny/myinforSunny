import { describe,it,expect } from 'vitest';
import { assertAnalysis, indicators, locate, makeSources, ratio, sentences, validSpan } from '../lib/domain';
import { demoAnalysis, demoVerification, fixtures } from '../lib/fixtures';
import { analyzeRequestSchema, verifyRequestSchema, type RawAnalysis } from '../lib/contracts';
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
describe('모델 정규화에서 제외한 항목의 부분 결과 표시',()=>{
  const req={kind:'text' as const,body:'공개 본문이다.',comments:[{id:'c',text:'공개 댓글이다.'}]};
  function proposal():RawAnalysis{
    return {topics:[{id:'public',label:'공개 논점',description:'공개 합성 논점',evidence:[{sentenceId:'body_s0',quote:req.body}]}],topicAssignments:[{sourceId:'comment_0',topicIds:['public'],status:'assigned',evidence:[{sentenceId:'comment_0_s0',quote:req.comments[0].text}],reason:'공개 댓글의 논점'}],stances:[],bodyAssigned:[{sentenceId:'body_s0',topicIds:['public']}],bodyOtherIds:[],bodyUndeterminedIds:[],expressions:['body_s0','comment_0_s0'].map(sentenceId=>({sentenceId,status:'clear',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]})),claims:[],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:false};
  }
  it('댓글의 알 수 없는 논점을 제외하되 정상 논점·댓글 분모를 보존하고 경고한다',()=>{
    const raw=proposal();raw.topicAssignments[0].topicIds.push('unknown');
    const result=assembleAnalysis(req,raw,'unknown-comment-topic','mock');
    expect(result.status).toBe('partial');expect(result.warnings.map(w=>w.code)).toContain('PARTIAL_EVIDENCE');
    expect(result.topicAssignments[0]).toMatchObject({status:'assigned',topicIds:['public']});
    expect(result.indicators.topics[0].coverage).toEqual({numerator:1,denominator:1,percent:100});
    expect(result.coverage).toMatchObject({totalSentences:2,naturalSentences:2,claimsMayBeOmitted:true});
  });
  it('잘못된 선택 검색어만 제거하고 핵심 분석 결과는 유지한다',()=>{
    const raw=proposal();raw.searchSuggestions=[
      {label:'검증 자료',query:'통계청'.normalize('NFD')+' 3.5% 예산'},
      {label:'잘못된 검색 연산자',query:'통계청 OR 학교'},
      {label:'x'.repeat(61),query:'정상 자료'},
      '형식이 잘못된 항목',
      {label:'추가 제안',query:'정상 추가 자료'},
    ];
    const result=assembleAnalysis(req,raw,'invalid-optional-search-hint','mock');
    expect(result.status).toBe('partial');expect(result.warnings.some(w=>w.code==='BODY_POSITION_UNAVAILABLE')).toBe(true);expect(result.searchSuggestions).toEqual([
      {label:'검증 자료',query:'통계청 3.5% 예산'},
      {label:'추가 제안',query:'정상 추가 자료'},
    ]);
  });
  it('존재하지 않는 문장의 상세 표현을 제외하고 정상 문장 수·정상 분류를 유지하며 경고한다',()=>{
    const raw=proposal();raw.expressions.push({sentenceId:'phantom',status:'flagged',criteria:['mockery'],severity:'strong',context:'direct',explanation:'존재하지 않는 문장에 붙은 모델 분류',evidence:[{sentenceId:'body_s0',quote:req.body}]});
    const result=assembleAnalysis(req,raw,'unknown-expression-unit','mock');
    expect(result.status).toBe('partial');expect(result.warnings.map(w=>w.code)).toContain('PARTIAL_EVIDENCE');
    expect(result.expressions.map(e=>[e.sentenceId,e.status])).toEqual([['body_s0','clear'],['comment_0_s0','clear']]);
    expect(result.indicators.expression).toEqual({numerator:0,denominator:2,percent:0});
    expect(result.coverage).toMatchObject({totalSentences:2,naturalSentences:2});
  });
});

describe('자료 대조',()=>{
  it.each(['unclear','mismatched'] as const)('시점 %s인 자료는 양쪽 인용이 있어도 사실 상충으로 확정하지 않는다',temporalFit=>{
    const a=demoAnalysis('conflict');
    const references=[{id:'support',text:'운영 시간은 6시다.',provenance:'provided_text' as const,truncated:false},{id:'oppose',text:'운영 시간은 9시다.',provenance:'provided_text' as const,truncated:false}];
    const relations=references.map((r,i)=>({referenceId:r.id,quote:r.text,relation:i===0?'supports' as const:'contradicts' as const,explanation:'가상 운영 시간 안내'}));
    for(const outcome of ['supported','contradicted','conflicting'] as const){
      const result=buildChecks({checks:[{claimId:a.claims[0].id,originMatches:true,outcome,relations,explanation:'시점 확인 필요',temporalFit,limitations:[]}]},a.claims,references);
      expect(result.checks[0]).toMatchObject({outcome:'insufficient',execution:'completed',temporalFit});
      expect(indicators(a,result.checks).evidenceSupport.numerator).toBe(0);
    }
    expect(buildChecks({checks:[{claimId:a.claims[0].id,originMatches:true,outcome:'conflicting',relations,explanation:'같은 시점의 자료',temporalFit:'matched',limitations:[]}]},a.claims,references).checks[0].outcome).toBe('conflicting');
  });
  it.each([{start:0,end:99},{start:0.5,end:5},{start:0,end:5.5}])('참고자료 범위가 잘못된 인용을 slice 보정으로 통과시키지 않는다: %j',offset=>{
    const a=demoAnalysis('conflict'),reference={id:'r',text:'공개 자료',provenance:'provided_text' as const,truncated:false};
    const relation={referenceId:'r',quote:reference.text,relation:'supports' as const,explanation:'가상 자료'};
    const result=buildChecks({checks:[{claimId:a.claims[0].id,originMatches:true,outcome:'supported',relations:[relation],explanation:'자료 대조',temporalFit:'matched',limitations:[]}]},a.claims,[reference],new Map([[relation,offset]]));
    expect(result.damaged).toBe(true);expect(result.checks[0]).toMatchObject({outcome:'insufficient',relations:[]});
  });
  it('가짜 인용으로 뒷받침을 만들지 않는다',()=>{const a=demoAnalysis('conflict');const result=buildChecks({checks:[{claimId:'claim_0',originMatches:true,outcome:'supported',relations:[{referenceId:'r',quote:'없는 인용',relation:'supports',explanation:'예시'}],explanation:'대조',temporalFit:'matched',limitations:[]}]},a.claims,[{id:'r',provenance:'provided_text',text:'다른 문장',truncated:false}]);expect(result.checks[0].outcome).toBe('insufficient');expect(result.checks[0].relations).toHaveLength(0);expect(result.damaged).toBe(true);});
  it('원문 위치를 바꿔 보내면 거절한다',()=>{const a=demoAnalysis('conflict');const req={kind:'text' as const,sources:a.sources,claims:a.claims,references:[],useWebSearch:false as const};expect(()=>validateVerifyInput(req)).not.toThrow();req.sources[0].sentences[0].start=1;expect(()=>validateVerifyInput(req)).toThrow();});
  it('시점이 다른 자료로 뒷받침을 확정하지 않는다',()=>{const a=demoAnalysis('conflict');const result=buildChecks({checks:[{claimId:'claim_0',originMatches:true,outcome:'supported',relations:[{referenceId:'r',quote:'작년 공지',relation:'supports',explanation:'작년의 내용'}],explanation:'올해 자료 아님',temporalFit:'mismatched',limitations:[]}]},a.claims,[{id:'r',text:'작년 공지',provenance:'provided_text',truncated:false}]);expect(result.checks[0].outcome).toBe('insufficient');});
});
describe('입력·네트워크 경계',()=>{
  it('본문 한도와 스키마를 확인한다',()=>{expect(analyzeRequestSchema.safeParse({kind:'text',body:' ',comments:[]}).success).toBe(false);expect(analyzeRequestSchema.safeParse({kind:'text',body:'가'.repeat(8001),comments:[]}).success).toBe(false);expect(verifyRequestSchema.safeParse({kind:'text',sources:[],claims:[],references:[],useWebSearch:false}).success).toBe(false);});
  it('허용 목록 밖의 URL·로컬 주소·인증 URL·유사 도메인을 차단한다',()=>{expect(allowedUrl('https://example.com/page',['example.com'])?.hostname).toBe('example.com');for(const url of ['http://127.0.0.1','http://localhost','https://example.com.evil.test','https://user@example.com','https://example.com:9000'])expect(allowedUrl(url,['example.com'])).toBeNull();});
  it('다른 출처의 요청과 너무 큰 본문을 거절한다',async()=>{await expect(readJson(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'}))).rejects.toMatchObject({status:403});await expect(readJson(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'가'.repeat(140000)})}))).rejects.toMatchObject({status:413});});
});
