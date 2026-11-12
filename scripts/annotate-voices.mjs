// Explicit, bounded offline AI annotation. Sequential, no retries or provider fallback.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
const [input,output,maxText='0',budgetText='0']=process.argv.slice(2),maximum=Number(maxText),budget=Number(budgetText);
const root=process.cwd(),destination=path.resolve(output??'.'),local=path.resolve(root,'.sites-runtime')+path.sep;
if(!input||!output||!destination.startsWith(local)||!Number.isInteger(maximum)||maximum<1||!Number.isFinite(budget)||budget<6500||budget>120000)
 throw Error('Usage: input local-output maximumArticles tokenBudget(6500..120000)');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',resolve:{alias:{'@':root}}});
let used=0,reserved=0,completed=0;
try{
 const {z}=await import('zod/v4');
 const {structured}=await server.ssrLoadModule('/lib/server/language.ts');
 const {VOICE_INSTRUCTIONS,voiceAnnotationInput,voiceArticleHash,VOICE_VERSION}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {NVIDIA_FAST_MODEL}=await server.ssrLoadModule('/lib/server/config.ts');
 const config={...process.env,AI_PROVIDER:'nvidia',NVIDIA_MODEL:NVIDIA_FAST_MODEL,
  onUsage:tokens=>{used+=tokens;},onDispatch:()=>{if(Math.max(used,reserved)+6500>budget)throw Error('Annotation token reserve exhausted');reserved=Math.max(used,reserved)+6500;}};
 const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const previous=fs.existsSync(destination)?fs.readFileSync(destination,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
 const seen=new Set(previous.map(row=>row.articleId));
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 for(const row of rows){
  if(completed>=maximum||Math.max(used,reserved)+6500>budget)break;if(seen.has(row.id))continue;
  const scope=voiceAnnotationInput(row.text,row.topicId),ids=scope.sentences.map(unit=>unit.sentenceId),issues=Object.keys(scope.issues);
  // Compact symbols mapped at the boundary; no duplicated original quotations.
  const schema=z.object({labels:z.array(z.tuple([z.enum(ids),z.enum([...issues,'none','unknown']),z.enum(['+','-','0','?']),z.enum(['J','S','M','?'])])).length(ids.length)}).strict();
  const result=await structured(config,schema,VOICE_INSTRUCTIONS+' labels 출력은 [문장ID,issue,방향(+/-/0/?),화자(J/S/M/?)] 배열이다. 기자 J, 취재원 S, 혼합 M, 불명확 ?다.',
    {voiceInput:scope},AbortSignal.timeout(90000));
  if(new Set(result.labels.map(item=>item[0])).size!==ids.length)throw Error('Duplicate or missing sentence labels');
  const labels=result.labels.map(([sentenceId,issue,direction,speaker])=>({sentenceId,issue,
    direction:({'+':'support','-':'oppose','0':'neutral','?':'uncertain'})[direction],
    speaker:({J:'journalist',S:'source',M:'mixed','?':'unknown'})[speaker]}));
  const record={articleId:row.id,articleHash:await voiceArticleHash(row.text),topic:row.topicId,version:VOICE_VERSION,
    segmenter:scope.segmenter,scopeCharacters:scope.scopeCharacters,labels,
    annotator:{kind:'ai',model:NVIDIA_FAST_MODEL,version:VOICE_VERSION},createdAt:new Date().toISOString()};
  fs.appendFileSync(destination,JSON.stringify(record)+'\n');completed++;
  console.log(JSON.stringify({completed,sentences:labels.length,tokens:used}));
 }
 console.log(JSON.stringify({completed,tokens:used,stopped:completed>=maximum?'article_limit':'budget_or_corpus_limit'}));
}finally{await server.close();}
