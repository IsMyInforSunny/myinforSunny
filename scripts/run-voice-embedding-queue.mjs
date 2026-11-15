// Local, resumable orchestration only. Existing extractor owns credentials,
// provider dispatch, the shared ledger and the no-retry error policy.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
export const PRIORITY_ISSUES=['housing_supply:supply','medical_school_quota:quota','nuclear_energy:expansion','minimum_wage:increase'];
const OPTIONS={model:'nvidia/nemotron-3.5-embed-1b',input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:2048};
export const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'
 ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const load=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function local(value,root=ROOT){
 const runtime=fs.realpathSync(path.join(root,'.sites-runtime')),target=path.resolve(root,value);
 if(!target.startsWith(runtime+path.sep))throw Error('Queue data must stay inside project .sites-runtime.');
 let ancestor=target;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const real=fs.realpathSync(ancestor);if(real!==runtime&&!real.startsWith(runtime+path.sep))throw Error('Queue path resolves outside project .sites-runtime.');
 return target;
}
export function requestBatches(records){
 const batches=[];let batch=[];
 for(const item of records){
  if(batch.length&&(batch.length===64||Buffer.byteLength(JSON.stringify({...OPTIONS,input:[...batch,item].map(record=>record.text)}),'utf8')>12000)){batches.push(batch);batch=[];}
  batch.push(item);if(Buffer.byteLength(JSON.stringify({...OPTIONS,input:batch.map(record=>record.text)}),'utf8')>12000)throw Error('A retained sentence exceeds the approved request byte ceiling.');
 }
 if(batch.length)batches.push(batch);return batches;
}

/** Every unique pending sentence is assigned once, to its earliest priority.
 * Other sourceIDs remain intact so deduplication never drops article coverage. */
export function orderedPendingGroups(prepared,rows,supportedTopics){
 const {inputDigest,...payload}=prepared;
 if(prepared.schemaVersion!=='voice-embedding-input-1.0'||sha(canonical(payload))!==inputDigest||canonical(prepared.embedding)!==canonical(OPTIONS))throw Error('Pending snapshot provenance or model mismatch.');
 const byId=new Map(rows.map(row=>[row.id,row]));
 if(byId.size!==rows.length)throw Error('Duplicate article IDs in snapshot.');
 const supported=new Set(supportedTopics),seen=new Set(),groups=new Map(PRIORITY_ISSUES.map(key=>[key,[]]));
 const memberships=new Map(PRIORITY_ISSUES.map(key=>[key,new Set()]));
 let excludedUnsupportedUniqueSentences=0;
 for(const record of prepared.records){
  if(typeof record.text!=='string'||sha(record.text)!==record.key||seen.has(record.key)||!record.sourceIDs?.length)throw Error('Invalid retained sentence identity.');
  seen.add(record.key);
  const sources=record.sourceIDs.map(source=>{const article=byId.get(source.articleId);if(!article||typeof source.sentenceId!=='string')throw Error('Missing article source identity.');return article;});
  const applicable=PRIORITY_ISSUES.filter(key=>sources.some(article=>`${article.topic}:${article.issue}`===key));
  for(const key of applicable)memberships.get(key).add(record.key);
  const topic=sources.find(article=>supported.has(article.topic))?.topic;
  if(!topic){excludedUnsupportedUniqueSentences++;continue;}
  const group=applicable[0]??`remaining:${topic}`;
  if(!groups.has(group))groups.set(group,[]);groups.get(group).push(record);
 }
 return {groups:[...groups].filter(([,records])=>records.length).map(([key,records])=>({key,records})),
  memberships:Object.fromEntries([...memberships].map(([key,keys])=>[key,[...keys]])),excludedUnsupportedUniqueSentences};
}

export function prepareQueue({snapshot,output,chunkSize=2048},root=ROOT){
 if(!Number.isSafeInteger(chunkSize)||chunkSize<64||chunkSize>4096)throw Error('Chunk size must be 64..4096 unique sentences.');
 snapshot=local(snapshot,root);output=local(output,root);if(fs.existsSync(output))throw Error('Preserve prior queue and choose a new output directory.');
 const summary=load(path.join(snapshot,'summary.local.json')),prepared=load(path.join(snapshot,'pending-embedding-input.local.json'));
 const rows=fs.readFileSync(path.join(snapshot,'coordinates.local.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
 if(rows.length!==summary.counts.articles)throw Error('Snapshot article count mismatch.');
 const ordered=orderedPendingGroups(prepared,rows,summary.supportedTopics),chunks=[];
 // Validate all input sizes before writing any queue and before any API call.
 for(const group of ordered.groups)requestBatches(group.records);
 fs.mkdirSync(output,{recursive:true});
 for(const group of ordered.groups)for(let at=0;at<group.records.length;at+=chunkSize){
  const records=group.records.slice(at,at+chunkSize),index=chunks.length;
  const payload={schemaVersion:'voice-embedding-input-1.0',embedding:OPTIONS,records,sets:{corpus:[]},pairs:[],humanEvaluationCount:0,
   preparation:{researchOnly:true,budgetPolicy:'user-authorized-unlimited',minimumDispatchIntervalMs:20000,batchSize:64,maxBodyBytes:12000,sourceSnapshotDigest:prepared.inputDigest,queueGroup:group.key},sourceDigests:prepared.sourceDigests??{}};
  const input={...payload,inputDigest:sha(canonical(payload))},prefix=String(index).padStart(3,'0');
  const inputFile=path.join(output,prefix+'-input.local.json'),vectorsFile=path.join(output,prefix+'-vectors.local.json');
  atomic(inputFile,input);
  chunks.push({index,group:group.key,input:path.relative(root,inputFile),vectors:path.relative(root,vectorsFile),inputDigest:input.inputDigest,
   records:records.length,plannedCalls:requestBatches(records).length});
 }
 const manifest={schemaVersion:'voice-embedding-queue-1.0',preparedAt:new Date().toISOString(),researchOnly:true,usageReviewed:false,
  sourceSnapshot:path.relative(root,snapshot),sourceInputDigest:prepared.inputDigest,modelVersion:summary.modelVersion,
  maximumBatchSize:64,maximumBodyBytes:12000,minimumDispatchIntervalMs:20000,dailyReservationCap:null,
  totalUniqueSentences:chunks.reduce((sum,item)=>sum+item.records,0),excludedUnsupportedUniqueSentences:ordered.excludedUnsupportedUniqueSentences,
  priorityOrder:PRIORITY_ISSUES,priorityMemberships:ordered.memberships,chunks};
 atomic(path.join(output,'queue.local.json'),manifest);return manifest;
}

export async function runQueue({queue,progress,resume=false,priorityOnly=false},root=ROOT,{spawnChild=spawn}={}){
 const queuePath=local(queue,root),directory=path.dirname(queuePath),manifest=load(queuePath),statePath=path.join(directory,'state.local.json');
 const progressPath=path.resolve(root,progress??'docs/test-runs/embedding-progress.json');
 if(progressPath!==path.resolve(root,'docs/test-runs/embedding-progress.json'))throw Error('Use only the designated sanitized progress report.');
 if(manifest.schemaVersion!=='voice-embedding-queue-1.0'||manifest.minimumDispatchIntervalMs!==20000||manifest.maximumBatchSize!==64)throw Error('Invalid queue manifest.');
 const lockPath=path.join(directory,'runner.lock');let lock;
 try{lock=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}
 catch{throw Error('Queue runner is already active or needs manual lock inspection.');}
 const started=Date.now(),completedKeys=new Set();
 let state=fs.existsSync(statePath)?load(statePath):{schemaVersion:'voice-embedding-queue-state-1.0',sourceInputDigest:manifest.sourceInputDigest,preparedAt:manifest.preparedAt,
  startedAt:new Date().toISOString(),status:'prepared',completedChunks:[],currentIndex:null,currentCompleted:0,rateLimitCount:0};
 const inputs=new Map();
 let heartbeat,child,publish;
 try{
  if(state.sourceInputDigest!==manifest.sourceInputDigest||state.preparedAt!==manifest.preparedAt)throw Error('Queue state belongs to another manifest.');
  if(['rate_limited','failed','interrupted'].includes(state.status)&&!resume)throw Error('A stopped queue requires an explicit operator resume; no automatic retry.');
  for(const chunk of manifest.chunks){
   const prepared=load(local(chunk.input,root));const {inputDigest,...payload}=prepared;
   if(inputDigest!==chunk.inputDigest||sha(canonical(payload))!==inputDigest||prepared.records.length!==chunk.records)throw Error('Queue input digest mismatch.');
   inputs.set(chunk.index,prepared.records);
   if(state.completedChunks.includes(chunk.index)){
    const checkpoint=load(local(chunk.vectors,root));
    if(checkpoint.inputDigest!==chunk.inputDigest||checkpoint.model!==OPTIONS.model||checkpoint.dimensions!==2048
     ||Object.keys(checkpoint.vectors??{}).length!==chunk.records||prepared.records.some(record=>!Object.hasOwn(checkpoint.vectors,record.key)))throw Error('Completed queue checkpoint does not match its input.');
    for(const record of prepared.records)completedKeys.add(record.key);
   }
  }
  publish=()=>{
   const active=manifest.chunks.find(chunk=>chunk.index===state.currentIndex);
   const liveKeys=new Set(completedKeys);
   if(active)for(const record of inputs.get(active.index).slice(0,state.currentCompleted))liveKeys.add(record.key);
   const priority=manifest.priorityOrder.map(issue=>{const members=manifest.priorityMemberships[issue]??[];const completed=members.filter(key=>liveKeys.has(key)).length;return {issue,totalMissingAtStart:members.length,completedUniqueSentences:completed,remainingUniqueSentences:members.length-completed};});
   state.pid=process.pid;state.updatedAt=new Date().toISOString();atomic(statePath,state);
   atomic(progressPath,{schemaVersion:'voice-embedding-progress-1.0',updatedAt:state.updatedAt,startedAt:state.startedAt,status:state.status,pid:process.pid,childPid:child?.pid??null,
    researchOnly:true,usageReviewed:false,articleTextOrUrlsIncluded:false,sourceSnapshotInputDigest:manifest.sourceInputDigest,
    countingBasis:'Unique missing sentences at this snapshot; previously cached sentences are excluded from both numerator and denominator.',
    totalUniqueSentences:manifest.totalUniqueSentences,completedUniqueSentences:liveKeys.size,remainingUniqueSentences:manifest.totalUniqueSentences-liveKeys.size,
    excludedUnsupportedUniqueSentences:manifest.excludedUnsupportedUniqueSentences,priorityIssues:priority,priorityComplete:priority.every(item=>item.remainingUniqueSentences===0),
    completedChunks:state.completedChunks.length,totalChunks:manifest.chunks.length,currentGroup:active?.group??null,rateLimitCount:state.rateLimitCount,
    retryAfterAt:state.retryAfterAt??null,minimumDispatchIntervalMs:20000,maximumBatchSize:64,dailyReservationCap:null,
    estimatedMinimumDispatchDurationMs:Math.max(0,manifest.chunks.reduce((sum,chunk)=>sum+chunk.plannedCalls,0)-1)*20000,
    elapsedThisProcessMs:Date.now()-started,automaticRetry:false,stopReason:state.stopReason??null});
  };
  if(resume&&state.stopReason){state.previousStopReason=state.stopReason;state.stopReason=null;delete state.retryAfterAt;}
  state.status='running';publish();heartbeat=setInterval(publish,60000);
  for(const chunk of manifest.chunks){
   if(state.completedChunks.includes(chunk.index))continue;
   state.currentIndex=chunk.index;state.currentCompleted=0;publish();
   const args=['scripts/extract-voice-embeddings.mjs','--input',chunk.input,'--output',chunk.vectors,'--budget','unlimited','--pacing','provider','--batch-size','64','--max-body-bytes','12000','--run'];
   // Inherit the existing runtime environment; never inspect or log any credential.
   child=spawnChild(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});publish();
   let buffer='',failureText='';
   child.stdout.on('data',data=>{buffer+=data.toString('utf8');let boundary;while((boundary=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);let event;try{event=JSON.parse(line);}catch{continue;}
    if(Number.isSafeInteger(event.completedRecords)&&event.completedRecords>=0&&event.completedRecords<=chunk.records){state.currentCompleted=event.completedRecords;publish();}
   }});
   child.stderr.on('data',data=>{if(failureText.length<65536)failureText+=data.toString('utf8');});
   const exitCode=await new Promise(resolve=>{child.once('error',()=>resolve(-1));child.once('close',resolve);});child=undefined;
   if(exitCode!==0){
    const rateLimited=failureText.includes('Embedding HTTP 429');state.status=rateLimited?'rate_limited':'failed';state.rateLimitCount+=rateLimited?1:0;
    state.stopReason=rateLimited?'provider_429_no_retry':'extractor_failed_or_unknown_no_retry';
    if(rateLimited){const ledger=load(path.join(root,'.sites-runtime/svm-improvement-20261114/embedding-day-budget.local.json'));state.retryAfterAt=ledger.retryAfterAt??null;}
    publish();return {status:state.status,completedUniqueSentences:completedKeys.size+state.currentCompleted,automaticRetry:false};
   }
   const checkpoint=load(local(chunk.vectors,root));
   if(checkpoint.inputDigest!==chunk.inputDigest||checkpoint.model!==OPTIONS.model||checkpoint.dimensions!==2048
    ||Object.keys(checkpoint.vectors??{}).length!==chunk.records||inputs.get(chunk.index).some(record=>!Object.hasOwn(checkpoint.vectors,record.key)))throw Error('Extractor exited without complete matching vectors.');
   for(const record of inputs.get(chunk.index))completedKeys.add(record.key);
   state.completedChunks.push(chunk.index);state.currentCompleted=chunk.records;publish();
   if(priorityOnly){
    const done=new Set(completedKeys),complete=manifest.priorityOrder.every(issue=>(manifest.priorityMemberships[issue]??[]).every(key=>done.has(key)));
    if(complete){state.currentIndex=null;state.currentCompleted=0;state.status='priority_complete';state.completedAt=new Date().toISOString();publish();
     return {status:'priority_complete',completedUniqueSentences:completedKeys.size,automaticRetry:false};}
   }
  }
  state.currentIndex=null;state.currentCompleted=0;state.status='completed';state.completedAt=new Date().toISOString();publish();
  return {status:'completed',completedUniqueSentences:completedKeys.size,automaticRetry:false};
 }catch(error){
  // Preserve fixed diagnostic text only; inputs and provider payloads never enter logs.
  state.status='failed';state.stopReason='queue_validation_or_runtime_failure_no_retry';state.updatedAt=new Date().toISOString();atomic(statePath,state);publish?.();throw error;
 }finally{clearInterval(heartbeat);if(lock!==undefined)fs.closeSync(lock);fs.unlinkSync(lockPath);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),options={};
 for(let index=0;index<args.length;index++){
  const flag=args[index];if(flag==='--run'||flag==='--resume'||flag==='--priority-only'){options[flag.slice(2)]=true;continue;}
  if(!['--snapshot','--output','--queue','--progress','--chunk-size'].includes(flag)||!args[index+1])throw Error('Use --snapshot LOCAL --output NEW_LOCAL [--chunk-size 2048] to prepare, or --queue LOCAL_MANIFEST --run [--resume].');
  options[flag.slice(2)]=args[++index];
 }
 if(options.run){const result=await runQueue(options);console.log(JSON.stringify(result));if(!['completed','priority_complete'].includes(result.status))process.exitCode=result.status==='rate_limited'?2:1;}
 else{const plan=prepareQueue({...options,chunkSize:options['chunk-size']===undefined?2048:Number(options['chunk-size'])});console.log(JSON.stringify({status:'prepared',chunks:plan.chunks.length,totalUniqueSentences:plan.totalUniqueSentences,excludedUnsupportedUniqueSentences:plan.excludedUnsupportedUniqueSentences,plannedCalls:plan.chunks.reduce((sum,item)=>sum+item.plannedCalls,0),priorityCounts:Object.fromEntries(Object.entries(plan.priorityMemberships).map(([issue,keys])=>[issue,keys.length])),apiCalls:0}));}
}
