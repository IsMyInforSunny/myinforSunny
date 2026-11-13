// Explicit, bounded offline AI annotation. Sequential, no retries or provider fallback.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
const [input,output,maxText='0',budgetText='0']=process.argv.slice(2),maximum=Number(maxText),budget=Number(budgetText);
const root=process.cwd(),destination=path.resolve(output??'.'),local=path.resolve(root,'.sites-runtime')+path.sep;
if(!input||!output||!destination.startsWith(local)||!Number.isInteger(maximum)||maximum<1||!Number.isFinite(budget)||budget<6500||budget>120000)
 throw Error('Usage: input local-output maximumArticles tokenBudget(6500..120000)');
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom',resolve:{alias:{'@':root}}});
let used=0,reserved=0,completed=0,usageReports=0;
try{
 const {z}=await import('zod/v4');
 const {structured}=await server.ssrLoadModule('/lib/server/language.ts');
 const {VOICE_INSTRUCTIONS,voiceAnnotationInput,voiceArticleHash,VOICE_VERSION,validateVoiceDocument}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {NVIDIA_FAST_MODEL}=await server.ssrLoadModule('/lib/server/config.ts');
 const config={...process.env,AI_PROVIDER:'nvidia',NVIDIA_MODEL:NVIDIA_FAST_MODEL,
  onUsage:tokens=>{used+=tokens;usageReports++;},onDispatch:()=>{if(Math.max(used,reserved)+6500>budget)throw Error('Annotation token reserve exhausted');reserved=Math.max(used,reserved)+6500;}};
 const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const previous=fs.existsSync(destination)?fs.readFileSync(destination,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
 const seen=new Set(previous.map(row=>row.articleId));
 if(seen.size!==previous.length||previous.some(row=>row.annotator?.model!==NVIDIA_FAST_MODEL||row.annotator?.version!==VOICE_VERSION))throw Error('Existing annotations have duplicate IDs or a different teacher');
 const ledger=destination+'.budget.json';
 const day=new Date().toISOString().slice(0,10);
 const previousBudget=fs.existsSync(ledger)?JSON.parse(fs.readFileSync(ledger,'utf8')):null;
 if(previous.length&&!previousBudget)throw Error('Existing annotations need their original budget ledger');
 if(previousBudget?.day===day){reserved=previousBudget.reserved;used=previousBudget.used;}
 const reviews=destination+'.review.jsonl';
 if(fs.existsSync(reviews))for(const review of fs.readFileSync(reviews,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse))seen.add(review.articleId);
 let lastDispatch=previousBudget?.lastDispatch??0;
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 for(const row of rows){
  if(completed>=maximum||Math.max(used,reserved)+6500>budget)break;if(seen.has(row.id))continue;
  const scope=voiceAnnotationInput(row.text,row.topicId),ids=scope.sentences.map(unit=>unit.sentenceId),issues=Object.keys(scope.issues);
  // Compact symbols mapped at the boundary; no duplicated original quotations.
  const label=z.object({issue:z.enum([...issues,'none','unknown']),direction:z.enum(['+','-','0','?']),speaker:z.enum(['J','S','M','?'])}).strict();
  const schema=z.object({labels:z.object(Object.fromEntries(ids.map(id=>[id,label]))).strict()}).strict();
  // One reserved request per minute. Failed or cancelled calls retain their
  // reservation; restarting this script must not reset the annotation budget.
  const wait=Math.max(0,60000-(Date.now()-lastDispatch));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  lastDispatch=Date.now();
  const persistBudget=()=>fs.writeFileSync(ledger,JSON.stringify({day,used,reserved,lastDispatch,lastArticleId:row.id}));
  const dispatch=config.onDispatch;
  config.onDispatch=()=>{dispatch();persistBudget();};
  let result;
  try{
  result=await structured(config,schema,VOICE_INSTRUCTIONS+' labels는 문장ID를 키로 하는 객체다. 각 값은 issue, direction(+/-/0/?), speaker(J/S/M/?)다. 기자 J, 취재원 S, 혼합 M, 불명확 ?다.',
    {voiceInput:scope},AbortSignal.timeout(90000));
  }catch(error){fs.appendFileSync(reviews,JSON.stringify({articleId:row.id,status:'needs_review',reason:'request_or_schema_failure',createdAt:new Date().toISOString()})+'\n');throw error;}
  finally{config.onDispatch=dispatch;persistBudget();}
  const labels=Object.entries(result.labels).map(([sentenceId,{issue,direction,speaker}])=>({sentenceId,issue,
    direction:({'+':'support','-':'oppose','0':'neutral','?':'uncertain'})[direction],
    speaker:({J:'journalist',S:'source',M:'mixed','?':'unknown'})[speaker]}));
  const record={articleId:row.id,articleHash:await voiceArticleHash(row.text),topic:row.topicId,version:VOICE_VERSION,
    segmenter:scope.segmenter,scopeCharacters:scope.scopeCharacters,labels,
    annotator:{kind:'ai',model:NVIDIA_FAST_MODEL,version:VOICE_VERSION},createdAt:new Date().toISOString()};
  const validated=validateVoiceDocument(row.text,{...record,method:'ai',modelVersion:NVIDIA_FAST_MODEL});
  if(!validated){fs.appendFileSync(reviews,JSON.stringify({...record,status:'needs_review',reason:'invalid_document'})+'\n');throw Error('Invalid voice document');}
  // Preserve raw labels; semantic conflicts are downgraded to unresolved, never
  // repaired to a confident class. The trainer excludes these unresolved rows.
  record.rawLabels=labels;record.labels=validated.labels;
  fs.appendFileSync(destination,JSON.stringify(record)+'\n');completed++;
  console.log(JSON.stringify({completed,sentences:labels.length,reportedTokens:usageReports?used:null,reservedTokens:reserved}));
 }
 console.log(JSON.stringify({completed,reportedTokens:usageReports?used:null,reservedTokens:reserved,stopped:completed>=maximum?'article_limit':'budget_or_corpus_limit'}));
}finally{await server.close();}
