import {errorResponse} from './errors';

type Outcome='completed'|'failed'|'cancelled';
const completions=new WeakMap<Response,Promise<Outcome>>();
export const analysisStreamCompletion=(response:Response)=>completions.get(response);

export function analysisStream(request:Request,requestId:string,
  work:(emit:(event:string,data:unknown)=>void,signal:AbortSignal)=>Promise<unknown>){
  const abort=new AbortController();
  const signal=AbortSignal.any([request.signal,abort.signal]);
  let finish!:(outcome:Outcome)=>void;
  const completion=new Promise<Outcome>(resolve=>{finish=resolve;});
  let closed=false;
  const body=new ReadableStream<Uint8Array>({
    start(controller){
      const encoder=new TextEncoder();
      const emit=(event:string,data:unknown)=>{if(!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
      const heartbeat=setInterval(()=>{if(!closed)controller.enqueue(encoder.encode(': waiting\n\n'));},15000);
      void (async()=>{
        try{const result=await work(emit,signal);signal.throwIfAborted();emit('result',result);finish('completed');}
        catch(error){if(!signal.aborted)emit('error',await errorResponse(error,requestId).json());finish(signal.aborted?'cancelled':'failed');}
        finally{clearInterval(heartbeat);if(!closed){closed=true;controller.close();}}
      })();
    },
    cancel(){closed=true;abort.abort();finish('cancelled');},
  });
  const response=new Response(body,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-Id':requestId}});
  completions.set(response,completion);
  return response;
}
