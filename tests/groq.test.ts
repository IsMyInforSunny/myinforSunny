import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {capabilities,providerReady} from '../lib/server/config';
import {structured,requestTokenBudget,retrySeconds} from '../lib/server/language';
import {analyze,ANALYZE_PROMPT} from '../lib/server/analyze';
import {rawAnalysisSchema} from '../lib/contracts';
import {makeSources} from '../lib/domain';
const config={GROQ_API_KEY:'synthetic-test-token',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true'};
const schema=z.object({message:z.string()}).strict();
const response=(content:unknown,finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{total_tokens:123}});
afterEach(()=>vi.unstubAllGlobals());
describe('Groq 단일 요청 경로와 무료 경계',()=>{
 it('키·계정 조건·무료 요금제·허용 모델이 모두 필요하다',()=>{
  expect(providerReady(config)).toBe(true);
  for(const c of [{...config,GROQ_API_KEY:undefined},{...config,GROQ_ELIGIBILITY_CONFIRMED:'false'},{...config,GROQ_FREE_PLAN_CONFIRMED:'false'},{...config,GROQ_MODEL:'paid-or-unknown'}])expect(providerReady(c)).toBe(false);
  expect(capabilities({...config,DB:{} as D1Database}).live).toBe(false);
 });
 it('Groq 고정 URL·strict JSON·출력 한도를 사용하고 사용량을 정산한다',async()=>{
  const fetch=vi.fn().mockResolvedValue(response({message:'확인'}));vi.stubGlobal('fetch',fetch);
  const onUsage=vi.fn(),onDispatch=vi.fn();
  expect(await structured({...config,onUsage,onDispatch},schema,'한글 분석',{text:'공개 예시'},new AbortController().signal)).toEqual({message:'확인'});
  expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  const body=JSON.parse(fetch.mock.calls[0][1].body);
  expect(body).toMatchObject({model:config.GROQ_MODEL,max_completion_tokens:2000,response_format:{type:'json_schema',json_schema:{strict:true}}});
  expect(body).not.toHaveProperty('tools');expect(onUsage).toHaveBeenCalledWith(123);expect(onDispatch).toHaveBeenCalledTimes(1);
 });
 it('429는 대기 시간을 저장하고 재호출·다른 제공자 전환을 하지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('private provider detail',{status:429,headers:{'retry-after':'120'}}));vi.stubGlobal('fetch',fetch);
  const onRateLimit=vi.fn().mockResolvedValue(undefined);
  await expect(structured({...config,onRateLimit},schema,'분석',{},new AbortController().signal)).rejects.toMatchObject({code:'RATE_LIMITED'});
  expect(onRateLimit).toHaveBeenCalledWith(120);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('잘린 응답·틀린 스키마·잘못된 JSON을 정상 결과로 만들지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(response({message:'미완성'},'length')).mockResolvedValueOnce(response({wrong:1})).mockResolvedValueOnce(response('{broken'));vi.stubGlobal('fetch',fetch);
  for(let i=0;i<3;i++)await expect(structured(config,schema,'분석',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(fetch).toHaveBeenCalledTimes(3);
 });
 it('취소된 요청은 외부 호출 전에 거절한다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const controller=new AbortController();controller.abort();
  await expect(structured(config,schema,'분석',{},controller.signal)).rejects.toMatchObject({code:'TIMEOUT'});expect(fetch).not.toHaveBeenCalled();
 });
 it('원문 안의 특수 토큰 문자열을 사용자 데이터로 계산한다',async()=>{
  expect(await requestTokenBudget('분석',{text:'<|im_start|> 사용자 글'},{})).toBeLessThan(6500);
 });
 it('너무 긴 요청은 공급자 호출 전에 거절한다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(structured(config,schema,'분석',{text:'서로 다른 공개 문장을 검토합니다. '.repeat(3000)},new AbortController().signal)).rejects.toMatchObject({code:'INPUT_TOO_LARGE'});expect(fetch).not.toHaveBeenCalled();
 });
 it('실제 분석 스키마·한글 프롬프트도 사전 한도 안에 들어간다',async()=>{
  const sources=makeSources({kind:'text',body:'학교 도서관은 오후 6시에 문을 닫는다.',comments:[]});
  const count=await requestTokenBudget(ANALYZE_PROMPT,{sources},z.toJSONSchema(rawAnalysisSchema,{target:'draft-7'}));expect(count).toBeLessThanOrEqual(6500);
 });
 it('표현 근거가 부족하면 유보하고 보완 API를 자동 호출하지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(response({clearSentenceIds:[],topics:[{id:'not_applicable',label:'판단 유보',description:'해당 없음',evidence:[{sentenceId:'body_s0',quote:'학교에 관한 글이다.'}]}],topicAssignments:[],stances:[],bodyAssigned:[],bodyOtherIds:['body_s0'],bodyUndeterminedIds:[],expressions:[{sentenceId:'body_s0',status:'flagged',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]}],claims:[],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[{sentenceId:'body_s0',quote:'원문'}]}],searchSuggestions:[],claimsMayBeOmitted:true}));vi.stubGlobal('fetch',fetch);
  const result=await analyze({kind:'text',body:'학교에 관한 글이다.',comments:[]},config,'test',new AbortController().signal);
  expect(result.status).toBe('partial');expect(result.expressions[0].status).toBe('undetermined');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('잘못된 대기 헤더에는 보수적 기본값을 쓴다',()=>{expect(retrySeconds(new Headers({'retry-after':'invalid'}))).toBe(60);});
 it('공급자 JSON 생성 실패를 설정 오류나 임의 분석으로 대신하지 않는다',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({error:{code:'json_validate_failed',message:'private provider detail'}},{status:400}));vi.stubGlobal('fetch',fetch);
  await expect(structured(config,schema,'분석',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('정상 목록의 중복이 유효한 검토 표현을 가리지 않으며 부분 결과로 알린다',async()=>{
  const body='반대하는 사람은 모두 바보다.';
  const fetch=vi.fn().mockResolvedValue(response({topics:[{id:'opinion',label:'반대 의견 표현',description:'반대자를 다루는 표현',evidence:[{sentenceId:'body_s0',quote:body}]}],topicAssignments:[],stances:[],bodyAssigned:[{sentenceId:'body_s0',topicIds:['opinion']}],bodyOtherIds:[],bodyUndeterminedIds:[],clearSentenceIds:['body_s0'],expressions:[{sentenceId:'body_s0',status:'flagged',criteria:['personal_attack'],severity:'strong',context:'direct',explanation:'반대자를 일괄 비하',evidence:[{sentenceId:'body_s0',quote:body}]}],claims:[],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[{sentenceId:'body_s0',quote:'원문'}]}],searchSuggestions:[],claimsMayBeOmitted:true}));vi.stubGlobal('fetch',fetch);
  const a=await analyze({kind:'text',body,comments:[]},config,'overlap',new AbortController().signal);
  expect(a.status).toBe('partial');expect(a.expressions[0].status).toBe('flagged');expect(a.warnings.some(w=>w.code==='CLASSIFICATION_CONFLICT')).toBe(true);expect(a.bodyTopicAssignments).toEqual([{sentenceId:'body_s0',topicIds:['opinion'],status:'assigned'}]);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
