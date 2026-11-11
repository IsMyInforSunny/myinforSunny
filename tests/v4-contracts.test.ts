import {describe,expect,it} from 'vitest';
import {analyzeRequestSchema,verifyRequestSchema} from '../lib/contracts';
import {containsContactInfo} from '../lib/privacy';
import {reportStatus} from '../lib/report-status';
import {demoAnalysis,demoVerification} from '../lib/fixtures';
import {POST as analyzeRoute} from '../app/api/analyze/route';
describe('v4 입력과 표시 계약',()=>{
 it('동의와 축소한 한도를 강제한다',()=>{
  const req={kind:'text',body:'공개 예시',comments:[],transmissionConsent:true};
  expect(analyzeRequestSchema.safeParse(req).success).toBe(true);
  for(const r of [{...req,transmissionConsent:false},{...req,body:'가'.repeat(8001)},{...req,comments:Array.from({length:6},(_,i)=>({id:`c${i}`,text:'댓글'}))}])expect(analyzeRequestSchema.safeParse(r).success).toBe(false);
 });
 it('참고자료와 주장은 한 번에 최대 2개·1개다',()=>{
  const a=demoAnalysis('conflict');const req={kind:'text',sources:a.sources,claims:a.claims,references:[],useWebSearch:false,transmissionConsent:true};
  expect(verifyRequestSchema.safeParse(req).success).toBe(true);
  expect(verifyRequestSchema.safeParse({...req,claims:[...a.claims,...a.claims]}).success).toBe(false);
 });
 it('명확한 연락처는 잡되 공개 통계 숫자를 연락처로 보지 않는다',()=>{
  expect(containsContactInfo('메일 name@example.com')).toBe(true);expect(containsContactInfo('전화 010-1234-5678')).toBe(true);expect(containsContactInfo('42.7%와 2024년 조사')).toBe(false);
 });
 it('실제 API 경계에서도 개인정보를 공급자 호출 전에 거절한다',async()=>{
  const response=await analyzeRoute(new Request('https://site.test/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'text',body:'연락처 name@example.com',comments:[],transmissionConsent:true})}));
  expect(response.status).toBe(422);expect((await response.json() as {error:{code:string}}).error.code).toBe('PRIVACY_INPUT_REJECTED');
 });
 it('표현 유보와 미대조를 정상·안전 등급으로 표시하지 않는다',()=>{
  const a=demoAnalysis('conflict');a.expressions[0].status='undetermined';
  expect(reportStatus(a,[])).toMatchObject({expression:'판단 유보',evidence:'아직 대조하지 않음'});
  expect(reportStatus(a,demoVerification('conflict').checks).evidence).toBe('추가 자료 필요');
 });
});
