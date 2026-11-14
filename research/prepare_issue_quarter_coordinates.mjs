/** Offline issue/quarter preparation with retained vectors. This file never calls a provider. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
const MODEL='nvidia/nemotron-3.5-embed-1b';
const OPTIONS={model:MODEL,input_type:'passage',encoding_format:'float',truncate:'NONE',dimensions:2048};
const args=process.argv.slice(2),options={cacheInputs:[],cacheVectors:[]};
for(let at=0;at<args.length;at++){
  const flag=args[at];
  if(flag==='--inventory-only'){options.inventoryOnly=true;continue;}
  if(!['--corpus','--candidate','--split-manifest','--output','--ledger','--cache-input','--cache-vectors'].includes(flag)||!args[at+1])
    throw Error('Use --corpus PATH --candidate PATH --output NEW_RUNTIME_DIRECTORY [--split-manifest PATH] [--ledger PATH] [--cache-input PATH --cache-vectors PATH] [--inventory-only]');
  const value=args[++at];
  if(flag==='--cache-input')options.cacheInputs.push(value);
  else if(flag==='--cache-vectors')options.cacheVectors.push(value);
  else options[flag.slice(2)]=value;
}
function local(value){
  if(typeof value!=='string'||!value)throw Error('A local runtime path is required');
  const target=path.resolve(value);
  if(!target.startsWith(runtime+path.sep))throw Error('Research files must stay beneath .sites-runtime');
  let existing=target;while(!fs.existsSync(existing))existing=path.dirname(existing);
  const real=fs.realpathSync(existing);
  if(real!==runtime&&!real.startsWith(runtime+path.sep))throw Error('Research path resolves outside .sites-runtime');
  return target;
}
const load=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(canonical(value));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});
const validVector=value=>Array.isArray(value)&&value.length===2048&&value.every(Number.isFinite)&&Number.isFinite(Math.hypot(...value))&&Math.hypot(...value)>0;
const corpusPath=local(options.corpus),candidatePath=local(options.candidate),output=local(options.output);
if(fs.existsSync(output))throw Error('Preserve prior coordinate snapshots and select a new output directory');
if(options.cacheInputs.length!==options.cacheVectors.length)throw Error('Every cache input needs its corresponding vector file');
const corpusBytes=fs.readFileSync(corpusPath),candidateBytes=fs.readFileSync(candidatePath);
const corpus=corpusBytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const candidate=JSON.parse(candidateBytes.toString('utf8').replace(/^\uFEFF/,''));
if(candidate.schemaVersion!=='voice-embedding-svm-research-1.0'||candidate.status!=='research'||!candidate.version
  ||candidate.configuration?.embeddingModel!==MODEL||candidate.configuration?.dimensions!==2048||!candidate.heads)
  throw Error('Use the retained research embedding candidate');
if(new Set(corpus.map(article=>article.id)).size!==corpus.length)throw Error('Duplicate corpus article IDs');
const supportedTopics=Object.keys(candidate.topics??{});
// The retained single-topic candidate records its scope in training data, never inferred from publisher identity.
const cacheRecords=new Map(),vectors=new Map(),trainingIds=new Set(),trainingHashes=new Set(),digests=[];
let inferredTopic=null;
for(let at=0;at<options.cacheInputs.length;at++){
  const inputBytes=fs.readFileSync(local(options.cacheInputs[at])),vectorBytes=fs.readFileSync(local(options.cacheVectors[at]));
  const input=JSON.parse(inputBytes.toString('utf8').replace(/^\uFEFF/,'')),stored=JSON.parse(vectorBytes.toString('utf8').replace(/^\uFEFF/,''));
  const {inputDigest,...payload}=input;
  if(input.schemaVersion!=='voice-embedding-input-1.0'||digest(payload)!==inputDigest||canonical(input.embedding)!==canonical(OPTIONS)
    ||stored.schemaVersion!=='voice-embeddings-1.0'||stored.inputDigest!==inputDigest||stored.model!==MODEL||stored.dimensions!==2048)
    throw Error('Cache input, model or digest mismatch');
  if(at===0&&candidate.inputDigest!==inputDigest)throw Error('The first cache must be the candidate training experiment');
  const allowed=new Set(input.records.map(record=>record.key));
  if(allowed.size!==input.records.length)throw Error('Duplicate prepared sentence keys');
  for(const record of input.records){
    if(typeof record.text!=='string'||sha(record.text)!==record.key||!record.sourceIDs?.length)throw Error('Invalid prepared sentence identity');
    const previous=cacheRecords.get(record.key);
    if(previous&&previous.text!==record.text)throw Error('A sentence hash maps to conflicting text');
    cacheRecords.set(record.key,record);
  }
  for(const [key,vector]of Object.entries(stored.vectors??{})){
    if(!allowed.has(key)||!validVector(vector))throw Error('Invalid or unrequested cached vector');
    if(vectors.has(key)&&vectors.get(key).some((value,column)=>Math.abs(value-vector[column])>1e-8))throw Error('Conflicting cached vectors');
    vectors.set(key,vector);
  }
  if(at===0){
    for(const row of input.sets?.train??[])trainingIds.add(row.articleId);
    const topics=new Set((input.pairs??[]).map(pair=>pair.topic));
    if(topics.size===1)inferredTopic=[...topics][0];
  }
  digests.push({inputDigest,inputFileDigest:sha(inputBytes),vectorsDigest:sha(vectorBytes)});
}
if(!supportedTopics.length&&inferredTopic)supportedTopics.push(inferredTopic);
if(!supportedTopics.length)throw Error('Candidate topic scope cannot be established');
const split=options['split-manifest']?load(local(options['split-manifest'])):null;
if(split&&split.schemaVersion!=='voice-split-1.0')throw Error('Unexpected split manifest');
const selectedIds=split?new Set(split.evaluationArticleIds):null;
if(selectedIds&&[...selectedIds].some(id=>!corpus.some(article=>article.id===id)))throw Error('Frozen evaluation article is missing');
for(const id of trainingIds){const hash=split?.articleHashes?.[id];if(hash)trainingHashes.add(hash);}
const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
try{
  const dense=await server.ssrLoadModule('/lib/voice-dense.ts');
  const voice=await server.ssrLoadModule('/lib/sentence-voice.ts');
  const relative=await server.ssrLoadModule('/lib/relative-metrics.ts');
  const compare=await server.ssrLoadModule('/lib/voice-comparison.ts');
  const issues=options.inventoryOnly?null:await server.ssrLoadModule('/lib/voice-article-issue.ts');
  for(const article of corpus)if(trainingIds.has(article.id))trainingHashes.add(await voice.voiceArticleHash(article.text));
  const records=new Map(),rows=[],counts={articles:0,sentences:0,boilerplate:0,cachedSentences:0,missingSentences:0,
    unsupportedTopicArticles:0,issueUnassignedArticles:0,fullyCachedArticles:0,sourceCoordinates:0,journalistCoordinates:0,rangeArticles:0};
  const topicCounts={},articleIssues={},missingByTopic={};
  for(const article of corpus){
    if(selectedIds&&!selectedIds.has(article.id))continue;
    const body=article.text;
    if(typeof body!=='string'||!body.trim())throw Error('Article body is missing');
    const topic=relative.classifyRelativeTopic(body,article.title??'');
    const bodyHash=await voice.voiceArticleHash(body);
    const knownTopic=!!topic&&Object.hasOwn(voice.VOICE_TOPICS,topic);
    const articleIssue=knownTopic&&issues?issues.selectArticleVoiceIssue(body,topic):null;
    const units=voice.voiceSentences(body);
    let cached=0,missing=0,boilerplate=0;
    const labels=units.map(unit=>{
      if(voice.isVoiceBoilerplate(unit.text)){boilerplate++;return {sentenceId:unit.sentenceId,issue:'none',direction:'neutral',speaker:'unknown',excluded:true};}
      const text=dense.denseVoiceInputText(unit.text),key=sha(text),record=cacheRecords.get(key);
      // Fixed outer diagnostics retain the existing exact-text partition guard.
      const value=!selectedIds||record?.partition==='evaluation'?vectors.get(key):null;
      if(value)cached++;
      else{
        missing++;
        if(text){
          const prepared=records.get(key)??{key,text,partition:selectedIds?'evaluation':'corpus',sourceIDs:[]};
          const source={articleId:article.id,sentenceId:unit.sentenceId};
          if(!prepared.sourceIDs.some(item=>item.articleId===source.articleId&&item.sentenceId===source.sentenceId))prepared.sourceIDs.push(source);
          records.set(key,prepared);
        }
      }
      const prediction=value&&knownTopic&&supportedTopics.includes(topic)&&articleIssue?dense.inferDenseVoiceHeads(candidate.heads,value):null;
      const issue=prediction&&articleIssue?issues.relatedVoiceIssue(prediction.margins.issue,articleIssue):'unknown';
      return {sentenceId:unit.sentenceId,issue,direction:prediction?.direction??'uncertain',speaker:prediction?.speaker??'unknown'};
    });
    counts.articles++;counts.sentences+=units.length;counts.boilerplate+=boilerplate;counts.cachedSentences+=cached;counts.missingSentences+=missing;
    if(!missing)counts.fullyCachedArticles++;
    topicCounts[topic??'unknown']=(topicCounts[topic??'unknown']??0)+1;
    missingByTopic[topic??'unknown']=(missingByTopic[topic??'unknown']??0)+missing;
    const supported=knownTopic&&supportedTopics.includes(topic);
    if(!supported)counts.unsupportedTopicArticles++;
    if(!articleIssue)counts.issueUnassignedArticles++;
    articleIssues[`${topic??'unknown'}:${articleIssue??'unassigned'}`]=(articleIssues[`${topic??'unknown'}:${articleIssue??'unassigned'}`]??0)+1;
    let document=null,summary=null,primary=null;
    if(!options.inventoryOnly&&supported&&articleIssue){
      document=voice.validateVoiceDocument(body,{version:voice.VOICE_VERSION,segmenter:'sentence-3.1',scopeCharacters:voice.VOICE_SCOPE,
        topic,method:'svm',modelVersion:candidate.version,decisionPolicy:voice.VOICE_INDEPENDENT_NEUTRAL,
        issuePolicy:voice.VOICE_ARTICLE_ISSUE,articleIssue,labels});
      if(!document)throw Error('The runtime rejected the prepared research document');
      summary=voice.summarizeVoices(body,document);primary=compare.mainVoiceIssue(body,document);
    }
    const axis=(name)=>{
      const part=primary?.[name];
      const evidence=part?.evidence;
      const lower=evidence?.lower,upper=evidence?.upper;
      const eligible=part?.directional>=3&&typeof lower==='number'&&typeof upper==='number'&&upper-lower<=.5+1e-12;
      return {eligible:!!eligible,support:part?.support??0,oppose:part?.oppose??0,directional:part?.directional??0,
        unresolved:evidence?.unresolved??0,coordinate:eligible&&lower===upper?lower:null,
        bounds:eligible?{lower,upper}:null};
    };
    const source=axis('source'),journalist=axis('journalist');
    if(source.eligible)counts.sourceCoordinates++;
    if(journalist.eligible)counts.journalistCoordinates++;
    if(source.eligible&&source.coordinate===null)counts.rangeArticles++;
    rows.push({id:article.id,url:article.url??'',title:article.title??'',publisher:article.publisherId??'',publishedAt:article.publishedAt,
      bodyHash,topic,issue:articleIssue,axis:'source',method:'svm',version:voice.VOICE_VERSION,modelVersion:candidate.version,
      decisionPolicy:voice.VOICE_INDEPENDENT_NEUTRAL,issuePolicy:voice.VOICE_ARTICLE_ISSUE??'voice-article-issue-1.0',
      scopeCharacters:voice.VOICE_SCOPE,segmenter:'sentence-3.1',researchOnly:true,trainingOriginal:trainingIds.has(article.id)||trainingHashes.has(bodyHash),
      coordinate:source.coordinate,bounds:source.bounds,directional:source.directional,unresolved:source.unresolved,
      eligible:source.eligible,source,journalist,cache:{cached,missing,boilerplate},
      status:!supported?'unsupported_topic':!articleIssue?'issue_unassigned':source.eligible?'coordinate_available':'evidence_insufficient'});
  }
  const pending=[...records.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const batches=[];let batch=[];
  const bytes=items=>Buffer.byteLength(JSON.stringify({...OPTIONS,input:items.map(item=>item.text)}),'utf8');
  for(const record of pending){
    if(batch.length&&(batch.length>=32||bytes([...batch,record])>6000)){batches.push(batch);batch=[];}
    batch.push(record);if(bytes(batch)>6000)throw Error('One sentence exceeds the existing 6000-byte embedding request ceiling');
  }
  if(batch.length)batches.push(batch);
  const ledgerPath=options.ledger?local(options.ledger):path.join(runtime,'svm-improvement-20261114','embedding-day-budget.local.json');
  const ledger=fs.existsSync(ledgerPath)?load(ledgerPath):null;
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const reserved=ledger?.days?.[day]?.reservedTokens??0,budget=ledger?.maximumDailyBudget??117000;
  const summary={schemaVersion:'issue-quarter-coordinate-preparation-1.0',generatedAt:new Date().toISOString(),researchOnly:true,
    modelVersion:candidate.version,embeddingModel:MODEL,supportedTopics,scopeCharacters:voice.VOICE_SCOPE,segmenter:'sentence-3.1',decisionPolicy:voice.VOICE_INDEPENDENT_NEUTRAL,
    issuePolicy:voice.VOICE_ARTICLE_ISSUE??'voice-article-issue-1.0',axis:'source',inventoryOnly:!!options.inventoryOnly,
    counts,topicCounts,articleIssues,missingByTopic,uniquePendingSentences:pending.length,apiCalls:0,
    budget:{day,dailyReservationLimit:budget,alreadyReserved:reserved,remainingReservation:Math.max(0,budget-reserved),
      reservationPerCall:6500,plannedCalls:batches.length,requiredReservation:batches.length*6500,
      availableCallsToday:Math.floor(Math.max(0,budget-reserved)/6500),fullBudgetDaysRequired:Math.ceil(batches.length/Math.floor(budget/6500))},
    sourceDigests:{corpus:sha(corpusBytes),candidate:sha(candidateBytes),articleIssueRules:options.inventoryOnly?null:sha(fs.readFileSync(path.join(root,'lib/data/voice-article-issue-rules.json'))),caches:digests},
    meaning:'Retained actual article inference using a research candidate and cached vectors. Missing vectors and unsupported topic models stay unresolved. No API request or release approval.'};
  const prepared={schemaVersion:'voice-embedding-input-1.0',embedding:OPTIONS,records:pending,sets:{corpus:[]},pairs:[],
    preparation:{articles:counts.articles,uniqueTexts:pending.length,plannedCalls:batches.length,reservedTokensRequired:batches.length*6500,
      dailyBudget:budget,callsPerFullBudgetDay:Math.floor(budget/6500)},humanEvaluationCount:0,sourceDigests:summary.sourceDigests};
  prepared.inputDigest=digest(prepared);
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'candidate.snapshot.local.json'),candidateBytes,{flag:'wx'});
  if(ledger)write(path.join(output,'embedding-ledger.snapshot.local.json'),ledger);
  write(path.join(output,'summary.local.json'),summary);
  write(path.join(output,'pending-embedding-input.local.json'),prepared);
  fs.writeFileSync(path.join(output,'coordinates.local.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{encoding:'utf8',flag:'wx'});
  console.log(JSON.stringify(summary));
}finally{await server.close();}
