import {readFileSync, mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';

/** Local serve only. Credentials stay in process memory and Worker secret bindings.
 * @param {{command:string,root:string,env?:Record<string,string|undefined>}} options
 */
export function localGroqRuntime({command, root, env=process.env}) {
  if(command!=='serve')return null;
  let settings, credentials;
  try {settings=parseEnv(readFileSync(path.join(root,'.dev.vars'),'utf8'));}
  catch(error) {if(error.code==='ENOENT'&&!env.INFORCAST_GROQ_KEY_FILE)return null;throw Error('Cannot read local runtime settings.');}
  const keyFile=env.INFORCAST_GROQ_KEY_FILE||settings.INFORCAST_GROQ_KEY_FILE;
  if(!keyFile)return null;
  try {
    credentials=parseEnv(readFileSync(path.resolve(root,keyFile),'utf8'));
  } catch {throw Error('Cannot read the configured local Groq runtime files.');}
  const key=settings.GROQ_API_KEY||credentials.GROQ_API_KEY;
  if(!/^gsk_[A-Za-z0-9_-]{20,}$/.test(key??''))throw Error('Invalid local Groq credential format.');
  const allowed=new Set(Object.keys(parseEnv(readFileSync(path.join(root,'.env.example'),'utf8'))));
  const names=[];
  for(const [name,value] of Object.entries({...settings,GROQ_API_KEY:key})) {
    if(!allowed.has(name))continue;
    env[name]=value;
    names.push(name);
  }
  // An isolated config directory lets Wrangler read only declared process secrets,
  // without .dev.vars shadowing the existing external credential.
  const directory=path.join(root,'.sites-runtime','local-groq-worker');
  mkdirSync(directory,{recursive:true});
  const configPath=path.join(directory,'wrangler.jsonc');
  if(!existsSync(configPath))writeFileSync(configPath,JSON.stringify({name:'inforcast-local',compatibility_date:'2026-05-15'}));
  return {configPath,secrets:{required:names}};
}
