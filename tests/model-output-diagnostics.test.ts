import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {structured} from '../lib/server/language';

const requestId='4ac0808a-ef63-4234-8e68-4aa93d5495a0';
const privateValue='private synthetic article and credential value';
const config={GROQ_API_KEY:privateValue,GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true'};
const schema=z.object({claims:z.array(z.object({kind:z.enum(['factual','opinion'])}).strict())}).strict();
const envelope=(content:string,finish='stop')=>Response.json({choices:[{finish_reason:finish,message:{content}}]});
const run=(id=requestId)=>structured(config,schema,'synthetic instructions',{body:privateValue},AbortSignal.timeout(2000),{requestId:id});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('모델 출력 실패의 제한된 서버 진단',()=>{
  it.each([
    ['provider_json_validation',()=>Response.json({error:{code:'json_validate_failed',message:privateValue,failed_generation:privateValue}},{status:400})],
    ['output_limit',()=>envelope(privateValue,'length')],
    ['refusal',()=>Response.json({choices:[{finish_reason:'stop',message:{refusal:privateValue,content:privateValue}}]})],
    ['response_envelope',()=>Response.json({unexpected:privateValue})],
  ] as const)('공급자 실패 %s를 고정 사유와 요청 ID로만 구분한다',async(reason,response)=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetch=vi.fn().mockResolvedValue(response());vi.stubGlobal('fetch',fetch);
    await expect(run()).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT',status:502});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({type:'model_output_failure',provider:'groq',stage:'provider_response',reason,requestId});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateValue);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('JSON 해독 실패는 응답 문자열과 예외 메시지를 기록하지 않는다',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetch=vi.fn().mockResolvedValue(envelope('{'+privateValue));vi.stubGlobal('fetch',fetch);
    await expect(run()).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({type:'model_output_failure',provider:'groq',stage:'json_decode',requestId});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateValue);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('핵심 스키마 오류에는 필드 경로와 오류 코드만 남기며 알 수 없는 키·값을 제외한다',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const raw={claims:[{kind:privateValue}],[privateValue]:privateValue};
    const fetch=vi.fn().mockResolvedValue(envelope(JSON.stringify(raw)));vi.stubGlobal('fetch',fetch);
    await expect(run()).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
    const logged=JSON.parse(warn.mock.calls[0][0]);
    expect(logged).toMatchObject({type:'model_output_failure',provider:'groq',stage:'schema_validation',requestId});
    expect(logged.issues).toEqual([{path:'claims.0.kind',code:'invalid_value'},{path:'',code:'unrecognized_keys'}]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateValue);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('동적 키 경로는 가리고 요청 ID와 진단 개수를 제한한다',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const dynamic=z.object({sections:z.record(z.string(),z.array(z.object({value:z.number()}).strict()))}).strict();
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(envelope(JSON.stringify({sections:{[privateValue]:Array.from({length:12},()=>({value:privateValue}))}}))));
    await expect(structured(config,dynamic,'synthetic instructions',{},AbortSignal.timeout(2000),{requestId:privateValue})).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
    const logged=JSON.parse(warn.mock.calls[0][0]);
    expect(logged.requestId).toBeUndefined();expect(logged.issues).toHaveLength(8);
    expect(logged.issues[0]).toEqual({path:'sections.*.0.value',code:'invalid_type'});
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateValue);
  });
  it('정상 결과에는 실패 진단이나 추가 호출을 만들지 않는다',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetch=vi.fn().mockResolvedValue(envelope(JSON.stringify({claims:[{kind:'factual'}]})));vi.stubGlobal('fetch',fetch);
    expect(await run()).toEqual({claims:[{kind:'factual'}]});
    expect(warn).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);
  });
});
