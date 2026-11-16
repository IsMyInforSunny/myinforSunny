import {execFileSync,spawn} from 'node:child_process';
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

const worktrees=execFileSync('git',['worktree','list','--porcelain'],{cwd:root,encoding:'utf8'});
const roots=[...worktrees.matchAll(/^worktree (.+)$/gm)].map(match=>match[1]);
const canonical=process.env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT
  ?realpathSync(process.env.LOCAL_VOICE_RESEARCH_CANONICAL_ROOT)
  :roots.find(candidate=>realpathSync(candidate)!==root&&existsSync(path.join(candidate,'docs','CODEX_COMMAND_2026-11-16B.md')));
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
const cli=fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url));
const child=spawn(process.execPath,['--import',new URL('./sites-env.mjs',import.meta.url).href,cli,
  '--host','127.0.0.1','--port','5190','--strictPort'],{cwd:root,env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
