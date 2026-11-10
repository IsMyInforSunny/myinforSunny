import { Analysis, BodyTopicAssignment, Check, Expression, Reference, RUBRIC, TextRequest, Topic, Verification } from './contracts';
import { assertAnalysis, indicators, locate, makeSources, naturalSentenceCount, SEGMENTER } from './domain';

export const fixtures=[
  {id:'mixed',name:'복합적인 의견',tag:'학교생활',title:'학교에서 휴대전화를 금지해야 할까요?',body:'학교에서 휴대전화를 전면 금지해야 한다는 의견이 나왔다. 일부 학생은 수업 집중에 도움이 된다고 말한다. 다른 학생은 긴급 연락과 자기 관리의 기회도 중요하다고 생각한다.',comments:['수업 시간에는 휴대전화를 보관하면 집중하는 데 도움이 될 것 같아요. 다만 긴급 연락은 가능해야 해요.','전면 금지보다는 스스로 사용을 조절하는 방법을 배우면 좋겠어요.','반대하는 애들은 전부 공부하기 싫어서 그러는 거잖아.'],proposition:'학교에서 휴대전화 사용을 전면 금지해야 한다.'},
  {id:'neutral',name:'차분한 의견',tag:'일상',title:'도서관 운영 시간을 늘리면 어떨까요?',body:'도서관을 저녁까지 이용할 수 있으면 좋겠다. 다만 운영 비용과 직원의 근무 여건도 함께 살펴봐야 한다.',comments:['늦게까지 공부할 공간이 필요해요.','직원의 근무 시간도 고려해서 운영하면 좋겠어요.'],proposition:'도서관의 저녁 운영 시간을 늘려야 한다.'},
  {id:'provocative',name:'표현 살펴보기',tag:'표현',title:'단정적인 표현을 찾아보세요',body:'이 방법을 쓰면 누구나 무조건 성적이 오른다. 반대하는 사람들은 전부 아무것도 모르는 바보다. 지금 당장 시작하지 않으면 평생 뒤처질 것이다.',comments:['누구에게나 같은 효과가 있는지 근거를 확인하고 싶어요.'],proposition:''},
  {id:'unsupported',name:'근거 없는 주장',tag:'출처',title:'숫자가 있다면 믿어도 될까요?',body:'우리 학교 학생의 90%가 아침을 먹지 않는다고 한다. 그래서 아침 자습 시간을 늦춰야 한다는 주장이 나왔다.',comments:['90%라는 수치의 조사 시점과 대상은 누구인가요?'],proposition:''},
  {id:'no_comments',name:'본문만 분석',tag:'본문',title:'댓글 없이도 살펴볼 수 있어요',body:'학교 정원에 나무를 더 심으면 좋겠다. 그늘에서 쉴 수 있는 공간이 필요하기 때문이다.',comments:[],proposition:''},
  {id:'conflict',name:'자료가 다른 경우',tag:'자료 대조',title:'같은 숫자도 맥락을 확인해요',body:'올해 학교 도서관은 평일 오후 9시까지 운영한다. 이용 시간을 연장하면 좋겠다는 의견도 있다.',comments:['새 학기 공지와 이전 공지를 구분해서 확인하면 좋겠어요.'],proposition:''},
  {id:'supported',name:'출처에서 확인된 주장',tag:'자료 대조',title:'공지와 같은 내용인지 확인해요',body:'이번 학기 학교 도서관은 평일 오후 6시에 문을 닫는다.',comments:[],proposition:''},
] as const;
export type FixtureId=typeof fixtures[number]['id'];
export function getFixture(id:string){const f=fixtures.find(f=>f.id===id);if(!f)throw Error('UNKNOWN_FIXTURE');return f;}
export function fixtureInput(id:string):TextRequest{const f=getFixture(id);return {kind:'text',body:f.body,comments:f.comments.map((text,i)=>({id:`c${i}`,text})),...(f.proposition?{proposition:f.proposition}:{})};}
export function demoAnalysis(id:string):Analysis{
  const f=getFixture(id);const input=fixtureInput(id);const sources=makeSources(input);
  const span=(sourceIndex:number,sentenceIndex=0)=>{const s=sources[sourceIndex],sent=s.sentences[sentenceIndex];return locate(sources,{sentenceId:sent.id,quote:s.text.slice(sent.start,sent.end)})!;};
  const topicNames=id==='mixed'?['수업 집중','긴급 연락','자율성']:id==='neutral'?['이용 편의','운영 여건']:id==='supported'?['운영 시간']:id==='conflict'?['운영 시간','공지의 시점']:id==='unsupported'?['조사 근거']:id==='no_comments'?['휴식 공간']:['효과의 근거','표현 방식'];
  const topics:Topic[]=topicNames.map((label,i)=>({id:`topic_${i}`,label,description:`입력에서 ${label}에 관해 다룬 부분`,evidence:[span(i===0?0:Math.min(i,sources.length-1))]}));
  const assignments=sources.filter(s=>s.kind==='comment').map((s,i)=>({sourceId:s.id,topicIds:id==='mixed'?(i===0?['topic_0','topic_1']:i===1?['topic_2']:['topic_0']):[topics[Math.min(i,topics.length-1)].id],status:'assigned' as const,evidence:[span(i+1)]}));
  // Hand-authored per-sentence body classification; null means "no listed topic" (other).
  const bodyPlan:Record<string,(string[]|null)[]>={mixed:[null,['topic_0'],['topic_1','topic_2']],neutral:[['topic_0'],['topic_1']],provocative:[['topic_0'],['topic_1'],null],unsupported:[['topic_0'],null],no_comments:[null,['topic_0']],conflict:[['topic_0','topic_1'],['topic_0']],supported:[['topic_0']]};
  const bodyTopicAssignments:BodyTopicAssignment[]=sources[0].sentences.map((t,i)=>{const ids=bodyPlan[id]?.[i]??null;return ids?{sentenceId:t.id,topicIds:ids,status:'assigned' as const}:{sentenceId:t.id,topicIds:[],status:'other' as const};});
  const expressions:Expression[]=sources.flatMap(s=>s.sentences.map(t=>({sourceId:s.id,sentenceId:t.id,status:'clear' as Expression['status'],criteria:[],context:'direct' as const,evidence:[]})));
  if(id==='mixed'){const e=expressions.find(e=>e.sourceId==='comment_2')!;Object.assign(e,{status:'flagged',criteria:['group_generalization','mockery'],severity:'strong',explanation:'반대하는 학생 전체를 하나의 동기로 단정하고 낮춰 표현합니다.',evidence:[span(3)]});}
  if(id==='provocative')expressions.filter(e=>e.sourceId==='body').forEach((e,i)=>Object.assign(e,{status:'flagged',criteria:[[ 'overstatement'],['personal_attack','group_generalization'],['fear_appeal']][i]??['overstatement'],severity:i===1?'strong':'moderate',explanation:['조건과 개인차를 고려하지 않고 효과를 단정합니다.','다른 의견을 가진 사람들을 일괄적으로 비하합니다.','미래의 불이익을 단정하여 불안을 유발합니다.'][i],evidence:[span(0,i)]}));
  const factual=id==='unsupported'||id==='conflict'||id==='provocative'||id==='supported';
  const claim={id:'claim_0',text:span(0).quote,kind:factual?'factual' as const:'opinion' as const,origin:[span(0)]};
  const curatedPositions:Record<string,{proposition:string;label:'support'|'mixed'|'not_expressed';sentences:number[];reason:string}>={
    mixed:{proposition:input.proposition!,label:'mixed',sentences:[0,1,2],reason:'수업 집중과 긴급 연락이라는 두 관점을 함께 소개합니다.'},
    neutral:{proposition:input.proposition!,label:'support',sentences:[0,1],reason:'도서관 저녁 운영 확대를 제안하며 비용과 근무 여건을 조건으로 살펴봅니다.'},
    provocative:{proposition:'제시한 학습 방법을 시작해야 한다.',label:'support',sentences:[0,2],reason:'학습 방법의 효과를 단정하고 즉시 시작하도록 권합니다.'},
    unsupported:{proposition:'아침 자습 시작 시간을 늦춰야 한다.',label:'not_expressed',sentences:[1],reason:'시간을 늦추자는 주장이 나왔다고 전달하며 작성자의 지지는 명시하지 않습니다.'},
    no_comments:{proposition:'학교 정원에 나무를 더 심어야 한다.',label:'support',sentences:[0,1],reason:'그늘에서 쉴 공간을 이유로 나무를 더 심자고 제안합니다.'},
    conflict:{proposition:'학교 도서관 운영 시간을 연장해야 한다.',label:'not_expressed',sentences:[1],reason:'운영 시간과 연장 의견의 존재를 전달합니다.'},
    supported:{proposition:'',label:'not_expressed',sentences:[0],reason:'도서관 운영 시간을 전달하는 사실 안내입니다.'},
  };
  const curated=curatedPositions[id];
  const bodyPosition=curated?{proposition:curated.proposition,label:curated.label,evidence:curated.sentences.map(index=>span(0,index)),reason:curated.reason}:undefined;
  const a:Analysis={schemaVersion:'2.1',analysisId:`demo_${f.id}`,requestId:`demo_${f.id}`,mode:'demo',status:'success',versions:{rubric:RUBRIC,prompt:'demo-curated-2.2',model:'human-authored-fixture',segmenter:SEGMENTER},sources,bodyPosition,proposition:input.proposition,topics,topicAssignments:assignments,bodyTopicAssignments,...(input.proposition?{stances:sources.filter(s=>s.kind==='comment').map((s,i)=>({sourceId:s.id,label:id==='mixed'?(i===0?'mixed' as const:i===1?'oppose' as const:'not_expressed' as const):'not_expressed' as const,evidence:[span(i+1)],reason:'학습용 예시로 작성한 분류입니다.'}))}:{}),expressions,claims:[claim],counterArguments:id==='mixed'?[{claimId:claim.id,kind:'qualification',text:'전면 금지 대신 수업 중 보관과 긴급 연락 허용을 함께 검토할 수 있어요.',reasoning:'집중을 돕는 목적과 연락 필요성을 함께 고려하는 제안입니다.',evidenceNeeded:'수업 중 사용 실태와 긴급 연락 수단에 관한 자료가 필요해요.',basis:[span(0)],provenance:'curated_example'}]:[],searchSuggestions:[],perspectiveQuestions:[{text:id==='mixed'?'학습 집중과 긴급 연락을 함께 보장할 방법은 무엇일까요?':id==='unsupported'?'수치의 조사 대상·방법·시점을 확인할 수 있을까요?':'이 글에서 아직 다루지 않은 조건이나 자료는 무엇일까요?',basis:[span(0)]}],indicators:null as unknown as Analysis['indicators'],coverage:{totalSentences:expressions.length,naturalSentences:naturalSentenceCount(sources),factualClaimsExtracted:factual?1:0,claimsMayBeOmitted:false,scopeNote:'직접 작성한 학습용 예시입니다. 실제 조사·실제 AI 분석 결과가 아닙니다.'},warnings:[{code:'DEMO',message:'직접 작성한 예시 결과입니다. 입력을 수정하면 실제 분석 연결이 필요합니다.'}],createdAt:new Date().toISOString()};a.indicators=indicators(a);assertAnalysis(a);return a;
}
export function demoVerification(id:string):Verification{
  const a=demoAnalysis(id),claim=a.claims[0];let refs:Reference[]=[],checks:Check[]=[];
  if(id==='conflict'||id==='supported'){
    const supported=id==='supported';
    refs=[{id:'ref_0',provenance:'provided_text',text:supported?'이번 학기 학교 도서관은 평일 오후 6시에 문을 닫는다.':'올해 학교 도서관은 평일 오후 6시에 문을 닫는다.',title:'학습용 가상 도서관 공지',truncated:false}];
    const r=refs[0];
    checks=[{claimId:claim.id,outcome:supported?'supported':'contradicted',execution:'completed',relations:[{referenceId:r.id,start:0,end:r.text.length,quote:r.text,relation:supported?'supports':'contradicts',explanation:supported?'입력 본문과 가상 공지의 운영 시간이 같습니다.':'입력 본문은 오후 9시, 가상 공지는 오후 6시로 서로 다릅니다.'}],explanation:supported?'가상 참고자료에서 같은 운영 시간을 확인했습니다.':'입력한 출처와 운영 시간이 다릅니다. 실제 최신 공지는 별도로 확인해야 합니다.',temporalFit:'matched',limitations:['기능 체험을 위해 직접 만든 가상 자료이며 실제 학교의 공지가 아닙니다.']}];
  }else checks=[{claimId:claim.id,outcome:claim.kind==='factual'?'unchecked':'not_applicable',execution:'skipped',relations:[],explanation:claim.kind==='factual'?'이 예시에는 대조 가능한 자료가 없습니다. 자료 없음은 거짓을 뜻하지 않습니다.':'의견을 사실의 참·거짓으로 평가하지 않습니다.',temporalFit:'unclear',limitations:['실제 웹 검색을 수행하지 않았습니다.']}];
  return {schemaVersion:'2.1',requestId:`verify_demo_${id}`,parentAnalysisId:a.analysisId,mode:'demo',status:'success',versions:{rubric:RUBRIC,prompt:'demo-curated-2.1',model:'human-authored-fixture',retriever:'disabled'},scope:'provided_text',references:refs,checks,attempts:[],warnings:[{code:'DEMO',message:'가상 자료를 사용한 학습용 예시입니다.'}],createdAt:new Date().toISOString()};
}
