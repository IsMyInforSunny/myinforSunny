/** Aggregate previously computed article coordinates. This command makes no API requests. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildIssueQuarterBaselines,issueQuarterCoordinateRange} from '../lib/issue-quarter-baseline.ts';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const argumentsList=process.argv.slice(2),args=new Map();
for(let index=0;index<argumentsList.length;index++){
  const name=argumentsList[index];
  if(!['--input','--output','--report','--recommendations','--training-hashes'].includes(name)||!argumentsList[index+1])throw new Error('Use --input coordinates.jsonl --output .sites-runtime/baselines.json [--report report.json] [--recommendations .sites-runtime/recommendations.json] [--training-hashes hashes.json]');
  if(args.has(name))throw new Error('Duplicate option');
  args.set(name,argumentsList[++index]);
}
if(!args.has('--input')||!args.has('--output'))throw new Error('--input and --output are required');
const within=(parent,child)=>child.startsWith(parent+path.sep);
function destination(value,localOnly=false){
  const resolved=path.resolve(value);
  const relative=path.relative(root,resolved);
  if(path.extname(resolved)!=='.json'||relative.split(path.sep).some(part=>['.git','.codex','.agents','node_modules'].includes(part))
    ||!within(root,resolved)||localOnly&&!within(path.join(root,'.sites-runtime'),resolved))throw new Error(localOnly?'Recommendation rows must remain inside .sites-runtime':'Output must remain inside this project');
  return resolved;
}
async function atomicJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+`.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n','utf8');
  await rename(temporary,file);
}
function parseRows(text){
  const content=text.replace(/^\uFEFF/,'').trim();
  if(!content)return [];
  let parsed;
  try{parsed=JSON.parse(content);}catch{parsed=undefined;}
  const rows=parsed===undefined?content.split(/\r?\n/).filter(Boolean).map(JSON.parse)
    :Array.isArray(parsed)?parsed:parsed&&Array.isArray(parsed.articles)?parsed.articles:parsed?[parsed]:[];
  return rows.flatMap(row=>Array.isArray(row?.coordinates)?row.coordinates.map(coordinate=>({...row.article,...coordinate})):row);
}
const inputFile=path.resolve(args.get('--input'));
const outputFile=destination(args.get('--output'));
const reportFile=args.has('--report')?destination(args.get('--report')):null;
const recommendationsFile=args.has('--recommendations')?destination(args.get('--recommendations'),true):null;
const destinations=[outputFile,reportFile,recommendationsFile].filter(Boolean);
if(new Set(destinations).size!==destinations.length||destinations.includes(inputFile)
  ||args.has('--training-hashes')&&destinations.includes(path.resolve(args.get('--training-hashes'))))throw new Error('Outputs must be distinct from source files and each other');
const input=await readFile(inputFile,'utf8');
const rows=parseRows(input);
const trainingHashes=args.has('--training-hashes')?JSON.parse(await readFile(path.resolve(args.get('--training-hashes')),'utf8')):[];
if(!Array.isArray(trainingHashes)||trainingHashes.some(hash=>typeof hash!=='string'))throw new Error('Training hashes must be a JSON string array');
const baselines=buildIssueQuarterBaselines(rows,{trainingHashes});
const report={schemaVersion:'issue-quarter-baseline-report-1.0',generatedAt:baselines.generatedAt,researchOnly:true,usageReviewed:false,
  sourceDigest:createHash('sha256').update(input).digest('hex'),inputArticleCount:baselines.inputArticleCount,
  acceptedArticleCount:baselines.acceptedArticleCount,pointArticleCount:baselines.pointArticleCount,rangeArticleCount:baselines.rangeArticleCount,
  coordinateCoverage:rows.length?baselines.acceptedArticleCount/rows.length:0,
  rangeShare:baselines.acceptedArticleCount?baselines.rangeArticleCount/baselines.acceptedArticleCount:0,
  modelVersions:[...new Set(rows.map(row=>row?.modelVersion).filter(Boolean))],
  readyGroupCounts:Object.fromEntries(['quarter','half','all'].map(kind=>[kind,baselines.groups.filter(group=>group.period.kind===kind&&group.status==='ready').length])),
  insufficientGroupCount:baselines.groups.filter(group=>group.status==='insufficient').length,exclusions:baselines.exclusions,
  scope:'Point coordinates determine weighted distribution boundaries. Eligible range coordinates are counted separately. Each contributing publisher needs three point articles and at least two publishers are required. No API or embedding requests were made by this aggregation command.'};
await atomicJson(outputFile,baselines);
if(reportFile)await atomicJson(reportFile,report);
if(recommendationsFile){
  const training=new Set(trainingHashes),seen=new Set();
  const candidates=rows.flatMap(row=>{
    const range=issueQuarterCoordinateRange(row);
    if(!range||training.has(row.bodyHash)||seen.has(row.bodyHash)||typeof row.url!=='string'||typeof row.title!=='string')return [];
    let url;try{url=new URL(row.url);}catch{return [];}
    if(url.protocol!=='https:'||url.username||url.password||url.port)return [];
    seen.add(row.bodyHash);
    return [{id:row.id,bodyHash:row.bodyHash,title:row.title,url:url.href,publisher:row.publisher,publishedAt:row.publishedAt,
      topic:row.topic,issue:row.issue,method:row.method,modelVersion:row.modelVersion,version:row.version,
      decisionPolicy:row.decisionPolicy,issuePolicy:row.issuePolicy,axis:row.axis,coordinate:row.coordinate,bounds:row.bounds,
      directional:row.directional,unresolved:row.unresolved,trainingOriginal:false,usageApproved:row.usageApproved===true}];
  });
  await atomicJson(recommendationsFile,{schemaVersion:'issue-quarter-recommendations-1.0',researchOnly:true,generatedAt:baselines.generatedAt,articles:candidates});
}
console.log(JSON.stringify(report));
