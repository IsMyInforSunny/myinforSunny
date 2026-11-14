import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {ARTICLE_ISSUE_POLICY,buildIssueQuarterBaselines,compareAgainstIssueQuarterArticles,compareIssueQuarterBaseline,issueQuarterPeriods,issueQuarterCoordinateRange,recommendIssueQuarterArticles,type IssueQuarterArticle} from '../lib/issue-quarter-baseline';

const article=(id:string,publisher='dailian.co.kr',coordinate:number|null=.5,extra:Partial<IssueQuarterArticle>={}):IssueQuarterArticle=>({
 id,bodyHash:createHash('sha256').update(id).digest('hex'),publisher,topic:'nuclear_energy',issue:'expansion',method:'svm',
 modelVersion:'candidate-1',version:'sentence-voice-1.0',decisionPolicy:'voice-neutral-independent-1.0',issuePolicy:ARTICLE_ISSUE_POLICY,
 axis:'source',coordinate,directional:4,unresolved:0,trainingOriginal:false,publishedAt:'2026-08-01T00:00:00+09:00',
 url:`https://${publisher}/news/${id}`,title:`Article ${id}`,...extra,
});
const population=()=>[
 ...Array.from({length:3},(_,i)=>article(`low${i}`,'dailian.co.kr',-1)),
 ...Array.from({length:3},(_,i)=>article(`high${i}`,'pressian.com',1)),
];
const input=()=>article('input','hani.co.kr',.6);

describe('issue and Korean calendar period cohorts',()=>{
 it('uses KST quarter and half, including a UTC date on the period boundary',()=>{
  expect(issueQuarterPeriods('2026-06-30T15:00:00Z').map(p=>p.key)).toEqual(['2026-Q3','2026-H2','all']);
  expect(issueQuarterPeriods('2026-06-30T14:59:59Z')[0].key).toBe('2026-Q2');
  expect(issueQuarterPeriods('2026-12-31T15:00:00Z')[0].key).toBe('2027-Q1');
  expect(issueQuarterPeriods('2026-02-30T12:00:00Z').map(p=>p.key)).toEqual(['all']);
  expect(issueQuarterPeriods(undefined).map(p=>p.key)).toEqual(['all']);
 });
 it('weights each eligible publisher equally despite unequal article counts',()=>{
  const rows=[...population(),...Array.from({length:9},(_,i)=>article(`more${i}`,'dailian.co.kr',-1))];
  const result=compareAgainstIssueQuarterArticles(input(),rows);
  expect(result).toMatchObject({status:'ready',baseline:0,score:30,publisherCount:2,pointCount:15,period:{key:'2026-Q3'},widened:false,direction:'above'});
  expect(result.percentile!.lower).toBeGreaterThanOrEqual(50);
 });
 it('keeps the three-article and two-publisher thresholds',()=>{
  expect(compareAgainstIssueQuarterArticles(input(),population().slice(0,5)).status).toBe('insufficient');
  expect(compareAgainstIssueQuarterArticles(input(),population().slice(0,3)).status).toBe('insufficient');
 });
 it('widens from quarter to half and then all periods and reports the selected range',()=>{
  const rows=population().map((row,i)=>({...row,publishedAt:i%2?'2026-10-01T00:00:00+09:00':row.publishedAt}));
  const half=compareAgainstIssueQuarterArticles(input(),rows);
  expect(half).toMatchObject({status:'ready',period:{key:'2026-H2'},widened:true});
  const all=compareAgainstIssueQuarterArticles(input(),rows.map((row,i)=>({...row,publishedAt:i%2?'2025-08-01T00:00:00+09:00':row.publishedAt})));
  expect(all).toMatchObject({status:'ready',period:{key:'all'},widened:true});
  expect(all.fallbackReason).toBeTruthy();
  expect(compareAgainstIssueQuarterArticles({...input(),publishedAt:undefined},population())).toMatchObject({status:'ready',period:{key:'all'},widened:false});
 });
 it('keeps unresolved evidence as a range and reports an unsigned distance interval',()=>{
  const bounded={...input(),coordinate:null,unresolved:1,bounds:{lower:-.2,upper:.2}};
  expect(issueQuarterCoordinateRange(bounded)).toEqual({lower:-.2,upper:.2});
  expect(compareAgainstIssueQuarterArticles(bounded,population())).toMatchObject({status:'ready',score:null,scoreRange:{lower:0,upper:10},direction:'undetermined'});
  expect(compareAgainstIssueQuarterArticles({...bounded,bounds:{lower:.2,upper:.6}},population())).toMatchObject({status:'ready',score:null,scoreRange:{lower:10,upper:30},direction:'above'});
  expect(compareAgainstIssueQuarterArticles({...bounded,bounds:{lower:-.3,upper:.3}},population()).status).toBe('input_unresolved');
 });
 it('counts eligible ranges separately without substituting them into the distribution',()=>{
  const ranged=Array.from({length:4},(_,i)=>article(`range${i}`,'dailian.co.kr',null,{unresolved:1,bounds:{lower:.2,upper:.5}}));
  const bundle=buildIssueQuarterBaselines([...population(),...ranged]);
  expect(bundle).toMatchObject({pointArticleCount:6,rangeArticleCount:4});
  const group=bundle.groups.find(g=>g.period.key==='2026-Q3')!;
  expect(group).toMatchObject({median:0,count:10,pointCount:6,rangeCount:4,status:'ready'});
  expect(group.boundaries).toHaveLength(21);
  expect(compareAgainstIssueQuarterArticles(input(),[...population().slice(0,3),...ranged.map(row=>({...row,publisher:'pressian.com'}))]).status).toBe('insufficient');
 });
 it('excludes the input, duplicate bodies, duplicate URLs and training originals',()=>{
  const rows=[...population(),input(),{...population()[0],id:'copy'},{...article('copy-url'),url:population()[0].url},article('training','pressian.com',0,{trainingOriginal:true})];
  const bundle=buildIssueQuarterBaselines(rows,{excludeInput:input()});
  expect(bundle.exclusions).toMatchObject({input_article:1,duplicate_article:2,training_original:1});
  expect(bundle.acceptedArticleCount).toBe(6);
  expect(compareAgainstIssueQuarterArticles(input(),population(),[population()[0].bodyHash]).status).toBe('insufficient');
 });
 it('requires the same model, decision policy, fixed article issue and source axis',()=>{
  for(const override of [{modelVersion:'other'},{decisionPolicy:'other'},{issuePolicy:'legacy'},{axis:'journalist' as const},{issue:'lifetime'}]){
   expect(compareAgainstIssueQuarterArticles({...input(),...override},population()).status).not.toBe('ready');
  }
 });
 it('keeps aggregate artifacts free of text, quotations, URLs and article identifiers',()=>{
  const bundle=buildIssueQuarterBaselines(population());
  const serialized=JSON.stringify(bundle);
  expect(serialized).not.toContain('https://');expect(serialized).not.toContain('Article low0');
  expect(serialized).not.toContain('bodyHash');expect(serialized).not.toContain('low0');
  expect(bundle).toMatchObject({researchOnly:true,usageReviewed:false,distributionPopulation:'point-coordinates-only'});
  expect(compareIssueQuarterBaseline(input(),bundle).status).toBe('membership_unverified');
  expect(compareIssueQuarterBaseline(input(),bundle,{corpusArticleHashes:[input().bodyHash]}).status).toBe('input_in_population');
  expect(compareIssueQuarterBaseline(input(),bundle,{corpusArticleHashes:population().map(a=>a.bodyHash)}).status).toBe('ready');
 });
 it('preserves percentile rank uncertainty for ties and coordinate intervals',()=>{
  const equal=population().map(row=>({...row,coordinate:0}));
  const result=compareAgainstIssueQuarterArticles({...input(),coordinate:0},equal);
  expect(result).toMatchObject({score:0,percentile:{lower:0,upper:100},topPercentile:{lower:0,upper:100},direction:'at_baseline'});
 });
 it('shows title and link recommendations only with existing approval or explicit local mode',()=>{
  expect(recommendIssueQuarterArticles(input(),population()).opposing).toHaveLength(0);
  const local=recommendIssueQuarterArticles(input(),population(),{localOnly:true});
  expect(local.opposing).toHaveLength(3);expect(local.similar).toHaveLength(3);
  expect(local.opposing.every(row=>row.id.startsWith('low'))).toBe(true);
  const approved=recommendIssueQuarterArticles(input(),population().map(row=>({...row,usageApproved:true})));
  expect(approved.opposing).toHaveLength(3);
  expect(recommendIssueQuarterArticles({...input(),coordinate:null,unresolved:1,bounds:{lower:.4,upper:.7}},population(),{localOnly:true}).opposing).toHaveLength(3);
 });
 it('partitions the same articles evaluated by different model versions',()=>{
  const bundle=buildIssueQuarterBaselines([...population(),...population().map(row=>({...row,modelVersion:'candidate-2'}))]);
  expect(bundle.acceptedArticleCount).toBe(12);
  expect(bundle.groups.filter(group=>group.period.kind==='quarter')).toHaveLength(2);
  expect(compareAgainstIssueQuarterArticles(input(),population().map(row=>({...row,modelVersion:'candidate-2'}))).status).toBe('version_mismatch');
 });
 it('rejects inconsistent distribution artifacts and projects recommendations to display metadata',()=>{
  const bundle=buildIssueQuarterBaselines(population());
  bundle.groups.find(group=>group.period.kind==='quarter')!.boundaries[10].coordinate=3;
  expect(compareIssueQuarterBaseline(input(),bundle,{corpusArticleHashes:population().map(row=>row.bodyHash)}).status).toBe('insufficient');
  const rows=population().map(row=>({...row,usageApproved:true,text:'Private source text',labels:['private']}));
  const recommendations=recommendIssueQuarterArticles(input(),rows);
  expect(recommendations.opposing).toHaveLength(3);
  expect(recommendations.opposing.every(row=>Object.keys(row).sort().join(',')==='id,publishedAt,publisher,title,url')).toBe(true);
  expect(JSON.stringify(recommendations.opposing)).not.toContain('Private source text');
 });

});
