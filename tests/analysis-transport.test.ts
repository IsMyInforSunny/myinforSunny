import {describe,it,expect,vi,afterEach} from 'vitest';
import {z} from 'zod/v4';
import {analysisModelSchema} from '../lib/contracts';
import {makeSources} from '../lib/domain';
import {compactAnalysisTransport} from '../lib/server/analysis-transport';
import {analyze,assembleAnalysis} from '../lib/server/analyze';
import {buildAnalysisScores} from '../lib/analysis-scores';
afterEach(()=>vi.unstubAllGlobals());

const req={kind:'text' as const,body:'칫솔질할 때 휘어지는 힘을 스스로 전기로 바꿔 세균을 없애주는 칫솔모가 개발됐다.',comments:[]};
const sources=makeSources(req),ref={sentenceId:'body_s0'};
function wire(){return {topics:[{id:'toothbrush',label:'칫솔모 개발',description:'압전 칫솔모',evidence:[ref]}],topicAssignments:[],stances:[],bodyPosition:{proposition:'압전 칫솔모는 세균 제거에 효과적이다.',label:'not_expressed',evidence:[ref],reason:'개발 사실을 전달한다.'},bodyAssigned:[{sentenceId:'body_s0',topicIds:['toothbrush']}],bodyOtherIds:[],bodyUndeterminedIds:[],clearSentenceIds:['body_s0'],expressions:[],claims:[{id:'c1',kind:'factual',text:req.body,origin:[ref],targetTime:''}],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:true};}
function grouped(){const {bodyAssigned,bodyOtherIds,bodyUndeterminedIds,clearSentenceIds,expressions,...raw}=wire();return {...raw,topics:raw.topics.map(t=>({...t,evidence:['body_s0']})),bodyPosition:{...raw.bodyPosition,attribution:'reported_sources',evidence:['body_s0']},claims:raw.claims.map(c=>({...c,origin:['body_s0']})),sentences:{body_s0:{status:'clear',topics:'1'}}};}
describe('compact evidence transport',()=>{
 it('requires article claims in generation and never reports omitted extraction as a completed no-facts result',async()=>{
  const raw={...wire(),claims:[]};
  expect(compactAnalysisTransport(sources,false,true).generation.safeParse({...grouped(),claims:[]}).success).toBe(false);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]})));
  const result=await analyze(req,{AI_PROVIDER:'nvidia',NVIDIA_API_KEY:'synthetic'},'missing-claims',new AbortController().signal,{article:true});
  expect(result.status).toBe('partial');expect(result.warnings.some(w=>w.code==='CLAIMS_UNAVAILABLE')).toBe(true);
  expect(buildAnalysisScores(result).attribution.status).toBe('pending');
 });
 it('ignores only an unused no-counterargument placeholder, without accepting an empty genuine counterargument',()=>{
  const transport=compactAnalysisTransport(sources,false);
  const raw={...wire(),counterArguments:[{kind:'not_applicable',claimId:'not_applicable',text:'',reasoning:'',evidenceNeeded:'',basis:[]}]};
  expect(transport.response.parse(raw).counterArguments).toEqual([]);
  expect(transport.response.safeParse({...raw,counterArguments:[{...raw.counterArguments[0],kind:'qualification'}]}).success).toBe(false);
 });
 it('restores exact source text without asking the model to repeat quotations',()=>{
  const transport=compactAnalysisTransport(sources,false),raw=transport.response.parse(grouped());
  expect(raw.topics[0].evidence[0]).toEqual({...ref,quote:req.body});
  expect(raw.claims[0].origin[0]).toEqual({...ref,quote:req.body});
  expect(transport.generation.safeParse(grouped()).success).toBe(true);
  expect(raw.bodyAssigned).toEqual(wire().bodyAssigned);
  expect(transport.response.safeParse({...grouped(),sentences:{}}).success).toBe(false);
  expect(transport.response.safeParse({...grouped(),sentences:{body_s0:{status:'clear',topics:'1'},unknown:{status:'clear',topics:'1'}}}).success).toBe(false);
  expect(JSON.stringify(z.toJSONSchema(transport.generation,{reused:'ref'}))).not.toContain('"quote"');
  expect(JSON.stringify(z.toJSONSchema(transport.generation,{reused:'ref'})).length).toBeLessThan(JSON.stringify(z.toJSONSchema(analysisModelSchema(sources,false))).length);
 });
 it('does not turn unknown IDs or supplied false quotations into grounded evidence',()=>{
  const transport=compactAnalysisTransport(sources,false);
  const invalid=wire();invalid.topics[0].evidence=[{sentenceId:'unknown'}];
  const {clearSentenceIds,...raw}=transport.response.parse(invalid);
  const result=assembleAnalysis(req,{...raw,expressions:clearSentenceIds.map(sentenceId=>({sentenceId,status:'clear',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]}))},'test','test');
  expect(result.status).toBe('partial');expect(result.topics).toEqual([]);
  const legacy=wire() as unknown as Record<string,any>;legacy.claims[0].origin=[{...ref,quote:'다른 원문'}];
  expect(transport.response.parse(legacy).claims[0].origin[0].quote).toBe('다른 원문');
 });
});
