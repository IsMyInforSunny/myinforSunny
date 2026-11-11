import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {weightedBoundaries, scoreCorpusRows, buildRelativeBaselines} from '../research/build_relative_baselines.mjs';
import {computeRelativeMetrics, RELATIVE_TOPICS, relativeMetricVersions} from '../lib/relative-metrics';

const publishers = ['dailian.co.kr','newdaily.co.kr','ohmynews.com','pressian.com'];
const body = '통계청에 따르면 조사 결과가 공개됐다. ' + '추가적인 조사 내용을 설명한다. '.repeat(150) + '지금 당장 참여해야 한다.';
const rows = () => RELATIVE_TOPICS.flatMap((topic, topicIndex) => publishers.map((publisherId, index) => ({
  publisherId, topicId:topic.id, url:`https://${publisherId}/article/${topicIndex}-${index}`,
  text:`자료 ${topicIndex}-${index}에 관한 보도다. ${body}`, publishedAt:'2026-11-04T23:00:00+09:00', politicalLabel:null,
})));

describe('offline relative baseline builder', () => {
  it('gives each publisher equal weight despite unequal article counts', () => {
    const boundaries = weightedBoundaries([
      ...Array.from({length:9},()=>({publisher:'first',value:0})), {publisher:'second',value:100},
    ]);
    expect(boundaries).toHaveLength(21);
    expect(boundaries.find(point=>point.percentile===50)).toMatchObject({value:0,belowPercent:0,atOrBelowPercent:50});
    expect(boundaries.find(point=>point.percentile===55)).toMatchObject({value:100,belowPercent:50,atOrBelowPercent:100});
    expect(boundaries[0].percentile).toBe(0);
    expect(boundaries[20].percentile).toBe(100);
  });

  it('preserves the complete weighted interval of tied values', () => {
    const boundaries = weightedBoundaries([
      {publisher:'first',value:0}, {publisher:'first',value:0},
      {publisher:'second',value:0}, {publisher:'second',value:100},
    ]);
    expect(boundaries.find(point=>point.percentile===75)).toEqual({percentile:75,value:0,belowPercent:0,atOrBelowPercent:75});
    expect(boundaries.find(point=>point.percentile===80)).toEqual({percentile:80,value:100,belowPercent:75,atOrBelowPercent:100});
  });

  it('uses the same body window and rule modules as the site', async () => {
    const row = rows()[0];
    const scored = await scoreCorpusRows([row]);
    expect(scored[0].values).toEqual(computeRelativeMetrics(row.text));
    expect(scored[0].values.analyzedCharacters).toBe(2000);
    expect(scored[0].values.fomo.count).toBe(0);
    expect(scored[0].values.attribution.count).toBeGreaterThan(0);
  });

  it('rejects duplicated bodies, unsupported topics, dates outside the KST window and political labels', async () => {
    const row = rows()[0];
    await expect(scoreCorpusRows([row,{...row,url:row.url+'/duplicate'}])).rejects.toThrow('duplicate');
    for (const invalid of [
      {...row,topicId:'unknown'}, {...row,publishedAt:'2026-11-05T00:00:00+09:00'},
      {...row,publishedAt:'2023-12-31T23:59:59+09:00'}, {...row,politicalLabel:'left'},
    ]) await expect(scoreCorpusRows([invalid])).rejects.toThrow('invalid');
  });

  it('publishes only aggregate distributions and keeps the original rows intact', async () => {
    const input = rows(), original = structuredClone(input);
    const {baseline,summary} = await buildRelativeBaselines(input,{expectedCount:24,generatedAt:'2026-11-12T00:00:00.000Z'});
    expect(baseline.topics).toHaveLength(6);
    expect(baseline.topics.every((topic:{n:number;publisherCount:number})=>topic.n===4&&topic.publisherCount===4)).toBe(true);
    expect(baseline.metricVersions).toEqual(relativeMetricVersions);
    expect(summary.checks).toMatchObject({uniqueUrls:24,uniqueBodies:24,equalPublisherWeight:true,politicalLabelsCreated:0});
    expect(input).toEqual(original);
    const serialized = JSON.stringify({baseline,summary});
    for (const secret of ['"publisherId"','"politicalLabel"','https://','dailian.co.kr','"body"','"text"','"title"','"url"']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('contains all 3000 reviewed articles in six distributions without source identities', () => {
    const baseline = JSON.parse(readFileSync(new URL('../lib/data/relative-baselines.json',import.meta.url),'utf8'));
    expect(baseline.sourceArticleCount).toBe(3000);
    expect(baseline.publisherCount).toBe(4);
    expect(baseline.topics.reduce((sum:number,topic:{n:number})=>sum+topic.n,0)).toBe(3000);
    expect(baseline.topics.map((topic:{id:string})=>topic.id)).toEqual(RELATIVE_TOPICS.map(topic=>topic.id));
    for (const topic of baseline.topics) for (const metric of ['fomo','attribution']) {
      expect(topic.metrics[metric].boundaries.map((point:{percentile:number})=>point.percentile)).toEqual(Array.from({length:21},(_,i)=>i*5));
    }
    expect(JSON.stringify(baseline)).not.toMatch(/https?:|publisherId|politicalLabel|\.co\.kr/);
  });
});
