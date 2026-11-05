import {AppError,providerFailure} from '../errors';
export const NVIDIA_TIMEOUT_MS=180000;
import {retrySeconds} from './groq';
import type {StructuredProvider} from './types';

/** NVIDIA NIM's OpenAI-compatible endpoint. No application token cap or retries. */
export const nvidiaProvider:StructuredProvider={id:'nvidia',async generate(request,config){
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(NVIDIA_TIMEOUT_MS)]);
 let response:Response;
 try{
  signal.throwIfAborted();config.onDispatch?.();
  response=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.NVIDIA_API_KEY}`},
   body:JSON.stringify({model:request.model,messages:[
    {role:'system',content:request.instructions+'\nReturn only one JSON object matching this JSON Schema. Do not include Markdown or explanations.\n'+JSON.stringify(request.schema)},
    {role:'user',content:JSON.stringify(request.input)}],temperature:1,top_p:0.95,stream:false}),signal,
  });
 }catch{throw new AppError(signal.aborted?504:503,signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',signal.aborted?'분석 시간이 초과되었거나 취소되었습니다.':'NVIDIA AI 서비스에 연결하지 못했습니다.',true);}
 if(!response.ok){
  try{
   if(response.status===429)await config.onRateLimit?.(retrySeconds(response.headers));
   throw providerFailure(response.status);
  }finally{await response.body?.cancel().catch(()=>{});}
 }
 const data=await response.json().catch(()=>null) as {usage?:{total_tokens?:number};choices?:{finish_reason?:string;message?:{content?:unknown;refusal?:unknown}}[]}|null;
 const usage=data?.usage?.total_tokens;
 if(typeof usage==='number'&&Number.isFinite(usage)&&usage>=0)config.onUsage?.(usage);
 const choice=data?.choices?.[0];
 if(choice?.finish_reason!=='stop'||choice.message?.refusal||typeof choice.message?.content!=='string')throw new AppError(502,'INVALID_MODEL_OUTPUT','완전한 분석 결과를 받지 못했습니다.');
 return choice.message.content;
}};
