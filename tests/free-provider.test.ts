import {describe,expect,it,vi,afterEach} from 'vitest';
import {capabilities,providerReady,paidProviderAllowed} from '../lib/server/config';
import {structured} from '../lib/server/language';
import {z} from 'zod/v4';
afterEach(()=>vi.unstubAllGlobals());
describe('v4 이전 제공자 비활성',()=>{
 it('유료 전환은 무료 전용 해제·별도 활성화·명시적 확인을 모두 요구한다',()=>{
  expect(paidProviderAllowed({})).toBe(false);
  expect(paidProviderAllowed({FREE_ONLY:'false',ENABLE_PAID_PROVIDER:'true'})).toBe(false);
  expect(paidProviderAllowed({FREE_ONLY:'false',ENABLE_PAID_PROVIDER:'true',PAID_ACTIVATION_CONFIRMED:'true'})).toBe(true);
  expect(providerReady({AI_PROVIDER:'openai',FREE_ONLY:'false',ENABLE_PAID_PROVIDER:'true',PAID_ACTIVATION_CONFIRMED:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'synthetic'})).toBe(false);
 });
 it('이전 키·무료 제공자 설정으로 활성화되지 않는다',()=>{
  for(const AI_PROVIDER of ['cloudflare','openai','custom-browser']){
   const c={AI_PROVIDER,FREE_ONLY:'false',ENABLE_LIVE_ANALYSIS:'true',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'synthetic',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_AI_TOKEN:'synthetic',DB:{} as D1Database};
   expect(providerReady(c)).toBe(false);expect(capabilities(c).live).toBe(false);
  }
 });
 it('기존 언어 분석 경계에서 네트워크를 호출하지 않는다',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(structured({},z.object({text:z.string()}),'분석',{text:'입력'},new AbortController().signal)).rejects.toMatchObject({code:'FEATURE_UNAVAILABLE'});
  expect(fetch).not.toHaveBeenCalled();
 });
});
