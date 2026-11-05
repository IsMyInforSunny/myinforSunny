import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {structured} from '../lib/server/language';
import {capabilities,NVIDIA_MODEL,providerReady} from '../lib/server/config';
afterEach(()=>vi.unstubAllGlobals());
const config={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic',ENABLE_LIVE_ANALYSIS:'true',DB:{} as D1Database};
describe('NVIDIA DeepSeek adapter',()=>{
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
  expect(body.model).toBe(NVIDIA_MODEL);expect(body.max_tokens).toBeUndefined();expect(body.max_completion_tokens).toBeUndefined();expect(onUsage).toHaveBeenCalledWith(20000);
 });
 it('rejects malformed output without fallback or retry',async()=>{
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}));vi.stubGlobal('fetch',fetch);
  await expect(structured(config,z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('honors provider cooldown and hides raw errors',async()=>{
  const onRateLimit=vi.fn();const fetch=vi.fn().mockResolvedValue(new Response('private provider detail',{status:429,headers:{'retry-after':'90'}}));vi.stubGlobal('fetch',fetch);
  await expect(structured({...config,onRateLimit},z.object({ok:z.boolean()}),'JSON',{},new AbortController().signal)).rejects.toMatchObject({code:'RATE_LIMITED'});expect(onRateLimit).toHaveBeenCalledWith(90);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
