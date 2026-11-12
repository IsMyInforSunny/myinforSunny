import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sentences} from '../lib/segmentation';
import {fomoSignals} from '../lib/reader-metrics';
import {reviewCitedSources} from '../lib/cited-sources';
import {computeRelativeMetrics,classifyRelativeTopic,relativeMetricVersions} from '../lib/relative-metrics';
import {compareRelativeBaseline,percentilePosition,type RelativeBaselines} from '../lib/relative-baselines';
import RelativeTopicComparison from '../components/relative-topic-comparison';
import reference from '../lib/data/relative-baselines.json';

const body='최저임금을 논의한다. 통계청에 따르면 임금이 증가했다. 지금 당장 신청해야 한다. 관계자에 따르면 검토 중이다.';

describe('same-method topic comparison',()=>{
 it('uses the existing lexical and attribution modules over the same natural sentences',()=>{
  const source={id:'body',kind:'body' as const,text:body,sentences:sentences(body,'body')};
  const values=computeRelativeMetrics(body);
  expect(values.totalSentences).toBe(4);
  expect(values.fomo).toEqual({count:1,total:4,value:25});
  expect(values.fomo.count).toBe(fomoSignals({sources:[source]}).flaggedSentences);
  const cited=reviewCitedSources({sources:[source],claims:[]});
  expect(cited.sources.filter(item=>item.signals.named)).toHaveLength(1);
  expect(values.attribution).toEqual({count:1,total:4,value:25});
 });
 it('keeps the comparison window at 2000 characters even when the main analysis is longer',()=>{
  const prefix='최저임금 기사다. '.repeat(250);
  const long=prefix+'통계청에 따르면 지금 당장 신청해야 한다.';
  expect(computeRelativeMetrics(long)).toEqual(computeRelativeMetrics(long.slice(0,2000)));
  expect(computeRelativeMetrics(long).fomo.count).toBe(0);
  expect(computeRelativeMetrics(long).attribution.count).toBe(0);
 });
 it('counts a fragmented natural sentence once and preserves quoted-expression exclusions',()=>{
  const long='최저임금 '+ '가'.repeat(650)+' 지금 당장 신청해야 한다.';
  expect(computeRelativeMetrics(long).fomo).toEqual({count:1,total:1,value:100});
  expect(computeRelativeMetrics('최저임금 광고의 “지금 당장” 문구를 소개했다.').fomo.count).toBe(0);
 });
 it('leaves ambiguous and unsupported topics unassigned',()=>{
  expect(classifyRelativeTopic('최저임금과 국민연금을 논의한다.')).toBeNull();
  expect(classifyRelativeTopic('칫솔모가 미세한 전기를 만든다.')).toBeNull();
  expect(classifyRelativeTopic('원전과 전기요금을 논의한다.','원전 계획')).toBe('nuclear_energy');
 });
 it('reports weighted tie midranks and bounded percentile ranges',()=>{
  const boundaries=[{percentile:0,value:0,belowPercent:0,atOrBelowPercent:80},{percentile:85,value:10,belowPercent:80,atOrBelowPercent:90},{percentile:100,value:20,belowPercent:90,atOrBelowPercent:100}];
  expect(percentilePosition(0,boundaries)).toEqual({lower:40,upper:40,ties:80});
  expect(percentilePosition(5,boundaries)).toEqual({lower:80,upper:80,ties:null});
  expect(percentilePosition(30,boundaries)).toEqual({lower:100,upper:100,ties:null});
 });
 it('withholds ranks for small groups and mismatched rule versions',()=>{
  const small=structuredClone(reference) as RelativeBaselines;
  small.topics.find(topic=>topic.id==='minimum_wage')!.n=99;
  expect(compareRelativeBaseline(body,'',small).fomo.position).toBeNull();
  expect(compareRelativeBaseline(body,'',small).status).toBe('insufficient');
  const stale={...reference,metricVersions:{...relativeMetricVersions,fomo:'old-rules'}} as RelativeBaselines;
  expect(compareRelativeBaseline(body,'',stale).status).toBe('incompatible');
  expect(compareRelativeBaseline(body,'',stale).attribution.position).toBeNull();
 });
 it('shows absolute values, ranks and population metadata without naming publisher scores',()=>{
  const html=renderToStaticMarkup(createElement(RelativeTopicComparison,{body}));
  expect(html).toContain('25점');expect(html).toContain('백분위');
  expect(html).toContain('416');expect(html).toContain('4개 매체');
  expect(html).toContain('2,000');expect(html).toContain('2024-01-01');
  expect(html).toContain('relative-baselines-2026-11-12.2');
  expect(html).not.toMatch(/dailian|newdaily|pressian|ohmynews/);
 });
});
