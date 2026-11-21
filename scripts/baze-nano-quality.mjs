import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import {createBazeLabelingAdapter} from './baze-labeling-adapter.mjs';
registerHooks({resolve(s,c,n){try{return n(s,c)}catch(e){if(s.startsWith('.')&&!path.extname(s)&&c.parentURL?.endsWith('.ts'))return n(s+'.ts',c);throw e}},load(url,c,n){if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};if(url.endsWith('.json')&&url.includes('/lib/data/'))return {format:'module',shortCircuit:true,source:'export default '+fs.readFileSync(new URL(url),'utf8')+';'};return n(url,c)}});
const root=fs.realpathSync(process.cwd()),dir=path.join(root,'.sites-runtime/paired-voice-labels-20261116'),runtime=path.join(root,'.sites-runtime/baze-nano-quality-20261118');
fs.mkdirSync(runtime,{recursive:true});
const reportPath=path.join(root,'docs/test-runs/baze-nano-quality-2026-11-18.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const rows=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const save=(p,x)=>{const temp=p+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(x,null,2)+'\n',{mode:0o600});fs.renameSync(temp,p)};
const topics=['medical_school_quota','minimum_wage','nuclear_energy'];
const voice=await import('../lib/sentence-voice.ts');
const definitions=voice.VOICE_TOPICS;
// Freeze and use the exact Lightning instructions, including topic examples.
const source=fs.readFileSync('scripts/optimized-labeling.mjs','utf8');
const promptCode=source.slice(source.indexOf('const examples='),source.indexOf('const inputCache='));
if(!promptCode.startsWith('const examples=')||!promptCode.includes('const instructions='))throw Error('LIGHTNING_PROMPT_NOT_FOUND');
const instructions=vm.runInNewContext(promptCode+';instructions',{topics,definitions});
const frozenThresholds={primary:{directionAgreement:0.85,supportRecall:0.75,opposeRecall:0.75,speakerAgreement:0.85,repeatConsistency:0.90,formatErrorRate:0.02},auxiliary:{directionAgreement:0.75,supportRecall:0.60,opposeRecall:0.60,formatErrorRate:0.05}};
const manifest=read(path.join(dir,'paired-sample-manifest.local.json'));
const corp=new Map(rows(path.join(root,'.sites-runtime/collection-1000-20261105/articles-reviewed-3000.local.jsonl')).map(x=>[x.id,x]));
const files={lightning:'lightning-labels.local.jsonl',deepseek:'deepseek-evaluation-labels.local.jsonl',groq:'groq-evaluation-labels.local.jsonl'};
const labels=Object.fromEntries(Object.entries(files).map(([k,p])=>[k,new Map(rows(path.join(dir,p)).map(x=>[x.articleId,x]))]));
const fields=['issue','direction','speaker'];
const agreement=(a,b)=>fields.every(k=>a[k]===b[k]);
function prepare(item){const article=corp.get(item.id);const input=voice.voiceAnnotationInput(article.text,item.topic);const sentences=input.sentences.filter(x=>!voice.isVoiceBoilerplate(x.text));return {input,sentences,messages:[{role:'system',content:instructions.get(item.topic)},{role:'user',content:JSON.stringify({sentences:sentences.map(x=>[x.sentenceId,x.text])})}],maxTokens:sentences.length*25+100}}
const candidates=[];
for(const item of manifest.articles.filter(x=>x.partition==='evaluation')){
  const a=labels.lightning.get(item.id),b=labels.deepseek.get(item.id)?.status==='completed'?labels.deepseek.get(item.id):labels.groq.get(item.id);
  if(a?.status!=='completed'||b?.status!=='completed')continue;
  const article=corp.get(item.id),p=prepare(item);
  if(!article||a.articleHash!==item.bodyHash||b.articleHash!==item.bodyHash||a.topic!==item.topic||b.topic!==item.topic||a.scopeCharacters!==2000||b.scopeCharacters!==2000)throw Error('GOLD_PROVENANCE_MISMATCH');
  if(await voice.voiceArticleHash(article.text)!==item.bodyHash)throw Error('CORPUS_HASH_MISMATCH');
  const bm=new Map(b.labels.map(x=>[x.sentenceId,x])),am=new Map(a.labels.map(x=>[x.sentenceId,x]));
  const gold=p.sentences.map(x=>am.get(x.sentenceId)).filter(x=>x&&!x.excluded&&bm.get(x.sentenceId)&&!bm.get(x.sentenceId).excluded&&agreement(x,bm.get(x.sentenceId))).map(x=>Object.fromEntries(['sentenceId',...fields].map(k=>[k,x[k]])));
  if(gold.length)candidates.push({...item,secondModel:b.model,gold});
}
let selected=[];
for(const topic of topics){const pool=candidates.filter(x=>x.topic===topic);const tally={support:0,oppose:0,neutral:0,journalist:0,source:0};for(let i=0;i<6;i++){pool.sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));const best=pool.shift();if(!best)throw Error('INSUFFICIENT_GOLD_ARTICLES');selected.push(best);for(const x of best.gold){tally[x.direction]=(tally[x.direction]??0)+1;tally[x.speaker]=(tally[x.speaker]??0)+1;}}
 function score(a){return a.gold.reduce((n,x)=>n+1+(x.direction==='support'||x.direction==='oppose'?4+20/(1+tally[x.direction]):0)+(x.speaker==='journalist'||x.speaker==='source'?5/(1+tally[x.speaker]):0),0)}
}
const counts={articles:selected.length,sentences:selected.reduce((n,x)=>n+x.gold.length,0),directional:selected.reduce((n,x)=>n+x.gold.filter(s=>['support','oppose'].includes(s.direction)).length,0),byTopic:Object.fromEntries(topics.map(t=>[t,{articles:selected.filter(x=>x.topic===t).length,sentences:selected.filter(x=>x.topic===t).reduce((n,x)=>n+x.gold.length,0)}])),byDirection:{},bySpeaker:{}};
for(const x of selected.flatMap(x=>x.gold)){counts.byDirection[x.direction]=(counts.byDirection[x.direction]??0)+1;counts.bySpeaker[x.speaker]=(counts.bySpeaker[x.speaker]??0)+1}
if(counts.sentences<150||counts.directional<50||!['support','oppose','neutral'].every(k=>counts.byDirection[k])||!['journalist','source'].every(k=>counts.bySpeaker[k]))throw Error('GOLD_COVERAGE_GATE_FAILED');
const existing=fs.existsSync(path.join(runtime,'frozen-plan.local.json'))?read(path.join(runtime,'frozen-plan.local.json')):null;
if(existing){selected=existing.selected;if(existing.promptSha256!==sha(promptCode))throw Error('PROMPT_CHANGED_SINCE_FREEZE');}
else save(path.join(runtime,'frozen-plan.local.json'),{createdAt:new Date().toISOString(),thresholds:frozenThresholds,promptSha256:sha(promptCode),counts,selected,sourceHashes:Object.fromEntries(Object.entries(files).map(([k,f])=>[k,sha(fs.readFileSync(path.join(dir,f)))]))});
const plan=read(path.join(runtime,'frozen-plan.local.json'));
const report={schemaVersion:'baze-nano-quality-1.0',startedAt:plan.createdAt,status:'running',reference:'two-AI-consensus; not human accuracy',thresholdsFrozenBeforeInference:plan.thresholds,promptSha256:plan.promptSha256,selection:plan.counts,model:null,connection:null,metrics:null,calls:[],incorrectExamples:[]};
save(reportPath,report);
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({status:'prepared',selection:plan.counts,promptSha256:plan.promptSha256}));process.exit(0)}
const adapter=createBazeLabelingAdapter();const models=await adapter.models();const target=models.find(x=>x.id==='gpt-5.4-nano');if(!target)throw Error('EXACT_NANO_MODEL_NOT_LISTED');
report.model=target;report.provider=adapter.metadata;
function parse(text,p){if(!text)throw Error('EMPTY_RESPONSE');let d;try{d=JSON.parse(text)}catch{throw Error('INVALID_JSON')}if(!d||Object.keys(d).some(x=>x!=='labels')||!Array.isArray(d.labels)||d.labels.length!==p.sentences.length)throw Error('INVALID_LABEL_COUNT');const seen=new Set(),ids=new Set(p.sentences.map(x=>x.sentenceId));const out=[];for(const x of d.labels){if(!Array.isArray(x)||x.length!==4)throw Error('INVALID_LABEL_TUPLE');const [sentenceId,issue,direction,speaker]=x;if(!ids.has(sentenceId)||seen.has(sentenceId)||![...Object.keys(p.input.issues),'none','unknown'].includes(issue)||!['support','oppose','neutral','uncertain'].includes(direction)||!['journalist','source','mixed','unknown'].includes(speaker))throw Error('INVALID_LABEL_FIELDS');seen.add(sentenceId);out.push({sentenceId,issue,direction,speaker})}return out}
async function invoke(item,kind,subset){const checkpoint=path.join(runtime,kind+'-'+item.id+'.local.json');if(fs.existsSync(checkpoint))return read(checkpoint);const p=prepare(item);if(subset){p.sentences=p.sentences.slice(0,subset);p.messages[1].content=JSON.stringify({sentences:p.sentences.map(x=>[x.sentenceId,x.text])});p.maxTokens=p.sentences.length*25+100}const started=Date.now();let result,receivedUsage=null;try{const r=await adapter.label({model:target.id,...p});receivedUsage=r.usage;if(r.status!=='completed')throw Object.assign(Error('INCOMPLETE_OUTPUT'),{usage:r.usage});result={articleId:item.id,topic:item.topic,kind,status:'success',labels:parse(r.text,p),usage:r.usage,durationMs:r.durationMs,sentences:p.sentences.length};}catch(e){const category=e.name==='TimeoutError'||e.name==='AbortError'?'timeout':e.message==='EMPTY_RESPONSE'?'emptyResponse':/^INVALID_/.test(e.message)?'formatError':e.message==='INCOMPLETE_OUTPUT'?'incompleteOutput':'providerError';result={articleId:item.id,topic:item.topic,kind,status:'failed',category,errorCode:/^[A-Z_0-9]+$/.test(e.message)?e.message:'REQUEST_FAILED',usage:e.usage??receivedUsage,durationMs:Date.now()-started,sentences:p.sentences.length};}save(checkpoint,result);report.calls.push({...result,labels:undefined});save(reportPath,report);console.log(JSON.stringify({articleId:item.id,kind,status:result.status,errorCode:result.errorCode,durationMs:result.durationMs}));return result}
const smoke=await invoke(selected[0],'connection',5);report.connection={status:smoke.status,sentences:5,errorCode:smoke.errorCode};save(reportPath,report);if(smoke.status!=='success'){report.status='blocked_connection';report.finishedAt=new Date().toISOString();save(reportPath,report);process.exitCode=1;}else{
const primary=[];for(const item of selected)primary.push(await invoke(item,'quality'));
const repeated=[];const repeatItems=[selected[0],selected[6],selected[12],selected[1],selected[7]];for(const item of repeatItems)repeated.push(await invoke(item,'repeat'));
const correct={issue:0,direction:0,speaker:0},confusion={issue:{},direction:{},speaker:{}},byTopic={};const mistakes=[];let denominator=0;
for(const item of selected){const result=primary.find(x=>x.articleId===item.id),map=new Map((result.labels??[]).map(x=>[x.sentenceId,x]));byTopic[item.topic]??={sentences:0,correct:{issue:0,direction:0,speaker:0}};for(const expected of item.gold){const actual=map.get(expected.sentenceId);denominator++;byTopic[item.topic].sentences++;for(const field of fields){const want=expected[field],got=actual?.[field]??'missing';if(want===got){correct[field]++;byTopic[item.topic].correct[field]++;}confusion[field][want]??={};confusion[field][want][got]=(confusion[field][want][got]??0)+1;}if(!actual||!agreement(expected,actual))mistakes.push({sentenceId:item.id+':'+expected.sentenceId,expected:Object.fromEntries(fields.map(k=>[k,expected[k]])),nano:actual?Object.fromEntries(fields.map(k=>[k,actual[k]])):null});}}
let repeatTotal=0,repeatExact=0;const repeatFields={issue:0,direction:0,speaker:0};for(const repeat of repeated){const first=primary.find(x=>x.articleId===repeat.articleId);const item=selected.find(x=>x.id===repeat.articleId);const input=prepare(item);const firstMap=new Map((first.labels??[]).map(x=>[x.sentenceId,x])),secondMap=new Map((repeat.labels??[]).map(x=>[x.sentenceId,x]));for(const sentence of input.sentences){repeatTotal++;const a=firstMap.get(sentence.sentenceId),b=secondMap.get(sentence.sentenceId);if(a&&b){if(agreement(a,b))repeatExact++;for(const k of fields)if(a[k]===b[k])repeatFields[k]++;}}}
const all=[smoke,...primary,...repeated],errors={formatError:0,emptyResponse:0,timeout:0,incompleteOutput:0,providerError:0};for(const r of all)if(r.status!=='success')errors[r.category]++;
const recall=label=>{const c=confusion.direction[label]??{},n=Object.values(c).reduce((a,b)=>a+b,0);return n?(c[label]??0)/n:0};
const rates=Object.fromEntries(fields.map(k=>[k,correct[k]/denominator]));const repeatConsistency=repeatTotal?repeatExact/repeatTotal:0;
// All invalid/missing outputs count as format failures for the grade, preventing an empty/timeout loophole.
const invalidResponseRate=all.filter(x=>x.status!=='success').length/all.length;
report.metrics={denominator,fieldAgreement:rates,supportRecall:recall('support'),opposeRecall:recall('oppose'),confusion,byTopic,repeat:{articles:5,comparisons:repeatTotal,exact:repeatExact,consistency:repeatConsistency,fieldConsistency:Object.fromEntries(fields.map(k=>[k,repeatFields[k]/repeatTotal]))},errors,calls:all.length,formatErrorRate:errors.formatError/all.length,invalidResponseRate,meanResponseMs:all.reduce((n,x)=>n+x.durationMs,0)/all.length,tokensPerCall:all.map(x=>({articleId:x.articleId,kind:x.kind,usage:x.usage})),missingOutputsCountAsDisagreement:true};
const primaryGrade=rates.direction>=0.85&&recall('support')>=0.75&&recall('oppose')>=0.75&&rates.speaker>=0.85&&repeatConsistency>=0.90&&invalidResponseRate<=0.02;
const auxiliary=rates.direction>=0.75&&recall('support')>=0.60&&recall('oppose')>=0.60&&invalidResponseRate<=0.05;
report.grade=primaryGrade?'primary':auxiliary?'auxiliary':'reject';report.allowedUse=primaryGrade?'remaining and expanded training only on Lightning-nano agreed sentences':auxiliary?'missing second evaluation labels and disagreement adjudication only; never count nano and Groq as independent votes on one sentence':'none';report.incorrectExamples=mistakes.slice(0,10);report.calls=all.map(({labels,...x})=>x);report.status='completed';report.finishedAt=new Date().toISOString();save(reportPath,report);console.log(JSON.stringify({grade:report.grade,selection:report.selection,metrics:report.metrics,incorrectExamples:report.incorrectExamples}));}
