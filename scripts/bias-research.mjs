// Local research orchestration only: no provider imports or API calls.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
const [mode,...args]=process.argv.slice(2);
const help=`Local bias research (API calls: 0)
  npm run bias:diagnose -- --out .sites-runtime/NEW-DIRECTORY [--data .sites-runtime/REVIEW-DIRECTORY] [--frozen-split .sites-runtime/SPLIT.json]
    Runs existing diagnose_voice_consensus.py; reports independent review overlap and blockers.
  npm run bias:retrain -- --config .sites-runtime/PIPELINE.json
    Runs prepare_multitopic_voice_embeddings.py, then train_multitopic_voice_embeddings.py.
    The multitopic trainer evaluates frozen heldout data and writes its evaluation report.
    Config: {"corpus":["..."],"labels":["..."],"splitManifest":"...","vectors":["..."],"cacheInputs":["..."],"outputDir":".sites-runtime/NEW-DIRECTORY","events":"..."}
    labels must already contain the reviewed/consensus labels, with actual annotator provenance.
    All paths must be under .sites-runtime; inputs must exist; output directory must be new.
    No labels, embeddings, approvals or release decisions are invented. Prior files are preserved.
  Uses py on Windows and python3 elsewhere. BIAS_PYTHON can select an executable.`;
if(args.includes('--help')||args.includes('-h')){console.log(help);process.exit(0);}
if(!['diagnose','retrain'].includes(mode))throw Error(help);
const options=new Map();
for(let index=0;index<args.length;index+=2){
 const key=args[index],value=args[index+1];
 if(!key.startsWith('--')||!value||value.startsWith('--')||options.has(key))throw Error('Expected unique --option value pairs. Use --help.');
 options.set(key,value);
}
const local=(value,exists=true)=>{
 if(typeof value!=='string'||!value.trim())throw Error('A local research path is required. Use --help.');
 const resolved=path.resolve(root,value);
 if(!resolved.startsWith(runtime+path.sep))throw Error('Research input/output must be under .sites-runtime.');
 if(exists&&!fs.existsSync(resolved))throw Error(`Missing research input: ${value}`);
 // Resolve existing parents too, so junctions cannot redirect new outputs.
 let ancestor=resolved;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const actual=fs.realpathSync(ancestor);
 if(actual!==runtime&&!actual.startsWith(runtime+path.sep))throw Error('Research path resolves outside .sites-runtime.');
 return resolved;
};
const run=(script,arguments_)=>{
 const result=spawnSync(process.env.BIAS_PYTHON??(process.platform==='win32'?'py':'python3'),[path.join(root,'research',script),...arguments_],{cwd:root,stdio:'inherit',shell:false});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`${script} failed (exit ${result.status}); later stages were not run.`);
};
const newOutput=value=>{
 const output=local(value,false);
 if(fs.existsSync(output))throw Error('Output directory already exists; preserve previous artifacts and choose a new directory.');
 return output;
};
if(mode==='diagnose'){
 for(const key of options.keys())if(!['--data','--frozen-split','--out'].includes(key))throw Error(`Unknown option: ${key}`);
 const data=local(options.get('--data')??'.sites-runtime/voice-expansion-20261115');
 const split=local(options.get('--frozen-split')??path.join(data,'six-topics-frozen-split.local.json'));
 for(const name of ['review-a.local.jsonl','review-a-additional.local.jsonl','review-b.local.jsonl','review-b-additional.local.jsonl'])local(path.join(data,name));
 const out=newOutput(options.get('--out'));
 run('diagnose_voice_consensus.py',['--data',data,'--frozen-split',split,'--out',out]);
}else{
 if(options.size!==1||!options.has('--config'))throw Error('bias:retrain requires --config .sites-runtime/PIPELINE.json. Use --help.');
 const config=JSON.parse(fs.readFileSync(local(options.get('--config')),'utf8').replace(/^\uFEFF/,''));
 const paths=key=>{if(!Array.isArray(config[key])||!config[key].length)throw Error(`Config requires a nonempty ${key} array.`);return config[key].map(value=>local(value));};
 const corpus=paths('corpus'),labels=paths('labels'),vectors=paths('vectors');
 const caches=config.cacheInputs===undefined?[]:paths('cacheInputs');
 if(caches.length&&caches.length!==vectors.length)throw Error('Supply one cacheInputs provenance file per vectors file.');
 const split=local(config.splitManifest),events=config.events?local(config.events):null;
 const out=newOutput(config.outputDir),prepared=path.join(out,'prepared.local.json');
 const candidate=path.join(out,'candidate.local.json'),report=path.join(out,'evaluation.local.json');
 const repeated=(flag,values)=>values.flatMap(value=>[flag,value]);
 run('prepare_multitopic_voice_embeddings.py',[...repeated('--corpus',corpus),...repeated('--labels',labels),'--split-manifest',split,'--output',prepared,...(events?['--events',events]:[])]);
 run('train_multitopic_voice_embeddings.py',['--input',prepared,...repeated('--vectors',vectors),...repeated('--cache-input',caches),'--candidate',candidate,'--report',report]);
 const evaluation=JSON.parse(fs.readFileSync(report,'utf8'));
 console.log(JSON.stringify({apiCalls:0,researchOnly:true,candidate,report,ready:evaluation.ready,topics:evaluation.topics}));
}
