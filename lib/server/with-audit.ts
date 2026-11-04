import {auditEvent,type AuditEvent} from './audit';
/** Only fixed metadata is emitted. Request/response bodies and raw errors never enter logging. */
export function withAudit(event:AuditEvent,handler:(request:Request)=>Promise<Response>){
 return async(request:Request)=>{
  const start=Date.now();const requestId=crypto.randomUUID();
  try{const response=await handler(request);const header=response.headers.get('X-Request-Id');const correlated=header&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(header)?header:requestId;response.headers.set('X-Request-Id',correlated);auditEvent(event,request.signal.aborted?'cancelled':response.ok?'completed':response.status<500?'rejected':'failed',{requestId:correlated,durationMs:Date.now()-start});return response;}
  catch(error){auditEvent(event,request.signal.aborted?'cancelled':'failed',{requestId,durationMs:Date.now()-start});throw error;}
 };
}
