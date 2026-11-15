import {afterEach,describe,expect,it,vi} from 'vitest';
import {demoAnalysis} from '../lib/fixtures';
import {ANALYSIS_PROMPT_VERSION} from '../lib/contracts';
import {modelName,type RuntimeConfig} from '../lib/server/config';
import {issueAnalysisBudgetContext,readAnalysisBudgetContext} from '../lib/server/analysis-budget-context';

const config:RuntimeConfig={AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic-context',ENABLE_LIVE_ANALYSIS:'true'};
const request=(actor='one')=>new Request('http://localhost/api/analyze',{headers:{'cf-connecting-ip':actor}});
const analysis=()=>({...demoAnalysis('supported'),mode:'live' as const,versions:{...demoAnalysis('supported').versions,prompt:ANALYSIS_PROMPT_VERSION,model:modelName(config)}});
afterEach(()=>vi.useRealTimers());

describe('server-signed follow-up request groups',()=>{
 it('accepts the original sources and any subset of extracted claims despite property-order changes',async()=>{
  const value=analysis(),token=await issueAnalysisBudgetContext(request(),config,value);
  const sources=value.sources.map(source=>({...source,sentences:source.sentences.map(unit=>({...unit}))}));
  const claims=value.claims.slice(0,1).map(claim=>({origin:claim.origin,kind:claim.kind,text:claim.text,id:claim.id,...(claim.targetTime?{targetTime:claim.targetTime}:{})}));
  expect(await readAnalysisBudgetContext(request(),config,{sources,claims,analysisContextToken:token})).toBe(value.requestId);
 });
 it('rejects edited sources, new claims, another actor, a new model and a forged token',async()=>{
  const value=analysis(),token=await issueAnalysisBudgetContext(request(),config,value);
  const input={sources:value.sources,claims:value.claims,analysisContextToken:token};
  await expect(readAnalysisBudgetContext(request(),config,{...input,sources:value.sources.map(source=>({...source,text:source.text+' changed'}))})).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  await expect(readAnalysisBudgetContext(request(),config,{...input,claims:value.claims.map(claim=>({...claim,text:claim.text+' changed'}))})).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  await expect(readAnalysisBudgetContext(request('other'),config,input)).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
  await expect(readAnalysisBudgetContext(request(),{...config,NVIDIA_MODEL:'nvidia/nemotron-3.5-lightning-30b-a3b'},input)).rejects.toMatchObject({code:'RESEARCH_INPUT_CHANGED'});
  await expect(readAnalysisBudgetContext(request(),config,{...input,analysisContextToken:'invalid.signature'})).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
 });
 it('leaves legacy follow-ups without a token on their existing accounting path and skips demos',async()=>{
  const value=analysis();
  expect(await readAnalysisBudgetContext(request(),config,{sources:value.sources,claims:value.claims})).toBeUndefined();
  expect(await issueAnalysisBudgetContext(request(),config,{...value,mode:'demo'})).toBeUndefined();
 });
 it('expires the analysis group after thirty minutes',async()=>{
  vi.useFakeTimers();const value=analysis(),token=await issueAnalysisBudgetContext(request(),config,value);
  vi.setSystemTime(Date.now()+31*60000);
  await expect(readAnalysisBudgetContext(request(),config,{sources:value.sources,claims:value.claims,analysisContextToken:token})).rejects.toMatchObject({code:'INVALID_RESEARCH_EVIDENCE'});
 });
});
