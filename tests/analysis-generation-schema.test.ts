import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {analysisModelSchema,analysisResponseSchema} from '../lib/contracts';
import {makeSources} from '../lib/domain';
import {analyze} from '../lib/server/analyze';

const body='학교 도서관 운영 시간을 늘리자는 제안이다.';
const request={kind:'text' as const,body,comments:[]};
const config={GROQ_API_KEY:'synthetic-test-token',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true'};
const sources=makeSources(request);
const quote={sentenceId:'body_s0',quote:body};
const proposal=()=>({topics:[{id:'hours',label:'도서관 운영',description:'운영 시간 제안',evidence:[quote]}],
  topicAssignments:[],stances:[],bodyAssigned:[{sentenceId:'body_s0',topicIds:['hours']}],bodyOtherIds:[],bodyUndeterminedIds:[],
  clearSentenceIds:['body_s0'],expressions:[],claims:[{id:'proposal',kind:'opinion',text:body,origin:[quote],targetTime:''}],
  perspectiveQuestions:[],counterArguments:[{claimId:'proposal',kind:'qualification',text:'운영 인력도 확인할 수 있다.',reasoning:'시간 확대에는 운영 조건이 필요할 수 있다.',evidenceNeeded:'도서관 운영 자료',basis:[quote]}],
  searchSuggestions:[] as unknown,claimsMayBeOmitted:false});
afterEach(()=>vi.unstubAllGlobals());

describe('analysis provider grammar and tolerant optional hints',()=>{
 it('sends typed, closed objects to the provider instead of untyped hint items',()=>{
  const schema=z.toJSONSchema(analysisModelSchema(sources,false),{target:'draft-7'});
  const visit=(node:Record<string,unknown>)=>{
   expect(node.type??node.$ref??node.anyOf??node.oneOf).toBeDefined();
   if(node.type==='object'){
    const properties=node.properties as Record<string,Record<string,unknown>>;
    expect(node.additionalProperties).toBe(false);
    expect([...(node.required as string[])].sort()).toEqual(Object.keys(properties).sort());
    Object.values(properties).forEach(visit);
   }
   if(node.type==='array')visit(node.items as Record<string,unknown>);
  };
  visit(schema);
  expect(schema.properties?.searchSuggestions).toMatchObject({type:'array',maxItems:2,items:{type:'object',required:['label','query'],additionalProperties:false}});
 });
 it.each([undefined,null,'wrong shape',{query:'도서관 운영'},[null,'wrong item',{label:'자료',query:'도서관 OR 운영'}]])('does not lose core analysis when optional discovery hints are %j',async hints=>{
  const raw={...proposal(),searchSuggestions:hints};
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],usage:{total_tokens:100}}));
  vi.stubGlobal('fetch',fetch);
  const result=await analyze(request,config,'synthetic-optional-hints',AbortSignal.timeout(1000));
  expect(result.status).toBe('success');expect(result.claims).toHaveLength(1);expect(result.expressions[0].status).toBe('clear');
  expect(result.searchSuggestions).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1);
  const sent=JSON.parse(fetch.mock.calls[0][1].body);
  expect(sent.response_format.json_schema.schema.properties.searchSuggestions.items.type).toBe('object');
 });
 it('keeps valid Korean hints next to malformed items and normalizes them',async()=>{
  const raw={...proposal(),searchSuggestions:[null,{label:'도서관 자료',query:'도서관'.normalize('NFD')+' 운영 시간'},42,{label:'잘못된 검색어',query:'도서관 OR 운영'}]};
  const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));vi.stubGlobal('fetch',fetch);
  const result=await analyze(request,config,'synthetic-mixed-hints',AbortSignal.timeout(1000));
  expect(result.searchSuggestions).toEqual([{label:'도서관 자료',query:'도서관 운영 시간'}]);
  expect(result.status).toBe('success');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('still rejects malformed core claims and unknown top-level fields',()=>{
  const schema=analysisResponseSchema(sources,false);
  expect(schema.safeParse({...proposal(),claims:null}).success).toBe(false);
  expect(schema.safeParse({...proposal(),unexpected:'not accepted'}).success).toBe(false);
 });
});
