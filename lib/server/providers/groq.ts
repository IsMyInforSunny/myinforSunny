import {AppError,providerFailure} from '../errors';
import type {RuntimeConfig} from '../config';
import {REQUEST_TIMEOUT_MS} from '../limits';
import {RESERVATION} from '../budget';
import type {StructuredProvider} from './types';

export const MAX_COMPLETION_TOKENS=2000;
export async function requestTokenBudget(instructions:string,input:unknown,schemaJson:unknown){
  const {encode}=await import('gpt-tokenizer/encoding/o200k_harmony');
  // Count the actual fixed encoder plus a conservative allowance for server chat/schema wrappers.
  const tokens=encode(instructions,{disallowedSpecial:new Set()}).length+encode(JSON.stringify(input),{disallowedSpecial:new Set()}).length+encode(JSON.stringify(schemaJson),{disallowedSpecial:new Set()}).length+512+MAX_COMPLETION_TOKENS;
  if(tokens>RESERVATION)throw new AppError(422,'INPUT_TOO_LARGE','무료 분석의 토큰 한도를 넘었습니다. 본문·댓글·자료를 줄여 주세요.');
  return tokens;
}
export function retrySeconds(headers:Headers){
 const value=headers.get('retry-after');const seconds=value?Number(value):NaN;
 return Number.isFinite(seconds)&&seconds>0?Math.min(86400,seconds):60;
}

export const groqProvider:StructuredProvider={id:'groq',async generate(request,config:RuntimeConfig){
  const callSignal=AbortSignal.any([request.signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  let response:Response;
  try{
    callSignal.throwIfAborted();
    config.onDispatch?.();
    response=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.GROQ_API_KEY}`},
      body:JSON.stringify({model:request.model,messages:[{role:'system',content:request.instructions},{role:'user',content:JSON.stringify(request.input)}],
        response_format:{type:'json_schema',json_schema:{name:'information_ingredients',strict:true,schema:request.schema}},
        max_completion_tokens:MAX_COMPLETION_TOKENS,reasoning_effort:'low',stream:false}),signal:callSignal,
    });
  }catch{throw new AppError(callSignal.aborted?504:503,callSignal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',callSignal.aborted?'분석 시간이 초과되었거나 취소되었습니다.':'무료 AI 서비스에 연결하지 못했습니다.',true);}
  if(!response.ok){
   try{
    if(response.status===429){await config.onRateLimit?.(retrySeconds(response.headers));throw new AppError(429,'RATE_LIMITED','무료 AI 요청·토큰 한도에 도달했습니다. 안내된 시간이 지난 뒤 다시 이용해 주세요.',true);}
    if(response.status===400){
      const error=await response.json().catch(()=>null) as {error?:{code?:unknown}}|null;
      if(error?.error?.code==='json_validate_failed')throw new AppError(502,'INVALID_MODEL_OUTPUT','AI가 완전한 분석 형식을 만들지 못했습니다. 입력을 줄이거나 예시를 이용해 주세요.');
    }
    // No raw provider message is exposed or logged.
    throw providerFailure(response.status);
   }finally{await response.body?.cancel().catch(()=>{});}
  }
  const data=await response.json().catch(()=>null) as {usage?:{total_tokens?:number};choices?:{finish_reason?:string;message?:{content?:unknown;refusal?:unknown}}[]}|null;
  const usage=data?.usage?.total_tokens;
  if(typeof usage==='number'&&Number.isFinite(usage)&&usage>=0)config.onUsage?.(usage);
  const choice=data?.choices?.[0];
  if(choice?.finish_reason!=='stop'||choice.message?.refusal||typeof choice.message?.content!=='string')throw new AppError(502,'INVALID_MODEL_OUTPUT','완전한 분석 결과를 받지 못했습니다. 입력을 줄이거나 예시를 이용해 주세요.');
  return choice.message.content;
}};
