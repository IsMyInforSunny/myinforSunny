import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import './sites-env.mjs';

if(!process.env.NVIDIA_API_KEY?.trim())throw Error('Set NVIDIA_API_KEY in the server environment before starting.');
const configPath=fileURLToPath(new URL('../dist/server/wrangler.json',import.meta.url));
const config=JSON.parse(readFileSync(configPath,'utf8'));
config.vars={...config.vars,AI_PROVIDER:'nvidia',NVIDIA_MODEL:'deepseek-ai/deepseek-v4.1-flash',ENABLE_LIVE_ANALYSIS:'true',ENABLE_DIRECT_FETCH:'true',ENABLE_NEWS_SEARCH:'false',NEWS_PROVIDER:'publisher_feeds',NEWS_TERMS_APPROVED:'true',
 ALLOWED_RETRIEVAL_HOSTS:process.env.ALLOWED_RETRIEVAL_HOSTS??'www.dailian.co.kr,www.newdaily.co.kr,www.ohmynews.com,www.pressian.com,news.kbs.co.kr,imnews.imbc.com,news.sbs.co.kr,www.hani.co.kr,www.khan.co.kr,www.donga.com,www.chosun.com'};
// Only the generated, ignored configuration is modified. Secret value stays in memory.
delete config.vars.NVIDIA_API_KEY;
config.secrets={required:['NVIDIA_API_KEY']};
writeFileSync(configPath,JSON.stringify(config));
process.argv=[process.execPath,fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','--config',configPath,'--local','--persist-to','.wrangler/state','--ip','127.0.0.1','--port',process.env.PORT??'5184','--inspector-port','0'];
const {spawn}=await import('node:child_process');
const child=spawn(process.execPath,['--import',new URL('./sites-env.mjs',import.meta.url).href,...process.argv.slice(1)],{stdio:'inherit',env:process.env});
child.on('exit',code=>{process.exitCode=code??1;});

