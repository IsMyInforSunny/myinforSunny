import {describe,it,expect} from 'vitest';
import {guardBodyPosition,isDebatableProposition} from '../lib/body-position-guard';
import {makeSources,locate} from '../lib/domain';
import {canonicalStanceProposition} from '../lib/stance-model';
import {assembleAnalysis} from '../lib/server/analyze';
import type {BodyPosition,RawAnalysis,TextRequest} from '../lib/contracts';
import cases from '../research/body-position-cases.json';
function grounded(body:string,proposition='주택 공급을 확대해야 한다.',attribution:BodyPosition['attribution']='author'){
 const sources=makeSources({kind:'text',body,comments:[]});
 const evidence=sources[0].sentences.map(unit=>locate(sources,{sentenceId:unit.id,quote:body.slice(unit.start,unit.end)})!);
 return {sources,position:{proposition,label:'support' as const,attribution,evidence,reason:'모델 제안'}};
}
describe('본문 입장 고정 회귀 경계',()=>{
 it.each(['전기요금을 올리기로 했다.','전기료가 오른다.','전기료를 내려야 한다.','전기요금 현실화에 찬성한다.'])('전기요금 일상 표현 %s',body=>{
  expect(canonicalStanceProposition(body)).toBe('전기요금을 인상해야 한다.');
 });
 it('최저시급과 주택 화재를 구분한다',()=>{
  expect(canonicalStanceProposition('최저시급을 올려야 한다.')).toBe('최저임금을 인상해야 한다.');
  expect(canonicalStanceProposition('주택 화재로 주민들이 대피했다.')).toBeUndefined();
 });
 it.each(['주택 공급을 확대해야 한다.','수업을 늘려야 한다.','요금을 올리지 말아야 한다.','의대 정원 확대가 바람직하다.','원전을 확대해서는 안 된다.'])('당위 명제를 보존한다 %s',text=>expect(isDebatableProposition(text)).toBe(true));
 it.each(['전기요금이 올랐다.','내일 비가 예상된다.','기온은 30도이다.'])('사실 명제를 정상 무논점 상태로 바꾼다 %s',text=>{
  const {sources,position}=grounded(text,text);const value=guardBodyPosition(position,sources,true);
  expect(value).toMatchObject({proposition:'',label:'not_expressed',evidence:[],attributionSource:'server_rule'});
 });
 it('실제 사례 B와 같은 취재원 전언을 기자 찬성으로 받지 않는다',()=>{
  const {sources,position}=grounded('유희종 전북지부장은 “주택 공급을 확대해야 한다”고 강조했다.');
  expect(guardBodyPosition(position,sources,false)).toMatchObject({label:'not_expressed',attribution:'reported_sources',attributionSource:'server_rule'});
 });
 it('일부 인용일 때 작성자 근거만 남긴다',()=>{
  const {sources,position}=grounded('관계자는 “주택 공급을 확대해야 한다”고 말했다. 주택 공급 확대가 바람직하다.');
  const result=guardBodyPosition(position,sources,false);expect(result.evidence).toHaveLength(1);
  expect(result.evidence[0].quote).toBe('주택 공급 확대가 바람직하다.');expect(result.label).toBe('support');
 });
 it('정책 용어의 작은따옴표만으로 취재원이라고 하지 않는다',()=>{
  const {sources,position}=grounded('‘주택 공급’ 확대가 바람직하다.');
  expect(guardBodyPosition(position,sources,false).attribution).toBe('author');
 });
 it('A: 명제와 반대 근거·사실 주장을 보존한다(모의 공급자)',()=>{
  const req:TextRequest={kind:'text',body:cases.synthetic[0].body,comments:[]};
  const sources=makeSources(req),quote=(index:number)=>({sentenceId:sources[0].sentences[index].id,quote:req.body.slice(sources[0].sentences[index].start,sources[0].sentences[index].end)});
  const raw:RawAnalysis={topics:[{id:'price',label:'전기요금',description:'요금 인상',evidence:[quote(0)]}],topicAssignments:[],stances:[],
   bodyPosition:{proposition:'전기요금을 인상해야 한다.',label:'oppose',attribution:'author',evidence:[quote(1),quote(2)],reason:'요금 인상 반대'},
   bodyAssigned:sources[0].sentences.map(unit=>({sentenceId:unit.id,topicIds:['price']})),bodyOtherIds:[],bodyUndeterminedIds:[],
   expressions:sources[0].sentences.map(unit=>({sentenceId:unit.id,status:'clear',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]})),
   claims:[{id:'c1',text:quote(0).quote,kind:'factual',origin:[quote(0)],targetTime:''}],perspectiveQuestions:[],counterArguments:[],searchSuggestions:[],claimsMayBeOmitted:true};
  const result=assembleAnalysis(req,raw,'A','mock');expect(result.bodyPosition).toMatchObject(cases.synthetic[0].expected&&{proposition:'전기요금을 인상해야 한다.',label:'oppose',attribution:'author'});
  expect(result.claims.filter(claim=>claim.kind==='factual')).toHaveLength(1);
 });
});
