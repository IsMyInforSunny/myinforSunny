import {afterEach,describe,it,expect,vi} from 'vitest';
import {assembleAnalysis} from '../lib/server/analyze';
import {normalizeArticles,publicArticleUrl,searchNews} from '../lib/server/news';
import {capabilities} from '../lib/server/config';
import type {RawAnalysis} from '../lib/contracts';
afterEach(()=>vi.unstubAllGlobals());
describe('다른 관점과 승인 전 기사 검색',()=>{
 const raw=():RawAnalysis=>({topics:[],topicAssignments:[],stances:[],bodyAssigned:[],bodyOtherIds:['body_s0'],bodyUndeterminedIds:[],expressions:[{sentenceId:'body_s0',status:'clear',criteria:[],severity:'none',context:'direct',explanation:'',evidence:[]}],claims:[{id:'c1',text:'운영 시간을 늘리면 좋겠다.',kind:'opinion',origin:[{sentenceId:'body_s0',quote:'운영 시간을 늘리면 좋겠다.'}],targetTime:''}],perspectiveQuestions:[],counterArguments:[{claimId:'c1',kind:'qualification',text:'운영 비용도 함께 검토할 수 있어요.',reasoning:'운영 인력이 필요할 수 있습니다.',evidenceNeeded:'운영 예산과 근무 자료',basis:[{sentenceId:'body_s0',quote:'운영 시간을 늘리면 좋겠다.'}]}],searchSuggestions:[],claimsMayBeOmitted:true});
 it('주장과 원문을 확인한 제안만 AI 출처 없음으로 반환한다',()=>{
  const result=assembleAnalysis({kind:'text',body:'운영 시간을 늘리면 좋겠다.',comments:[]},raw(),'r','mock');expect(result.counterArguments?.[0].provenance).toBe('ai_suggestion');
  const broken=raw();broken.counterArguments[0].claimId='missing';const r=assembleAnalysis({kind:'text',body:'운영 시간을 늘리면 좋겠다.',comments:[]},broken,'r','mock');expect(r.counterArguments).toHaveLength(0);expect(r.status).toBe('partial');
 });
 it('검색이 승인되지 않으면 네트워크를 호출하지 않는다',async()=>{
  const f=vi.fn();vi.stubGlobal('fetch',f);await expect(searchNews('school library',{ENABLE_NEWS_SEARCH:'true'},new AbortController().signal)).rejects.toMatchObject({code:'SEARCH_UNAVAILABLE'});expect(f).not.toHaveBeenCalled();expect(capabilities({ENABLE_NEWS_SEARCH:'true',DB:{} as D1Database}).webSearch).toBe(false);
 });
 it('검색 결과는 중복·로컬 주소를 제거하고 기사 입장을 확인했다고 표시하지 않는다',()=>{
  for(const url of ['javascript:alert(1)','http://127.0.0.1/x','https://user:secret@news.test/x','https://localhost/a'])expect(publicArticleUrl(url)).toBeNull();
  const a={title:'가상 기사',url:'https://news.example/a?utm_source=test',language:'Korean',seendate:'20261030T010000Z'};
  const list=normalizeArticles([a,{...a,url:'https://news.example/a'},{...a,url:'http://127.0.0.1/x'}]);expect(list).toHaveLength(1);expect(list[0]).toMatchObject({url:'https://news.example/a',provenance:'search_result',stance:'not_checked'});
 });
});
