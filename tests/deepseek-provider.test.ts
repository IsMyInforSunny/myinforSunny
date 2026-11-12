import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {structured} from '../lib/server/language';
import {capabilities,DEEPSEEK_MODEL,providerReady} from '../lib/server/config';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const config={AI_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'synthetic',DEEPSEEK_MODEL,FREE_ONLY:'false',ENABLE_PAID_PROVIDER:'true',PAID_ACTIVATION_CONFIRMED:'true',ENABLE_LIVE_ANALYSIS:'true',DB:{} as D1Database};

describe('official DeepSeek API provider',()=>{
 it('requires a DeepSeek key, the supported model and explicit billed-provider gates',()=>{
  expect(providerReady(config)).toBe(true);
  expect(capabilities(config).live).toBe(true);
  expect(providerReady({...config,DEEPSEEK_API_KEY:''})).toBe(false);
  expect(providerReady({...config,DEEPSEEK_MODEL:'other'})).toBe(false);
  expect(providerReady({...config,PAID_ACTIVATION_CONFIRMED:'false'})).toBe(false);
  expect(capabilities({...config,FREE_ONLY:'true'}).live).toBe(false);
 });

 it('calls the official endpoint in JSON mode and validates the returned object',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{total_tokens:90}}));vi.stubGlobal('fetch',fetch);
  const onUsage=vi.fn();
  expect(await structured({...config,onUsage},z.object({ok:z.boolean()}),'Return JSON',{text:'article'},new AbortController().signal)).toEqual({ok:true});
  const [url,init]=fetch.mock.calls[0],body=JSON.parse(init.body);
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(init.headers.Authorization).toBe('Bearer synthetic');
  expect(body.model).toBe('deepseek-flash');expect(body.reasoning_effort).toBe('none');
  expect(body.response_format).toEqual({type:'json_object'});expect(body.stream).toBe(true);
  expect(body.stream_options).toEqual({include_usage:true});expect(body.max_tokens).toBe(8192);
  expect(onUsage).toHaveBeenCalledWith(90);
 });

 it('joins streaming content and ignores reasoning-only fields',async()=>{
  const encoder=new TextEncoder();
  const wire=['data: '+JSON.stringify({choices:[{delta:{reasoning_content:'private'}}]}),'data: '+JSON.stringify({choices:[{delta:{content:'{"ok":'}}]}),'data: '+JSON.stringify({choices:[{delta:{content:'true}'},finish_reason:'stop'}],usage:{total_tokens:12}}),'data: [DONE]'].join('\n\n')+'\n\n';
  const bytes=encoder.encode(wire);const stream=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(stream,{headers:{'Content-Type':'text/event-stream'}})));
  const onUsage=vi.fn();expect(await structured({...config,onUsage},z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).toEqual({ok:true});
  expect(onUsage).toHaveBeenCalledWith(12);
 });

 it('refuses an incomplete or invalid result instead of accepting partial JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'length',message:{content:'{"ok":'}}]})));
  await expect(structured(config,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
 });
});
