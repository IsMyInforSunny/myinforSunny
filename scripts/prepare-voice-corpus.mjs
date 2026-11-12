// Shares the production segmenter. Article bodies/URLs and AI labels stay local.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
const [input,output,topic='nuclear_energy',countText='130']=process.argv.slice(2);
const root=process.cwd(),count=Number(countText);
const local=path.resolve(root,'.sites-runtime');
if(!input||!output||!Number.isInteger(count)||count<1||count>3000)throw Error('input output topic [articleCount] required');
const destination=path.resolve(output);
if(!destination.startsWith(local+path.sep))throw Error('Corpus output must stay beneath .sites-runtime');
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',resolve:{alias:{'@':root}}});
try{
 const {voiceAnnotationInput,voiceArticleHash,VOICE_TOPICS}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {classifyArticleFormat}=await server.ssrLoadModule('/lib/article-comparison-groups.ts');
 if(!VOICE_TOPICS[topic])throw Error('Unknown topic');
 const rows=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.topicId===topic);
 const strata=new Map();
 for(const row of rows){
  const format=classifyArticleFormat({body:row.text,title:row.title??'',section:row.section??''}).id;
  const key=`${row.publisherId}:${format}`;if(!strata.has(key))strata.set(key,[]);strata.get(key).push({...row,voiceFormat:format});
 }
 // Deterministic hash-order within source/format strata, round-robin across strata.
 for(const values of strata.values())values.sort((a,b)=>String(a.contentHash??a.id).localeCompare(String(b.contentHash??b.id)));
 const selected=[],seen=new Set();
 while(selected.length<count&&[...strata.values()].some(values=>values.length))for(const values of strata.values()){
  const row=values.shift();if(!row||selected.length>=count)continue;
  const voice=voiceAnnotationInput(row.text,topic),text=row.text.slice(0,2000),hash=await voiceArticleHash(text);
  if(seen.has(hash))continue;seen.add(hash);
  selected.push({...row,text,voiceVersion:voice.version,segmenter:voice.segmenter,scopeCharacters:voice.scopeCharacters,
    sentences:voice.sentences,voiceHash:hash,voiceSampling:'publisher-format-round-robin-hash-order'});
 }
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,selected.map(row=>JSON.stringify(row)).join('\n')+'\n');
 console.log(JSON.stringify({articles:selected.length,sentences:selected.reduce((n,row)=>n+row.sentences.length,0),topic,
  strata:Object.fromEntries([...strata.keys()].map(key=>[key,selected.filter(row=>`${row.publisherId}:${row.voiceFormat}`===key).length]))}));
}finally{await server.close();}
