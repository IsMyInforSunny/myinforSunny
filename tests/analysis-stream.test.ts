import {afterEach,describe,expect,it,vi} from 'vitest';
import {analysisStream,analysisStreamCompletion} from '../lib/server/analysis-stream';
import {requestAnalysis} from '../lib/analysis-stream-client';
import {demoAnalysis} from '../lib/fixtures';
import {AppError} from '../lib/server/errors';

afterEach(()=>vi.unstubAllGlobals());
describe('two-stage analysis transport',()=>{
 it('delivers rule preview before the final model result',async()=>{
  let finish!:(value:unknown)=>void;
  const final=new Promise(resolve=>{finish=resolve;});
  const response=analysisStream(new Request('https://site.test'),'test',async emit=>{
   emit('preview',{characters:100,sentences:3,fomoSentences:0,namedSources:1,topic:null});return final;
  });
  vi.stubGlobal('fetch',async()=>response);
  const preview=vi.fn();const result=requestAnalysis({},new AbortController().signal,preview);
  await vi.waitFor(()=>expect(preview).toHaveBeenCalledOnce());
  const analysis=demoAnalysis('no_comments');finish(analysis);
  expect(await result).toMatchObject({analysisId:analysis.analysisId});
  expect(await analysisStreamCompletion(response)).toBe('completed');
 });
 it('preserves structured failures and aborts model work when the reader cancels',async()=>{
  const failed=analysisStream(new Request('https://site.test'),'error',async()=>{throw new AppError(429,'RATE_LIMITED','잠시 후 다시 시도해 주세요.');});
  vi.stubGlobal('fetch',async()=>failed);
  await expect(requestAnalysis({},new AbortController().signal,()=>{})).rejects.toMatchObject({code:'RATE_LIMITED'});
  expect(await analysisStreamCompletion(failed)).toBe('failed');
  let signal:AbortSignal|undefined;
  const response=analysisStream(new Request('https://site.test'),'cancel',async(_emit,active)=>{
   signal=active;await new Promise<void>(resolve=>active.addEventListener('abort',()=>resolve(),{once:true}));return {};
  });
  await response.body!.cancel();expect(signal!.aborted).toBe(true);
  expect(await analysisStreamCompletion(response)).toBe('cancelled');
 });
});
