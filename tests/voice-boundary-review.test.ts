import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {voiceAnnotationInput,voiceArticleHash} from '../lib/sentence-voice';
import {NVIDIA_FAST_MODEL} from '../lib/server/config';

const directories:string[]=[];
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

async function fixture(){
  const directory=mkdtempSync(path.resolve('.sites-runtime/boundary-review-test-'));directories.push(directory);
  const text='A source makes a policy claim. A reporter describes the announcement.';
  const scope=voiceAnnotationInput(text,'nuclear_energy'),articleHash=await voiceArticleHash(text);
  const article={id:'retained-contract',topicId:'nuclear_energy',text,voiceHash:articleHash,sentences:scope.sentences};
  const corpus=path.join(directory,'corpus.jsonl'),queueFile=path.join(directory,'queue.json'),output=path.join(directory,'drafts.jsonl');
  writeFileSync(corpus,JSON.stringify(article)+'\n');
  const queue={schemaVersion:'voice-targeted-review-1.0',researchOnly:true,sourceDigests:{corpus:sha(readFileSync(corpus))},requests:[{
    articleId:article.id,articleHash,topic:article.topicId,sentences:[{sentenceId:scope.sentences[0].sentenceId,text:scope.sentences[0].text,
      rawLabel:{sentenceId:scope.sentences[0].sentenceId,issue:'expansion',direction:'uncertain',speaker:'source'}}],
  }]};
  writeFileSync(queueFile,JSON.stringify(queue));
  const run=(maximum='2')=>spawnSync(process.execPath,['scripts/review-voice-boundaries.mjs','--queue',queueFile,'--corpus',corpus,
    '--output',output,'--max-articles',maximum],{encoding:'utf8',env:{...process.env,NVIDIA_API_KEY:''},timeout:30000});
  return {directory,articleHash,corpus,queue,queueFile,output,run};
}

describe('targeted offline boundary review contract',()=>{
  it('dry-runs only selected sentence IDs without credentials or output writes',async()=>{
    const {run}=await fixture();const result=run();
    expect(result.status,result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({mode:'dry-run',queuedArticles:1,selectedArticles:1,targetSentences:1,draftOnly:true,humanEvaluationCount:0,minimumDispatchIntervalMs:20000});
  });
  it('rejects a corpus whose content changed after queue preparation',async()=>{
    const {corpus,run}=await fixture();writeFileSync(corpus,readFileSync(corpus,'utf8').replace('A source','Another source'));
    expect(run().status).not.toBe(0);
  });
  it('skips only valid completed drafts with exact queue and target identity',async()=>{
    const {articleHash,corpus,queue,queueFile,output,run}=await fixture();
    const targetSentenceIds=queue.requests[0].sentences.map(unit=>unit.sentenceId);
    const draft={articleId:'retained-contract',articleHash,queueDigest:sha(readFileSync(queueFile)),corpusDigest:sha(readFileSync(corpus)),
      status:'draft',draftOnly:true,targetSentenceIds,labels:[{sentenceId:targetSentenceIds[0],issue:'expansion',direction:'uncertain',speaker:'source'}],
      annotator:{kind:'ai',model:NVIDIA_FAST_MODEL,version:'voice-boundary-review-1.0'}};
    writeFileSync(output,JSON.stringify(draft)+'\n');
    const completed=run();expect(completed.status,completed.stderr).toBe(0);
    expect(JSON.parse(completed.stdout)).toMatchObject({completedArticles:1,selectedArticles:0});
    draft.labels=[];writeFileSync(output,JSON.stringify(draft)+'\n');
    expect(run().status).not.toBe(0);
  });
  it('requires a small explicit article limit',async()=>{
    const {run}=await fixture();expect(run('6').status).not.toBe(0);expect(run('0').status).not.toBe(0);
  });
});
