// Research only. Default is a dry run; --run requires prior review of prepared input.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localRoot=path.join(root,'.sites-runtime');
const MODEL='nvidia/nemotron-3.5-embed-1b',DIMENSIONS=2048;
const ENDPOINT='https://integrate.api.nvidia.com/v1/embeddings';
const OPTIONS={model:MODEL,input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:DIMENSIONS};
const RESERVATION=6500,MAX_BUDGET=117000,INTERVAL=60000;
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  const flag=args[i];
  if(flag==='--run'){options.run=true;continue;}
  if(!['--input','--output','--ledger','--budget'].includes(flag)||!args[i+1])throw Error('Use --input PATH --output PATH [--ledger PATH] [--budget 117000] [--run]');
  options[flag.slice(2)]=args[++i];
}
function local(value){
  if(typeof value!=='string'||!value)throw Error('A local research path is required');
  const resolved=path.resolve(value);
  if(!resolved.startsWith(localRoot+path.sep))throw Error('Files must stay beneath project .sites-runtime');
  let existing=resolved;
  while(!fs.existsSync(existing))existing=path.dirname(existing);
  const actual=fs.realpathSync(existing);
  if(actual!==localRoot&&!actual.startsWith(localRoot+path.sep))throw Error('Research path resolves outside .sites-runtime');
  return resolved;
}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function load(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function save(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+process.pid;
  fs.writeFileSync(temporary,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});
  fs.renameSync(temporary,file);
}
function validVector(vector){return Array.isArray(vector)&&vector.length===DIMENSIONS&&vector.every(Number.isFinite)&&Number.isFinite(Math.hypot(...vector))&&Math.hypot(...vector)>0;}
const inputPath=local(options.input),outputPath=local(options.output),ledgerPath=local(options.ledger??path.join(localRoot,'svm-improvement-20261114','embedding-day-budget.local.json'));
if(new Set([inputPath,outputPath,ledgerPath]).size!==3)throw Error('Input, vectors and budget paths must differ');
const budget=options.budget===undefined?MAX_BUDGET:Number(options.budget);
if(!Number.isSafeInteger(budget)||budget<RESERVATION||budget>MAX_BUDGET)throw Error('Budget must be an integer from 6500 through 117000; increases are unsupported');
const input=load(inputPath),{inputDigest,...payload}=input;
if(input.schemaVersion!=='voice-embedding-input-1.0'||sha(canonical(payload))!==inputDigest)throw Error('Prepared input digest mismatch');
if(canonical(input.embedding)!==canonical(OPTIONS))throw Error('Only the reviewed fixed model/options are supported');
if(!Array.isArray(input.records)||!input.records.length||new Set(input.records.map(record=>record.key)).size!==input.records.length)throw Error('Prepared sentence records are missing or duplicated');
for(const record of input.records){
  if(typeof record.text!=='string'||!record.text.trim()||sha(record.text)!==record.key||!Array.isArray(record.sourceIDs)||!record.sourceIDs.length)throw Error('Invalid prepared actual sentence identity');
}
function batches(records){
  const result=[];let current=[];
  for(const record of records){
    const candidate=[...current,record];
    if(candidate.length>32||Buffer.byteLength(JSON.stringify({...OPTIONS,input:candidate.map(item=>item.text)}),'utf8')>6000){
      if(!current.length)throw Error('One sentence exceeds the fixed request byte ceiling');
      result.push(current);current=[record];
    }else current=candidate;
    if(Buffer.byteLength(JSON.stringify({...OPTIONS,input:current.map(item=>item.text)}),'utf8')>6000)throw Error('One sentence exceeds the fixed request byte ceiling');
  }
  if(current.length)result.push(current);return result;
}
function state(){
  const value=fs.existsSync(outputPath)?load(outputPath):{schemaVersion:'voice-embeddings-1.0',inputDigest,model:MODEL,dimensions:DIMENSIONS,vectors:{},requests:[]};
  if(value.schemaVersion!=='voice-embeddings-1.0'||value.inputDigest!==inputDigest||value.model!==MODEL||value.dimensions!==DIMENSIONS||!value.vectors||!Array.isArray(value.requests))throw Error('Resume vectors belong to another input or model');
  const keys=new Set(input.records.map(record=>record.key));
  for(const [key,vector]of Object.entries(value.vectors))if(!keys.has(key)||!validVector(vector))throw Error('Resume vectors contain an invalid entry');
  return value;
}
let checkpoint=state();
const pending=input.records.filter(record=>!Object.hasOwn(checkpoint.vectors,record.key));
const planned=batches(pending);
console.log(JSON.stringify({mode:options.run?'run':'dry-run',model:MODEL,dimensions:DIMENSIONS,totalRecords:input.records.length,completedRecords:Object.keys(checkpoint.vectors).length,pendingRecords:pending.length,plannedCalls:planned.length,requiredReservation:planned.length*RESERVATION,dailyBudget:budget,maxCallsPerDay:Math.floor(budget/RESERVATION),inputDigest}));
if(!options.run||!pending.length)process.exit(0);
const apiKey=process.env.NVIDIA_API_KEY;
if(typeof apiKey!=='string'||!apiKey.trim())throw Error('Existing NVIDIA_API_KEY environment variable is required');
fs.mkdirSync(path.dirname(ledgerPath),{recursive:true});
const lockPath=ledgerPath+'.lock';let lock;
try{lock=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}
catch{throw Error('Embedding budget is locked by another process or interrupted run; inspect the local lock before resuming');}
const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  // Recheck after acquiring the shared ledger lock to avoid duplicate dispatch.
  checkpoint=state();
  const work=batches(input.records.filter(record=>!Object.hasOwn(checkpoint.vectors,record.key)));
  let ledger=fs.existsSync(ledgerPath)?load(ledgerPath):{schemaVersion:'voice-embedding-budget-1.0',model:MODEL,maximumDailyBudget:MAX_BUDGET,lastDispatchAt:0,days:{}};
  if(ledger.schemaVersion!=='voice-embedding-budget-1.0'||ledger.model!==MODEL||ledger.maximumDailyBudget!==MAX_BUDGET||!ledger.days||!Number.isFinite(ledger.lastDispatchAt))throw Error('Invalid persistent embedding budget ledger');
  for(const batch of work){
    await sleep(Math.max(0,ledger.lastDispatchAt+INTERVAL-Date.now()));
    const day=dayKey(),entry=ledger.days[day]??{reservedTokens:0,requests:[]};
    if(!Number.isSafeInteger(entry.reservedTokens)||entry.reservedTokens<0||!Array.isArray(entry.requests))throw Error('Corrupt daily reservation record');
    if(entry.reservedTokens+RESERVATION>budget){console.log(JSON.stringify({status:'daily_budget_exhausted',day,reservedTokens:entry.reservedTokens,pendingRecords:input.records.length-Object.keys(checkpoint.vectors).length}));process.exitCode=3;break;}
    const reservation={id:crypto.randomUUID(),inputDigest,at:new Date().toISOString(),reservedTokens:RESERVATION,records:batch.length,status:'reserved',usage:null};
    entry.reservedTokens+=RESERVATION;entry.requests.push(reservation);ledger.days[day]=entry;ledger.lastDispatchAt=Date.now();
    save(ledgerPath,ledger); // Reservation is durable BEFORE any request.
    const body=JSON.stringify({...OPTIONS,input:batch.map(record=>record.text)});
    if(batch.length>32||Buffer.byteLength(body,'utf8')>6000)throw Error('Dispatch exceeds the fixed request ceiling');
    try{
      const response=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json'},body,signal:AbortSignal.timeout(60000),redirect:'error'});
      if(!response.ok)throw Error(`Embedding HTTP ${response.status}; stopped without retry`);
      const value=await response.json();
      if(value.model!==MODEL||!Array.isArray(value.data)||value.data.length!==batch.length)throw Error('Embedding response model or record count mismatch');
      const indices=new Set();
      for(const item of value.data){
        if(!Number.isInteger(item.index)||item.index<0||item.index>=batch.length||indices.has(item.index)||!validVector(item.embedding))throw Error('Embedding response index/vector validation failed');
        indices.add(item.index);
      }
      for(const item of value.data){const norm=Math.hypot(...item.embedding);checkpoint.vectors[batch[item.index].key]=item.embedding.map(number=>number/norm);}
      const usage=value.usage&&typeof value.usage==='object'?Object.fromEntries(Object.entries(value.usage).filter(([key,number])=>/tokens$/.test(key)&&Number.isFinite(number)&&number>=0)):null;
      const status={id:reservation.id,at:reservation.at,records:batch.length,status:'completed',usage:usage&&Object.keys(usage).length?usage:null,usageStatus:usage&&Object.keys(usage).length?'reported':'unknown'};
      checkpoint.requests.push(status);save(outputPath,checkpoint);
      Object.assign(reservation,status);save(ledgerPath,ledger);
      console.log(JSON.stringify({status:'batch_completed',completedRecords:Object.keys(checkpoint.vectors).length,totalRecords:input.records.length,dayReservedTokens:entry.reservedTokens,usageStatus:status.usageStatus}));
    }catch(error){
      reservation.status='failed_or_unknown';save(ledgerPath,ledger);
      // Never print response payloads, request text, headers or credentials.
      const safe=/^Embedding (HTTP \d+; stopped without retry|response model or record count mismatch|response index\/vector validation failed)$/.test(error.message)?error.message:'Embedding request failed; reservation retained; no automatic retry';
      throw Error(safe);
    }
  }
}finally{if(lock!==undefined)fs.closeSync(lock);fs.unlinkSync(lockPath);}
