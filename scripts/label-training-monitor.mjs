// API-free checkpoint-triggered evaluation and semantic SVM research training.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const root=process.cwd(),runtime=path.join(root,'.sites-runtime/paired-voice-labels-20261116');
const stateFile=path.join(runtime,'training-monitor-progress.local.json');
const snapshotFile=path.join(runtime,'training-corpus.local.jsonl');
const manifestFile=path.join(runtime,'paired-sample-manifest.local.json');
const transient=operation=>{for(let attempt=0;;attempt++){try{return operation();}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=5)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}};
const readText=file=>transient(()=>fs.readFileSync(file,'utf8')).replace(/^\uFEFF/,'');
const rows=file=>fs.existsSync(file)?readText(file).split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
const json=file=>JSON.parse(readText(file));
let writeSequence=0;
const atomic=(file,value)=>{const tmp=file+'.tmp-'+process.pid+'-'+(++writeSequence),body=JSON.stringify(value,null,2)+'\n';transient(()=>fs.writeFileSync(tmp,body));transient(()=>fs.renameSync(tmp,file));};
const manifest=json(manifestFile),topics=['medical_school_quota','minimum_wage','nuclear_energy'];
const state=fs.existsSync(stateFile)?json(stateFile):{version:1,apiCalls:0,stages:{},startedAt:new Date().toISOString()};
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(s.startsWith('.')&&!path.extname(s)&&c.parentURL?.endsWith('.ts'))return n(s+'.ts',c);throw e;}},load(url,c,n){
 if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
 if(url.endsWith('.json')&&url.includes('/lib/data/'))return {format:'module',shortCircuit:true,source:'export default '+fs.readFileSync(new URL(url),'utf8')+';'};return n(url,c);
}});
async function exportCorpus(){
 if(fs.existsSync(snapshotFile))return;
 const {voiceAnnotationInput,voiceArticleHash}=await import('../lib/sentence-voice.ts');
 const source=new Map(rows(path.join(root,'.sites-runtime/collection-1000-20261105/articles-reviewed-3000.local.jsonl')).map(a=>[a.id,a]));
 const records=[];
 for(const item of manifest.articles){const article=source.get(item.id);if(!article||await voiceArticleHash(article.text)!==item.bodyHash)throw Error('Frozen article hash mismatch');
  const input=voiceAnnotationInput(article.text,item.topic);records.push({...article,voiceVersion:input.version,segmenter:input.segmenter,scopeCharacters:input.scopeCharacters,sentences:input.sentences});}
 fs.writeFileSync(snapshotFile,records.map(JSON.stringify).join('\n')+'\n',{flag:'wx'});
}
const completed=file=>new Map(rows(path.join(runtime,file)).filter(x=>x.status==='completed').map(x=>[x.articleId,x]));
function counts(){
 const lightning=completed('lightning-labels.local.jsonl'),deepseek=completed('deepseek-evaluation-labels.local.jsonl'),groq=completed('groq-evaluation-labels.local.jsonl');
 const evaluation=manifest.articles.filter(x=>x.partition==='evaluation');
 const paired=evaluation.filter(x=>lightning.has(x.id)&&(deepseek.has(x.id)||groq.has(x.id)));
 const pairedByTopic=Object.fromEntries(topics.map(topic=>[topic,paired.filter(x=>x.topic===topic).length]));
 const progressFile=path.join(runtime,'optimized-lightning-progress.local.json'),lightningProgress=fs.existsSync(progressFile)?json(progressFile):{};
 const lightningTerminal=['completed','finished_with_failures'].includes(lightningProgress.phase);
 return {evaluationReady:paired.length>=80&&Object.values(pairedByTopic).every(n=>n>=25),secondBranch:'deepseek-preferred-groq-fallback',lightningTerminal,lightningPhase:lightningProgress.phase??null,pairedEvaluation:paired.length,pairedByTopic,
  lightning:lightning.size,deepseek:deepseek.size,groq:groq.size,
  training:Object.fromEntries(topics.map(topic=>[topic,manifest.articles.filter(x=>x.topic===topic&&x.partition==='training'&&lightning.has(x.id)).length]))};
}
function fingerprint(stage){
 const selected=new Set(manifest.articles.filter(x=>stage!=='evaluation'||x.partition==='evaluation').map(x=>x.id));
 const labels=['lightning-labels.local.jsonl','deepseek-evaluation-labels.local.jsonl','groq-evaluation-labels.local.jsonl'].map(file=>rows(path.join(runtime,file)).filter(row=>selected.has(row.articleId)&&row.status==='completed').sort((a,b)=>a.articleId.localeCompare(b.articleId)));
 const cacheStats=[];
 for(const relative of ['voice-expansion-20261115','speed-20261115/priority-four','speed-20261115/priority-resume','speed-20261115/priority-resume-2','speed-20261115/full-corpus-queue','issue-quarter-20261115-priority','issue-quarter-20261115-all-supported','issue-quarter-20261115-title-completion','svm-improvement-20261114']){
  const dir=path.join(root,'.sites-runtime',relative);if(!fs.existsSync(dir))continue;
  for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('vectors.local.json'))){const stat=fs.statSync(path.join(dir,name));cacheStats.push([relative,name,stat.size,stat.mtimeMs]);}
 }
 return createHash('sha256').update(JSON.stringify({stage,labels,cacheStats,evaluationPolicy:'paired80-topic25-v2',finalPolicy:'terminal-lightning-topic60-v1'})).digest('hex');
}
async function tick(){
 const count=counts();state.counts=count;state.checkedAt=new Date().toISOString();atomic(stateFile,state);
 const ready={evaluation:count.evaluationReady,initial:count.evaluationReady&&Object.values(count.training).every(n=>n>=60),final:count.evaluationReady&&count.lightningTerminal&&Object.values(count.training).every(n=>n>=60)};
 for(const stage of ['evaluation','initial','final']){
  if(!ready[stage]||(stage!=='final'&&state.stages[stage]?.status==='completed'))continue;
  const inputFingerprint=fingerprint(stage),previous=state.stages[stage];if(previous?.inputFingerprint===inputFingerprint)continue;
  const attempt=(previous?.attempt??0)+1;
  const out=path.join(runtime,'training-pipeline',stage,`attempt-${String(attempt).padStart(3,'0')}`);fs.mkdirSync(out,{recursive:true});
  state.stages[stage]={status:'running',startedAt:new Date().toISOString(),counts:count,inputFingerprint,attempt,previousAttempts:previous?[...(previous.previousAttempts??[]),{attempt:previous.attempt,status:previous.status,completedAt:previous.completedAt}]:[]};atomic(stateFile,state);
  const log=fs.openSync(path.join(out,'pipeline.log'),'a');
  const result=spawnSync(process.platform==='win32'?'py':'python3',['research/paired_label_pipeline.py','--stage',stage,'--runtime',runtime,'--output',out],{cwd:root,stdio:['ignore',log,log],shell:false});fs.closeSync(log);
  const report=path.join(out,'pipeline-result.local.json');
  const pipelineResult=fs.existsSync(report)?json(report):null;
  state.stages[stage]={...state.stages[stage],status:result.error?'failed':result.status===0&&pipelineResult?.status!=='blocked'?'completed':'blocked',exitCode:result.status,error:result.error?.code,completedAt:new Date().toISOString(),...(pipelineResult?{result:pipelineResult}:{})};atomic(stateFile,state);
 }
}
await exportCorpus();
if(process.argv.includes('--audit')){console.log(JSON.stringify({articles:rows(snapshotFile).length,...counts(),apiCalls:0}));process.exit(0);}
const lock=path.join(runtime,'training-monitor.lock');let fd;
try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));await tick();
 while(!process.argv.includes('--once')&&state.stages.final?.status!=='completed'){await new Promise(resolve=>setTimeout(resolve,30_000));await tick();}
}finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
