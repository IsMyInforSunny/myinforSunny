import {describe,expect,it} from 'vitest';
import {providerFailure} from '../lib/server/language';
describe('외부 API 실패의 원인 구분',()=>{
 it('429여도 크레딧 소진은 재시도 가능한 요청 제한으로 오인하지 않는다',()=>{
  const error=providerFailure(429,'credit_balance_exhausted','insufficient_quota');
  expect(error).toMatchObject({status:503,code:'API_QUOTA_EXHAUSTED',retryable:false});
 });
 it('일반 요청 제한은 재시도를 허용한다',()=>{expect(providerFailure(429,'rate_limit_exceeded')).toMatchObject({status:429,code:'RATE_LIMITED',retryable:true});});
 it('인증·모델 권한·일시 장애를 구분한다',()=>{
  expect(providerFailure(401)).toMatchObject({code:'API_AUTH_FAILED',retryable:false});
  expect(providerFailure(403)).toMatchObject({code:'MODEL_ACCESS_DENIED',retryable:false});
  expect(providerFailure(500)).toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:true});
 });
});
