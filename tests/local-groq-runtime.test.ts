import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localGroqRuntime} from '../scripts/local-groq-runtime.mjs';
const folders:string[]=[];
afterEach(()=>{for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
it('never reads credentials or changes the build environment',()=>{
 const env={INFORCAST_GROQ_KEY_FILE:'nonexistent'};
 expect(localGroqRuntime({command:'build',root:'nonexistent',env})).toBeNull();
 expect(env).toEqual({INFORCAST_GROQ_KEY_FILE:'nonexistent'});
});
it.each(['process','local-reference'])('passes only declared secrets in memory, without saving credential values (%s)',source=>{
 const root=mkdtempSync(path.join(tmpdir(),'inforcast-runtime-'));folders.push(root);
 const key='gsk_synthetic_key_for_isolated_test_12345';
 const keyFile=path.join(root,'original-key');
 writeFileSync(keyFile,`GROQ_API_KEY=${key}\nOTHER_SECRET=do-not-import`);
 writeFileSync(path.join(root,'.dev.vars'),'AI_PROVIDER=groq\nUNKNOWN=ignored'+(source==='local-reference'?'\nINFORCAST_GROQ_KEY_FILE=original-key':''));
 writeFileSync(path.join(root,'.env.example'),'AI_PROVIDER=groq\nGROQ_API_KEY=');
 const env:Record<string,string>=source==='process'?{INFORCAST_GROQ_KEY_FILE:keyFile}:{};
 const result=localGroqRuntime({command:'serve',root,env})!;
 expect(env.GROQ_API_KEY).toBe(key);expect(env.OTHER_SECRET).toBeUndefined();expect(env.UNKNOWN).toBeUndefined();
 expect(result.secrets.required).toEqual(['AI_PROVIDER','GROQ_API_KEY']);
 expect(JSON.stringify(result)).not.toContain(key);
 expect(readFileSync(result.configPath,'utf8')).not.toContain(key);
 expect(readdirSync(path.dirname(result.configPath))).toEqual(['wrangler.jsonc']);
});
