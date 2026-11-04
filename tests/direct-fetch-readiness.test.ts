import {describe,expect,it} from 'vitest';
import {capabilities,type RuntimeConfig} from '../lib/server/config';

const config:RuntimeConfig={AI_PROVIDER:'groq',GROQ_API_KEY:'synthetic-only',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',ENABLE_LIVE_ANALYSIS:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_TPD:'200000',GROQ_CONSOLE_RPD:'1000',DB:{} as D1Database,ENABLE_DIRECT_FETCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example'};

describe('검색과 독립적인 공개 주소 취득 준비 조건',()=>{
 it('검색을 활성화하지 않아도 직접 취득만 준비할 수 있다',()=>{
  expect(capabilities(config)).toMatchObject({live:true,webSearch:false,webFetch:true,directFetch:true});
 });
 it('명시적 취득 설정·출처 승인·허용 호스트·분석 준비가 없으면 취득하지 않는다',()=>{
  for(const patch of [{ENABLE_DIRECT_FETCH:'false'},{NEWS_TERMS_APPROVED:'false'},{ALLOWED_RETRIEVAL_HOSTS:''},{DB:undefined},{ENABLE_LIVE_ANALYSIS:'false'}])expect(capabilities({...config,...patch})).toMatchObject({webFetch:false,directFetch:false});
 });
 it('직접 취득 설정으로 Firecrawl의 계정 확인을 우회하지 않는다',()=>{
  expect(capabilities({...config,NEWS_PROVIDER:'firecrawl'})).toMatchObject({webSearch:false,webFetch:false,directFetch:false});
 });
 it('기존 검색 연결만 준비된 경우 직접 취득 폼은 활성화하지 않는다',()=>{
  expect(capabilities({...config,ENABLE_NEWS_SEARCH:'true',ENABLE_DIRECT_FETCH:'false'})).toMatchObject({webSearch:true,webFetch:true,directFetch:false});
 });
});
