/** Explicit opt-in: synthetic public documents only. No search service is contacted. */
import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {makeSources} from '../lib/domain';
import {verify} from '../lib/server/verify';
import {verifiedRecommendations} from '../lib/reliability';
import {createRun,safeFailure} from './helpers/pilot-artifacts';
afterEach(()=>vi.unstubAllGlobals());
describe.runIf(process.env.RUN_GROQ_RESEARCH_PILOT==='true')('실제 무료 Groq · 자료 대조와 의견 구분 선별 시험',()=>{
 it('다른 수치와 다른 입장을 각각 실제 자료 인용으로 복원한다',async()=>{
  const path=process.env.GROQ_PILOT_KEY_FILE;if(!path)throw Error('Approved key file path missing');
  const key=readFileSync(path,'utf8').replace(/^\uFEFF/,'').match(/^\s*GROQ_API_KEY\s*=\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m)?.[1];
  if(!key||!/^gsk_[A-Za-z0-9_-]{20,}$/.test(key))throw Error('Approved key format invalid');
  const sources=makeSources({kind:'text',body:'가상 학교 도서관은 평일 오후 6시에 문을 닫는다. 도서관 운영 시간을 늘려야 한다.',comments:[]});
  const source=sources[0],s=source.sentences[0],quote=source.text.slice(s.start,s.end);
  const claim={id:'factual',kind:'factual' as const,text:quote,origin:[{sourceId:source.id,sentenceId:s.id,start:s.start,end:s.end,quote}]};
  const text='가상 학교 도서관은 평일 오후 9시에 문을 닫는다. 담당자는 야간 안전 관리 인력이 부족하므로 도서관 운영 시간을 더 늘려서는 안 된다는 입장이다.';
  const run=createRun('.sites-runtime/groq-research');let tokens=0;let observed:unknown;
  const realFetch=globalThis.fetch;
  vi.stubGlobal('fetch',async(...args:Parameters<typeof fetch>)=>{const response=await realFetch(...args);if(response.ok){const data=await response.clone().json() as {choices?:{message?:{content?:string}}[]};const content=data.choices?.[0]?.message?.content;if(typeof content==='string')run.writeRaw(0,content);}return response;});
  try{
   const result=await verify({kind:'text',sources,claims:[claim],references:[],useWebSearch:false},{AI_PROVIDER:'groq',GROQ_API_KEY:key,GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',onUsage:n=>{tokens+=n;}},'research-pilot',AbortSignal.timeout(60000),[{id:'r1',provenance:'web_fetched',url:'https://news.example/synthetic',title:'시험용 가상 자료 · 실제 취득 아님',text,truncated:false,fetchedAt:new Date().toISOString()}],'도서관 운영 시간을 늘려야 한다.');
   observed=result;run.writeResults([{caseId:'synthetic-research',tokens,result}],{realProvider:true,realSearch:false,syntheticReferences:true,independentHumanEvaluation:false});
   expect(result.checks[0].outcome).toBe('contradicted');expect(result.perspectiveChecks?.[0].stance).toBe('opposes_position');
   for(const relation of result.checks[0].relations)expect(text.slice(relation.start,relation.end)).toBe(relation.quote);
   expect(verifiedRecommendations([result])[0].kind).toBe('opposing_view');
   console.log(JSON.stringify({caseId:'synthetic-research',tokens,outcome:result.checks[0].outcome,stance:result.perspectiveChecks?.[0].stance}));
  }catch(e){run.writeResults([{caseId:'synthetic-research',tokens,result:observed,...safeFailure(e)}],{realProvider:true,realSearch:false,syntheticReferences:true,independentHumanEvaluation:false});throw e;}
 },80000);
});
