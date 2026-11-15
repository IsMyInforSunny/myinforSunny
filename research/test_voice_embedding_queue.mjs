import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {canonical,orderedPendingGroups,prepareQueue,runQueue,requestBatches} from '../scripts/run-voice-embedding-queue.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const embedding={model:'nvidia/nemotron-3.5-embed-1b',input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:2048};
function record(text,ids){return {key:hash(text),text,partition:'corpus',sourceIDs:ids.map(articleId=>({articleId,sentenceId:'body_s1'}))};}
function prepared(records){const payload={schemaVersion:'voice-embedding-input-1.0',embedding,records,sets:{corpus:[]},pairs:[],humanEvaluationCount:0};return {...payload,inputDigest:hash(canonical(payload))};}
function fixture(){
 const root=fs.mkdtempSync(path.resolve('.sites-runtime/embedding-queue-contract-'));
 const runtime=path.join(root,'.sites-runtime'),snapshot=path.join(runtime,'snapshot');fs.mkdirSync(snapshot,{recursive:true});
 const rows=[{id:'housing',topic:'housing_supply',issue:'supply'},{id:'medical',topic:'medical_school_quota',issue:'quota'},
  {id:'nuclear',topic:'nuclear_energy',issue:'expansion'},{id:'wage',topic:'minimum_wage',issue:'increase'},
  {id:'other',topic:'pension_reform',issue:null},{id:'unknown',topic:null,issue:null}];
 const records=[record('Shared retained queue contract sentence.',['medical','housing']),record('Medical retained queue contract sentence.',['medical']),
  record('Nuclear retained queue contract sentence.',['nuclear']),record('Wage retained queue contract sentence.',['wage']),
  record('Other retained queue contract sentence.',['other']),record('Unassigned retained queue contract sentence.',['unknown'])];
 fs.writeFileSync(path.join(snapshot,'summary.local.json'),JSON.stringify({counts:{articles:rows.length},supportedTopics:['housing_supply','medical_school_quota','nuclear_energy','minimum_wage','pension_reform'],modelVersion:'test-candidate'}));
 fs.writeFileSync(path.join(snapshot,'coordinates.local.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 fs.writeFileSync(path.join(snapshot,'pending-embedding-input.local.json'),JSON.stringify(prepared(records)));
 const clean=()=>{const target=fs.realpathSync(root),parent=fs.realpathSync('.sites-runtime');assert.ok(target.startsWith(parent+path.sep));fs.rmSync(target,{recursive:true});};
 return {root,snapshot,rows,records,clean};
}
test('priority order deduplicates shared sentences while retaining every source and counting unsupported topics',()=>{
 const f=fixture();try{const result=orderedPendingGroups(prepared(f.records),f.rows,['housing_supply','medical_school_quota','nuclear_energy','minimum_wage','pension_reform']);
  assert.deepEqual(result.groups.map(group=>group.key),['housing_supply:supply','medical_school_quota:quota','nuclear_energy:expansion','minimum_wage:increase','remaining:pension_reform']);
  assert.equal(result.groups[0].records[0].sourceIDs.length,2);assert.equal(result.memberships['medical_school_quota:quota'].length,2);
  assert.equal(result.excludedUnsupportedUniqueSentences,1);assert.equal(new Set(result.groups.flatMap(group=>group.records.map(row=>row.key))).size,5);
 }finally{f.clean();}
});
test('prepared chunks are accepted by the existing extractor dry-run without any provider access',()=>{
 const f=fixture();try{const plan=prepareQueue({snapshot:f.snapshot,output:path.join(f.root,'.sites-runtime/queue')},f.root);
  assert.equal(plan.totalUniqueSentences,5);assert.equal(plan.chunks.length,5);
  for(const chunk of plan.chunks){const result=spawnSync(process.execPath,['scripts/extract-voice-embeddings.mjs','--input',path.join(f.root,chunk.input),'--output',path.join(f.root,chunk.vectors),'--budget','unlimited','--pacing','provider','--batch-size','64','--max-body-bytes','12000'],{encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);const event=JSON.parse(result.stdout);assert.equal(event.minimumDispatchIntervalMs,20000);assert.equal(event.batchSize,64);
  }
 }finally{f.clean();}
});
test('request construction never exceeds 64 inputs or silently truncates an oversized sentence',()=>{
 const records=Array.from({length:129},(_,at)=>record('Contract queue sentence '+at,['article']));
 assert.deepEqual(requestBatches(records).map(batch=>batch.length),[64,64,1]);
 assert.throws(()=>requestBatches([record('x'.repeat(12000),['article'])]),/byte ceiling/);
});
test('a provider 429 persists the cooldown and stops the entire queue after exactly one extractor launch',async()=>{
 const f=fixture();try{prepareQueue({snapshot:f.snapshot,output:path.join(f.root,'.sites-runtime/queue')},f.root);
  const ledgerDir=path.join(f.root,'.sites-runtime/svm-improvement-20261114');fs.mkdirSync(ledgerDir,{recursive:true});
  const retryAfterAt=Date.now()+90000;fs.writeFileSync(path.join(ledgerDir,'embedding-day-budget.local.json'),JSON.stringify({retryAfterAt}));
  let launches=0;const launch=()=>{launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=1234;
   setImmediate(()=>{child.stderr.emit('data',Buffer.from('Error: Embedding HTTP 429; stopped without retry'));child.emit('close',1);});return child;};
  const result=await runQueue({queue:path.join(f.root,'.sites-runtime/queue/queue.local.json')},f.root,{spawnChild:launch});
  assert.equal(launches,1);assert.equal(result.status,'rate_limited');const report=JSON.parse(fs.readFileSync(path.join(f.root,'docs/test-runs/embedding-progress.json'),'utf8'));
  assert.equal(report.automaticRetry,false);assert.equal(report.rateLimitCount,1);assert.equal(report.retryAfterAt,retryAfterAt);
  assert.ok(!JSON.stringify(report).includes('Shared retained'));assert.ok(!Object.hasOwn(report,'priorityMemberships'));
  await assert.rejects(runQueue({queue:path.join(f.root,'.sites-runtime/queue/queue.local.json')},f.root,{spawnChild:launch}),/explicit operator resume/);
  assert.equal(launches,1);
 }finally{f.clean();}
});
test('unknown failures stop the queue without a retry or launching the next priority group',async()=>{
 const f=fixture();try{prepareQueue({snapshot:f.snapshot,output:path.join(f.root,'.sites-runtime/queue')},f.root);
  let launches=0;const launch=()=>{launches++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=1234;
   setImmediate(()=>{child.stderr.emit('data',Buffer.from('Error: An interrupted embedding request may have reached the provider'));child.emit('close',1);});return child;};
  const result=await runQueue({queue:path.join(f.root,'.sites-runtime/queue/queue.local.json')},f.root,{spawnChild:launch});assert.equal(launches,1);assert.equal(result.status,'failed');
 }finally{f.clean();}
});
