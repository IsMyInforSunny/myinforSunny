import {afterEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod/v4';
import {analysisModelSchema,analysisResponseSchema,rawAnalysisSchema,type RawAnalysis,type TextRequest} from '../lib/contracts';
import {makeSources} from '../lib/domain';
import {analyze,assembleAnalysis} from '../lib/server/analyze';

const body='학교 도서관 운영 시간을 늘려야 한다.';
const comment='운영 시간을 늘려서는 안 된다.';
const request:TextRequest={kind:'text',body,comments:[{id:'reader',text:comment}],proposition:body};
const bodyQuote={sentenceId:'body_s0',quote:body};
const commentQuote={sentenceId:'comment_0_s0',quote:comment};
function proposal(req:TextRequest=request):RawAnalysis{
  const sources=makeSources(req),first=sources[0].sentences[0];
  const quote={sentenceId:first.id,quote:req.body.slice(first.start,first.end)};
  return {
    topics:[{id:'hours',label:'운영 시간',description:'도서관 운영 제안',evidence:[quote]}],
    topicAssignments:req.comments.map((_,i)=>({sourceId:`comment_${i}`,topicIds:[],status:'other',evidence:[],reason:''})),
    stances:req.proposition?req.comments.map((c,i)=>({sourceId:`comment_${i}`,label:'oppose',evidence:[{sentenceId:`comment_${i}_s0`,quote:c.text}],reason:'댓글은 연장에 반대한다.'})):[],
    bodyPosition:{proposition:req.proposition??body,label:'support',evidence:[quote],reason:'본문은 운영 시간 연장을 명시적으로 제안한다.'},
    bodyAssigned:sources[0].sentences.map(unit=>({sentenceId:unit.id,topicIds:['hours']})),bodyOtherIds:[],bodyUndeterminedIds:[],
    expressions:sources.flatMap(source=>source.sentences.map(unit=>({sentenceId:unit.id,status:'clear',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]}))),
    claims:[],perspectiveQuestions:[],counterArguments:[{claimId:'not_applicable',kind:'not_applicable',text:'해당 없음',reasoning:'해당 없음',evidenceNeeded:'해당 없음',basis:[quote]}],
    searchSuggestions:[],claimsMayBeOmitted:false,
  };
}
afterEach(()=>vi.unstubAllGlobals());

describe('기사 본문 입장의 명제와 원문 근거',()=>{
  it('본문과 반대 댓글의 입장을 각각 보존하고 본문 인용 위치를 서버에서 복원한다',()=>{
    const result=assembleAnalysis(request,proposal(),'body-and-comment','mock');
    expect(result.bodyPosition).toEqual({proposition:body,label:'support',evidence:[{...bodyQuote,sourceId:'body',start:0,end:body.length}],reason:'본문은 운영 시간 연장을 명시적으로 제안한다.'});
    expect(result.stances?.[0]).toMatchObject({sourceId:'comment_0',label:'oppose'});
    expect(result.status).toBe('success');
  });
  it.each([commentQuote,{sentenceId:'body_s0',quote:'본문에 없는 가상 인용'}])('댓글 또는 불일치 인용을 본문 입장 근거로 승격하지 않는다 %j',quote=>{
    const raw=proposal();raw.bodyPosition!.evidence=[quote];
    const result=assembleAnalysis(request,raw,'bad-body-origin','mock');
    expect(result.bodyPosition).toBeUndefined();expect(result.status).toBe('success');
    expect(result.warnings.map(w=>w.code)).toContain('BODY_POSITION_UNAVAILABLE');
    expect(result.expressions).toHaveLength(2);expect(result.stances?.[0].label).toBe('oppose');
  });
  it('사용자 명제의 공백·유니코드 정규화는 허용하고 다른 명제로 바꾸면 입장을 생략한다',()=>{
    const raw=proposal();raw.bodyPosition!.proposition=' 학교  도서관 운영 시간을 늘려야 한다. '.normalize('NFD');
    expect(assembleAnalysis(request,raw,'normalized-position','mock').bodyPosition?.proposition).toBe(body);
    raw.bodyPosition!.proposition='학교 도서관 운영 시간을 줄여야 한다.';
    const result=assembleAnalysis(request,raw,'changed-position','mock');
    expect(result.bodyPosition).toBeUndefined();expect(result.warnings.map(w=>w.code)).toContain('BODY_POSITION_UNAVAILABLE');
  });
  it('사용자 명제가 없으면 본문의 비정치적 비교 명제를 보존하고 사실 전달은 입장 없음으로 둔다',()=>{
    const req:TextRequest={kind:'text',body:'학생들의 과학 실험 수업을 늘려야 한다.',comments:[]};
    const raw=proposal(req);raw.bodyPosition!.proposition=req.body;
    const result=assembleAnalysis(req,raw,'science-position','mock');
    expect(result.proposition).toBeUndefined();expect(result.bodyPosition).toMatchObject({proposition:req.body,label:'support'});
    const factual:TextRequest={kind:'text',body:'도서관은 오전 9시에 문을 열었다.',comments:[]};
    const neutral=proposal(factual);neutral.bodyPosition={proposition:'',label:'not_expressed',evidence:[{sentenceId:'body_s0',quote:factual.body}],reason:'운영 사실을 전달하며 제안의 찬반은 드러내지 않는다.'};
    expect(assembleAnalysis(factual,neutral,'neutral-position','mock').bodyPosition).toMatchObject({proposition:'',label:'not_expressed'});
  });
  it('이전 응답과 잘못된 선택 필드가 핵심 분석을 무효화하지 않는다',()=>{
    const raw=proposal();delete raw.bodyPosition;
    expect(rawAnalysisSchema.safeParse(raw).success).toBe(true);
    const malformed=rawAnalysisSchema.parse({...raw,bodyPosition:{label:'support',evidence:'not quotes'}});
    for(const value of [raw,malformed]){
      const result=assembleAnalysis(request,value,'legacy-position','mock');
      expect(result.status).toBe('success');expect(result.bodyPosition).toBeUndefined();
      expect(result.warnings.map(w=>w.code)).toContain('BODY_POSITION_UNAVAILABLE');
    }
  });
  it('새 생성 계약은 타입 있는 본문 입장을 요구하고 한 번의 분석 호출에 포함한다',async()=>{
    const sources=makeSources(request),schema=z.toJSONSchema(analysisModelSchema(sources,true),{target:'draft-7'});
    expect(schema.required).toContain('bodyPosition');
    expect(schema.properties?.bodyPosition).toMatchObject({type:'object',additionalProperties:false,required:['proposition','label','evidence','reason']});
    const raw=proposal(),{expressions,...rest}=raw;
    const response={...rest,clearSentenceIds:expressions.map(e=>e.sentenceId),expressions:[]};
    const {bodyPosition:omitted,...legacy}=response;void omitted;
    expect(analysisModelSchema(sources,true).safeParse(legacy).success).toBe(false);
    expect(analysisResponseSchema(sources,true).safeParse(legacy).success).toBe(true);
    const fetch=vi.fn().mockResolvedValue(Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(response)}}],usage:{total_tokens:200}}));vi.stubGlobal('fetch',fetch);
    const config={GROQ_API_KEY:'synthetic-only',GROQ_MODEL:'openai/gpt-oss-120b',GROQ_ELIGIBILITY_CONFIRMED:'true',GROQ_FREE_PLAN_CONFIRMED:'true'};
    const result=await analyze(request,config,'single-body-call',AbortSignal.timeout(2000));
    expect(result.bodyPosition?.label).toBe('support');expect(fetch).toHaveBeenCalledTimes(1);
    const sent=JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.response_format.json_schema.schema.required).toContain('bodyPosition');
    expect(sent.messages[0].content).toContain('댓글을 제외한 기사 본문 자체의 입장');
  });
});
