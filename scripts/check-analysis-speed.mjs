// Bounded live QA. Run explicitly against a loopback development server only.
// The report contains timings and hashes, while selected URLs stay local.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const runtime=fs.realpathSync(path.join(root,'.sites-runtime'));
const origin=new URL(process.argv[2]??'http://127.0.0.1:5194');
if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.username||origin.password)
  throw Error('Use a loopback HTTP server without URL credentials');
if(process.argv.length>4)throw Error('Use node scripts/check-analysis-speed.mjs [LOCAL_ORIGIN] [NEW_LOCAL_REPORT]');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const reportPath=local(process.argv[3]??path.join(runtime,'speed-20261115',`analysis-speed-${stamp}.local.json`));
if(fs.existsSync(reportPath))throw Error('Preserve previous measurements and choose a new report path');
const privateInputPath=reportPath.replace(/\.json$/,'')+'.inputs.local.json';
const timingLog=process.env.ANALYSIS_SPEED_SERVER_LOG?local(process.env.ANALYSIS_SPEED_SERVER_LOG):null;
if(privateInputPath===reportPath||fs.existsSync(privateInputPath))throw Error('A separate new input manifest path is required');
const sourcePath=path.join(runtime,'collection-1000-20261105','articles-reviewed-3000.local.jsonl');
const publishers=['dailian.co.kr','newdaily.co.kr','ohmynews.com','pressian.com'];
const source=fs.readFileSync(sourcePath,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const seen=new Set();
const rows=source.flatMap(article=>{
  if(!publishers.includes(article.publisherId))return [];
  try{
    const url=new URL(article.finalUrl||article.canonicalUrl||article.url);
    const host=url.hostname.replace(/^www\./,'');
    if(url.protocol!=='https:'||url.username||url.password||host!==article.publisherId&&!host.endsWith('.'+article.publisherId))return [];
    url.hash='';if(seen.has(url.href))return [];seen.add(url.href);
    return [{publisher:article.publisherId,url:url.href,publishedAt:article.publishedAt??'',articleHash:sha(url.href)}];
  }catch{return [];}
}).sort((left,right)=>(Date.parse(right.publishedAt)||0)-(Date.parse(left.publishedAt)||0)||left.articleHash.localeCompare(right.articleHash));
const selected=publishers.flatMap(publisher=>rows.find(article=>article.publisher===publisher)??[]);
const extra=rows.find(article=>!selected.some(existing=>existing.url===article.url));
if(extra)selected.push(extra);
if(selected.length!==5)throw Error('The retained corpus must provide five distinct actual article URLs from four publishers');
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
fs.writeFileSync(privateInputPath,JSON.stringify({origin:origin.origin,selected},null,2)+'\n',{flag:'wx',mode:0o600});
const report={schemaVersion:'analysis-speed-measurement-1.0',startedAt:new Date().toISOString(),originKind:'loopback',
  actualRetainedArticles:true,maximumAnalysisRequests:10,requestedArticleCount:5,
  measurements:[],stoppedReason:null,
  scope:'Five actual retained URL articles, each first and cache request. No synthetic article text. Missing SVM results remain unavailable.'};
const blockedHosts=new Set();
for(const [index,article] of selected.entries()){
  const publisher=article.publisher;
  if(blockedHosts.has(publisher)){
    report.measurements.push({articleHash:article.articleHash,publisher,status:'skipped',reason:'publisher_unavailable_in_this_run'});
    persist();continue;
  }
  for(const phase of ['first','cache']){
    const measurement=await measure(article,index,phase);
    if(timingLog)attachTimings(measurement);
    report.measurements.push(measurement);persist();
    console.log(JSON.stringify(measurement));
    if(measurement.errorCode==='RATE_LIMITED'||measurement.httpStatus===429){
      blockedHosts.add(publisher);report.stoppedReason='rate_limited';break;
    }
    if(measurement.httpStatus===403||['ARTICLE_BODY_UNAVAILABLE','ARTICLE_URL_NOT_ALLOWED'].includes(measurement.errorCode)){
      blockedHosts.add(publisher);break;
    }
    if(measurement.status!=='completed')break;
  }
  if(report.stoppedReason)break;
}
report.completedAt=new Date().toISOString();
report.completedArticleCount=new Set(report.measurements.filter(row=>row.status==='completed').map(row=>row.articleHash)).size;
report.completedCacheCount=report.measurements.filter(row=>row.phase==='cache'&&row.status==='completed'&&row.cache==='hit').length;
persist();
console.log(JSON.stringify({status:'recorded',completedArticleCount:report.completedArticleCount,completedCacheCount:report.completedCacheCount,stoppedReason:report.stoppedReason,report:path.relative(root,reportPath)}));

function local(value){
  const resolved=path.resolve(value);
  if(!resolved.startsWith(runtime+path.sep))throw Error('Measurement reports must stay in project .sites-runtime');
  let ancestor=resolved;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const real=fs.realpathSync(ancestor);
  if(real!==runtime&&!real.startsWith(runtime+path.sep))throw Error('Report destination resolves outside project .sites-runtime');
  return resolved;
}
function sha(value){return createHash('sha256').update(value).digest('hex');}
function attachTimings(metric){
 const entries=fs.readFileSync(timingLog,'utf8').split(/\r?\n/).filter(line=>line.startsWith('{')).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}})
  .filter(event=>event.type==='article_timing'&&event.requestId===metric.requestId);
 metric.stages=Object.fromEntries(entries.filter(event=>['retrieved','llm','embedding','svm','voice_plan'].includes(event.stage)).map(event=>[event.stage,
  Object.fromEntries(['startedAt','durationMs','batchCount','sentenceCount','status'].filter(key=>event[key]!==undefined).map(key=>[key,event[key]]))]));
 const embedding=metric.stages.embedding,llm=metric.stages.llm;
 metric.llmEmbeddingStartDifferenceMs=embedding?.startedAt!==undefined&&llm?.startedAt!==undefined?Math.abs(embedding.startedAt-llm.startedAt):null;
 metric.llmEmbeddingOverlapped=embedding?.startedAt!==undefined&&llm?.startedAt!==undefined
  ?embedding.startedAt<llm.startedAt+llm.durationMs&&llm.startedAt<embedding.startedAt+embedding.durationMs:null;
 if(embedding)metric.embeddingStatus=embedding.status==='completed'?(embedding.batchCount?'executed':'vector_cache_hit'):'failed';
 else if(metric.cache==='hit')metric.embeddingStatus='analysis_cache_hit';
 else if(metric.stages.voice_plan)metric.embeddingStatus=metric.stages.voice_plan.status;
}
function persist(){
  const temporary=reportPath+'.tmp-'+process.pid;
  fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,reportPath);
}
async function measure(article,index,phase){
  const started=performance.now();
  const metric={articleHash:article.articleHash,publisher:article.publisher,phase,status:'failed',httpStatus:null,
    initialPreviewMs:null,totalMs:null,requestId:null,cache:null,resultStatus:null,model:null,voiceModelVersion:null,voicesPresent:false,
    embeddingStatus:'not_observed',warningCodes:[],errorCode:null};
  try{
    const response=await fetch(new URL('/api/analyze',origin),{method:'POST',
      headers:{'Content-Type':'application/json','Accept':'text/event-stream','cf-connecting-ip':`198.51.100.${10+index%3}`},
      body:JSON.stringify({kind:'url',url:article.url,comments:[],transmissionConsent:true}),signal:AbortSignal.timeout(720000)});
    metric.httpStatus=response.status;metric.requestId=response.headers.get('X-Request-Id');
    let analysis;
    if(response.headers.get('content-type')?.includes('text/event-stream')){
      const reader=response.body?.getReader();if(!reader)throw Error('STREAM_BODY_MISSING');
      const decoder=new TextDecoder();let buffer='';
      try{
        while(!analysis&&!metric.errorCode){
          const chunk=await reader.read();buffer+=decoder.decode(chunk.value??new Uint8Array(),{stream:!chunk.done});
          let boundary;
          while((boundary=buffer.indexOf('\n\n'))>=0){
            const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const lines=frame.split('\n');const event=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
            const text=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
            if(!text)continue;
            const value=JSON.parse(text);
            if(event==='preview'&&metric.initialPreviewMs===null)metric.initialPreviewMs=Math.round(performance.now()-started);
            if(event==='result')analysis=value;
            if(event==='error')metric.errorCode=safeCode(value.error?.code);
          }
          if(chunk.done)break;
        }
      }finally{await reader.cancel().catch(()=>{});}
    }else{
      const value=await response.json();
      if(response.ok&&!value.error)analysis=value;
      else metric.errorCode=safeCode(value.error?.code);
    }
    if(analysis&&analysis.mode==='live'&&typeof analysis.requestId==='string'&&Array.isArray(analysis.sources)){
      metric.status='completed';metric.resultStatus=analysis.status??null;metric.requestId=analysis.requestId??metric.requestId;
      metric.model=analysis.versions?.model??null;metric.voiceModelVersion=analysis.versions?.voiceModel??null;
      metric.warningCodes=(analysis.warnings??[]).map(warning=>safeCode(warning.code));
      metric.cache=metric.warningCodes.includes('CACHED_ANALYSIS')?'hit':metric.warningCodes.includes('SHARED_ANALYSIS')?'coalesced':'miss';
      metric.voicesPresent=analysis.sentenceVoices?.method==='svm';
      metric.embeddingStatus=metric.voicesPresent?'svm_result_present':analysis.versions?.voiceModel?'svm_result_unavailable':'no_released_voice_model';
    }else if(!metric.errorCode)metric.errorCode='INCOMPLETE_ANALYSIS_RESPONSE';
  }catch{metric.errorCode='NETWORK_OR_RESPONSE_FAILURE';}
  metric.totalMs=Math.round(performance.now()-started);
  return metric;
}
function safeCode(value){return typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:'UNKNOWN_ERROR';}
