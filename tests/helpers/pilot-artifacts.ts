import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

const PATTERNS:[RegExp,string][]=[
 [/gsk_[A-Za-z0-9_-]+/g,'[redacted]'],
 [/\bsk-[A-Za-z0-9_-]{8,}/g,'[redacted]'],
 [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,'$1[redacted]'],
 [/((?:GROQ|OPENAI|IP_HASH)[A-Z_]*\s*[=:]\s*)\S+/g,'$1[redacted]']
];
export function redact(value:string){return PATTERNS.reduce((text,[pattern,to])=>text.replace(pattern,to),value);}
/** Failure record without the raw error message, which may echo provider output or secrets. */
export function safeFailure(error:unknown){
 const code=typeof error==='object'&&error&&'code' in error&&typeof (error as {code:unknown}).code==='string'?redact((error as {code:string}).code):'UNKNOWN';
 const status=typeof error==='object'&&error&&'status' in error&&typeof (error as {status:unknown}).status==='number'?(error as {status:number}).status:undefined;
 return {status:'failed' as const,code,...(status===undefined?{}:{httpStatus:status})};
}
/** Every run gets its own directory; an existing directory is never reused or overwritten. */
export function createRun(base:string,now=new Date(),id=randomUUID()){
 const runId=`${now.toISOString().replace(/[:.]/g,'-')}_${id}`;const dir=join(base,'runs',runId);
 mkdirSync(join(base,'runs'),{recursive:true});mkdirSync(dir);
 return {runId,dir,
  writeRaw(index:number,content:string){writeFileSync(join(dir,`raw-${index}.json`),redact(content),{flag:'wx'});},
  writeResults(results:unknown[],meta:Record<string,unknown>={}){
   // Whole file is rewritten for this run only, after redaction of the serialized form.
   writeFileSync(join(dir,'results.json'),redact(JSON.stringify({runId,...meta,results},null,2)));
   // The latest summary is only a pointer; history lives in runs/.
   writeFileSync(join(base,'latest.json'),JSON.stringify({runId,resultCount:results.length,updatedAt:new Date().toISOString()},null,2));
  }};
}
