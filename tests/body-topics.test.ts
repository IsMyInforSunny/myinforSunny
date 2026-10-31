import { describe,it,expect } from 'vitest';
import { assertAnalysis,bodyTopicDistribution,indicators,naturalSentences } from '../lib/domain';
import { demoAnalysis,fixtures } from '../lib/fixtures';
import { analysisModelSchema,type RawAnalysis,type TextRequest } from '../lib/contracts';
import { makeSources } from '../lib/domain';
import { assembleAnalysis } from '../lib/server/analyze';

const body='학교 앞 도로가 위험하다. 신호등을 설치해야 한다. 예산도 확인해야 한다.';
const clear=(sentenceId:string)=>({sentenceId,status:'clear' as const,criteria:[],severity:'none' as const,context:'direct' as const,explanation:'',evidence:[]});
const topics=()=>[
  {id:'safety',label:'안전',description:'도로 안전',evidence:[{sentenceId:'body_s0',quote:'학교 앞 도로가 위험하다.'}]},
  {id:'budget',label:'예산',description:'필요한 비용',evidence:[{sentenceId:'body_s2',quote:'예산도 확인해야 한다.'}]},
];
function raw(overrides:Partial<RawAnalysis>={},req:TextRequest={kind:'text',body,comments:[]}):RawAnalysis{
  const units=makeSources(req).flatMap(s=>s.sentences);
  return {topics:topics(),topicAssignments:[],stances:[],bodyAssigned:[],bodyOtherIds:[],bodyUndeterminedIds:[],expressions:units.map(u=>clear(u.id)),claims:[],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:false,...overrides};
}
const build=(overrides:Partial<RawAnalysis>={},req:TextRequest={kind:'text',body,comments:[]})=>assembleAnalysis(req,raw(overrides,req),'req','mock-model');

describe('본문 논점 분포 조립',()=>{
  it('댓글이 없어도 문장별 배정으로 본문 분포를 만들고 다중 논점은 겹쳐 센다',()=>{
    const a=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety','budget']},{sentenceId:'body_s1',topicIds:['safety']},{sentenceId:'body_s2',topicIds:['budget']}]});
    expect(a.status).toBe('success');expect(a.sources.filter(s=>s.kind==='comment')).toHaveLength(0);
    expect(a.bodyTopicAssignments).toEqual([{sentenceId:'body_s0',topicIds:['safety','budget'],status:'assigned'},{sentenceId:'body_s1',topicIds:['safety'],status:'assigned'},{sentenceId:'body_s2',topicIds:['budget'],status:'assigned'}]);
    const dist=bodyTopicDistribution(a);expect(dist).toMatchObject({available:true,sentences:3,assigned:3,other:0,undetermined:0});
    expect(dist.topics.map(t=>t.coverage)).toEqual([{numerator:2,denominator:3,percent:66.7},{numerator:2,denominator:3,percent:66.7}]);
    expect(dist.topics.reduce((n,t)=>n+(t.coverage.percent??0),0)).toBeGreaterThan(100);
    // The comment distribution stays separate: no comments means no denominator, regardless of body results.
    expect(a.indicators.topics.every(t=>t.coverage.denominator===0&&t.coverage.percent===null)).toBe(true);
  });
  it('기타와 명시적 유보를 구분하고 유보 문장도 분모에 남긴다',()=>{
    const a=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']}],bodyOtherIds:['body_s1'],bodyUndeterminedIds:['body_s2']});
    expect(a.bodyTopicAssignments!.map(x=>x.status)).toEqual(['assigned','other','undetermined']);
    expect(a.bodyTopicAssignments![2].reason).toBeTruthy();
    const dist=bodyTopicDistribution(a);expect(dist).toMatchObject({sentences:3,assigned:1,other:1,undetermined:1});
    expect(dist.topics[0].coverage).toEqual({numerator:1,denominator:3,percent:33.3});
    expect(()=>assertAnalysis(a)).not.toThrow();
  });
  it('논점 근거 인용(예시)은 완전한 배정으로 세지 않는다',()=>{
    const a=build();// topics carry example quotes for body_s0 and body_s2, but no sentence is assigned.
    expect(a.topics).toHaveLength(2);expect(a.status).toBe('partial');
    expect(a.bodyTopicAssignments!.every(x=>x.status==='undetermined'&&x.topicIds.length===0&&!!x.reason)).toBe(true);
    const dist=bodyTopicDistribution(a);expect(dist).toMatchObject({sentences:3,assigned:0,undetermined:3});
    expect(dist.topics.every(t=>t.coverage.numerator===0&&t.coverage.denominator===3)).toBe(true);
    expect(()=>assertAnalysis(a)).not.toThrow();
  });
  it('누락된 문장은 유보하고 부분 결과로 표시한다',()=>{
    const a=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']}],bodyOtherIds:['body_s1']});
    expect(a.status).toBe('partial');expect(a.bodyTopicAssignments![2]).toMatchObject({sentenceId:'body_s2',status:'undetermined',topicIds:[]});
    expect(a.bodyTopicAssignments![2].reason).toContain('누락');expect(a.warnings.some(w=>w.code==='PARTIAL_EVIDENCE')).toBe(true);
  });
  it('여러 목록 또는 같은 목록에 중복된 문장은 어느 쪽도 믿지 않고 유보한다',()=>{
    const across=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']}],bodyOtherIds:['body_s0','body_s1'],bodyUndeterminedIds:['body_s2']});
    expect(across.status).toBe('partial');expect(across.bodyTopicAssignments![0]).toMatchObject({status:'undetermined',topicIds:[]});expect(across.bodyTopicAssignments![0].reason).toContain('중복');
    const within=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']},{sentenceId:'body_s0',topicIds:['budget']}],bodyOtherIds:['body_s1','body_s2']});
    expect(within.bodyTopicAssignments![0]).toMatchObject({status:'undetermined',topicIds:[]});expect(within.status).toBe('partial');
    expect(across.bodyTopicAssignments).toHaveLength(3);expect(within.bodyTopicAssignments).toHaveLength(3);
  });
  it('존재하지 않는 논점 ID는 제거하고 남는 유효 ID가 없으면 유보한다',()=>{
    const none=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['ghost']}],bodyOtherIds:['body_s1','body_s2']});
    expect(none.bodyTopicAssignments![0]).toMatchObject({status:'undetermined',topicIds:[]});expect(none.status).toBe('partial');
    const some=build({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety','ghost','safety']}],bodyOtherIds:['body_s1','body_s2']});
    expect(some.bodyTopicAssignments![0]).toEqual({sentenceId:'body_s0',topicIds:['safety'],status:'assigned'});expect(some.status).toBe('partial');
    expect(()=>assertAnalysis(none)).not.toThrow();expect(()=>assertAnalysis(some)).not.toThrow();
  });
  it('본문이 아닌 문장 ID나 없는 ID는 배정 목록을 늘리지 못한다',()=>{
    const req:TextRequest={kind:'text',body,comments:[{id:'c1',text:'신호등이 필요해요.'}]};
    const a=build({topicAssignments:[{sourceId:'comment_0',topicIds:['safety'],status:'assigned',evidence:[{sentenceId:'comment_0_s0',quote:'신호등이 필요해요.'}],reason:''}],bodyAssigned:[{sentenceId:'comment_0_s0',topicIds:['safety']},{sentenceId:'body_s9',topicIds:['safety']}],bodyOtherIds:['body_s0','body_s1','body_s2']},req);
    expect(a.bodyTopicAssignments!.map(x=>x.sentenceId)).toEqual(['body_s0','body_s1','body_s2']);expect(a.status).toBe('partial');
    expect(bodyTopicDistribution(a).assigned).toBe(0);
  });
  it('댓글 분포는 본문 분포와 따로 유지된다',()=>{
    const req:TextRequest={kind:'text',body,comments:[{id:'c1',text:'신호등이 필요해요.'},{id:'c2',text:'다른 이야기예요.'}]};
    const a=build({topicAssignments:[{sourceId:'comment_0',topicIds:['safety'],status:'assigned',evidence:[{sentenceId:'comment_0_s0',quote:'신호등이 필요해요.'}],reason:''},{sourceId:'comment_1',topicIds:[],status:'other',evidence:[],reason:''}],bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']},{sentenceId:'body_s1',topicIds:['safety']}],bodyOtherIds:['body_s2']},req);
    expect(a.status).toBe('success');
    expect(a.indicators.topics.find(t=>t.topicId==='safety')!.coverage).toEqual({numerator:1,denominator:2,percent:50});
    expect(bodyTopicDistribution(a).topics.find(t=>t.topicId==='safety')!.coverage).toEqual({numerator:2,denominator:3,percent:66.7});
  });
  it('500자 조각으로 나뉜 긴 문장은 본문 문장 1개로 센다',()=>{
    const long=`${'가나다라마바사아자차'.repeat(60)}.`;const req:TextRequest={kind:'text',body:long,comments:[]};
    const withTopic=(over:Partial<RawAnalysis>)=>build({topics:[{id:'safety',label:'안전',description:'도로 안전',evidence:[{sentenceId:'body_s0',quote:'가나다라마바사아자차'}]}],...over},req);
    const a=withTopic({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']}],bodyOtherIds:['body_s1']});
    expect(a.coverage).toMatchObject({totalSentences:2,naturalSentences:1});
    const dist=bodyTopicDistribution(a);expect(dist).toMatchObject({sentences:1,processingUnits:2,fragmentedSentences:1,assigned:1,undetermined:0,items:[{status:'assigned',partiallyUndetermined:false}]});
    expect(dist.topics[0].coverage).toEqual({numerator:1,denominator:1,percent:100});
    const mixed=bodyTopicDistribution(withTopic({bodyAssigned:[{sentenceId:'body_s0',topicIds:['safety']}],bodyUndeterminedIds:['body_s1']}));
    expect(mixed.items[0]).toMatchObject({status:'assigned',partiallyUndetermined:true});
    const unresolved=bodyTopicDistribution(withTopic({bodyOtherIds:['body_s0'],bodyUndeterminedIds:['body_s1']}));
    expect(unresolved).toMatchObject({sentences:1,assigned:0,other:0,undetermined:1});
    expect(bodyTopicDistribution(withTopic({bodyOtherIds:['body_s0','body_s1']})).items[0].status).toBe('other');
  });
});

describe('본문 논점 불변식과 이전 형식 호환',()=>{
  const valid=()=>demoAnalysis('mixed');
  it('배정이 빠지거나 중복되면 완전한 분석으로 통과하지 않는다',()=>{
    const missing=valid();missing.bodyTopicAssignments!.pop();expect(()=>assertAnalysis(missing)).toThrow('BODY_TOPIC_COVERAGE');
    const duplicate=valid();duplicate.bodyTopicAssignments![1]={...duplicate.bodyTopicAssignments![0]};expect(()=>assertAnalysis(duplicate)).toThrow('BODY_TOPIC_COVERAGE');
    const foreign=valid();foreign.bodyTopicAssignments![0].sentenceId='comment_0_s0';expect(()=>assertAnalysis(foreign)).toThrow('BODY_TOPIC_COVERAGE');
  });
  it('잘못된 논점 ID와 상태·논점 불일치를 거절한다',()=>{
    const ghost=valid();ghost.bodyTopicAssignments![1].topicIds=['ghost'];expect(()=>assertAnalysis(ghost)).toThrow('BODY_TOPIC_ASSIGNMENT');
    const empty=valid();empty.bodyTopicAssignments![1].topicIds=[];expect(()=>assertAnalysis(empty)).toThrow('BODY_TOPIC_ASSIGNMENT');
    const other=valid();other.bodyTopicAssignments![0]={sentenceId:'body_s0',topicIds:['topic_0'],status:'other'};expect(()=>assertAnalysis(other)).toThrow('BODY_TOPIC_ASSIGNMENT');
    const dup=valid();dup.bodyTopicAssignments![2].topicIds=['topic_1','topic_1'];expect(()=>assertAnalysis(dup)).toThrow('BODY_TOPIC_ASSIGNMENT');
  });
  it('현재 분리기로 만든 결과에 본문 배정이 없으면 거절하고, 이전 형식 내보내기는 허용하되 분포를 만들지 않는다',()=>{
    const current=valid();delete current.bodyTopicAssignments;expect(()=>assertAnalysis(current)).toThrow('BODY_TOPIC_MISSING');
    const old=valid();delete old.bodyTopicAssignments;old.versions.segmenter='sentence-2.0';expect(()=>assertAnalysis(old)).not.toThrow();
    const dist=bodyTopicDistribution(old);expect(dist).toMatchObject({available:false,sentences:0,topics:[],items:[]});
  });
  it('자연 문장 수가 조각 수와 어긋난 요약은 거절한다',()=>{
    const a=valid();a.coverage.naturalSentences=99;expect(()=>assertAnalysis(a)).toThrow('NATURAL_SENTENCE_COUNT');
  });
  it('모델 출력 스키마는 본문 문장 수보다 많은 ID를 받지 않는다',()=>{
    const sources=makeSources({kind:'text',body,comments:[]});const shape=analysisModelSchema(sources,false).shape;
    expect(shape.bodyOtherIds.safeParse(['body_s0','body_s1','body_s2']).success).toBe(true);
    expect(shape.bodyOtherIds.safeParse(['body_s0','body_s1','body_s2','body_s3']).success).toBe(false);
    expect(shape.bodyAssigned.safeParse([{sentenceId:'body_s0',topicIds:['a'],reason:'extra'}]).success).toBe(false);
  });
});

describe('예시 본문 논점',()=>{
  for(const f of fixtures)it(`${f.id}: 모든 본문 문장이 정확히 한 번 배정되고 근거 인용과 무관하게 계산된다`,()=>{
    const a=demoAnalysis(f.id);expect(()=>assertAnalysis(a)).not.toThrow();
    const dist=bodyTopicDistribution(a);expect(dist.available).toBe(true);
    expect(dist.assigned+dist.other+dist.undetermined).toBe(dist.sentences);
    // Body distribution excludes comment sentences; coverage covers every source.
    expect(dist.sentences).toBe(naturalSentences(a.sources[0].sentences).length);
    expect(a.coverage.naturalSentences).toBe(a.sources.reduce((n,s)=>n+naturalSentences(s.sentences).length,0));
    expect(new Set(a.bodyTopicAssignments!.map(x=>x.sentenceId)).size).toBe(a.sources[0].sentences.length);
  });
  it('댓글 없는 예시도 본문 분포를 가지며 댓글 지표는 분모 0 그대로다',()=>{
    const a=demoAnalysis('no_comments');const dist=bodyTopicDistribution(a);
    expect(dist.sentences).toBe(2);expect(dist.topics[0].coverage).toEqual({numerator:1,denominator:2,percent:50});
    expect(indicators(a).topics[0].coverage).toEqual({numerator:0,denominator:0,percent:null});
  });
  it('여러 논점에 해당하는 문장은 각 논점에 겹쳐 센다',()=>{
    const a=demoAnalysis('mixed');const dist=bodyTopicDistribution(a);
    const numerators=dist.topics.reduce((n,t)=>n+t.coverage.numerator,0);
    expect(numerators).toBeGreaterThan(dist.assigned);
  });
});
