import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {structured} from '../lib/server/language';
import {capabilities,NVIDIA_MODEL,NVIDIA_FAST_MODEL,providerReady} from '../lib/server/config';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const config={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',ENABLE_LIVE_ANALYSIS:'true',DB:{} as D1Database};
describe('NVIDIA DeepSeek adapter',()=>{
 it('supports explicitly selected Lightning without silently falling back from DeepSeek',async()=>{
  const selected={...config,NVIDIA_MODEL:NVIDIA_FAST_MODEL};expect(providerReady(selected)).toBe(true);
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}));vi.stubGlobal('fetch',fetch);
  await structured(selected,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal);
  const body=JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.model).toBe(NVIDIA_FAST_MODEL);expect(body.chat_template_kwargs).toEqual({enable_thinking:false});
  expect(body.max_tokens).toBe(8192);expect(body.reasoning_effort).toBeUndefined();
  expect(body.response_format).toMatchObject({type:'json_schema',json_schema:{name:'article_analysis',strict:true}});
  expect(capabilities(selected)).toMatchObject({aiProvider:'nvidia',aiModel:NVIDIA_FAST_MODEL,live:true});
 });
 it('requires the selected model and secret, without inheriting Groq account limits',()=>{
  expect(providerReady(config)).toBe(true);
  expect(providerReady({...config,NVIDIA_API_KEY:''})).toBe(false);
  expect(providerReady({...config,NVIDIA_MODEL:'other'})).toBe(false);
  expect(capabilities(config).live).toBe(true);
 });
 it('uses the NVIDIA endpoint without app token limits and validates JSON',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{total_tokens:20000}}));vi.stubGlobal('fetch',fetch);
  const onUsage=vi.fn();
  expect(await structured({...config,onUsage},z.object({ok:z.boolean()}),'Return JSON','x'.repeat(40000),new AbortController().signal)).toEqual({ok:true});
  const [url,init]=fetch.mock.calls[0];const body=JSON.parse(init.body);
  expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
  expect(body.model).toBe(NVIDIA_MODEL);expect(body.reasoning_effort).toBe('none');expect(body.max_tokens).toBeUndefined();expect(body.max_completion_tokens).toBeUndefined();expect(onUsage).toHaveBeenCalledWith(20000);
 });
 it('rejects malformed output without fallback or retry',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}));vi.stubGlobal('fetch',fetch);
  await expect(structured(config,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('honors provider cooldown and hides raw errors',async()=>{
  const onRateLimit=vi.fn();const fetch=vi.fn().mockResolvedValue(new Response('private provider detail',{status:429,headers:{'retry-after':'90'}}));vi.stubGlobal('fetch',fetch);
  await expect(structured({...config,onRateLimit},z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'RATE_LIMITED'});expect(onRateLimit).toHaveBeenCalledWith(90);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('joins split SSE frames and ignores private reasoning',async()=>{
  const encoder=new TextEncoder();const wire='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'private reasoning'}}]})+'\r\n\r\n'+'data: '+JSON.stringify({choices:[{delta:{content:'{"ok":'}}]})+'\n\n'+'data: '+JSON.stringify({choices:[{delta:{content:'true}'},finish_reason:'stop'}],usage:{total_tokens:123}})+'\n\n';
  const bytes=encoder.encode(wire);const body=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}});
  const fetch=vi.fn().mockResolvedValue(new Response(body,{headers:{'Content-Type':'text/event-stream'}}));vi.stubGlobal('fetch',fetch);
  const onUsage=vi.fn();expect(await structured({...config,onUsage},z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).toEqual({ok:true});
  expect(JSON.parse(fetch.mock.calls[0][1].body).stream).toBe(true);expect(onUsage).toHaveBeenCalledWith(123);
 });
 it('rejects unfinished streams without accepting partial JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n',{headers:{'Content-Type':'text/event-stream'}})));
  await expect(structured(config,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
 });
 it('stops a DONE-only stream and cancels it instead of waiting for a socket close',async()=>{
  const cancel=vi.fn();const encoder=new TextEncoder();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({start(c){c.enqueue(encoder.encode('data: [DONE]\n\n'));},cancel}),{headers:{'Content-Type':'text/event-stream'}})));
  await expect(structured(config,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(cancel).toHaveBeenCalled();
 });
 it('logs only stage timing and never the request, response or private reasoning',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"reasoning_content":"private-reasoning"}}]}\n\ndata: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}]}\n\n',{headers:{'Content-Type':'text/event-stream'}})));
  await structured(config,z.object({ok:z.boolean()}),'private-prompt',{text:'private-article'},new AbortController().signal);
  const entries=log.mock.calls.map(([line])=>JSON.parse(line));
  expect(entries.map(e=>e.stage)).toEqual(['headers','first_delta','first_content','completed','stream_closed']);
  for(const entry of entries)expect(Object.keys(entry).sort()).toEqual(['durationMs','provider','stage','type']);
 });
 it('cancels the upstream reader on aborted requests',async()=>{
  const cancel=vi.fn();const controller=new AbortController();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(new ReadableStream({cancel}),{headers:{'Content-Type':'text/event-stream'}})));
  const pending=structured(config,z.object({ok:z.boolean()}),'JSON',{},controller.signal);
  await new Promise(resolve=>setTimeout(resolve,10));controller.abort();
  await expect(pending).rejects.toMatchObject({code:'TIMEOUT'});expect(cancel).toHaveBeenCalled();
 });
});
