import {AppError,providerFailure} from '../errors';
import {retrySeconds} from './groq';
import {DEEPSEEK_MODEL,type RuntimeConfig} from '../config';
import type {StructuredProvider} from './types';

export const DEEPSEEK_TIMEOUT_MS=600000;
export const DEEPSEEK_IDLE_TIMEOUT_MS=180000;

/** Official DeepSeek API (not NVIDIA NIM). */
export const deepseekProvider:StructuredProvider={id:'deepseek',async generate(request,config){
 const started=Date.now();
 const timing=(stage:string)=>console.info(JSON.stringify({type:'provider_timing',provider:'deepseek',stage,durationMs:Date.now()-started}));
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS)]);
 let response:Response;
 try{
  signal.throwIfAborted();config.onDispatch?.();
  response=await fetch('https://api.deepseek.com/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.DEEPSEEK_API_KEY}`},
   body:JSON.stringify({model:request.model||DEEPSEEK_MODEL,reasoning_effort:'none',max_tokens:8192,response_format:{type:'json_object'},messages:[
    {role:'system',content:request.instructions+'\nReturn only one JSON object matching this JSON Schema. Do not include Markdown or explanations.\n'+JSON.stringify(request.schema)},
    {role:'user',content:JSON.stringify(request.input)}],stream:true,stream_options:{include_usage:true}}),signal,
  });
 }catch{throw new AppError(signal.aborted?504:503,signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',signal.aborted?'분석 시간이 초과되었거나 취소되었습니다.':'DeepSeek API에 연결하지 못했습니다.',true);}
 timing('headers');
 if(!response.ok){
  try{
   if(response.status===429)await config.onRateLimit?.(retrySeconds(response.headers));
   throw providerFailure(response.status);
  }finally{await response.body?.cancel().catch(()=>{});}
 }
 if(response.headers.get('content-type')?.includes('text/event-stream'))return readStream(response,signal,config,timing);
 const data=await response.json().catch(()=>null) as {usage?:{total_tokens?:number};choices?:{finish_reason?:string;message?:{content?:unknown;refusal?:unknown}}[]}|null;
 const usage=data?.usage?.total_tokens;
 if(typeof usage==='number'&&Number.isFinite(usage)&&usage>=0)config.onUsage?.(usage);
 const choice=data?.choices?.[0];
 if(choice?.finish_reason!=='stop'||choice.message?.refusal||typeof choice.message?.content!=='string')throw new AppError(502,'INVALID_MODEL_OUTPUT','완전한 분석 결과를 받지 못했습니다.');
 return choice.message.content;
}};

async function readStream(response:Response,signal:AbortSignal,config:RuntimeConfig,timing:(stage:string)=>void){
 const reader=response.body?.getReader();
 if(!reader)throw new AppError(502,'INVALID_MODEL_OUTPUT','DeepSeek 응답 본문을 받지 못했습니다.');
 const decoder=new TextDecoder();let buffer='',content='',finish:string|null=null,refused=false,usage:number|undefined,done=false;
 let firstDelta=false,firstContent=false;
 const event=(line:string)=>{
  if(!line.startsWith('data:'))return;
  const payload=line.slice(5).trim();if(payload==='[DONE]'){done=true;return;}if(!payload)return;
  let data:{error?:{status?:number};choices?:{delta?:{content?:unknown;refusal?:unknown};finish_reason?:string}[];usage?:{total_tokens?:number}};
  try{data=JSON.parse(payload) as typeof data;}catch{throw new AppError(502,'INVALID_MODEL_OUTPUT','DeepSeek 스트림 형식을 확인하지 못했습니다.');}
  if(data.error)throw providerFailure(typeof data.error.status==='number'?data.error.status:503);
  const choice=data.choices?.[0];
  if(!firstDelta&&choice?.delta){firstDelta=true;timing('first_delta');}
  if(!firstContent&&typeof choice?.delta?.content==='string'&&choice.delta.content){firstContent=true;timing('first_content');}
  if(typeof choice?.delta?.content==='string')content+=choice.delta.content;
  if(choice?.delta?.refusal)refused=true;
  if(typeof choice?.finish_reason==='string')finish=choice.finish_reason;
  if(typeof data.usage?.total_tokens==='number'&&Number.isFinite(data.usage.total_tokens)&&data.usage.total_tokens>=0)usage=data.usage.total_tokens;
 };
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{
  while(true){
   signal.throwIfAborted();
   let timer:ReturnType<typeof setTimeout>|undefined;
   const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError(504,'TIMEOUT','DeepSeek 응답이 오래 멈춰 분석을 종료했습니다. 잠시 후 다시 시도해 주세요.',true)),DEEPSEEK_IDLE_TIMEOUT_MS);})]).finally(()=>clearTimeout(timer));
   signal.throwIfAborted();if(chunk.done)break;
   buffer+=decoder.decode(chunk.value,{stream:true});let index:number;
   while((index=buffer.indexOf('\n'))>=0){event(buffer.slice(0,index).replace(/\r$/,''));buffer=buffer.slice(index+1);}
   if(finish||done)break;
  }
  if(buffer.trim())event(buffer.replace(/\r$/,''));
  if(usage!==undefined)config.onUsage?.(usage);
  if(finish!=='stop'||refused||!content.trim()){
   timing(finish==='length'?'output_limit':refused?'refused':!content.trim()?'no_final_content':'incomplete');
   throw new AppError(502,'INVALID_MODEL_OUTPUT',finish==='length'?'DeepSeek가 결과 생성을 중단했습니다. 입력을 줄여 다시 시도해 주세요.':'완전한 분석 결과를 받지 못했습니다.');
  }
  timing('completed');return content;
 }catch(error){
  if(error instanceof AppError)throw error;
  throw new AppError(signal.aborted?504:503,signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',signal.aborted?'DeepSeek 분석 대기 시간이 초과되었거나 취소되었습니다.':'DeepSeek 응답 연결이 중단되었습니다.',true);
 }finally{timing('stream_closed');signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
