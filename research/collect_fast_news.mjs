/** Resumable general-news acquisition from previously observed publisher lists. */
import {registerHooks} from 'node:module';
import {readFile,writeFile,appendFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(error){if(specifier.startsWith('.')&&!path.extname(specifier)&&context.parentURL?.endsWith('.ts'))return next(specifier+'.ts',context);throw error;}}});
const {extractArticle}=await import('../lib/server/article-extraction.ts');
const {DOMParser}=await import('linkedom/worker');
const output=path.resolve(process.argv[2]??'.sites-runtime/fast-news-20261111');
const target=Number(process.argv[3]??1000);
const MAX_REQUESTS=target*2+400;
const ignoredRoot=path.resolve('.sites-runtime')+path.sep;
if(!output.startsWith(ignoredRoot)||!Number.isInteger(target)||target<1||target>1000)throw Error('Use an ignored output and target 1..1000');
await mkdir(path.join(output,'raw'),{recursive:true});
const baseline=path.resolve('.sites-runtime/collection-1000-20261105');
const UA='NaeInfoClearResearch/0.3 (user-requested local general-news acquisition)';
const HOSTS=['www.dailian.co.kr','www.newdaily.co.kr','www.ohmynews.com','www.pressian.com'];
const TERMS=['교육','과학','기술','문화','환경','경제','학교','인공지능'];
const DROP=/\[포토\]|\[영상\]|\[화보\]|\[사진\]|\[인사\]|\[부고\]|견본주택|모델하우스|업무협약|MOU|성료|수익률|상장|수주|완판|브랜드|전달식|기념식|우수기관|최우수상/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.normalize('NFC').replace(/\s+/g,' ').trim();
async function lines(file){try{return(await readFile(file,'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return[];throw error;}}
function identity(value){const u=new URL(value);if(u.hostname.includes('ohmynews.com'))return 'ohmy:'+u.searchParams.get('CNTN_CD');if(u.hostname.includes('pressian.com'))return 'pressian:'+u.pathname.match(/\/articles\/(\d+)/)?.[1];if(u.hostname.includes('dailian.co.kr'))return 'dailian:'+u.pathname.match(/\/news\/view\/(\d+)/)?.[1];return u.hostname.replace(/^(www|m)\./,'')+u.pathname;}
const existing=await lines(path.join(baseline,'articles-reviewed-3000.local.jsonl'));
const oldExclusions=JSON.parse(await readFile(path.join(baseline,'editorial-exclusions.local.json'),'utf8'));
const excludedIds=new Set(oldExclusions.ids);
const rows=await lines(path.join(output,'articles.local.jsonl'));
const seen=new Set([...existing,...rows].map(row=>identity(row.url)));
const hashes=new Set([...existing,...rows].map(row=>hash(normalize(row.text))));
const attempted=new Set((await lines(path.join(output,'requests.local.jsonl'))).filter(row=>row.kind==='article').map(row=>identity(row.url)));
const blocked=new Set(),policies=new Map(),last=new Map();
const priorRequests=await lines(path.join(output,'requests.local.jsonl'));
const completedLists=new Set(priorRequests.filter(row=>row.kind==='list'&&row.status===200).map(row=>row.url));
for(const row of priorRequests)if([401,403,429].includes(row.status))blocked.add(new URL(row.url).hostname);
let requests=priorRequests.length;
let outputWrites=Promise.resolve();
function append(file,row){outputWrites=outputWrites.then(()=>appendFile(path.join(output,file),JSON.stringify(row)+'\n'));return outputWrites;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function groups(text){const result=[];let agents=[],rules=[];for(const raw of text.split(/\r?\n/)){const m=/^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(raw.replace(/#.*/,'').trim());if(!m)continue;if(m[1].toLowerCase()==='user-agent'){if(rules.length){result.push({agents,rules});agents=[];rules=[];}agents.push(m[2].toLowerCase());}else if(agents.length&&m[2])rules.push({allow:m[1].toLowerCase()==='allow',pattern:m[2]});}if(agents.length)result.push({agents,rules});return result;}
function allowed(url){const policy=policies.get(url.hostname);if(!policy)return false;for(const agent of ['NaeInfoClearResearch','GPTBot','OpenAI','ClaudeBot','Claude-Code','FirecrawlAgent']){const specific=policy.groups.filter(group=>group.agents.some(a=>a!=='*'&&agent.toLowerCase().includes(a)));const chosen=specific.length?specific:policy.groups.filter(group=>group.agents.includes('*'));const matches=chosen.flatMap(group=>group.rules).filter(rule=>new RegExp('^'+rule.pattern.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')).test(url.pathname+url.search)).sort((a,b)=>b.pattern.replace(/\*/g,'').length-a.pattern.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));if(matches.length&&!matches[0].allow)return false;}return true;}
async function get(value,kind,redirects=0){
 const url=new URL(value);if(url.protocol!=='https:'||!HOSTS.includes(url.hostname)||url.username||url.password||url.port)throw Error('host_not_allowed');
 try{await access(path.join(output,'STOP'));throw Error('user_stop');}catch(error){if(error.message==='user_stop')throw error;}
 if(blocked.has(url.hostname))throw Error('host_blocked');
 if(requests>=MAX_REQUESTS)throw Error('request_cap');
 if(kind!=='robots'&&!allowed(url))throw Error('robots_denied');
 await sleep(Math.max(0,2300-(Date.now()-(last.get(url.hostname)??0))));last.set(url.hostname,Date.now());requests++;
 const log={url:url.href,kind,at:new Date().toISOString()};
 try{
  const response=await fetch(url,{redirect:'manual',headers:{'User-Agent':UA,Accept:'text/html,text/plain,application/xml'},signal:AbortSignal.timeout(15000)});log.status=response.status;
  if([401,403,429].includes(response.status))blocked.add(url.hostname);
  if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects>=3)throw Error('redirect_limit');const next=new URL(location,url);if(next.origin!==url.origin)throw Error('cross_origin_redirect');await append('requests.local.jsonl',log);return get(next.href,kind,redirects+1);}
  if(!response.ok&&!(kind==='robots'&&response.status===404)){await response.body?.cancel();throw Error('http_'+response.status);}
  if(/\b(noai|nosnippet)\b/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();throw Error('header_access_restriction');}
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(reader)while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>(kind==='robots'?65536:2*1024*1024)){await reader.cancel();throw Error('response_size_limit');}chunks.push(value);}
  const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(response.headers.get('content-type')??'')?.[1]??'utf-8';
  const text=new TextDecoder(charset,{fatal:true}).decode(Buffer.concat(chunks));await append('requests.local.jsonl',log);return {text,type:response.headers.get('content-type'),url:url.href};
 }catch(error){log.error=error.message;await append('requests.local.jsonl',log);throw error;}
}
function articleUrl(value,base){let url;try{url=new URL(value,base);}catch{return null;}if(!HOSTS.includes(url.hostname)||url.protocol!=='https:')return null;const host=url.hostname;
 if(host.includes('dailian')&&!/^\/news\/view\/\d+\/?$/.test(url.pathname))return null;
 if(host.includes('newdaily')&&!/^\/site\/data\/html\/\d{4}\/\d{2}\/\d{2}\/\d+\.html$/.test(url.pathname))return null;
 if(host.includes('pressian')&&!/^\/pages\/articles\/\d+/.test(url.pathname))return null;
 if(host.includes('ohmynews')&&!/at_pg\.aspx$/i.test(url.pathname))return null;
 if(host.includes('ohmynews')&&!/^A\d+$/.test(url.searchParams.get('CNTN_CD')??''))return null;
 url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid|CMPT_CD|SRS_CD|BLCK_NO|PAGE_CD)$/i.test(key))url.searchParams.delete(key);return url;
}
function topic(title){return /교육|학교|교사|학생|대학|수업/.test(title)?'education':/과학|연구|우주|생명|물리/.test(title)?'science':/기술|인공지능|AI|반도체|디지털/.test(title)?'technology':/문화|영화|예술|문학|공연|전시/.test(title)?'culture':/환경|기후|생태|탄소/.test(title)?'environment':/경제|물가|금리|소비|기업|산업/.test(title)?'economy':'general_news';}
function publication(doc,extracted){const value=extracted.publishedAt??doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')??doc.querySelector('meta[name="pubdate"]')?.getAttribute('content');const stamp=value?Date.parse(value):NaN;return Number.isFinite(stamp)?new Date(stamp).toISOString():null;}
async function checkpoint(final=false,count=rows.length){const checkedRows=rows.slice(0,count);const localUrls=new Set(),localHashes=new Set(),byPublisher={},byTopic={};for(const row of checkedRows){if(row.text.length<300||localUrls.has(identity(row.url))||localHashes.has(row.contentHash)||excludedIds.has(row.id)||DROP.test(row.title))throw Error('checkpoint_integrity_failure');const stamp=Date.parse(row.publishedAt);if(!Number.isFinite(stamp)||stamp<Date.parse('2024-01-01T00:00:00+09:00')||stamp>=Date.parse('2026-11-12T00:00:00+09:00'))throw Error('checkpoint_date_failure');localUrls.add(identity(row.url));localHashes.add(row.contentHash);byPublisher[row.publisherId]=(byPublisher[row.publisherId]??0)+1;byTopic[row.topicId]=(byTopic[row.topicId]??0)+1;}
 const summary={checkedAt:new Date().toISOString(),collected:checkedRows.length,baseline:existing.length,total:existing.length+checkedRows.length,uniqueUrls:localUrls.size,uniqueBodies:localHashes.size,byPublisher,byTopic,requests,requestLimit:MAX_REQUESTS,blockedHosts:[...blocked],final,usageStatus:'pending_unapproved',trainingApproved:0,releaseReady:false};
 await writeFile(path.join(output,'summary.local.json'),JSON.stringify(summary,null,2));if(count&&(count%300===0||count===target))await writeFile(path.join(output,`checkpoint-${count}.local.json`),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));}
async function collect(candidate){if(rows.length>=target||blocked.has(new URL(candidate.url).hostname))return;const key=identity(candidate.url);if(seen.has(key)||attempted.has(key)||DROP.test(candidate.title))return;attempted.add(key);
 try{const fetched=await get(candidate.url,'article');if(!/^text\/html\b/i.test(fetched.type??''))throw Error('not_html');const doc=new DOMParser().parseFromString(fetched.text,'text/html');for(const meta of doc.querySelectorAll('meta'))if(/robots|googlebot/i.test(meta.getAttribute('name')??'')&&/\b(noai|nosnippet|noarchive)\b/i.test(meta.getAttribute('content')??''))throw Error('page_access_restriction');
 const extracted=extractArticle(fetched.text,fetched.url);if(!extracted||extracted.text.length<300)throw Error('missing_short_or_restricted_body');const title=extracted.title??candidate.title;if(!title||DROP.test(title))throw Error('editorial_excluded');const publishedAt=publication(doc,extracted);const stamp=publishedAt?Date.parse(publishedAt):NaN;if(!Number.isFinite(stamp)||stamp<Date.parse('2024-01-01T00:00:00+09:00')||stamp>=Date.parse('2026-11-12T00:00:00+09:00'))throw Error('publication_date_missing_or_outside_range');
 const contentHash=hash(normalize(extracted.text)),id='article_'+hash(fetched.url).slice(0,20);if(seen.has(key)||hashes.has(contentHash)||excludedIds.has(id))throw Error('duplicate_or_excluded');
 if(rows.length>=target)return;seen.add(key);hashes.add(contentHash);const publisherId=new URL(fetched.url).hostname.replace(/^www\./,'');const row={id,publisherId,url:fetched.url,title,publishedAt,fetchedAt:new Date().toISOString(),text:extracted.text,topicId:topic(title),comparisonGroup:topic(title),contentHash,sourceEditionHost:new URL(fetched.url).hostname,provenance:'public_article',extractionVersion:extracted.extractionVersion,acquisition:{method:'direct_https',discovery:'observed_publisher_list',discoveredUrl:candidate.discoveredAt,userAgent:UA,robotsCheckedAt:policies.get(new URL(fetched.url).hostname).checkedAt},usage:{status:'pending_unapproved',trainingAllowed:null,modelDistributionAllowed:null},sourceGroupId:null};rows.push(row);const acceptedCount=rows.length;await writeFile(path.join(output,'raw',id+'.html'),fetched.text);await append('articles.local.jsonl',row);if(acceptedCount%300===0||acceptedCount===target)await checkpoint(false,acceptedCount);if(rows.length%25===0)console.log(JSON.stringify({collected:rows.length,requests}));
 }catch(error){await append('rejections.local.jsonl',{...candidate,reason:error.message});}
}
function seeds(host){const result=['https://'+host+'/'];for(let page=1;page<=5;page++){
 if(host.includes('dailian'))for(const term of TERMS)result.push(`https://${host}/search?shwords=${encodeURIComponent(term)}&c=&t=999&sbj=title&page=${page}`);
 if(host.includes('newdaily'))for(const term of TERMS)result.push(`https://${host}/news/search_result.html?search=${encodeURIComponent(term)}&s=&t=date&pn=${page}`);
 if(host.includes('ohmynews'))for(const term of TERMS)result.push(`https://${host}/NWS_Web/Mobile/at_list.aspx?${page>1?'ajaxgb=more&STD_KND=&RGN_KND=&FRM_KND=&':''}TAG_NM=${encodeURIComponent(term)}${page>1?'&pageno='+page:''}`);
 if(host.includes('pressian'))for(const section of ['news-economy','news-society'])result.push(`https://${host}/pages/${section}-list?page=${page}`);
 }return result;}
async function worker(host){
 try{const fetched=await get('https://'+host+'/robots.txt','robots');if(/(?:AI training|machine learning)[\s\S]{0,180}prohibited/i.test(fetched.text))throw Error('explicit_training_policy');policies.set(host,{groups:groups(fetched.text),checkedAt:new Date().toISOString()});await writeFile(path.join(output,'robots-'+host+'.local.txt'),fetched.text);console.log(JSON.stringify({host,robots:'checked'}));}catch(error){blocked.add(host);console.log(JSON.stringify({host,robots:error.message}));return;}
 const discovered=new Set();for(const listUrl of seeds(host)){if(rows.length>=target||blocked.has(host)||requests>=MAX_REQUESTS)break;if(completedLists.has(listUrl))continue;try{const fetched=await get(listUrl,'list');const doc=new DOMParser().parseFromString(fetched.text,'text/html');const candidates=[];for(const link of doc.querySelectorAll('a[href]')){const url=articleUrl(link.getAttribute('href'),listUrl);if(!url||url.hostname!==host)continue;const key=identity(url.href);if(discovered.has(key)||seen.has(key))continue;discovered.add(key);const title=normalize(link.textContent??'');if(DROP.test(title))continue;candidates.push({url:url.href,title,discoveredAt:listUrl});}await append('discovery.local.jsonl',{url:listUrl,found:candidates.length});for(const candidate of candidates){if(rows.length>=target||blocked.has(host))break;await collect(candidate);}}catch(error){await append('rejections.local.jsonl',{url:listUrl,reason:error.message});}}
}
await Promise.all(HOSTS.map(worker));await outputWrites;await checkpoint(true);





