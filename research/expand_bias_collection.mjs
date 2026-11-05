/** Local, resumable collection of explicitly discovered public article URLs.
 * Research candidates only: never writes approvals or a production model.
 */
import {registerHooks} from 'node:module';
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(s.startsWith('.')&&!path.extname(s)&&c.parentURL?.endsWith('.ts')&&['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(e.code))return next(s+'.ts',c);throw e;}}});
const {extractArticle}=await import('../lib/server/article-extraction.ts');
const {DOMParser}=await import('linkedom/worker');
const base=path.resolve(process.argv[2]??'.sites-runtime/collection-1000-20261105');
const target=Number(process.argv[3]??1000);
if(![1000,2000,3000].includes(target))throw Error('Supported cumulative target: 1000, 2000 or 3000');
const TARGET_PER_PUBLISHER=target/4,TOPIC_LIMIT=target===3000?165:target===2000?110:45;
if(!base.startsWith(path.resolve('.sites-runtime')+path.sep))throw Error('Local ignored output required');
await mkdir(base,{recursive:true});await mkdir(path.join(base,'raw'),{recursive:true});
const UA='NaeInfoClearResearch/0.2 (OpenAI-assisted local research; public news corpus)';
const SEARCH_HOSTS=['www.dailian.co.kr','www.newdaily.co.kr'];
// Keep edition identity in sourceEditionHost; model evaluation separates biz.
const HOSTS=new Set([...SEARCH_HOSTS,'biz.newdaily.co.kr']);
const topics={medical_school_quota:{q:['의대 정원','의대 증원'],re:/의대|의과대|의사\s*정원/},pension_reform:{q:['국민연금','연금개혁'],re:/국민연금|연금개혁|연금\s*개혁|소득대체율|보험료율/},minimum_wage:{q:['최저임금'],re:/최저임금|생활임금/},electricity_prices:{q:['전기요금','전기료'],re:/전기\s*(?:요금|료)|전력\s*요금/},housing_supply:{q:['주택 공급','주택공급'],re:/주택|부동산|아파트/},nuclear_energy:{q:['원전','원자력'],re:/원전|원자력|핵폐기/}};
const DROP=/(?:견본주택|모델하우스).*(?:개관|개장|오픈)|주택행정.*(?:우수상|수상|우수.*선정|우수기관|우수\s*시군)|\[포토\]|\[영상\]|\[화보\]|\[카드뉴스\]|\[사진\]|\[인사\]|\[부고\]|ETF|펀드|업무협약|MOU|심포지엄|세미나|성료|포상|공모|특징주|원전주|강세|맞손|제휴|준공식|홍보|수익률|상장|운용|수주|협약/;
const hash=t=>createHash('sha256').update(t).digest('hex');
const norm=t=>t.replace(/\s+/g,' ').trim();
const lines=async p=>{try{return(await readFile(p,'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return[];throw e;}};
const identity=u=>{const x=new URL(u);const m=x.pathname.match(/\/news\/view\/(\d+)/);return m?'dailian:'+m[1]:x.hostname.replace(/^www\./,'')+x.pathname;};
const seen=new Set(),hashes=new Set(),counts={},byTopic={};
const corpus=path.join(base,'articles.local.jsonl');
for(const r of await lines(corpus)){seen.add(identity(r.url));hashes.add(hash(norm(r.text)));counts[r.publisherId]=(counts[r.publisherId]??0)+1;const k=r.publisherId+':'+r.topicId;byTopic[k]=(byTopic[k]??0)+1;}
// A prior un-followed canonical redirect was not an article retrieval.
const tried=new Set((await lines(path.join(base,'fetch-log.local.jsonl'))).filter(r=>r.reason!=='http_301').map(r=>r.url));
const blocked=new Set(),last=new Map(),policies=new Map();let requests=0,added=0;
const MAX_REQUESTS=target===1000?1000:1500;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,limit=2*1024*1024,redirects=0){
 const u=new URL(url);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.username||u.password||u.port)throw Error('host_not_allowed');
 if(blocked.has(u.hostname))throw Error('host_blocked');if(requests>=MAX_REQUESTS)throw Error('request_cap');
 if(u.pathname!=='/robots.txt'&&!allowed(u))throw Error('robots_denied');
 const gap=2500-(Date.now()-(last.get(u.hostname)??0));if(gap>0)await delay(gap);last.set(u.hostname,Date.now());requests++;
 const r=await fetch(url,{redirect:'manual',headers:{'User-Agent':UA,Accept:'text/html,text/plain,application/xml'},signal:AbortSignal.timeout(15000)});
 if([301,302,303,307,308].includes(r.status)){
  const location=r.headers.get('location');await r.body?.cancel();
  if(!location||redirects>=3)throw Error('redirect_limit');
  const next=new URL(location,url);if(next.origin!==u.origin)throw Error('cross_origin_redirect');
  return get(next.href,limit,redirects+1);
 }
 if([401,403,429].includes(r.status))blocked.add(u.hostname);
 if(!r.ok){await r.body?.cancel();throw Error('http_'+r.status);}
 if(/\b(noai|nosnippet)\b/i.test(r.headers.get('x-robots-tag')??'')){await r.body?.cancel();throw Error('header_access_restriction');}
 const reader=r.body.getReader(),chunks=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('response_size_limit');}chunks.push(value);}
 const bytes=Buffer.concat(chunks),charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(r.headers.get('content-type')??'')?.[1]??'utf-8';
 return {text:new TextDecoder(charset,{fatal:true}).decode(bytes),status:r.status,type:r.headers.get('content-type'),xRobotsTag:r.headers.get('x-robots-tag')};
}
function groups(text){const gs=[];let agents=[],rules=[];for(const raw of text.split(/\r?\n/)){const m=/^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(raw.replace(/#.*/,'').trim());if(!m)continue;if(m[1].toLowerCase()==='user-agent'){if(rules.length){gs.push({agents,rules});agents=[];rules=[];}agents.push(m[2].toLowerCase());}else if(agents.length&&m[2])rules.push({allow:m[1].toLowerCase()==='allow',pattern:m[2]});}if(agents.length)gs.push({agents,rules});return gs;}
function allowed(u){const p=policies.get(u.hostname);if(!p)return false;for(const agent of ['NaeInfoClearResearch','GPTBot','OpenAI','ClaudeBot','Claude-Code','FirecrawlAgent']){const specific=p.groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.toLowerCase().includes(a)));const chosen=specific.length?specific:p.groups.filter(g=>g.agents.includes('*'));const matches=chosen.flatMap(g=>g.rules).filter(r=>{const pat=r.pattern.replace(/[.+?^{}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');return new RegExp('^'+pat).test(u.pathname+u.search);}).sort((a,b)=>b.pattern.replace(/\*/g,'').length-a.pattern.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));if(matches.length&&!matches[0].allow)return false;}return true;}
for(const host of HOSTS){try{const r=await get('https://'+host+'/robots.txt',65536);if(/(?:AI training|machine learning)[\s\S]{0,180}prohibited/i.test(r.text))throw Error('training_policy_denied');policies.set(host,{groups:groups(r.text),checkedAt:new Date().toISOString()});await writeFile(path.join(base,host+'-robots.local.txt'),r.text);}catch(e){blocked.add(host);console.log(JSON.stringify({policy:host,error:e.message}));}}
const candidates=new Map();
function candidate(r){const publisherId=r.publisherId==='dailian'?'dailian.co.kr':r.publisherId==='newdaily'?'newdaily.co.kr':r.publisherId;const u=new URL(r.url);if(!HOSTS.has(u.hostname)||!topics[r.topicId]||DROP.test(r.title??'')||!topics[r.topicId].re.test(r.title??'')||seen.has(identity(r.url))||tried.has(r.url))return;
 // Prior requests confirmed the publisher's canonical trailing-slash redirect.
 // Reuse that spelling while retaining the actual discovered URL as provenance.
 if(u.hostname==='www.dailian.co.kr'&&/^\/news\/view\/\d+$/.test(u.pathname))u.pathname+='/';
 if(tried.has(u.href))return;const k=identity(r.url);if(!candidates.has(k))candidates.set(k,{...r,publisherId,url:u.href,discoveredUrl:r.discoveredUrl??r.url});}
for(const r of await lines('.sites-runtime/claude-article-collection-20261104-expansion/discovery.jsonl'))candidate(r);
for(const r of await lines(path.join(base,'discovery.local.jsonl')))candidate(r);
const dateFrom=(doc,extracted)=>{const raw=extracted.publishedAt??doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')??doc.querySelector('meta[name="pubdate"]')?.getAttribute('content');return raw&&/^\d{4}-\d{2}-\d{2}/.test(raw)&&Number.isFinite(Date.parse(raw))?raw:null;};
async function collect(r){
 const key=r.publisherId+':'+r.topicId;if((counts[r.publisherId]??0)>=TARGET_PER_PUBLISHER||(byTopic[key]??0)>=TOPIC_LIMIT)return;
 if(seen.has(identity(r.url))||tried.has(r.url))return;tried.add(r.url);
 const log={url:r.url,publisherId:r.publisherId,topicId:r.topicId,fetchedAt:new Date().toISOString()};
 try{const fetched=await get(r.url);if(!/^text\/html\b/i.test(fetched.type??''))throw Error('not_html');const doc=new DOMParser().parseFromString(fetched.text,'text/html');
  for(const meta of doc.querySelectorAll('meta'))if(/robots|googlebot/i.test(meta.getAttribute('name')??'')&&/\b(noai|nosnippet|noarchive)\b/i.test(meta.getAttribute('content')??''))throw Error('page_access_restriction');
  const extracted=extractArticle(fetched.text,r.url);if(!extracted||extracted.text.length<300)throw Error('missing_short_or_restricted_body');
  const publishedAt=dateFrom(doc,extracted);
  // Extraction may normalize timestamps to UTC. The collection window follows
  // Korean calendar days, not the first ten characters of a UTC timestamp.
  const publicationTime=publishedAt?Date.parse(publishedAt):NaN;
  if(!Number.isFinite(publicationTime)||publicationTime<Date.parse('2024-01-01T00:00:00+09:00')||publicationTime>=Date.parse('2026-11-05T00:00:00+09:00'))throw Error('publication_date_missing_or_outside_range');
  const title=extracted.title??doc.querySelector('meta[property="og:title"]')?.getAttribute('content')??r.title;
  if(!topics[r.topicId].re.test(title??'')||DROP.test(title??'')||(extracted.text.match(new RegExp(topics[r.topicId].re.source,'g'))??[]).length<2)throw Error('topic_needs_review');
  const contentHash=hash(norm(extracted.text));if(hashes.has(contentHash))throw Error('exact_duplicate_content');
  const id='article_'+hash(r.url).slice(0,20),rawFile='raw/'+id+'.html';await writeFile(path.join(base,rawFile),fetched.text);
  const article={id,publisherId:r.publisherId,url:r.url,title,publishedAt,publishedAtNote:r.publisherId==='newdaily.co.kr'?'publisher_metadata_timezone_unreviewed':undefined,fetchedAt:log.fetchedAt,text:extracted.text,topicId:r.topicId,comparisonGroup:r.topicId,contentHash,sourceEditionHost:new URL(r.url).hostname,provenance:'public_article',extractionVersion:extracted.extractionVersion,acquisition:{method:'direct_https',userAgent:UA,robotsCheckedAt:policies.get(new URL(r.url).hostname).checkedAt,discovery:'publisher_search_page',discoveredUrl:r.discoveredUrl??r.url,rawFile,xRobotsTag:fetched.xRobotsTag},usage:{status:'pending_unapproved',trainingAllowed:null,modelDistributionAllowed:null},sourceGroupId:null};
  await appendFile(corpus,JSON.stringify(article)+'\n');seen.add(identity(r.url));hashes.add(contentHash);counts[r.publisherId]=(counts[r.publisherId]??0)+1;byTopic[key]=(byTopic[key]??0)+1;added++;log.status='collected';
 }catch(e){log.status='rejected';log.reason=e.message;}
 await appendFile(path.join(base,'fetch-log.local.jsonl'),JSON.stringify(log)+'\n');
 if(log.status==='collected'||requests%20===0)console.log(JSON.stringify({added,total:hashes.size,requests,byPublisher:counts,status:log.status,reason:log.reason}));
}
async function drain(){const queues={};for(const r of candidates.values())(queues[r.publisherId+':'+r.topicId]??=[]).push(r);candidates.clear();let active=true;while(active){active=false;for(const list of Object.values(queues)){if(list.length){active=true;await collect(list.shift());}}}}
await drain();
// New pages only; do not repeat already discovered search requests after restart.
const searchDone=new Set((await lines(path.join(base,'search-log.local.jsonl'))).filter(r=>r.discoveryVersion==='editions-2').map(r=>r.url));
for(let page=1;page<=30&&Object.values(counts).some(n=>n<TARGET_PER_PUBLISHER)&&requests<MAX_REQUESTS;page++){
 for(const [topic,{q}]of Object.entries(topics))for(const query of q)for(const host of SEARCH_HOSTS){
  const pub=host==='www.dailian.co.kr'?'dailian.co.kr':'newdaily.co.kr';if((counts[pub]??0)>=TARGET_PER_PUBLISHER||(byTopic[pub+':'+topic]??0)>=TOPIC_LIMIT||blocked.has(host))continue;
  const url=host==='www.dailian.co.kr'?`https://${host}/search?shwords=${encodeURIComponent(query)}&c=&t=999&sbj=title&page=${page}`:`https://${host}/news/search_result.html?search=${encodeURIComponent(query)}&s=&t=date&pn=${page}`;
  if(searchDone.has(url))continue;searchDone.add(url);const log={url,topic,publisherId:pub,discoveryVersion:'editions-2'};
  try{const r=await get(url);const doc=new DOMParser().parseFromString(r.text,'text/html');let found=0;for(const a of doc.querySelectorAll('a[href]')){let u;try{u=new URL(a.getAttribute('href'),url);}catch{continue;}const validHost=host==='www.dailian.co.kr'?u.hostname===host:['www.newdaily.co.kr','biz.newdaily.co.kr'].includes(u.hostname);if(!validHost||!(host==='www.dailian.co.kr'?/^\/news\/view\/\d+\/?$/:/^\/site\/data\/html\/\d{4}\/\d{2}\/\d{2}\/\d+\.html$/).test(u.pathname))continue;const row={publisherId:pub,topicId:topic,url:u.href,title:norm(a.textContent),query};if(topics[topic].re.test(row.title)&&!DROP.test(row.title)){candidate(row);await appendFile(path.join(base,'discovery.local.jsonl'),JSON.stringify(row)+'\n');found++;}}log.found=found;}catch(e){log.error=e.message;}
  await appendFile(path.join(base,'search-log.local.jsonl'),JSON.stringify(log)+'\n');await drain();
 }
}
await writeFile(path.join(base,'collector-summary.local.json'),JSON.stringify({added,total:hashes.size,byPublisher:counts,byPublisherTopic:byTopic,requests,blockedHosts:[...blocked],releaseReady:false},null,2));
console.log(JSON.stringify({done:true,added,total:hashes.size,counts,requests,blocked:[...blocked]}));
