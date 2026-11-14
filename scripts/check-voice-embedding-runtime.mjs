// Offline numerical parity on actual cached sentence embeddings. No API calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localRoot=path.join(root,'.sites-runtime');
const parameters=process.argv.slice(2);
if(parameters.length!==4)throw Error('Use CANDIDATE INPUT VECTORS REPORT, all local .sites-runtime paths');
const local=value=>{
  const resolved=path.resolve(value);
  if(!resolved.startsWith(localRoot+path.sep))throw Error('Research artifacts must stay beneath .sites-runtime');
  let existing=resolved;while(!fs.existsSync(existing))existing=path.dirname(existing);
  const real=fs.realpathSync(existing);
  if(real!==localRoot&&!real.startsWith(localRoot+path.sep))throw Error('Research path resolves outside .sites-runtime');
  return resolved;
};
const [candidatePath,inputPath,vectorsPath,reportPath]=parameters.map(local);
if(new Set(parameters.map(value=>path.resolve(value))).size!==4)throw Error('Input and report paths must differ');
const load=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const candidate=load(candidatePath),input=load(inputPath),vectors=load(vectorsPath);
if(candidate.schemaVersion!=='voice-embedding-svm-research-1.0'||candidate.status!=='research'
  ||candidate.inputDigest!==input.inputDigest||vectors.inputDigest!==input.inputDigest
  ||candidate.configuration?.embeddingModel!==vectors.model||candidate.configuration?.dimensions!==2048
  ||vectors.dimensions!==2048||!Array.isArray(input.records)||!input.records.length)throw Error('Incompatible research candidate/inputs');
for(const record of input.records)if(!Object.hasOwn(vectors.vectors,record.key))throw Error('Incomplete embedding cache; parity was not run');
const python=String.raw`
import sys,json,hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,'research')
from train_voice import selective_predictions
from prepare_voice_embeddings import natural_text
load=lambda path:json.loads(Path(path).read_text(encoding='utf-8-sig'))
candidate,prepared,vectors=map(load,sys.argv[1:4])
keys=[row['key'] for row in prepared['records']]
x=np.array([vectors['vectors'][key] for key in keys],dtype=np.float64)
if x.shape!=(len(keys),2048) or not np.all(np.isfinite(x)):raise ValueError('Invalid cached vectors')
scales=np.max(np.abs(x),axis=1)
if np.any(scales==0):raise ValueError('Zero cached vector')
x=x/scales[:,None]
norms=np.hypot.reduce(x,axis=1)
x=x/norms[:,None]
heads=candidate['heads']
labels=selective_predictions(heads,x)
scores={name:(x@np.array(head['coefficients'],dtype=np.float64).T+np.array(head['intercepts'],dtype=np.float64)) for name,head in heads.items()}
result=[]
for i,record in enumerate(prepared['records']):
 result.append({'key':record['key'],'labels':{name:values[i] for name,values in labels.items()},
  'naturalTextDigest':hashlib.sha256(natural_text(record['text']).encode()).hexdigest(),
  'margins':{name:{label:float(scores[name][i,j]) for j,label in enumerate(head['classes'])} for name,head in heads.items()}})
print(json.dumps(result,ensure_ascii=True,allow_nan=False))
`;
const expected=JSON.parse(execFileSync(process.platform==='win32'?'py':'python3',
  ['-X','utf8','-c',python,candidatePath,inputPath,vectorsPath],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}));
if(expected.length!==input.records.length)throw Error('Python parity coverage mismatch');
const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
try{
  const {inferDenseVoiceHeads,denseVoiceInputText}=await server.ssrLoadModule('/lib/voice-dense.ts');
  const durations=[],mismatches=[];let maximumMarginDifference=0,unresolved=0;
  for(let i=0;i<input.records.length;i++){
    const record=input.records[i],reference=expected[i];
    if(reference.key!==record.key)throw Error('Prepared record order mismatch');
    const textDigest=crypto.createHash('sha256').update(denseVoiceInputText(record.text)).digest('hex');
    if(textDigest!==reference.naturalTextDigest||textDigest!==record.key)mismatches.push({key:record.key,reason:'semantic_input_normalization'});
    const start=performance.now(),actual=inferDenseVoiceHeads(candidate.heads,vectors.vectors[record.key]);durations.push(performance.now()-start);
    if(!actual){mismatches.push({key:record.key,reason:'invalid_dense_result'});continue;}
    if(actual.direction===null||actual.speaker===null||actual.issue===null)unresolved++;
    for(const name of ['direction','speaker','issue'])if(actual[name]!==reference.labels[name])mismatches.push({key:record.key,reason:`${name}_classification`});
    for(const [name,margins]of Object.entries(reference.margins))for(const [label,expectedValue]of Object.entries(margins)){
      const difference=Math.abs(actual.margins[name][label]-expectedValue);
      if(!Number.isFinite(difference))throw Error('Nonfinite numerical parity difference');
      maximumMarginDifference=Math.max(maximumMarginDifference,difference);
      if(difference>1e-10)mismatches.push({key:record.key,reason:'margin_difference',head:name});
    }
  }
  durations.sort((a,b)=>a-b);
  const report={candidateVersion:candidate.version,inputDigest:input.inputDigest,modelStatus:candidate.status,
    embeddingModel:vectors.model,dimensions:2048,uniqueActualSentenceVectors:input.records.length,
    labeledUnits:Object.values(input.sets).reduce((sum,rows)=>sum+rows.length,0),
    partitionCounts:Object.fromEntries(Object.entries(input.sets).map(([name,rows])=>[name,rows.length])),
    mismatches:mismatches.length,details:mismatches,maximumMarginDifference,unresolved,
    latencyMs:{median:durations[Math.floor(durations.length*.5)],p95:durations[Math.floor(durations.length*.95)],max:durations.at(-1)},
    meaning:'Offline Python/TypeScript numerical and abstention parity on actual cached embeddings; not human accuracy, API latency, model release or production integration.'};
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));if(mismatches.length)process.exitCode=1;
}finally{await server.close();}
