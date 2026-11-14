import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const script=path.join(root,'research','build_issue_quarter_baselines.mjs');
const local=path.join(root,'.sites-runtime');
const row=(id,publisher,coordinate)=>({id,bodyHash:createHash('sha256').update(id).digest('hex'),publisher,
 topic:'nuclear_energy',issue:'expansion',method:'svm',modelVersion:'test-candidate',version:'sentence-voice-1.0',
 decisionPolicy:'voice-neutral-independent-1.0',issuePolicy:'voice-article-issue-1.0',axis:'source',coordinate,
 directional:3,unresolved:0,trainingOriginal:false,publishedAt:'2026-08-01T00:00:00+09:00',
 title:'Local article '+id,url:`https://${publisher}/article/${id}`,text:'This source text must not enter the distribution.'});

test('local aggregate CLI emits reproducible summaries and keeps recommendation approval flags',async()=>{
 await mkdir(local,{recursive:true});const directory=await mkdtemp(path.join(local,'quarter-builder-test-'));
 try{
  const input=path.join(directory,'coordinates.jsonl'),output=path.join(directory,'baseline.json'),report=path.join(directory,'report.json'),recommendations=path.join(directory,'recommendations.json');
  const rows=[...Array.from({length:3},(_,i)=>row('a'+i,'dailian.co.kr',-1)),...Array.from({length:3},(_,i)=>row('b'+i,'pressian.com',1))];
  await writeFile(input,rows.map(JSON.stringify).join('\n')+'\n');
  const args=[script,'--input',input,'--output',output,'--report',report,'--recommendations',recommendations];
  const first=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
  const summary=JSON.parse(await readFile(output,'utf8')),progress=JSON.parse(await readFile(report,'utf8'));
  assert.equal(summary.acceptedArticleCount,6);assert.equal(progress.readyGroupCounts.quarter,1);
  assert.equal(summary.groups[0].median,0);
  assert.equal(JSON.stringify(summary).includes('https://'),false);
  assert.equal(JSON.stringify(summary).includes('source text'),false);
  const localRecommendations=JSON.parse(await readFile(recommendations,'utf8'));
  assert.equal(localRecommendations.articles.length,6);
  assert.equal(localRecommendations.articles.every(article=>article.usageApproved===false),true);
  assert.equal(localRecommendations.articles.some(article=>'text' in article),false);
  const again=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});
  assert.equal(again.status,0,again.stderr);
  const repeated=JSON.parse(await readFile(output,'utf8'));
  assert.deepEqual(repeated.groups,summary.groups);
  const denied=spawnSync(process.execPath,[script,'--input',input,'--output',output,'--recommendations',path.join(root,'lib','data','forbidden-quarter-recommendations.json')],{cwd:root,encoding:'utf8'});
  assert.notEqual(denied.status,0);
 }finally{
  const resolved=path.resolve(directory);
  if(!resolved.startsWith(local+path.sep)||!path.basename(resolved).startsWith('quarter-builder-test-'))throw new Error('Unexpected test cleanup path');
  await rm(resolved,{recursive:true,force:true});
 }
});
