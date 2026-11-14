// Actual heldout article coverage, using retained vectors only. No API/release.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
function local(value){
 const target=path.resolve(value);if(!target.startsWith(runtime+path.sep))throw Error('Use runtime paths');
 let parent=target;while(!fs.existsSync(parent))parent=path.dirname(parent);
 const real=fs.realpathSync(parent);if(real!==runtime&&!real.startsWith(runtime+path.sep))throw Error('Runtime path escaped');
 return target;
}
const independent=process.argv.includes('--neutral-independent');
if(independent)process.argv.splice(process.argv.indexOf('--neutral-independent'),1);
if(![7,9].includes(process.argv.length))throw Error('Use CORPUS PREPARED VECTORS CANDIDATE OUTPUT [SUPPLEMENT_INPUT SUPPLEMENT_VECTORS] [--neutral-independent]');
const [corpusPath,inputPath,vectorsPath,candidatePath,outputPath,supplementPath,supplementVectorsPath]=process.argv.slice(2).map(local);
if(new Set(process.argv.slice(2).map(local)).size!==process.argv.length-2||fs.existsSync(outputPath))throw Error('Preserve inputs/reports');
const parse=text=>JSON.parse(text.replace(/^\uFEFF/,'')),load=file=>parse(fs.readFileSync(file,'utf8'));
const corpus=fs.readFileSync(corpusPath,'utf8').trim().split(/\r?\n/).map(parse);
const prepared=load(inputPath),vectors=load(vectorsPath),candidate=load(candidatePath);
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 return JSON.stringify(value);
}
function verifyInput(input){
 const {inputDigest,...payload}=input;
 if(createHash('sha256').update(canonical(payload)).digest('hex')!==inputDigest)throw Error('Prepared input digest mismatch');
 if(!Array.isArray(input.records)||new Set(input.records.map(row=>row.key)).size!==input.records.length)throw Error('Invalid sentence records');
 for(const row of input.records)if(typeof row.text!=='string'||!row.text.trim()||createHash('sha256').update(row.text).digest('hex')!==row.key
  ||!Array.isArray(row.sourceIDs)||!row.sourceIDs.length)throw Error('Invalid sentence identity');
}
verifyInput(prepared);
if(candidate.status!=='research'||candidate.inputDigest!==prepared.inputDigest||vectors.inputDigest!==prepared.inputDigest)throw Error('Experiment mismatch');
const heldout=new Set(prepared.sets.evaluation.map(row=>row.articleId));
const records=new Map(prepared.records.map(row=>[row.key,row]));
const supplement=supplementPath?load(supplementPath):null,supplementVectors=supplementVectorsPath?load(supplementVectorsPath):null;
if(supplement){
 verifyInput(supplement);
 if(supplement.schemaVersion!=='voice-embedding-input-1.0'||supplementVectors.inputDigest!==supplement.inputDigest||supplementVectors.model!==vectors.model||supplementVectors.dimensions!==2048)throw Error('Supplement mismatch');
 for(const row of supplement.records){
  if(records.has(row.key)||row.partition!=='evaluation'||!row.sourceIDs.every(source=>heldout.has(source.articleId)))throw Error('Supplement may only fill missing heldout sentences');
  records.set(row.key,row);
 }
}
const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
try{
 const {inferDenseVoiceHeads,denseVoiceInputText}=await server.ssrLoadModule('/lib/voice-dense.ts');
 const {voiceSentences,validateVoiceDocument,summarizeVoices,isVoiceBoilerplate,VOICE_VERSION,VOICE_INDEPENDENT_NEUTRAL}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {mainVoiceIssue}=await server.ssrLoadModule('/lib/voice-comparison.ts');
 const articles=[];
 for(const article of corpus.filter(row=>heldout.has(row.id))){
  let cached=0,missing=0;const missingReasons={emptyInput:0,partitionOverlap:0,absentVector:0};
  const labels=voiceSentences(article.text).map(unit=>{
   if(isVoiceBoilerplate(unit.text))return {sentenceId:unit.sentenceId,issue:'none',direction:'neutral',speaker:'unknown',excluded:true};
   const text=denseVoiceInputText(unit.text),key=createHash('sha256').update(text).digest('hex');
   const record=records.get(key);
   // The same exact text can occur at two sentence IDs. Reusing its encoder
   // vector does not transfer the other sentence's teacher label.
   const allowed=record?.partition==='evaluation';
   const value=allowed?(vectors.vectors[key]??supplementVectors?.vectors[key]):null;
   if(value)cached++;else{missing++;missingReasons[!text?'emptyInput':record&&!allowed?'partitionOverlap':'absentVector']++;}
   const result=value?inferDenseVoiceHeads(candidate.heads,value):null;
   return {sentenceId:unit.sentenceId,issue:result?.issue??'unknown',direction:result?.direction??'uncertain',speaker:result?.speaker??'unknown'};
  });
  const document=validateVoiceDocument(article.text,{version:VOICE_VERSION,segmenter:'sentence-3.1',scopeCharacters:2000,topic:'nuclear_energy',method:'svm',modelVersion:candidate.version,labels,
   ...(independent?{decisionPolicy:VOICE_INDEPENDENT_NEUTRAL}:{})});
  if(!document)throw Error('Invalid heldout document');
  const summary=summarizeVoices(article.text,document),primary=mainVoiceIssue(article.text,document);
  articles.push({articleId:article.id,total:summary.total,contentTotal:summary.contentTotal,excluded:summary.excluded,cached,missing,missingReasons,
   unresolved:summary.unresolved,uncertainty:summary.uncertainty,primaryIssue:primary?.issue??null,primaryCoordinate:primary?.coordinate??null,
   issues:summary.issues.map(issue=>({issue:issue.issue,directional:issue.directional,unresolved:issue.unresolved,coordinate:issue.coordinate,evidence:issue.evidence})),
   meaning:missing?'Missing vectors treated as unresolved; not full article inference.':'All non-boilerplate sentence vectors available.'});
 }
 const summary={candidateVersion:candidate.version,decisionPolicy:independent?VOICE_INDEPENDENT_NEUTRAL:'voice-joint-1.0',researchOnly:true,evaluationArticles:articles.length,fullyCachedArticles:articles.filter(row=>row.missing===0).length,
  unresolvedFreeArticles:articles.filter(row=>row.unresolved===0).length,primaryCoordinateAvailable:articles.filter(row=>row.primaryCoordinate!==null).length,
  totalMissingVectors:articles.reduce((sum,row)=>sum+row.missing,0),apiCalls:0,
  articlesWithObservedIssueCoordinate:articles.filter(row=>row.issues.some(issue=>issue.coordinate!==null)).length,
  meaning:'Actual heldout article aggregation with existing gates. A coordinate alone does not establish a same-event baseline or final bias score.'};
 fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify({summary,articles},null,2)+'\n');
 console.log(JSON.stringify({summary,articles}));
}finally{await server.close();}
