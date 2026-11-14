// Offline retrieval-population feasibility on retained actual articles.
// Does not classify sentences, release a model, or prove recommendation accuracy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localRoot=fs.realpathSync(path.join(root,'.sites-runtime'));
function local(value){
 const target=path.resolve(value);
 if(!target.startsWith(localRoot+path.sep))throw Error('Use local runtime paths');
 let ancestor=target;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const resolved=fs.realpathSync(ancestor);
 if(resolved!==localRoot&&!resolved.startsWith(localRoot+path.sep))throw Error('Path escapes local runtime');
 return target;
}
if(process.argv.length!==5)throw Error('Use CORPUS PREPARED_INPUT OUTPUT within .sites-runtime');
const [corpusPath,preparedPath,outputPath]=process.argv.slice(2).map(local);
if(new Set([corpusPath,preparedPath,outputPath]).size!==3||fs.existsSync(outputPath))throw Error('Preserve existing inputs and reports');
const parse=text=>JSON.parse(text.replace(/^\uFEFF/,''));
const corpus=fs.readFileSync(corpusPath,'utf8').trim().split(/\r?\n/).map(parse);
const prepared=parse(fs.readFileSync(preparedPath,'utf8'));
if(prepared.schemaVersion!=='voice-embedding-input-1.0'||!corpus.length)throw Error('Actual corpus and prepared experiment required');
const trainingIds=new Set(prepared.sets.train.map(row=>row.articleId));
const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true},appType:'custom'});
try{
 const {matchLiveVoiceEvent}=await server.ssrLoadModule('/lib/live-voice-event.ts');
 const {voiceArticleHash}=await server.ssrLoadModule('/lib/sentence-voice.ts');
 const {canonicalPublisherHost}=await server.ssrLoadModule('/lib/source-reliability.ts');
 const records=await Promise.all(corpus.map(async article=>{
  const url=new URL(article.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid retained article URL');
  return {...article,body:article.text,bodyHash:await voiceArticleHash(article.text),publisher:canonicalPublisherHost(url.hostname),time:Date.parse(article.publishedAt)};
 }));
 const trainingHashes=new Set(records.filter(row=>trainingIds.has(row.id)).map(row=>row.bodyHash));
 const unique=new Map();for(const row of records)if(!trainingHashes.has(row.bodyHash)&&Number.isFinite(row.time)&&!unique.has(row.bodyHash))unique.set(row.bodyHash,row);
 const population=[...unique.values()];let matchedPairs=0,possibleAnchors=0,largestComparisonSet=0;
 const counts=[];
 for(const anchor of population){
  const matches=population.filter(candidate=>candidate.bodyHash!==anchor.bodyHash&&Math.abs(candidate.time-anchor.time)<=3*86400000
   &&matchLiveVoiceEvent(anchor,candidate).status==='matched');
  matchedPairs+=matches.length;
  // Count each possible 3-day window containing the anchor. Pairwise proximity
  // alone can otherwise join two sides whose total span exceeds three days.
  let best=0,bestPublishers=0;
  for(const start of new Set([anchor.time,...matches.filter(row=>row.time<=anchor.time).map(row=>row.time)])){
   const groups=new Map();for(const row of matches)if(row.time>=start&&row.time<=start+3*86400000)groups.set(row.publisher,(groups.get(row.publisher)??0)+1);
   const qualified=[...groups.values()].filter(count=>count>=3);
   const count=qualified.reduce((sum,value)=>sum+value,0);
   if(qualified.length>=2&&count>best){best=count;bestPublishers=qualified.length;}
  }
  if(best)possibleAnchors++;largestComparisonSet=Math.max(largestComparisonSet,best);
  counts.push({articleId:anchor.id,matchedArticles:matches.length,possibleComparisonArticles:best,qualifiedPublishers:bestPublishers});
 }
 const summary={sourceArticles:corpus.length,uniqueEligibleArticles:population.length,excludedTrainingHashes:trainingHashes.size,
  pairwiseMatches:matchedPairs/2,possibleAnchors,largestComparisonSet,apiCalls:0,
  meaning:'Retrieval population upper bound before SVM issue, direction, unresolved and fetched-provenance gates. Not working recommendations or accuracy.'};
 fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify({summary,articles:counts},null,2)+'\n');
 console.log(JSON.stringify(summary));
}finally{await server.close();}
