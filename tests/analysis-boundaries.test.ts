import {afterEach,describe,expect,it,vi} from 'vitest';
import {encode} from 'gpt-tokenizer/encoding/o200k_harmony';
import {analyze} from '../lib/server/analyze';
import {makeSources} from '../lib/domain';
import {analyzeRequestSchema,type TextRequest} from '../lib/contracts';

const config={AI_PROVIDER:'groq',GROQ_API_KEY:'synthetic-not-a-real-key',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true'};
const request=(count:number):TextRequest=>({kind:'text',body:Array.from({length:count},(_,i)=>`공개 문장 ${i+1}입니다.`).join(' '),comments:[]});
function clearOutput(req:TextRequest){return {clearSentenceIds:makeSources(req).flatMap(s=>s.sentences.map(t=>t.id)),topics:[{id:'public',label:'공개 문장',description:'공개 예시',evidence:[{sentenceId:'body_s0',quote:makeSources(req)[0].text.slice(0,makeSources(req)[0].sentences[0].end)}]}],topicAssignments:req.comments.map((_,i)=>({sourceId:`comment_${i}`,topicIds:[],status:'other',evidence:[],reason:''})),stances:[],bodyAssigned:[{sentenceId:'body_s0',topicIds:['public']}],bodyOtherIds:makeSources(req)[0].sentences.slice(1).map(t=>t.id),bodyUndeterminedIds:[],expressions:[],claims:[],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[{sentenceId:'body_s0',quote:'원문'}]}],searchSuggestions:[],claimsMayBeOmitted:true};}
afterEach(()=>vi.unstubAllGlobals());

describe('무료 분석 입력 경계 (공급자 모의, 실제 모델 품질 검증 아님)',()=>{
 it('24문장 최소 응답은 출력 상한 안에서 전 문장 결과를 보존한다',async()=>{
  const req=request(24),raw=clearOutput(req),serialized=JSON.stringify(raw);
  expect(encode(serialized).length).toBeLessThan(2000);
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:serialized}}],usage:{total_tokens:4000}}));vi.stubGlobal('fetch',fetch);
  const result=await analyze(req,config,'boundary-24',new AbortController().signal);
  expect(result.coverage.totalSentences).toBe(24);expect(result.expressions.every(e=>e.status==='clear')).toBe(true);
  expect(result.status).toBe('partial');expect(result.warnings.some(w=>w.code==='BODY_POSITION_UNAVAILABLE')).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.bodyTopicAssignments).toHaveLength(24);expect(result.coverage.naturalSentences).toBe(24);
 });
 it('본문 24문장을 모두 다중 논점으로 배정해도 출력은 2000토큰 안이고 호출은 1회다',async()=>{
  const req=request(24),raw=clearOutput(req);
  raw.topics.push({id:'second',label:'둘째 논점',description:'공개 예시',evidence:[raw.topics[0].evidence[0]]});
  raw.bodyAssigned=makeSources(req)[0].sentences.map(t=>({sentenceId:t.id,topicIds:['public','second']}));raw.bodyOtherIds=[];
  const serialized=JSON.stringify(raw);expect(encode(serialized).length).toBeLessThan(2000);
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:serialized}}],usage:{total_tokens:4000}}));vi.stubGlobal('fetch',fetch);
  const result=await analyze(req,config,'boundary-body-topics',new AbortController().signal);
  expect(result.status).toBe('partial');expect(result.bodyTopicAssignments).toHaveLength(24);expect(result.bodyTopicAssignments!.every(a=>a.status==='assigned'&&a.topicIds.length===2)).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('긴 문장 하나는 처리 조각 2개이지만 자연 문장은 1개로 보고하고 24단위 한도는 조각 기준이다',async()=>{
  const req:TextRequest={kind:'text',body:`${'가나다라마바사아자차'.repeat(60)}.`,comments:[]};
  expect(makeSources(req)[0].sentences).toHaveLength(2);
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(clearOutput(req))}}],usage:{total_tokens:3000}}));vi.stubGlobal('fetch',fetch);
  const result=await analyze(req,config,'boundary-long-sentence',new AbortController().signal);
  expect(result.coverage).toMatchObject({totalSentences:2,naturalSentences:1});expect(result.bodyTopicAssignments).toHaveLength(2);expect(fetch).toHaveBeenCalledTimes(1);

 });
 it('본문 분류가 빠진 모델 출력은 임의 완성 없이 거절하고 재호출하지 않는다',async()=>{
  const req=request(3),{bodyAssigned,bodyOtherIds,bodyUndeterminedIds,...incomplete}=clearOutput(req);void bodyAssigned;void bodyOtherIds;void bodyUndeterminedIds;
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(incomplete)}}],usage:{total_tokens:3000}}));vi.stubGlobal('fetch',fetch);
  await expect(analyze(req,config,'boundary-missing-body',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('accepts more than 24 sentences with NVIDIA',async()=>{
  const req=request(40);
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(clearOutput(req))}}]}));vi.stubGlobal('fetch',fetch);
  const result=await analyze(req,{AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic-not-real'},'boundary-40',new AbortController().signal);
  expect(result.coverage.totalSentences).toBe(40);
  expect(result.expressions).toHaveLength(40);
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('문자수 상한 안이어도 실제 토큰 예산을 넘으면 외부 전송하지 않는다',async()=>{
  const req:TextRequest={kind:'text',body:'가나다라마바사아자차카타파하'.repeat(142),comments:Array.from({length:5},(_,i)=>({id:`c${i}`,text:'가나다라마바사아자차카타파하'.repeat(14)}))};
  expect(analyzeRequestSchema.safeParse({...req,transmissionConsent:true}).success).toBe(true);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(analyze(req,config,'boundary-tokens',new AbortController().signal)).rejects.toMatchObject({code:'INPUT_TOO_LARGE'});
  expect(fetch).not.toHaveBeenCalled();
 });
 it('출력이 잘리면 사용량을 기록하고 실패시키며 자동 재호출하지 않는다',async()=>{
  const onUsage=vi.fn(),onDispatch=vi.fn();
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'length',message:{content:'{"expressions":['}}],usage:{total_tokens:6000}}));vi.stubGlobal('fetch',fetch);
  await expect(analyze(request(24),{...config,onUsage,onDispatch},'boundary-truncated',new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
  expect(onUsage).toHaveBeenCalledWith(6000);expect(onDispatch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 });
});
