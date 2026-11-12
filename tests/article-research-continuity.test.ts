import {readFileSync,existsSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {analyzeRequestSchema} from '../lib/contracts';
import {locate,makeSources} from '../lib/domain';
import {validateVerifyInput} from '../lib/server/verify';
import {validateResearch} from '../lib/server/research';

// Retained real articles stay ignored and are never copied into tests or Git.
const corpusPath=new URL('../.sites-runtime/collection-1000-20261105/articles-reviewed-3000.local.jsonl',import.meta.url);
describe.skipIf(!existsSync(corpusPath))('retained real article continues from analysis to research',()=>{
 it('accepts an actual article over 2,000 characters and 24 sentence units',()=>{
  const rows=readFileSync(corpusPath,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line) as {text:string});
  const row=rows.find(row=>row.text.length>2000&&row.text.length<=8000&&makeSources({kind:'text',body:row.text,comments:[]})[0].sentences.length>24);
  expect(row).toBeDefined();
  const req=analyzeRequestSchema.parse({kind:'text',body:row!.text,comments:[],transmissionConsent:true});
  if(req.kind!=='text')throw Error('Expected text');
  const sources=makeSources(req),sentence=sources[0].sentences[0];
  const quote=row!.text.slice(sentence.start,sentence.end);
  const claims=[{id:'real_claim',text:quote,kind:'factual' as const,origin:[locate(sources,{sentenceId:sentence.id,quote})!]}];
  const verification={kind:'text' as const,sources,claims,references:[],useWebSearch:false as const};
  expect(()=>validateVerifyInput(verification)).not.toThrow();
  expect(()=>validateResearch({sources,claims,transmissionConsent:true,researchConsent:true})).not.toThrow();
  const altered=structuredClone(verification);altered.sources[0].sentences[0].end++;
  expect(()=>validateVerifyInput(altered)).toThrow();
 });
});
