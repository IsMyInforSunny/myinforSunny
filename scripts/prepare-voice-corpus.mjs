// Shares the production segmenter. Article bodies/URLs and AI labels stay local.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const args=process.argv.slice(2);
const stratifyQuarter=args.includes('--stratify-quarter');
if(args.some(value=>value.startsWith('--')&&value!=='--stratify-quarter'))throw Error('Unknown preparation option');
const [input,output,topic='nuclear_energy',countText='130']=args.filter(value=>value!=='--stratify-quarter');
const root=process.cwd(),count=Number(countText);
const local=path.resolve(root,'.sites-runtime');
if(!input||!output||!Number.isInteger(count)||count<1||count>3000)throw Error('input output topic [articleCount] required');
const destination=path.resolve(output);
if(!destination.startsWith(local+path.sep))throw Error('Corpus output must stay beneath .sites-runtime');
if(fs.existsSync(destination))throw Error('Preserve the existing corpus; select a new output path');
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom',resolve:{alias:{'@':root}}});
try{
 const {voiceAnnotationInput,voiceArticleHash,VOICE_TOPICS}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {classifyArticleFormat}=await server.ssrLoadModule('/lib/article-comparison-groups.ts');
 const {issueQuarterPeriods}=await server.ssrLoadModule('/lib/issue-quarter-baseline.ts');
 if(!VOICE_TOPICS[topic])throw Error('Unknown topic');
 const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.topicId===topic);
 const strata=new Map();
 const quarterFor=row=>issueQuarterPeriods(row.publishedAt).find(period=>period.kind==='quarter')?.key??'unknown';
 const keyFor=row=>stratifyQuarter?`${row.publisherId}:${quarterFor(row)}:${row.voiceFormat}`:`${row.publisherId}:${row.voiceFormat}`;
 for(const row of rows){
  const format=classifyArticleFormat({body:row.text,title:row.title??'',section:row.section??''}).id;
  const prepared={...row,voiceFormat:format};
  const key=keyFor(prepared);if(!strata.has(key))strata.set(key,[]);strata.get(key).push(prepared);
 }
 // Deterministic hash-order within source/format strata, round-robin across strata.
 for(const values of strata.values())values.sort((a,b)=>String(a.contentHash??a.id).localeCompare(String(b.contentHash??b.id)));
 let orderedStrata=[...strata.values()];
 if(stratifyQuarter){
  // Interleave publishers before partial budgets can exhaust the first source.
  // Quarter hash order avoids always selecting the earliest calendar periods.
  const quarterRank=value=>createHash('sha256').update(value).digest('hex');
  const publisherQueues=new Map();
  for(const values of orderedStrata){
   const publisher=values[0].publisherId;
   if(!publisherQueues.has(publisher))publisherQueues.set(publisher,[]);
   publisherQueues.get(publisher).push(values);
  }
  for(const queue of publisherQueues.values())queue.sort((left,right)=>
   quarterRank(quarterFor(left[0])).localeCompare(quarterRank(quarterFor(right[0])))||left[0].voiceFormat.localeCompare(right[0].voiceFormat));
  orderedStrata=[];
  const queues=[...publisherQueues.entries()].sort(([left],[right])=>left.localeCompare(right)).map(([,queue])=>queue);
  while(queues.some(queue=>queue.length))for(const queue of queues)if(queue.length)orderedStrata.push(queue.shift());
 }
 const selected=[],seen=new Set(),publisherCounts=new Map(),attempts=new Map();
 while(selected.length<count&&orderedStrata.some(values=>values.length)){
  // Duplicate exclusions must not leave the affected publisher undersampled.
  const candidates=stratifyQuarter?[orderedStrata.filter(values=>values.length).sort((left,right)=>
   (publisherCounts.get(left[0].publisherId)??0)-(publisherCounts.get(right[0].publisherId)??0)
    ||(attempts.get(left)??0)-(attempts.get(right)??0))[0]]:orderedStrata;
  for(const values of candidates){
   const row=values.shift();if(!row||selected.length>=count)continue;
   attempts.set(values,(attempts.get(values)??0)+1);
   const voice=voiceAnnotationInput(row.text,topic),text=row.text.slice(0,2000),hash=await voiceArticleHash(text);
   if(seen.has(hash))continue;seen.add(hash);
   selected.push({...row,text,voiceVersion:voice.version,segmenter:voice.segmenter,scopeCharacters:voice.scopeCharacters,
     sentences:voice.sentences,voiceHash:hash,voiceSampling:stratifyQuarter?'publisher-quarter-format-round-robin-hash-order':'publisher-format-round-robin-hash-order'});
   publisherCounts.set(row.publisherId,(publisherCounts.get(row.publisherId)??0)+1);
  }
 }
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,selected.map(row=>JSON.stringify(row)).join('\n')+'\n',{flag:'wx'});
 console.log(JSON.stringify({articles:selected.length,sentences:selected.reduce((n,row)=>n+row.sentences.length,0),topic,
  stratifyQuarter,strata:Object.fromEntries([...strata.keys()].map(key=>[key,selected.filter(row=>keyFor(row)===key).length]))}));
}finally{await server.close();}
