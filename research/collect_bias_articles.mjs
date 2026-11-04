/** Bounded direct collection for a local research corpus. No model or rights approvals. */
import {registerHooks} from 'node:module';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
registerHooks({resolve(specifier,context,next){
 try{return next(specifier,context);}catch(error){
  if(specifier.startsWith('.')&&!path.extname(specifier)&&context.parentURL?.endsWith('.ts')
   &&['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code))return next(specifier+'.ts',context);
  throw error;
 }
}});
const {extractArticle}=await import('../lib/server/article-extraction.ts');
const {publicationDate}=await import('../lib/server/article-document.ts');
const {DOMParser}=await import('linkedom/worker');
const [inputArg,outputArg]=process.argv.slice(2);
if(!inputArg||!outputArg)throw new Error('Usage: node research/collect_bias_articles.mjs manifest.json .sites-runtime/new-directory');
const localRoot=path.resolve('.sites-runtime'),output=path.resolve(outputArg);
if(!output.startsWith(localRoot+path.sep))throw new Error('Output must be inside ignored .sites-runtime');
const rows=JSON.parse(await readFile(inputArg,'utf8'));
if(!Array.isArray(rows)||!rows.length||rows.length>100)throw new Error('Need 1..100 explicitly discovered article candidates');
for(const row of rows){
 const u=new URL(row.url);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['pressian.com','ohmynews.com','hani.co.kr','khan.co.kr','chosun.com','joongang.co.kr'].includes(row.publisherId)
  ||![row.publisherId,'www.'+row.publisherId,'m.'+row.publisherId].includes(u.hostname)||!row.topicId)throw new Error('Invalid article candidate');
}
await mkdir(output); // Never overwrite a previous collection.
const ua='NaeInfoClearResearch/0.1 (OpenAI-assisted local research)';
const sha=text=>createHash('sha256').update(text).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const robots=new Map(),lastFetch=new Map(),blockedHosts=new Set(),seen=new Set(),hashes=new Map();
const articles=[],attempts=[];
async function request(url,limit){
 const host=new URL(url).hostname;const delay=2000-(Date.now()-(lastFetch.get(host)??0));if(delay>0)await pause(delay);
 lastFetch.set(host,Date.now());
 const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':ua,Accept:'text/html,text/plain'},signal:AbortSignal.timeout(12000)});
 if(response.status===429||response.status===403)blockedHosts.add(host);
 if(!response.ok){await response.body?.cancel();return {response,text:null};}
 const reader=response.body?.getReader();if(!reader)return {response,text:null};
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('response_size_limit');}chunks.push(value);}
 const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}
 const charset=/charset\s*=\s*([^;\s]+)/i.exec(response.headers.get('content-type')??'')?.[1]??'utf-8';
 return {response,text:new TextDecoder(charset,{fatal:true}).decode(data)};
}
function robotGroups(text){
 const groups=[];let agents=[],rules=[];
 for(const raw of text.split(/\r?\n/)){
  const line=raw.replace(/#.*/,'').trim(),m=/^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);if(!m)continue;
  if(m[1].toLowerCase()==='user-agent'){
   if(rules.length){groups.push({agents,rules});agents=[];rules=[];}agents.push(m[2].toLowerCase());
  }else if(agents.length&&m[2])rules.push({allow:m[1].toLowerCase()==='allow',pattern:m[2]});
 }
 if(agents.length)groups.push({agents,rules});return groups;
}
function robotAllowed(groups,agent,url){
 const exact=groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.toLowerCase().includes(a)));
 const chosen=exact.length?exact:groups.filter(g=>g.agents.includes('*'));const target=url.pathname+url.search;
 const matches=chosen.flatMap(g=>g.rules).filter(r=>{
  const pattern=r.pattern.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');
  return new RegExp('^'+pattern).test(target);
 }).sort((a,b)=>b.pattern.replace(/\*/g,'').length-a.pattern.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
 return !matches.length||matches[0].allow;
}
async function access(url){
 if(blockedHosts.has(url.hostname))return 'host_access_denied_or_rate_limited';
 if(!robots.has(url.origin)){
  const fetched=await request(url.origin+'/robots.txt',65536);
  const info={status:fetched.response.status,text:fetched.text??'',fetchedAt:new Date().toISOString()};robots.set(url.origin,info);
  await writeFile(path.join(output,'robots-'+url.hostname+'.local.txt'),info.text,'utf8');
 }
 const info=robots.get(url.origin);
 if(info.status!==200&&info.status!==404)return 'robots_unavailable_or_denied';
 if(/(?:AI training|machine learning)[\s\S]{0,180}prohibited/i.test(info.text))return 'explicit_machine_learning_restriction';
 const groups=robotGroups(info.text);
 for(const agent of ['NaeInfoClearResearch','GPTBot','OpenAI','ClaudeBot','Claude-Code','FirecrawlAgent'])if(!robotAllowed(groups,agent,url))return 'robots_disallows_research_or_training';
 return null;
}
function dateFromHtml(html){
 const doc=new DOMParser().parseFromString(html,'text/html');const candidates=[];
 for(const meta of doc.querySelectorAll('meta'))if(/(?:published|pubdate|datecreated|^date$)/i.test(meta.getAttribute('property')??meta.getAttribute('name')??''))candidates.push(meta.getAttribute('content'));
 for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){
  try{const pending=[JSON.parse(script.textContent)];while(pending.length){const value=pending.pop();if(!value||typeof value!=='object')continue;if(value.datePublished)candidates.push(value.datePublished);pending.push(...Object.values(value).filter(v=>v&&typeof v==='object'));}}catch{}
 }
 for(const time of doc.querySelectorAll('time[datetime]'))candidates.push(time.getAttribute('datetime'));
 for(const value of candidates){if(typeof value!=='string')continue;const exact=publicationDate(value);if(exact)return {publishedAt:exact,raw:value};const day=/^(\d{4})[-.\/](\d{2})[-.\/](\d{2})/.exec(value);if(day){const date=publicationDate(day.slice(1).join('-'));if(date)return {publishedAt:date,raw:value};}}
 return {publishedAt:null,raw:null};
}
for(const candidate of rows){
 const url=new URL(candidate.url);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid|CMPT_CD|SRS_CD|BLCK_NO|PAGE_CD)$/i.test(key))url.searchParams.delete(key);
 const identity=url.hostname.replace(/^(www|m)\./,'')+url.pathname.toLowerCase()+url.search;
 if(seen.has(identity))continue;seen.add(identity);
 const attempt={url:url.href,publisherId:candidate.publisherId,topicId:candidate.topicId,status:'failed'};
 try{
  const denied=await access(url);if(denied){attempt.reason=denied;attempts.push(attempt);continue;}
  const {response,text}=await request(url.href,2*1024*1024);attempt.httpStatus=response.status;
  if(!text){attempt.reason='http_'+response.status;attempts.push(attempt);continue;}
  if(!/^text\/html(?:;|$)/i.test(response.headers.get('content-type')??'')){attempt.reason='not_html';attempts.push(attempt);continue;}
  if(/\b(noai|nosnippet)\b/i.test(response.headers.get('x-robots-tag')??'')){attempt.reason='response_access_restriction';attempts.push(attempt);continue;}
  const extracted=extractArticle(text,url.href);if(!extracted||extracted.text.length<120){attempt.reason='restricted_or_no_substantive_article';attempts.push(attempt);continue;}
  const date=extracted.publishedAt?{publishedAt:extracted.publishedAt,raw:extracted.publishedAt}:dateFromHtml(text);
  if(date.publishedAt&&(date.publishedAt.slice(0,10)<'2024-01-01'||date.publishedAt.slice(0,10)>'2026-11-04')){attempt.reason='outside_collection_period';attempts.push(attempt);continue;}
  const hash=sha(extracted.text.replace(/\s+/g,' ').trim()),id='article_'+sha(url.href).slice(0,20);
  const article={id,publisherId:candidate.publisherId,url:url.href,title:extracted.title??candidate.title??null,
   ...date,publishedAtRaw:date.raw,fetchedAt:new Date().toISOString(),comparisonGroup:candidate.comparisonGroup??candidate.topicId,topicId:candidate.topicId,
   text:extracted.text,provenance:'public_article',extractionVersion:extracted.extractionVersion,contentHash:hash,
   sourceGroupId:null,sourceGroupIdCandidate:'content:'+hash,duplicateOf:hashes.get(hash)??null,
   acquisition:{method:'direct_https',robotsUrl:url.origin+'/robots.txt',robotsFetchedAt:robots.get(url.origin).fetchedAt,userAgent:ua},
   topicReview:{status:'candidate_from_search',reviewed:false},usage:{status:'not_reviewed',trainingAllowed:null,modelDistributionAllowed:null,basisUrl:null,reviewedBy:null,reviewedAt:null}};
  if(!hashes.has(hash))hashes.set(hash,id);articles.push(article);await appendFile(path.join(output,'articles.local.jsonl'),JSON.stringify(article)+'\n','utf8');
  attempt.status='collected';attempt.characters=article.text.length;attempt.publishedAt=article.publishedAt;attempt.duplicate=!!article.duplicateOf;
 }catch(error){attempt.reason=error.name==='TimeoutError'?'timeout':error.message?.slice(0,120)??'fetch_failed';}
 attempts.push(attempt);console.log(JSON.stringify({collected:articles.length,attempted:attempts.length,publisher:attempt.publisherId,topic:attempt.topicId,status:attempt.status,reason:attempt.reason}));
}
await writeFile(path.join(output,'attempts.local.json'),JSON.stringify(attempts,null,2),'utf8');
const byPublisher={},byTopic={};for(const a of articles){byPublisher[a.publisherId]=(byPublisher[a.publisherId]??0)+1;const key=a.publisherId+':'+a.topicId;byTopic[key]=(byTopic[key]??0)+1;}
const report={collected:articles.length,uniqueContents:hashes.size,withPublishedDate:articles.filter(a=>a.publishedAt).length,byPublisher,byTopic,attempted:attempts.length,failed:attempts.filter(a=>a.status!=='collected').length,trainingApproved:0,releaseReady:false};
await writeFile(path.join(output,'report.local.json'),JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report));
