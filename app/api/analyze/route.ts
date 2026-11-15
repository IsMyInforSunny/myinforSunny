import {withAudit} from '@/lib/server/with-audit';
import {containsContactInfo} from '@/lib/privacy';
import { analyzeRequestSchema } from '@/lib/contracts';
import { demoAnalysis } from '@/lib/fixtures';
import { analyze } from '@/lib/server/analyze';
import {prepareUrlAnalysis,analyzePreparedUrl} from '@/lib/server/analyze-url';
import {cachedAnalysis} from '@/lib/server/analysis-cache';
import { runtimeConfig } from '@/lib/server/config';
import {REQUEST_TIMEOUT_MS} from '@/lib/server/limits';
import { withBudget } from '@/lib/server/budget';
import { AppError, errorResponse, json, readJson } from '@/lib/server/errors';
import {issueVoiceArticleContext} from '@/lib/server/voice-article-context';
import {issueAnalysisBudgetContext} from '@/lib/server/analysis-budget-context';
import {analysisStream} from '@/lib/server/analysis-stream';
import {buildAnalysisPreview} from '@/lib/analysis-preview';
async function handlePost(request:Request){const requestId=crypto.randomUUID();try{
  const parsed=analyzeRequestSchema.safeParse(await readJson(request));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','입력 내용을 확인해 주세요.',false,parsed.error.issues.map(e=>({path:e.path.join('.'),message:e.message})));
  if(parsed.data.kind==='demo'){try{return json(demoAnalysis(parsed.data.fixtureId));}catch{throw new AppError(422,'VALIDATION_ERROR','등록된 예시를 선택해 주세요.');}}
  if(containsContactInfo([parsed.data.kind==='text'?parsed.data.body:parsed.data.url,parsed.data.proposition??'',...parsed.data.comments.map(c=>c.text)].join('\n')))throw new AppError(422,'PRIVACY_INPUT_REJECTED','전화번호·이메일 등 개인정보를 지우고 다시 입력해 주세요.');
  const req=parsed.data;const config=await runtimeConfig();
  const perform=async(signal:AbortSignal,emit?:(event:string,data:unknown)=>void)=>{
    const scopedRequest=new Request(request.url,{method:'POST',headers:request.headers,signal});
    const prepared=req.kind==='url'?await prepareUrlAnalysis(req,config,requestId,AbortSignal.any([signal,AbortSignal.timeout(REQUEST_TIMEOUT_MS)])):null;
    const textInput=prepared?.input??req as Extract<typeof req,{kind:'text'}>;
    if(emit)emit('preview',buildAnalysisPreview(textInput,prepared?.article.title));
    const result=await cachedAnalysis(scopedRequest,req,config,requestId,sharedSignal=>{
      const budgetRequest=new Request(request.url,{method:'POST',headers:request.headers,signal:sharedSignal??signal});
      return withBudget(budgetRequest,config,requestId,REQUEST_TIMEOUT_MS,(activeConfig,activeSignal)=>prepared?analyzePreparedUrl(prepared,activeConfig,requestId,activeSignal):analyze(textInput,activeConfig,requestId,activeSignal));
    },prepared?{articleHash:prepared.articleHash}:{});
    const articleContextToken=await issueVoiceArticleContext(scopedRequest,config,result.analysis);
    const analysisContextToken=await issueAnalysisBudgetContext(scopedRequest,config,result.analysis);
    return {analysis:{...result.analysis,...(articleContextToken?{articleContextToken}:{}),...(analysisContextToken?{analysisContextToken}:{})},cache:result.cache};
  };
  if(request.headers.get('Accept')?.includes('text/event-stream'))return analysisStream(request,requestId,async(emit,signal)=>(await perform(signal,emit)).analysis);
  const result=await perform(request.signal);
  return json(result.analysis,200,{'X-Analysis-Cache':result.cache});
}catch(error){return errorResponse(error,requestId);}}

export const POST=withAudit('analyze',handlePost);
