import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {classifyArticleFormat,eventTermCounts,eventDocument,eventCosine,findEventComparison,
  EVENT_RULES,EventBaseline,EventBaselineIndex} from '../lib/article-comparison-groups';
import {buildEventBaselines} from '../research/build_relative_baselines.mjs';

const text='의대 증원 법원 집행정지 신청 결정 판결 내용을 설명한다. '.repeat(12);
const title='법원 의대 증원 집행정지 신청 결정';
const idf=Object.fromEntries(Object.keys(eventTermCounts(text+' '+title)).map(term=>[term,1]));
const document=eventDocument(text,title,idf);
const event:EventBaseline={id:'event_sample',topicId:'medical_school_quota',
  start:'2024-04-03T00:00:00Z',through:'2024-04-04T00:00:00Z',n:3,publisherCount:2,
  centroid:document.body,titleCentroid:document.title,metrics:{fomo:{boundaries:[]},attribution:{boundaries:[]}}};
const index=(events:EventBaseline[]=[event]):EventBaselineIndex=>({schemaVersion:'event-baselines-1.0',version:'test',
  generatedAt:'2026-11-12T00:00:00Z',scopeCharacters:2000,metricVersions:{},
  articlePeriod:{from:'2024-01-01',through:'2026-11-04',timeZone:'Asia/Seoul'},
  sourceArticleCount:3,publisherCount:2,rules:{...EVENT_RULES},idf,events});
const input={body:text,title,topicId:event.topicId,publishedAt:'2024-04-03T00:00:00Z'};

describe('explicit article format classification',()=>{
  it('uses title markers before conflicting section and body markers',()=>{
    expect(classifyArticleFormat({title:'[기고] 제도 개선',section:'인터뷰',body:'인터뷰: 내용'}))
      .toMatchObject({id:'opinion',evidence:'title_prefix',opinion:true});
    expect(classifyArticleFormat({title:'칼럼: 쟁점',section:'보도'}).id).toBe('opinion');
    expect(classifyArticleFormat({title:'[인터뷰] 전문가를 만나다'}).id).toBe('interview');
    expect(classifyArticleFormat({title:'[포토] 현장'}).id).toBe('other');
  });
  it('requires section labels or explicit body cues and otherwise stays unknown',()=>{
    expect(classifyArticleFormat({section:'정치 > 오피니언'}).id).toBe('opinion');
    expect(classifyArticleFormat({section:'인터뷰 논란',title:'정치인의 사설 발언',body:'칼럼에 관한 일반 보도다.'}).id).toBe('unknown');
    expect(classifyArticleFormat({body:'Q: 이번 쟁점은 무엇입니까?\nA: 정책을 설명하겠습니다.'}))
      .toMatchObject({id:'interview',evidence:'qa'});
    expect(classifyArticleFormat({body:'(서울=연합뉴스) 홍길동 기자 = 새 소식이 전해졌다.'}).id).toBe('report');
    expect(classifyArticleFormat({title:'정부 정책 발표',section:'정치',body:'새 정책을 발표했다.'}).id).toBe('unknown');
  });
});

describe('event matching safeguards',()=>{
  it('hashes terms deterministically and normalizes the same input to cosine one',()=>{
    expect(eventTermCounts(text)).toEqual(eventTermCounts(text));
    expect(Object.keys(eventTermCounts(text)).every(key=>/^[0-9a-f]{16}$/.test(key))).toBe(true);
    expect(JSON.stringify(eventTermCounts(text))).not.toContain('법원');
    expect(eventCosine(document.body,document.body)).toBeCloseTo(1);
    expect(eventDocument(text+' 추가사항'.repeat(600),title,idf).body).toEqual(document.body);
  });
  it('requires topic, date, eligible counts, and compatible rules',()=>{
    expect(findEventComparison(input,index()).status).toBe('matched');
    expect(findEventComparison({...input,topicId:null},index()).status).toBe('unknown_topic');
    expect(findEventComparison({...input,publishedAt:undefined},index()).status).toBe('date_missing');
    expect(findEventComparison({...input,publishedAt:'bad date'},index()).status).toBe('date_missing');
    for(const change of [{n:2},{publisherCount:1},{start:'invalid'},{through:'2024-04-10T00:00:00Z'}])
      expect(findEventComparison(input,index([{...event,...change}])).status).toBe('no_match');
    const incompatible=index();incompatible.scopeCharacters=3000;
    expect(findEventComparison(input,incompatible).status).toBe('incompatible');
  });
  it('checks date distance against both event extrema, including inclusive boundaries',()=>{
    for(const publishedAt of ['2024-04-01T00:00:00Z','2024-04-06T00:00:00Z'])
      expect(findEventComparison({...input,publishedAt},index()).status).toBe('matched');
    for(const publishedAt of ['2024-03-31T23:59:59Z','2024-04-06T00:00:01Z'])
      expect(findEventComparison({...input,publishedAt},index()).status).toBe('no_match');
  });
  it('withholds two similarly close events and unrelated vocabulary',()=>{
    expect(findEventComparison(input,index([event,{...event,id:'event_second'}])).status).toBe('ambiguous');
    expect(findEventComparison({...input,body:'태풍 강우 풍속 기상',title:'태풍 기상'},index()).status).toBe('no_match');
  });
});

const publishers=['dailian.co.kr','newdaily.co.kr','ohmynews.com','pressian.com'];
const row=(at:number,body:string,date:string)=>({id:`local_${at}`,publisherId:publishers[at%4],
  url:`https://${publishers[at%4]}/article/${at}`,title:'',text:body,
  publishedAt:date,topicId:'medical_school_quota',politicalLabel:null});

describe('offline complete-link event builder',()=>{
  it('blocks a transitive date chain and preserves every local membership without publishing identities',async()=>{
    const rows=[0,2,4].map((day,at)=>row(at,text+` 구분${at}.`,`2024-04-0${day+1}T00:00:00Z`));
    const result=await buildEventBaselines(rows);
    expect(result.localMapping.events.map((group:{n:number})=>group.n).sort()).toEqual([1,2]);
    expect(result.summary.assignedArticleCount).toBe(3);
    expect(result.index.events).toHaveLength(0);
    expect(Object.keys(result.localMapping.articleGroups)).toEqual(expect.arrayContaining(rows.map(item=>item.id)));
    expect(JSON.stringify(result.index)).not.toMatch(/https?:|publisherId|politicalLabel|dailian|"title"|"url"|"text"/);
    expect(JSON.stringify(result.localMapping)).toContain(rows[0].url);
  });
  it('blocks a transitive similarity chain even when neighboring articles match',async()=>{
    const rows=[row(0,'alpha '.repeat(80),'2024-04-01T00:00:00Z'),
      row(1,'alpha beta '.repeat(50),'2024-04-01T01:00:00Z'),
      row(2,'beta '.repeat(80),'2024-04-01T02:00:00Z')];
    const result=await buildEventBaselines(rows);
    expect(result.localMapping.events.map((group:{n:number})=>group.n).sort()).toEqual([1,2]);
    expect(result.index.events).toHaveLength(0);
  });
  it('publishes only eligible multi-publisher groups and keeps shared boundary contracts',async()=>{
    const rows=[0,1,2].map(at=>row(at,text+` 구분${at}.`,`2024-04-0${at+1}T00:00:00Z`));
    const result=await buildEventBaselines(rows);
    expect(result.index.events).toHaveLength(1);
    expect(result.index.events[0]).toMatchObject({n:3,publisherCount:3});
    for(const metric of ['fomo','attribution'])expect(result.index.events[0].metrics[metric].boundaries).toHaveLength(21);
    const singlePublisher=rows.map((item,at)=>({...item,publisherId:publishers[0],url:`https://${publishers[0]}/single/${at}`}));
    expect((await buildEventBaselines(singlePublisher)).index.events).toHaveLength(0);
  });
  it('retains the actual 3000 article aggregate counts and no public source identities',()=>{
    const baseline=JSON.parse(readFileSync(new URL('../lib/data/relative-baselines.json',import.meta.url),'utf8'));
    const events=JSON.parse(readFileSync(new URL('../lib/data/event-baselines.json',import.meta.url),'utf8'));
    expect(baseline.formatCounts.reduce((sum:number,format:{n:number})=>sum+format.n,0)).toBe(3000);
    for(const topic of baseline.topics)
      expect(topic.formats.reduce((sum:number,format:{n:number})=>sum+format.n,0)).toBe(topic.n);
    expect(events.sourceArticleCount).toBe(3000);
    expect(events.events.every((group:EventBaseline)=>group.n>=3&&group.publisherCount>=2)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/https?:|publisherId|politicalLabel|dailian|ohmynews|pressian|"title"|"url"|"text"/);
  });
});
