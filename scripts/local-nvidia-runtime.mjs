import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';

/** Explicit local NVIDIA opt-in. Pass existing environment secrets by name, never persist them. */
export function localNvidiaRuntime({command,root,env=process.env}){
 if(command!=='serve'||env.AI_PROVIDER!=='nvidia')return null;
 if(!env.NVIDIA_API_KEY?.trim())throw Error('NVIDIA_API_KEY is missing from the server environment.');
 const directory=path.join(root,'.sites-runtime','local-nvidia-worker');mkdirSync(directory,{recursive:true});
 const configPath=path.join(directory,'wrangler.jsonc');
 writeFileSync(configPath,JSON.stringify({name:'inforcast-local',compatibility_date:'2026-05-15'}));
 const names=['AI_PROVIDER','NVIDIA_API_KEY','NVIDIA_MODEL','ENABLE_LIVE_ANALYSIS','ENABLE_DIRECT_FETCH','ENABLE_NEWS_SEARCH','NEWS_PROVIDER','NEWS_TERMS_APPROVED','ALLOWED_RETRIEVAL_HOSTS','IP_HASH_SECRET'];
 return {configPath,secrets:{required:names.filter(name=>env[name]!==undefined)}};
}
