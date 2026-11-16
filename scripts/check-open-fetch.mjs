import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {registerHooks} from 'node:module';

if(process.env.ENABLE_OPEN_FETCH_CHECK!=='true'){
 console.log('Skipped: set ENABLE_OPEN_FETCH_CHECK=true and OPEN_FETCH_CHECK_URLS to opt in.');
 process.exit(0);
}
const urls=(process.env.OPEN_FETCH_CHECK_URLS??'').split(/\r?\n|;/).map(value=>value.trim()).filter(Boolean);
if(urls.length!==15)throw new Error('OPEN_FETCH_CHECK_URLS must contain exactly 15 article URLs (10 allowed/open candidates, 3 denial checks, 2 portal URLs).');
const allowedHosts=(process.env.ALLOWED_RETRIEVAL_HOSTS??'').split(',').map(value=>value.trim()).filter(Boolean);
const outPath=resolve(process.env.OPEN_FETCH_CHECK_OUTPUT??'docs/test-runs/open-fetch-2026-11-16.json');
registerHooks({resolve(specifier,context,nextResolve){
 try{return nextResolve(specifier,context);}catch(error){
  if(specifier.startsWith('.')&&!/\.(?:mjs|cjs|js|json|ts)$/.test(specifier))return nextResolve(`${specifier}.ts`,context);
  throw error;
 }
}});
const {retrieveDetailed}=await import('../lib/server/retrieval.ts');
const config={...process.env,NEWS_PROVIDER:'direct',ALLOWED_RETRIEVAL_HOSTS:allowedHosts.join(',')};
const rows=[];
for(const url of urls){
 const started=Date.now();let host='invalid';try{host=new URL(url).hostname;}catch{}
 try{
  const result=await retrieveDetailed(url,`open_fetch_check_${rows.length+1}`,config,AbortSignal.timeout(12000));
  rows.push({host,status:result.ok?'completed':result.reason,...(result.ok?{extractionMethod:result.metadata.extractionMethod??'unknown',bodyLength:result.reference.fullTextLength??result.reference.text.length}:{}),durationMs:Date.now()-started});
 }catch(error){rows.push({host,status:error instanceof Error?error.name:'ERROR',durationMs:Date.now()-started});}
}
const summary={checkedAt:new Date().toISOString(),count:rows.length,results:rows};
await mkdir(dirname(outPath),{recursive:true});await writeFile(outPath,JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({checkedAt:summary.checkedAt,count:summary.count,results:rows}));
