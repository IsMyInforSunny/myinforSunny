import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const script=path.resolve('scripts/extract-voice-embeddings.mjs');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']'
  :value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'
    :JSON.stringify(value);
const sha=text=>createHash('sha256').update(text).digest('hex');

test('unlimited research authorization is explicit and dry-run never requires credentials',()=>{
  const directory=mkdtempSync(path.resolve('.sites-runtime/embedding-control-test-'));
  try{
    const text='Retained sentence for CLI contract verification.';
    const input={schemaVersion:'voice-embedding-input-1.0',embedding:{model:'nvidia/nemotron-3.5-embed-1b',input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:2048},
      records:[{key:sha(text),text,sourceIDs:[{articleId:'cli-contract',sentenceId:'s1'}]}]};
    input.inputDigest=sha(canonical(input));
    const inputFile=path.join(directory,'input.json'),outputFile=path.join(directory,'vectors.json');
    writeFileSync(inputFile,JSON.stringify(input));
    const run=(...extra)=>spawnSync(process.execPath,[script,'--input',inputFile,'--output',outputFile,...extra],{encoding:'utf8',env:{...process.env,NVIDIA_API_KEY:''}});
    const bounded=run();assert.equal(bounded.status,0);assert.equal(JSON.parse(bounded.stdout).dailyBudget,117000);
    const unlimited=run('--budget','unlimited','--pacing','provider');assert.equal(unlimited.status,0);
    assert.equal(JSON.parse(unlimited.stdout).dailyBudget,null);assert.equal(JSON.parse(unlimited.stdout).budgetPolicy,'user-authorized-unlimited');
    assert.equal(JSON.parse(unlimited.stdout).minimumDispatchIntervalMs,20000);
    assert.notEqual(run('--pacing','provider').status,0);
    assert.notEqual(run('--budget','999999').status,0);
    const seedFile=path.join(directory,'seed.json');
    writeFileSync(seedFile,JSON.stringify({schemaVersion:'voice-embeddings-1.0',inputDigest:input.inputDigest,model:input.embedding.model,dimensions:2048,
      vectors:{[input.records[0].key]:Array.from({length:2048},(_,index)=>index===0?1:0)},requests:[]}));
    const seeded=run('--seed-input',inputFile,'--seed-vectors',seedFile,'--ledger',path.join(directory,'ledger.json'),'--run');
    assert.equal(seeded.status,0,seeded.stderr);assert.equal(JSON.parse(seeded.stdout).pendingRecords,0);
    assert.equal(Object.keys(JSON.parse(readFileSync(outputFile,'utf8')).vectors).length,1);
    const wrong=JSON.parse(readFileSync(seedFile,'utf8'));wrong.inputDigest='unrelated';writeFileSync(seedFile,JSON.stringify(wrong));
    assert.notEqual(run('--seed-input',inputFile,'--seed-vectors',seedFile).status,0);
    const large={...input,records:Array.from({length:64},(_,index)=>{
      const sentence=`Retained CLI contract sentence ${index}.`;
      return {key:sha(sentence),text:sentence,sourceIDs:[{articleId:'cli-contract',sentenceId:'s'+index}]};
    })};
    delete large.inputDigest;large.inputDigest=sha(canonical(large));
    const largeInput=path.join(directory,'large.json');writeFileSync(largeInput,JSON.stringify(large));
    const expanded=spawnSync(process.execPath,[script,'--input',largeInput,'--output',path.join(directory,'large-vectors.json'),
      '--budget','unlimited','--pacing','provider','--batch-size','64','--max-body-bytes','12000'],{encoding:'utf8',env:{...process.env,NVIDIA_API_KEY:''}});
    assert.equal(expanded.status,0,expanded.stderr);assert.equal(JSON.parse(expanded.stdout).plannedCalls,1);
    assert.equal(JSON.parse(expanded.stdout).batchSize,64);assert.equal(JSON.parse(expanded.stdout).minimumDispatchIntervalMs,20000);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
