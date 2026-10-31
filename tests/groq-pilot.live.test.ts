/** Explicit opt-in only. Reads the approved key file in memory; never prints/copies the key. */
import {afterAll,beforeAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createRun,safeFailure} from './helpers/pilot-artifacts';
import {analyze} from '../lib/server/analyze';
import {verify} from '../lib/server/verify';
import {assertAnalysis,makeSources,bodyTopicDistribution} from '../lib/domain';
import type {Analysis} from '../lib/contracts';
const enabled=process.env.RUN_GROQ_PILOT==='true';
const cases=JSON.parse(readFileSync('research/llm-pilot-cases.json','utf8')) as {cases:{id:string;body:string;comments:{id:string;text:string}[];manualReviewFocus:string}[]};
if(process.env.PILOT_ARTICLE==='true')cases.cases.push({id:'article',body:'가상 학교 도서관은 이번 학기에 평일 오후 6시에 문을 닫는다. 운영 시간을 더 늘리면 좋겠다.',comments:[],manualReviewFocus:'본문 논점·사실과 제안 분리·다른 관점'});
const results:unknown[]=[];let lastDispatch=0;let halted=false;let number=0;let run:ReturnType<typeof createRun>|undefined;
function config(){
 const file=process.env.GROQ_PILOT_KEY_FILE;if(!file)throw Error('Approved Groq key file path missing');
 const contents=readFileSync(file,'utf8').replace(/^\uFEFF/,'');
 let key=contents.match(/^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/m)?.[1]??'';
 if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
 if(!/^gsk_[A-Za-z0-9_-]{20,}$/.test(key))throw Error('Invalid Groq key file format');
 return {AI_PROVIDER:'groq',GROQ_API_KEY:key,GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true',FREE_ONLY:'true',onDispatch:()=>{lastDispatch=Date.now();}};
}
async function waitForMinute(){
 if(halted)throw Error('Pilot halted after a provider/format failure; no automatic retries');
 while(Date.now()-lastDispatch<61000){const remaining=61000-(Date.now()-lastDispatch);console.log(JSON.stringify({pilot:'waiting for free token window',seconds:Math.ceil(remaining/1000)}));await new Promise(r=>setTimeout(r,Math.min(remaining,30000)));}
}
// Each run is kept in its own timestamp/UUID directory; latest.json is only a pointer.
function save(){run??=createRun('.sites-runtime/groq-pilot');run.writeResults(results,{model:'openai/gpt-oss-120b',realProvider:true,independentHumanEvaluation:false});}
describe.runIf(enabled)('Groq 실제 무료 선별 시험 — 독립 성능 평가 아님',()=>{
 beforeAll(()=>{
  const realFetch=globalThis.fetch;let call=0;
  vi.stubGlobal('fetch',async(...args:Parameters<typeof fetch>)=>{
   const response=await realFetch(...args);
   if(response.ok){
    const data=await response.clone().json() as {choices?:{message?:{content?:string}}[]};
    const content=data.choices?.[0]?.message?.content;
    if(typeof content==='string'){run??=createRun('.sites-runtime/groq-pilot');run.writeRaw(call++,content);}
   }
   if(!response.ok){
    const failure=await response.clone().json().catch(()=>null) as {error?:{code?:unknown;type?:unknown;message?:unknown;failed_generation?:unknown}}|null;
    const code=typeof failure?.error?.code==='string'&&/^[a-z0-9_]+$/i.test(failure.error.code)?failure.error.code:'unknown';
    let shape:Record<string,unknown>={};try{const f=JSON.parse(String(failure?.error?.failed_generation??''));shape={topicCount:Array.isArray(f.topics)?f.topics.length:null,counterCount:Array.isArray(f.counterArguments)?f.counterArguments.length:null};}catch{}
    console.log(JSON.stringify({providerStatus:response.status,providerCode:code,...shape}));
   }
   return response;
  });
 });
 for(const sample of cases.cases.filter(c=>!process.env.PILOT_CASES||process.env.PILOT_CASES.split(',').includes(c.id)))it(sample.id,async()=>{
  await waitForMinute();let tokens=0;const started=Date.now();
  try{
   const analysis=await analyze({kind:'text',body:sample.body,comments:sample.comments},{...config(),onUsage:n=>{tokens+=n;}},`pilot_${number++}`,AbortSignal.timeout(60000));
   assertAnalysis(analysis);const result={caseId:sample.id,durationMs:Date.now()-started,tokens,status:analysis.status,analysis};results.push(result);save();
   console.log(JSON.stringify({caseId:sample.id,status:analysis.status,durationMs:Date.now()-started,tokens,topics:analysis.topics.length,claims:analysis.claims.length,undetermined:analysis.expressions.filter(e=>e.status==='undetermined').length}));
   if(sample.id==='article'){expect(analysis.topics.length).toBeGreaterThan(0);expect(analysis.claims.some(c=>c.kind==='factual')).toBe(true);expect(analysis.claims.some(c=>c.kind==='opinion')).toBe(true);expect(analysis.counterArguments?.length).toBeGreaterThan(0);const dist=bodyTopicDistribution(analysis);expect(dist.available).toBe(true);expect(dist.sentences).toBe(2);expect(dist.assigned).toBeGreaterThan(0);}
   expect(analysis.mode).toBe('live');expect(analysis.expressions.every(e=>e.explanation!=='이 문장의 분석 결과를 확인하지 못했습니다.')).toBe(true);
  }catch(error){halted=true;results.push({caseId:sample.id,...safeFailure(error)});save();throw error;}
 },100000);
 it.runIf(!process.env.PILOT_CASES||process.env.PILOT_CASES.split(',').includes('number'))('입력 자료 대조',async()=>{
  await waitForMinute();
  let tokens=0;const started=Date.now();
  try{
  const entry=results.find(r=>(r as {caseId?:string}).caseId==='number') as {analysis?:Analysis}|undefined;
  const analysis=entry?.analysis;const claim=analysis?.claims.find(c=>c.kind==='factual');
  if(!analysis||!claim)throw Error('No factual claim from pilot; verification not fabricated');
  const result=await verify({kind:'text',parentAnalysisId:analysis.analysisId,sources:analysis.sources,claims:[claim],references:[{id:'provided_1',text:'이 자료는 예시를 위해 작성되었다. 학생의 아침 식사 비율에 대한 조사는 실시하지 않았다.'}],useWebSearch:false},{...config(),onUsage:n=>{tokens+=n;}},'pilot_verify',AbortSignal.timeout(60000));
  console.log(JSON.stringify({caseId:'provided_verification',outcome:result.checks[0]?.outcome,tokens,durationMs:Date.now()-started}));
  expect(result.references[0].provenance).toBe('provided_text');expect(result.checks[0].outcome).toBe('insufficient');expect(result.checks[0].execution).toBe('completed');
  results.push({caseId:'provided_verification',durationMs:Date.now()-started,tokens,verification:result});save();
  }catch(error){halted=true;results.push({caseId:'provided_verification',durationMs:Date.now()-started,tokens,...safeFailure(error)});save();throw error;}
 },100000);
 it.runIf(process.env.PILOT_BOUNDARY==='true')('실제 24문장 출력 상한',async()=>{
  await waitForMinute();let tokens=0;const started=Date.now();
  try{
   const body=Array.from({length:24},(_,i)=>`가상 도서관 공지 ${i+1}번을 함께 살펴본다.`).join(' ');
   const analysis=await analyze({kind:'text',body,comments:[]},{...config(),onUsage:n=>{tokens+=n;}},'pilot_boundary24',AbortSignal.timeout(60000));
   assertAnalysis(analysis);expect(analysis.expressions).toHaveLength(24);expect(analysis.status).toBe('success');
   results.push({caseId:'boundary24',tokens,durationMs:Date.now()-started,analysis});save();
   console.log(JSON.stringify({caseId:'boundary24',tokens,sentences:analysis.expressions.length,status:analysis.status}));
  }catch(error){halted=true;results.push({caseId:'boundary24',tokens,durationMs:Date.now()-started,...safeFailure(error)});save();throw error;}
 },100000);
 it.runIf(process.env.PILOT_CROSS_SOURCE==='true')('참고자료 문장 ID의 실제 운영 시간 대조',async()=>{
  await waitForMinute();let tokens=0;const started=Date.now();
  try{
   const body='가상 학교 도서관은 이번 학기에 평일 오후 6시에 문을 닫는다.';
   const sources=makeSources({kind:'text',body,comments:[]});
   const claim={id:'claim_test',text:body,kind:'factual' as const,origin:[{sourceId:'body',sentenceId:'body_s0',start:0,end:body.length,quote:body}]};
   const reference='가상 학교 도서관은 이번 학기에 평일 오후 9시에 문을 닫는다.';
   const verification=await verify({kind:'text',sources,claims:[claim],references:[{id:'reference_test',text:reference}],useWebSearch:false},{...config(),onUsage:n=>{tokens+=n;}},'pilot_cross_source',AbortSignal.timeout(60000));
   const check=verification.checks[0];expect(check.execution).toBe('completed');expect(check.outcome).toBe('contradicted');expect(check.relations[0].quote).toBe(reference);
   const relation=check.relations[0];expect(reference.slice(relation.start,relation.end)).toBe(relation.quote);
   results.push({caseId:'cross_source',tokens,durationMs:Date.now()-started,verification});save();console.log(JSON.stringify({caseId:'cross_source',tokens,outcome:check.outcome}));
  }catch(error){halted=true;results.push({caseId:'cross_source',tokens,durationMs:Date.now()-started,...safeFailure(error)});save();throw error;}
 },100000);
 afterAll(()=>{if(enabled)save();vi.unstubAllGlobals();});
});
