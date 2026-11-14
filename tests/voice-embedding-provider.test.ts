import {afterEach,describe,expect,it,vi} from 'vitest';
import {inferEmbeddingVoices} from '../lib/server/voice-embedding';
import type {EmbeddingVoiceModel} from '../lib/voice-embedding-model';

// Network/cache boundary fixtures only. No release or article accuracy claims.
function model():EmbeddingVoiceModel{
 const head=(classes:string[],positiveLast=true)=>({classes,coefficients:classes.map((_,index)=>{
  const row=Array(2048).fill(0);row[0]=(index===(positiveLast?1:0)?1:-1);return row;}),intercepts:[0,0]});
 return {version:crypto.randomUUID(),encoder:{model:'nvidia/nemotron-3.5-embed-1b'},topics:{nuclear_energy:{heads:{
  directionality:head(['directional','neutral'],false),polarity:head(['oppose','support']),
  speaker:head(['journalist','source']),issue:head(['none','expansion'])}}}} as unknown as EmbeddingVoiceModel;
}
const config=()=>({AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'provider-test-only',onDispatch:vi.fn(),onUsage:vi.fn(),onRateLimit:vi.fn(async()=>{})});
function response(input:RequestInfo|URL,init?:RequestInit){
 const request=JSON.parse(init!.body as string),vector=Array(2048).fill(0);vector[0]=1;
 return Response.json({model:request.model,data:request.input.map((_:string,index:number)=>({index,embedding:vector})),usage:{total_tokens:42}});
}
afterEach(()=>vi.unstubAllGlobals());
describe('embedding SVM provider boundaries',()=>{
 it('uses the workerd-supported redirect mode and refuses a provider redirect without following it',async()=>{
  const fetcher=vi.fn(async()=>new Response('',{status:307,headers:{Location:'https://other.test/embeddings'}}));vi.stubGlobal('fetch',fetcher);
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',config(),new AbortController().signal,'request:redirect',model())).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]).toBeDefined();
  expect((fetcher.mock.calls as unknown[][])[0][1]).toMatchObject({redirect:'manual'});
 });
 it('reports malformed vector rows as an invalid model response',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({model:'nvidia/nemotron-3.5-embed-1b',data:[null]})));
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',config(),new AbortController().signal,'request:null-row',model())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
 });
 it('does not use cached vectors or dispatch for a cancelled request',async()=>{
  const fetcher=vi.fn(response);vi.stubGlobal('fetch',fetcher);const selected=model(),active=config();
  await inferEmbeddingVoices('원전 확대가 필요하다.','nuclear_energy',active,new AbortController().signal,'public:cancel',selected);
  const controller=new AbortController();controller.abort();
  await expect(inferEmbeddingVoices('원전 확대가 필요하다.','nuclear_energy',active,controller.signal,'public:cancel',selected)).rejects.toMatchObject({name:'AbortError'});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('accounts reported provider usage even when vectors are rejected',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({model:'wrong-model',data:[],usage:{total_tokens:17}})));
  const active=config();
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',active,new AbortController().signal,'request:invalid-usage',model())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(active.onUsage).toHaveBeenCalledWith(17);
 });
 it('reuses the same scoped sentence vectors while keeping pasted-request scopes separate',async()=>{
  const fetcher=vi.fn(response);vi.stubGlobal('fetch',fetcher);const selected=model(),active=config();
  const signal=new AbortController().signal;
  const first=await inferEmbeddingVoices('원전 확대가 필요하다.','nuclear_energy',active,signal,'public:test',selected);
  expect(first!.labels[0]).toMatchObject({direction:'support',speaker:'source',issue:'expansion'});
  await inferEmbeddingVoices('원전 확대가 필요하다.','nuclear_energy',active,signal,'public:test',selected);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(active.onUsage).toHaveBeenCalledWith(42);
  await inferEmbeddingVoices('원전 확대가 필요하다.','nuclear_energy',active,signal,'request:private',selected);
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('stops at rate limits without a retry or another model',async()=>{
  const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'Retry-After':'61'}}));vi.stubGlobal('fetch',fetcher);
  const active=config();
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',active,new AbortController().signal,'request:429',model())).rejects.toMatchObject({code:'RATE_LIMITED'});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(active.onRateLimit).toHaveBeenCalledWith(61);
 });
 it('rejects incomplete vectors and requires the existing provider-budget hook',async()=>{
  const fetcher=vi.fn(async()=>Response.json({model:'nvidia/nemotron-3.5-embed-1b',data:[{index:0,embedding:[1]}]}));vi.stubGlobal('fetch',fetcher);
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',config(),new AbortController().signal,'request:bad',model())).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  await expect(inferEmbeddingVoices('원전 확대.','nuclear_energy',{...config(),onDispatch:undefined},new AbortController().signal,'request:no-budget',model())).rejects.toMatchObject({code:'FEATURE_UNAVAILABLE'});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
