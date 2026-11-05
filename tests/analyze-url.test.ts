import {afterEach,describe,expect,it,vi} from 'vitest';
import {analyzeRequestSchema} from '../lib/contracts';
import {demoAnalysis} from '../lib/fixtures';
import {analyzeUrl} from '../lib/server/analyze-url';
import type {RuntimeConfig} from '../lib/server/config';
import * as retrieval from '../lib/server/retrieval';
import * as analysis from '../lib/server/analyze';
import {POST} from '../app/api/analyze/route';
const config:RuntimeConfig={AI_PROVIDER:'groq',ENABLE_LIVE_ANALYSIS:'true',GROQ_API_KEY:'synthetic-not-real',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',GROQ_CONSOLE_LIMITS_CONFIRMED:'true',GROQ_CONSOLE_RPD:'1000',GROQ_CONSOLE_TPD:'200000',ENABLE_DIRECT_FETCH:'true',NEWS_TERMS_APPROVED:'true',ALLOWED_RETRIEVAL_HOSTS:'news.example',DB:{} as D1Database};
const req={kind:'url' as const,url:'https://news.example/article',comments:[],transmissionConsent:true as const};
const call=(input=req,c=config)=>analyzeUrl(input,c,'test_request',AbortSignal.timeout(3000));
function mockBody(text='공개 합성 기사에서 정책의 조건과 영향을 설명합니다. '.repeat(8)){
 vi.spyOn(retrieval,'retrieve').mockResolvedValue({id:'input_article',provenance:'web_fetched',url:req.url,text,title:'합성 기사',fetchedAt:'2026-11-05T00:00:00Z',truncated:false,fullTextLength:text.length});
 return vi.spyOn(analysis,'analyze').mockImplementation(async input=>({...demoAnalysis('mixed'),mode:'live',sources:[{id:'body',kind:'body',text:input.body,sentences:[]}]}));
}
afterEach(()=>vi.restoreAllMocks());
describe('URL article analysis — synthetic sources only',()=>{
 it('requires explicit consent before retrieval',async()=>{
  const fetch=vi.spyOn(retrieval,'retrieve');
  const response=await POST(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...req,transmissionConsent:false})}));
  expect(response.status).toBe(422);expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['http://news.example/article','https://127.0.0.1/article','https://news.example@localhost/article','https://news.example.evil.test/article','https://news.example:8443/article'])('never retrieves an unsafe or unapproved URL: %s',async url=>{
  const fetch=vi.spyOn(retrieval,'retrieve');await expect(call({...req,url})).rejects.toMatchObject({code:'ARTICLE_URL_NOT_ALLOWED'});expect(fetch).not.toHaveBeenCalled();
 });
 it('does not retrieve when direct import is disabled',async()=>{
  const fetch=vi.spyOn(retrieval,'retrieve');await expect(call(req,{...config,ENABLE_DIRECT_FETCH:'false'})).rejects.toMatchObject({code:'ARTICLE_IMPORT_UNAVAILABLE'});expect(fetch).not.toHaveBeenCalled();
 });
 it('uses retrieved body and preserves source metadata',async()=>{
  const model=mockBody();const result=await call();expect(model.mock.calls[0][0]).toMatchObject({kind:'text',transmissionConsent:true,comments:[]});expect(result.article).toMatchObject({url:req.url,title:'합성 기사',truncated:false});expect(result.sources[0].text).toBe(model.mock.calls[0][0].body);
 });
 it('discloses truncation and never expands the model input budget',async()=>{
  const model=mockBody('합성 정책 기사입니다. '.repeat(300));const result=await call();expect(model.mock.calls[0][0].body.length).toBeLessThanOrEqual(2000);expect(result.article?.truncated).toBe(true);expect(result.warnings.some(w=>w.code==='ARTICLE_TRUNCATED')).toBe(true);
 });
 it('does not call the model when no body is available',async()=>{
  const model=mockBody();vi.mocked(retrieval.retrieve).mockResolvedValue(null);await expect(call()).rejects.toMatchObject({code:'ARTICLE_BODY_UNAVAILABLE'});expect(model).not.toHaveBeenCalled();
 });
 it('rejects contact information in fetched text before the model',async()=>{
  const model=mockBody('공개 기사 문장입니다. '.repeat(20)+' 이메일 user@example.com');await expect(call()).rejects.toMatchObject({code:'PRIVACY_INPUT_REJECTED'});expect(model).not.toHaveBeenCalled();
 });
 it('validates URL request and comment bounds',()=>{
  expect(analyzeRequestSchema.safeParse(req).success).toBe(true);expect(analyzeRequestSchema.safeParse({...req,comments:[{id:'c1',text:'가'.repeat(201)}]}).success).toBe(false);
 });
});
