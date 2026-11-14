import {withAudit} from '@/lib/server/with-audit';
import {containsContactInfo} from '@/lib/privacy';
import { analyzeRequestSchema } from '@/lib/contracts';
import { demoAnalysis } from '@/lib/fixtures';
import { analyze } from '@/lib/server/analyze';
import {analyzeUrl} from '@/lib/server/analyze-url';
import {cachedAnalysis} from '@/lib/server/analysis-cache';
import { runtimeConfig } from '@/lib/server/config';
import {REQUEST_TIMEOUT_MS} from '@/lib/server/limits';
import { withBudget } from '@/lib/server/budget';
import { AppError, errorResponse, json, readJson } from '@/lib/server/errors';
import {issueVoiceArticleContext} from '@/lib/server/voice-article-context';
async function handlePost(request:Request){const requestId=crypto.randomUUID();try{
  const parsed=analyzeRequestSchema.safeParse(await readJson(request));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','입력 내용을 확인해 주세요.',false,parsed.error.issues.map(e=>({path:e.path.join('.'),message:e.message})));
  if(parsed.data.kind==='demo'){try{return json(demoAnalysis(parsed.data.fixtureId));}catch{throw new AppError(422,'VALIDATION_ERROR','등록된 예시를 선택해 주세요.');}}
  if(containsContactInfo([parsed.data.kind==='text'?parsed.data.body:parsed.data.url,parsed.data.proposition??'',...parsed.data.comments.map(c=>c.text)].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','전화번호·이메일 등 개인정보를 지우고 다시 입력해 주세요.');
  const req=parsed.data;const config=await runtimeConfig();
  const result=await cachedAnalysis(request,req,config,requestId,()=>withBudget(request,config,requestId,REQUEST_TIMEOUT_MS,(activeConfig,signal)=>req.kind==='url'?analyzeUrl(req,activeConfig,requestId,signal):analyze(req,activeConfig,requestId,signal)));
  const articleContextToken=await issueVoiceArticleContext(request,config,result.analysis);
  return json({...result.analysis,...(articleContextToken?{articleContextToken}:{})},200,{'X-Analysis-Cache':result.cache});
}catch(error){return errorResponse(error,requestId);}}

export const POST=withAudit('analyze',handlePost);
