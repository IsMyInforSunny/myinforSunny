// Real retained articles only. Research artifacts are never installed or released.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
const [modelPath,corpusPath,outputPath]=process.argv.slice(2);
const local=path.resolve('.sites-runtime')+path.sep;
if(![modelPath,corpusPath,outputPath].every(value=>value&&path.resolve(value).startsWith(local)))throw Error('Model, corpus and report must stay in .sites-runtime');
const model=JSON.parse(fs.readFileSync(modelPath,'utf8'));
const rows=fs.readFileSync(corpusPath,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const expected=JSON.parse(execFileSync(process.platform==='win32'?'py':'python3',['-X','utf8','research/predict_voice.py','--model',modelPath,'--corpus',corpusPath],{encoding:'utf8',maxBuffer:8*1024*1024}));
if(!expected.length)throw Error('No trainable topic: no runtime parity can be claimed');
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
try{
 const {inferVoices}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 let sentences=0,unresolved=0;const durations=[],mismatches=[];
 for(const entry of expected){
  const article=rows.find(row=>row.id===entry.articleId);
  const start=performance.now(),actual=inferVoices(model,article.text,article.topicId);durations.push(performance.now()-start);
  if(!actual)throw Error('Missing inference');
  if(actual.labels.length!==entry.labels.length)mismatches.push({articleId:entry.articleId,reason:'sentence_count'});
  for(let at=0;at<entry.labels.length;at++){
   const left=actual.labels[at],right=entry.labels[at];sentences++;
   if(left?.direction==='uncertain')unresolved++;
   if(!left||['sentenceId','direction','speaker','issue'].some(key=>left[key]!==right[key]))mismatches.push({articleId:entry.articleId,sentenceId:right.sentenceId});
  }
 }
 durations.sort((a,b)=>a-b);
 const report={modelVersion:model.version,modelStatus:model.status,articles:expected.length,sentences,unresolved,
  mismatches:mismatches.length,details:mismatches,latencyMs:{median:durations[Math.floor(durations.length*.5)],p95:durations[Math.floor(durations.length*.95)],max:durations.at(-1)},
  meaning:'Cross-language arithmetic and abstention parity on retained actual articles; not human accuracy or release approval.'};
 fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(mismatches.length)process.exitCode=1;
}finally{await server.close();}
