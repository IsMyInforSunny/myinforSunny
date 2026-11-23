import {describe,expect,it} from 'vitest';
import type {Analysis} from '../lib/contracts';
import {citationComposition,priorityScoreArticle} from '../lib/citation-composition';
import {buildAnalysisScores} from '../lib/analysis-scores';
import {demoAnalysis} from '../lib/fixtures';
import {makeSources} from '../lib/domain';

const URLS=[
 'https://www.pressian.com/pages/articles/2026091808555217839',
 'https://www.pressian.com/pages/articles/2026110509224063406',
];
type CitationLabel=NonNullable<Analysis['citationBalance']>['labels'][number];

function article(directions:CitationLabel['direction'][]=['support','oppose','neutral'],url=URLS[0]):Analysis{
 const analysis=structuredClone(demoAnalysis('supported'));
 const body=directions.map((_,index)=>`문장 ${index+1}의 공개 사실을 전달했다.`).join('\n');
 analysis.mode='live';analysis.status='success';
 analysis.sources=makeSources({kind:'text',body,comments:[]});
 analysis.article={url,fetchedAt:'2026-11-23T01:00:00Z',fullTextLength:body.length,analyzedCharacters:body.length,truncated:false};
 analysis.claims=[];analysis.topics=[];analysis.topicAssignments=[];analysis.stances=[];analysis.warnings=[];
 delete analysis.sentenceVoices;delete analysis.additionalSentenceVoices;delete analysis.voiceCoordinates;
 delete analysis.issueQuarterComparison;delete analysis.issueQuarterComparisons;
 analysis.bodyPosition={proposition:'공개 정책을 시행해야 한다.',label:'not_expressed',evidence:[],reason:'작성자 입장 표명 없음'};
 analysis.expressions=analysis.sources[0].sentences.map(unit=>({sourceId:'body',sentenceId:unit.id,status:'clear',criteria:[],context:'direct',evidence:[]}));
 analysis.citationBalance={method:'ai',modelVersion:'fixture-only',proposition:'공개 정책을 시행해야 한다.',labels:analysis.sources[0].sentences.map((unit,index)=>({sentenceId:unit.id,relevance:'related',direction:directions[index],speaker:'source'}))};
 return analysis;
}

describe('within-article citation composition',()=>{
 it('uses a shared denominator and integer percentages that sum to100',()=>{
  const result=citationComposition(article())!;
  expect(result.method).toBe('within_article');
  expect(result.all.counts).toEqual({support:1,oppose:1,neutral:1,uncertain:0});
  expect(result.all.denominator).toBe(3);
  expect(Object.values(result.all.percentages!).every(n=>Number.isInteger(n)&&n>=0&&n<=100)).toBe(true);
  expect(Object.values(result.all.percentages!).reduce((sum,n)=>sum+n,0)).toBe(100);
  expect(result.note).toContain('다른 매체와 비교한 편향 강도 점수가 아닙니다');
 });

 it('shows all-neutral100% without assigning an author or relative bias score of0',()=>{
  const analysis=article(['neutral','neutral','neutral']);
  const result=citationComposition(analysis)!;
  expect(result.all.percentages).toEqual({support:0,oppose:0,neutral:100,uncertain:0});
  expect(analysis.bodyPosition?.label).toBe('not_expressed');
  expect(buildAnalysisScores(analysis).bias).toMatchObject({status:'pending',value:null,numerator:null,denominator:null});
 });

 it('keeps unrelated sentences outside the proportion and relevance uncertainty in its own bucket',()=>{
  const analysis=article(['support','oppose','support','neutral','neutral']);
  const labels=analysis.citationBalance!.labels;
  labels[0].speaker='source';labels[1].speaker='journalist';
  labels[2].relevance='uncertain';labels[2].speaker='unknown';
  labels[3].speaker='mixed';labels[4].relevance='unrelated';
  const result=citationComposition(analysis)!;
  expect(result.all.counts).toEqual({support:1,oppose:1,neutral:1,uncertain:1});
  expect(result.all.percentages).toEqual({support:25,oppose:25,neutral:25,uncertain:25});
  expect(result.unrelated).toBe(1);expect(result.unknownSpeaker).toBe(2);
  expect(result.sources.denominator).toBe(1);expect(result.sources.counts.support).toBe(1);
  expect(result.journalist.denominator).toBe(1);expect(result.journalist.counts.oppose).toBe(1);
 });

 it('keeps no-related-evidence percentages empty rather than inventing a zero score',()=>{
  const analysis=article();analysis.citationBalance!.labels.forEach(label=>{label.relevance='unrelated';});
  const result=citationComposition(analysis)!;
  expect(result.all).toMatchObject({denominator:0,percentages:null});
  expect(result.sources.percentages).toBeNull();expect(result.journalist.percentages).toBeNull();
  expect(buildAnalysisScores(analysis).bias.value).toBeNull();
 });

 it.each(['missing','duplicate','unknown'] as const)('fails closed for %s sentence IDs',damage=>{
  const analysis=article();
  if(damage==='missing')analysis.citationBalance!.labels.pop();
  if(damage==='duplicate')analysis.citationBalance!.labels[1].sentenceId=analysis.citationBalance!.labels[0].sentenceId;
  if(damage==='unknown')analysis.citationBalance!.labels[1].sentenceId='body_unknown';
  expect(citationComposition(analysis)).toBeNull();
 });

 it('does not manufacture composition without a body or a citation result',()=>{
  const analysis=article();delete analysis.citationBalance;expect(citationComposition(analysis)).toBeNull();
  const missingBody=article();missingBody.sources=[];expect(citationComposition(missingBody)).toBeNull();
  expect(citationComposition(null)).toBeNull();
 });
});

describe('two-article priority rollout',()=>{
 it.each(URLS)('allows the approved article identity %s',url=>{
  expect(priorityScoreArticle(article(['neutral'],url))).toBe(true);
  expect(priorityScoreArticle(article(['neutral'],url+'/'))).toBe(true);
 });

 it.each([
  'http://www.pressian.com/pages/articles/2026091808555217839',
  'https://pressian.com/pages/articles/2026091808555217839',
  'https://www.pressian.com.evil.example/pages/articles/2026091808555217839',
  'https://other.example/pages/articles/2026091808555217839',
  'https://www.pressian.com/pages/articles/2026091808555217830',
  'https://www.pressian.com/pages/articles/2026091808555217839/extra',
  'https://reader@www.pressian.com/pages/articles/2026091808555217839',
  'https://www.pressian.com:8443/pages/articles/2026091808555217839',
  'not a URL',
 ])('does not activate for another article or origin: %s',url=>{
  expect(priorityScoreArticle(article(['neutral'],url))).toBe(false);
 });

 it('derives values from current labels rather than hardcoding them for an approved URL',()=>{
  const neutral=article(['neutral','neutral'],URLS[0]);
  const opposed=article(['oppose','oppose'],URLS[0]);
  expect(priorityScoreArticle(neutral)&&priorityScoreArticle(opposed)).toBe(true);
  expect(citationComposition(neutral)!.all.percentages!.neutral).toBe(100);
  expect(citationComposition(opposed)!.all.percentages!.oppose).toBe(100);
  expect(citationComposition(neutral)!.all.counts).not.toEqual(citationComposition(opposed)!.all.counts);
 });

 it('keeps the generic calculator independent of rollout eligibility',()=>{
  const analysis=article(['support','neutral'],'https://www.pressian.com/pages/articles/another');
  expect(priorityScoreArticle(analysis)).toBe(false);
  expect(citationComposition(analysis)!.all.denominator).toBe(2);
  expect(priorityScoreArticle(null)).toBe(false);
 });
});
