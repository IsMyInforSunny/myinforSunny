import {AppError,providerFailure} from '../errors';
// The shared endpoint can queue requests for >100 seconds before generation starts.
export const NVIDIA_TIMEOUT_MS=600000;
export const NVIDIA_IDLE_TIMEOUT_MS=180000;
import {retrySeconds} from './groq';
import type {StructuredProvider} from './types';

/** NVIDIA NIM's OpenAI-compatible endpoint. No application token cap or retries. */
export const nvidiaProvider:StructuredProvider={id:'nvidia',async generate(request,config){
 const started=Date.now();
 const timing=(stage:string)=>console.info(JSON.stringify({type:'provider_timing',provider:'nvidia',stage,durationMs:Date.now()-started}));
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(NVIDIA_TIMEOUT_MS)]);
 let response:Response;
 try{
  signal.throwIfAborted();config.onDispatch?.();
  response=await fetch('https://integrate.api.nvidia.com/v1/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.NVIDIA_API_KEY}`},
   body:JSON.stringify({model:request.model,messages:[
    {role:'system',content:request.instructions+'\nReturn only one JSON object matching this JSON Schema. Do not include Markdown or explanations.\n'+JSON.stringify(request.schema)},
    {role:'user',content:JSON.stringify(request.input)}],temperature:1,top_p:0.95,stream:true}),signal,
  });
 }catch{throw new AppError(signal.aborted?504:503,signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',signal.aborted?'분석 시간이 초과되었거나 취소되었습니다.':'NVIDIA AI 서비스에 연결하지 못했습니다.',true);}
 timing('headers');
 if(!response.ok){
  try{
   if(response.status===429)await config.onRateLimit?.(retrySeconds(response.headers));
   throw providerFailure(response.status);
  }finally{await response.body?.cancel().catch(()=>{});}
 }
 if(response.headers.get('content-type')?.includes('text/event-stream'))return readNvidiaStream(response,signal,config,timing);
 const data=await response.json().catch(()=>null) as {usage?:{total_tokens?:number};choices?:{finish_reason?:string;message?:{content?:unknown;refusal?:unknown}}[]}|null;
 const usage=data?.usage?.total_tokens;
 if(typeof usage==='number'&&Number.isFinite(usage)&&usage>=0)config.onUsage?.(usage);
 const choice=data?.choices?.[0];
 if(choice?.finish_reason!=='stop'||choice.message?.refusal||typeof choice.message?.content!=='string')throw new AppError(502,'INVALID_MODEL_OUTPUT','완전한 분석 결과를 받지 못했습니다.');
 return choice.message.content;
}};

/** Keep reasoning private. Only final content enters schema and evidence validation. */
async function readNvidiaStream(response:Response,signal:AbortSignal,config:import('../config').RuntimeConfig,timing:(stage:string)=>void){
 const reader=response.body?.getReader();
 if(!reader)throw new AppError(502,'INVALID_MODEL_OUTPUT','AI 응답 본문을 받지 못했습니다.');
 const decoder=new TextDecoder();let buffer='',content='',finish:string|null=null,refused=false,usage:number|undefined,done=false;
 let firstDelta=false,firstContent=false;
 const event=(line:string)=>{
  if(!line.startsWith('data:'))return;
  const payload=line.slice(5).trim();if(payload==='[DONE]'){done=true;return;}if(!payload)return;
  let data;try{data=JSON.parse(payload);}catch{throw new AppError(502,'INVALID_MODEL_OUTPUT','AI 스트림 형식을 확인하지 못했습니다.');}
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
   const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AppError(504,'TIMEOUT','NVIDIA 응답이 오래 멈춰 분석을 종료했습니다. 잠시 후 다시 시도해 주세요.',true)),NVIDIA_IDLE_TIMEOUT_MS);})]).finally(()=>clearTimeout(timer));
   signal.throwIfAborted();
   if(chunk.done)break;
   buffer+=decoder.decode(chunk.value,{stream:true});
   let index;while((index=buffer.indexOf('\n'))>=0){event(buffer.slice(0,index).replace(/\r$/,''));buffer=buffer.slice(index+1);}
   if(finish||done)break;
  }
  if(buffer.trim())event(buffer.replace(/\r$/,''));
  if(usage!==undefined)config.onUsage?.(usage);
  if(finish!=='stop'||refused||!content.trim()){
   timing(finish==='length'?'output_limit':refused?'refused':!content.trim()?'no_final_content':'incomplete');
   throw new AppError(502,'INVALID_MODEL_OUTPUT',finish==='length'?'NVIDIA가 결과 생성을 중단했습니다. 입력을 줄여 다시 시도해 주세요.':'완전한 분석 결과를 받지 못했습니다.');
  }
  timing('completed');return content;
 }catch(error){
  if(error instanceof AppError)throw error;
  throw new AppError(signal.aborted?504:503,signal.aborted?'TIMEOUT':'PROVIDER_UNAVAILABLE',signal.aborted?'NVIDIA 분석 대기 시간이 초과되었거나 취소되었습니다.':'NVIDIA 응답 연결이 중단되었습니다.',true);
 }finally{timing('stream_closed');signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
