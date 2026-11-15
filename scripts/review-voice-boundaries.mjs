/** Bounded NVIDIA drafts for changed/boundary sentence IDs. Existing labels stay intact. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
const parameters=process.argv.slice(2),options={};
for(let index=0;index<parameters.length;index++){
  const flag=parameters[index];
  if(flag==='--run'){options.run=true;continue;}
  if(flag==='--retry-unknown'){options.retryUnknown=true;continue;}
  if(!['--queue','--corpus','--output','--max-articles','--ledger'].includes(flag)||!parameters[index+1])
    throw Error('Use --queue PATH --corpus PATH --output NEW_DRAFT_JSONL --max-articles 1..5 [--run] [--retry-unknown]');
  options[flag.slice(2)]=parameters[++index];
}
function local(value){
  if(typeof value!=='string'||!value)throw Error('A local runtime path is required');
  const target=path.resolve(value);
  if(!target.startsWith(runtime+path.sep))throw Error('Review files must stay beneath .sites-runtime');
  let existing=target;while(!fs.existsSync(existing))existing=path.dirname(existing);
  const actual=fs.realpathSync(existing);
  if(actual!==runtime&&!actual.startsWith(runtime+path.sep))throw Error('Review path resolves outside .sites-runtime');
  return target;
}
const maximum=Number(options['max-articles']);
if(!Number.isSafeInteger(maximum)||maximum<1||maximum>5)throw Error('Specify max-articles from 1 through 5 for this review run');
const queuePath=local(options.queue),corpusPath=local(options.corpus),outputPath=local(options.output);
const ledgerPath=local(options.ledger??path.join(runtime,'svm-improvement-20261114','embedding-day-budget.local.json'));
const statePath=outputPath+'.state.json';
if(new Set([queuePath,corpusPath,outputPath,ledgerPath,statePath]).size!==5)throw Error('Inputs, drafts and accounting files must differ');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const readRows=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
function atomic(file,text){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+process.pid;
  fs.writeFileSync(temporary,text,{encoding:'utf8',mode:0o600});fs.renameSync(temporary,file);
}
const json=(file,value)=>atomic(file,JSON.stringify(value)+'\n');
const queueBytes=fs.readFileSync(queuePath),corpusBytes=fs.readFileSync(corpusPath);
const queue=read(queuePath),queueDigest=sha(queueBytes),corpusDigest=sha(corpusBytes);
if(queue.schemaVersion!=='voice-targeted-review-1.0'||queue.researchOnly!==true||!Array.isArray(queue.requests)
  ||queue.sourceDigests?.corpus!==corpusDigest)throw Error('Review queue and exact corpus provenance must match');
const corpus=readRows(corpusPath),articles=new Map(corpus.map(article=>[article.id,article]));
if(articles.size!==corpus.length||new Set(queue.requests.map(item=>item.articleId)).size!==queue.requests.length)throw Error('Duplicate article identities');
const definitions=read(path.join(root,'lib/data/voice-issues.json'));
function scopedBodyHash(text){
  let end=Math.min(text.length,2000);
  if(end>0&&end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
  // Same Unicode whitespace normalization as normalizeBiasText. The live path
  // additionally rechecks with voiceArticleHash before a provider dispatch.
  const normalized=text.slice(0,end).replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu,' ').replace(/^ +| +$/g,'');
  return sha(Buffer.from(normalized,'utf8'));
}
function validDraftLabels(labels,topic){
  const issues=Object.keys(definitions.topics[topic].issues);
  return Array.isArray(labels)&&labels.every(label=>label&&typeof label==='object'&&typeof label.sentenceId==='string'
    &&[...issues,'none','unknown'].includes(label.issue)&&['support','oppose','neutral','uncertain'].includes(label.direction)
    &&['journalist','source','mixed','unknown'].includes(label.speaker));
}
let server;
const acquired=[];
try{
  const prepared=[];
  for(const item of queue.requests){
    const article=articles.get(item.articleId);
    if(!article||!Object.hasOwn(definitions.topics,item.topic)||article.topicId!==item.topic||scopedBodyHash(article.text)!==item.articleHash)
      throw Error('Review article body hash or topic mismatch');
    const units=article.sentences;
    if(!Array.isArray(units)||units.some(unit=>article.text.slice(unit.start,unit.end)!==unit.text))throw Error('Stored sentence spans differ from the article body');
    const byId=new Map(units.map(unit=>[unit.sentenceId,unit]));
    if(!Array.isArray(item.sentences)||!item.sentences.length||new Set(item.sentences.map(unit=>unit.sentenceId)).size!==item.sentences.length)
      throw Error('Review target IDs are missing or duplicated');
    for(const sentence of item.sentences){
      if(byId.get(sentence.sentenceId)?.text!==sentence.text)throw Error('Review target differs from the retained original sentence');
    }
    prepared.push({item,article,units});
  }
  const targets=new Map(prepared.map(record=>[record.item.articleId,record]));
  const previous=fs.existsSync(outputPath)?readRows(outputPath):[];
  const seen=new Set();
  for(const record of previous){
    const source=targets.get(record.articleId);
    if(!source||seen.has(record.articleId)||record.queueDigest!==queueDigest||record.corpusDigest!==corpusDigest
      ||record.articleHash!==source.item.articleHash||record.status!=='draft'||record.draftOnly!==true
      ||record.annotator?.kind!=='ai'||typeof record.annotator?.model!=='string'||record.annotator?.version!=='voice-boundary-review-1.0'
      ||!validDraftLabels(record.labels,source.item.topic)
      ||JSON.stringify(record.labels.map(label=>label.sentenceId))!==JSON.stringify(source.item.sentences.map(unit=>unit.sentenceId))
      ||JSON.stringify(record.targetSentenceIds)!==JSON.stringify(source.item.sentences.map(unit=>unit.sentenceId)))
      throw Error('Resume draft identity does not match this queue');
    seen.add(record.articleId);
  }
  const selected=prepared.filter(record=>!seen.has(record.item.articleId)).slice(0,maximum);
  console.log(JSON.stringify({mode:options.run?'run':'dry-run',queuedArticles:prepared.length,completedArticles:previous.length,
    selectedArticles:selected.length,targetSentences:selected.reduce((sum,record)=>sum+record.item.sentences.length,0),
    minimumDispatchIntervalMs:20000,dailyBudget:null,draftOnly:true,humanEvaluationCount:0}));
  if(!options.run||!selected.length)process.exitCode=0;
  else{
    for(const file of [outputPath+'.lock',ledgerPath+'.lock']){
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const descriptor=fs.openSync(file,'wx',0o600);acquired.push({file,descriptor});
      fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),operation:'voice_boundary_review'}));
    }
    server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
    const voice=await server.ssrLoadModule('/lib/sentence-voice.ts');
    const {NVIDIA_FAST_MODEL}=await server.ssrLoadModule('/lib/server/config.ts');
    if(previous.some(record=>record.annotator.model!==NVIDIA_FAST_MODEL))throw Error('Resume drafts use a different NVIDIA model');
    for(const {item,article,units}of selected){
      const current=voice.voiceSentences(article.text);
      if(await voice.voiceArticleHash(article.text)!==item.articleHash||current.length!==units.length
        ||current.some((unit,index)=>['sentenceId','start','end','text'].some(key=>unit[key]!==units[index][key])))
        throw Error('Current sentence rules or article hash differ from the queued scope');
    }
    const {z}=await import('zod/v4');
    const {structured}=await server.ssrLoadModule('/lib/server/language.ts');
    const state=fs.existsSync(statePath)?read(statePath):{schemaVersion:'voice-boundary-review-run-1.0',queueDigest,corpusDigest,model:NVIDIA_FAST_MODEL,requests:[]};
    if(state.schemaVersion!=='voice-boundary-review-run-1.0'||state.queueDigest!==queueDigest||state.corpusDigest!==corpusDigest
      ||state.model!==NVIDIA_FAST_MODEL||!Array.isArray(state.requests))throw Error('Resume review journal belongs to another run');
    const completed=new Map(previous.map(record=>[record.attemptId,record]));
    for(const request of state.requests)if(completed.has(request.id))request.status='completed';
    const pendingIds=new Set(selected.map(record=>record.item.articleId));
    const unresolved=state.requests.filter(request=>['reserved','failed_or_unknown'].includes(request.status)&&pendingIds.has(request.articleId));
    if(unresolved.length&&!options.retryUnknown)throw Error('An earlier review request may have reached NVIDIA; inspect the journal and use --retry-unknown for an intentional resume');
    const ledger=fs.existsSync(ledgerPath)?read(ledgerPath):{schemaVersion:'voice-embedding-budget-1.0',model:'nvidia/nemotron-3.5-embed-1b',maximumDailyBudget:117000,lastDispatchAt:0,days:{}};
    if(ledger.schemaVersion!=='voice-embedding-budget-1.0'||!Number.isFinite(ledger.lastDispatchAt))throw Error('Invalid shared NVIDIA dispatch journal');
    const instructions=voice.VOICE_INSTRUCTIONS+' 검토 순서는 명제의 대상·행위 일치 → 실제 평가·요구·찬반 표현 → 그 표현의 발화자다. 단순 정책 발표·시행·수치 증감은 정책 찬성이 아니다. 지역별 요금 차등은 누진제 강화와 다르고, 주식 평가액 증가는 소득대체율 인상과 다르다. 직접·간접 인용을 전달하는 기자 문장에서도 인용 목소리는 source다. targetSentenceIds에 있는 문장만 labels에 정확히 한 번 답한다. labels 값은 issue, direction(+/-/0/?), speaker(J/S/M/?) 기호이며 원문을 반복하지 않는다. 기존 라벨은 정답으로 가정하지 않는다.';
    let count=0;
    for(const {item,article,units}of selected){
      const targetSentenceIds=item.sentences.map(sentence=>sentence.sentenceId);
      const label=z.object({issue:z.enum([...Object.keys(voice.VOICE_TOPICS[item.topic].issues),'none','unknown']),
        direction:z.enum(['+','-','0','?']),speaker:z.enum(['J','S','M','?'])}).strict();
      const schema=z.object({labels:z.object(Object.fromEntries(targetSentenceIds.map(id=>[id,label]))).strict()}).strict();
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.max(ledger.lastDispatchAt+20000,ledger.retryAfterAt??0)-Date.now())));
      const attempt={id:randomUUID(),articleId:item.articleId,articleHash:item.articleHash,targetSentenceIds,status:'reserved',
        at:new Date().toISOString(),usage:null,...(unresolved.length?{retryOf:unresolved.filter(record=>record.articleId===item.articleId).map(record=>record.id)}:{})};
      const config={...process.env,AI_PROVIDER:'nvidia',NVIDIA_MODEL:NVIDIA_FAST_MODEL,onDispatch:()=>{
        state.requests.push(attempt);json(statePath,state);
        ledger.lastDispatchAt=Date.now();ledger.lastReviewDispatchAt=ledger.lastDispatchAt;json(ledgerPath,ledger);
      },onUsage:tokens=>{attempt.usage=(attempt.usage??0)+tokens;},onRateLimit:async seconds=>{
        ledger.retryAfterAt=Date.now()+Math.max(60000,Math.min(86400000,seconds*1000));json(ledgerPath,ledger);
      }};
      try{
        const response=await structured(config,schema,instructions,{voiceInput:{topic:item.topic,issues:voice.VOICE_TOPICS[item.topic].issues,sentences:units},targetSentenceIds},AbortSignal.timeout(600000));
        const rawLabels=targetSentenceIds.map(sentenceId=>{const value=response.labels[sentenceId];return {sentenceId,issue:value.issue,
          direction:({'+':'support','-':'oppose','0':'neutral','?':'uncertain'})[value.direction],speaker:({J:'journalist',S:'source',M:'mixed','?':'unknown'})[value.speaker]};});
        const validated=voice.validateVoiceDocument(article.text,{version:voice.VOICE_VERSION,segmenter:'sentence-3.1',scopeCharacters:2000,
          method:'ai',modelVersion:NVIDIA_FAST_MODEL,topic:item.topic,decisionPolicy:voice.VOICE_INDEPENDENT_NEUTRAL,labels:rawLabels});
        if(!validated)throw Error('Invalid boundary review document');
        const selectedIds=new Set(targetSentenceIds),labels=validated.labels.filter(value=>selectedIds.has(value.sentenceId));
        if(labels.length!==targetSentenceIds.length)throw Error('Boundary review target coverage changed');
        previous.push({schemaVersion:'voice-boundary-draft-1.0',status:'draft',draftOnly:true,articleId:item.articleId,articleHash:item.articleHash,
          queueDigest,corpusDigest,topic:item.topic,targetSentenceIds,labels,rawLabels,originalLabels:item.sentences.map(value=>({sentenceId:value.sentenceId,
            rawLabel:value.rawLabel,...(value.reviewedLabel?{reviewedLabel:value.reviewedLabel}:{})})),
          annotator:{kind:'ai',model:NVIDIA_FAST_MODEL,version:'voice-boundary-review-1.0'},humanEvaluationCount:0,attemptId:attempt.id,createdAt:new Date().toISOString()});
        atomic(outputPath,previous.map(JSON.stringify).join('\n')+'\n');
        attempt.status='completed';json(statePath,state);count++;
        console.log(JSON.stringify({status:'draft_completed',completedArticles:count,targetSentences:labels.length,draftOnly:true,humanEvaluationCount:0}));
      }catch(error){
        attempt.status='failed_or_unknown';json(statePath,state);
        const code=typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'REQUEST_FAILED';
        throw Error('NVIDIA boundary review stopped without retry; checkpoint retained ('+code+')');
      }
    }
  }
}finally{
  for(const {file,descriptor}of acquired.reverse()){fs.closeSync(descriptor);fs.unlinkSync(file);}
  await server?.close();
}
