import {auditEvent,type AuditEvent} from './audit';
/** Only fixed metadata is emitted. Request/response bodies and raw errors never enter logging. */
export function withAudit(event:AuditEvent,handler:(request:Request)=>Promise<Response>){
 return async(request:Request)=>{
  const start=Date.now();const requestId=crypto.randomUUID();
  try{const response=await handler(request);auditEvent(event,request.signal.aborted?'cancelled':response.ok?'completed':response.status<500?'rejected':'failed',{requestId,durationMs:Date.now()-start});return response;}
  catch(error){auditEvent(event,request.signal.aborted?'cancelled':'failed',{requestId,durationMs:Date.now()-start});throw error;}
 };
}
