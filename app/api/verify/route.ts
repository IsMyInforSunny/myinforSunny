import {withAudit} from '@/lib/server/with-audit';
import {containsContactInfo} from '@/lib/privacy';
import { verifyRequestSchema } from '@/lib/contracts';
import { demoVerification } from '@/lib/fixtures';
import { verify } from '@/lib/server/verify';
import { capabilities, runtimeConfig } from '@/lib/server/config';
import {REQUEST_TIMEOUT_MS} from '@/lib/server/limits';
import { withBudget } from '@/lib/server/budget';
import { AppError, errorResponse, json, readJson } from '@/lib/server/errors';
async function handlePost(request:Request){const requestId=crypto.randomUUID();try{
  const parsed=verifyRequestSchema.safeParse(await readJson(request));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','선택한 주장과 자료를 확인해 주세요.',false,parsed.error.issues.map(e=>({path:e.path.join('.'),message:e.message})));
  if(parsed.data.kind==='demo'){try{return json(demoVerification(parsed.data.fixtureId));}catch{throw new AppError(422,'VALIDATION_ERROR','등록된 예시를 선택해 주세요.');}}
  if(containsContactInfo([...parsed.data.sources.map(s=>s.text),...parsed.data.claims.map(c=>c.text),...parsed.data.references.flatMap(r=>[r.text??'',r.url??''])].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','전화번호·이메일 등 개인정보를 지우고 다시 입력해 주세요.');
  const req=parsed.data;const config=await runtimeConfig();
  // Without reference text nothing is sent to the provider, so no D1 reservation or request quota is consumed.
  // Capability gating and full input validation (inside verify) are unchanged.
  if(!req.references.some(r=>r.text)){
    if(!capabilities(config).live)throw new AppError(503,'FEATURE_UNAVAILABLE','실시간 분석은 준비 중입니다. 예시 체험을 이용해 주세요.');
    return json(await verify(req,config,requestId,AbortSignal.any([request.signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)])));
  }
  return json(await withBudget(request,config,requestId,REQUEST_TIMEOUT_MS,(budgeted,signal)=>verify(req,budgeted,requestId,signal)));
}catch(error){return errorResponse(error,requestId);}}

export const POST=withAudit('verify',handlePost);
