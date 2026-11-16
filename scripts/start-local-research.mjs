import {spawn,spawnSync} from 'node:child_process';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

await import('./sites-env.mjs');
const root=realpathSync(process.cwd());
const runtime=realpathSync(path.join(root,'.sites-runtime'));
const inside=(base,target)=>target.startsWith(base+path.sep);
const isolatedRoot=realpathSync(path.dirname(root));
if(path.basename(isolatedRoot).toLowerCase()!=='.sites-runtime'||!inside(isolatedRoot,root))throw Error('Research UI must run from an isolated checkout under .sites-runtime.');
if(!process.env.NVIDIA_API_KEY?.trim())throw Error('Set NVIDIA_API_KEY in the server environment before starting research mode.');

const canonical=process.env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT
  ?realpathSync(process.env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT)
  :realpathSync(path.dirname(isolatedRoot));
if(!canonical||realpathSync(canonical)===root)throw Error('Could not identify the canonical checkout; set LOCAL_VOICE_RESEARCH_CANONICAL_ROOT explicitly.');

const model=process.env.LOCAL_VOICE_RESEARCH_MODEL??'.sites-runtime/voice-expansion-20261115/six-topics-candidate.local.json';
const modelPath=realpathSync(path.resolve(root,model));
if(!inside(runtime,modelPath))throw Error('Research candidate must be stored under .sites-runtime.');
const env={...process.env,LOCAL_VOICE_RESEARCH_MODEL:model,LOCAL_VOICE_RESEARCH_CANONICAL_ROOT:canonical,
  AI_PROVIDER:'nvidia',ENABLE_LIVE_ANALYSIS:'true',ENABLE_DIRECT_FETCH:'true',ENABLE_NEWS_SEARCH:'false',
  PORT:'5190',HOST:'127.0.0.1'};
const comparison=path.join('.sites-runtime','speed-20261115','coordinates-priority-complete');
for(const [key,name] of [['LOCAL_VOICE_PRECOMPUTED','precomputed-voices.local.json'],['LOCAL_VOICE_BASELINES','baselines.local.json'],
  ['LOCAL_VOICE_PROVENANCE','provenance.local.json'],['LOCAL_VOICE_RECOMMENDATIONS','recommendations.local.json']]){
  const file=path.join(comparison,name);if(existsSync(path.join(root,file)))env[key]=file;
}
const build=spawnSync('npm',['run','build'],{cwd:root,env,stdio:'inherit',shell:process.platform==='win32'});
if(build.error)throw build.error;
if(build.status!==0)process.exit(build.status??1);
const configPath=path.join(root,'dist','server','wrangler.json');
if(!existsSync(configPath))throw Error('Research build did not produce dist/server/wrangler.json.');
const config=JSON.parse(await (await import('node:fs/promises')).readFile(configPath,'utf8'));
config.vars={...config.vars,AI_PROVIDER:'nvidia',NVIDIA_MODEL:env.NVIDIA_MODEL??'nvidia/nemotron-3.5-lightning-30b-a3b',
  ENABLE_LIVE_ANALYSIS:'true',ENABLE_DIRECT_FETCH:'true',ENABLE_NEWS_SEARCH:'false',NEWS_TERMS_APPROVED:'true',
  ALLOWED_RETRIEVAL_HOSTS:env.ALLOWED_RETRIEVAL_HOSTS??'www.dailian.co.kr,www.newdaily.co.kr,biz.newdaily.co.kr,www.ohmynews.com,www.pressian.com,www.donga.com'};
delete config.vars.NVIDIA_API_KEY;
config.secrets={required:['NVIDIA_API_KEY']};
await (await import('node:fs/promises')).writeFile(configPath,JSON.stringify(config,null,2)+'\n','utf8');
const cli=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const migrations=spawnSync(process.execPath,[cli,'d1','migrations','apply','DB','--local','--config',path.join(root,'wrangler.local.jsonc'),'--persist-to','.wrangler/research-state'],{cwd:root,env,stdio:'inherit'});
if(migrations.error)throw migrations.error;
if(migrations.status!==0)process.exit(migrations.status??1);
const child=spawn(process.execPath,['--import',new URL('./sites-env.mjs',import.meta.url).href,cli,
  'dev','--config',configPath,'--local','--persist-to','.wrangler/research-state','--ip','127.0.0.1','--port','5190','--inspector-port','0'],
  {cwd:root,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
