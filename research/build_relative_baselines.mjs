/** Offline publisher-balanced distributions from the retained reviewed corpus. */
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, rename} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const START = Date.parse('2024-01-01T00:00:00+09:00');
const END = Date.parse('2026-11-05T00:00:00+09:00');
const ARTICLE_PERIOD = {from:'2024-01-01', through:'2026-11-04', timeZone:'Asia/Seoul'};
const PUBLISHERS = new Set(['dailian.co.kr', 'newdaily.co.kr', 'ohmynews.com', 'pressian.com']);
const METRICS = ['fomo', 'attribution'];
const round = value => Math.round(value * 1e10) / 1e10;
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Each participating publisher contributes the same total probability mass. */
export function weightedBoundaries(observations) {
  if (!observations.length) throw new Error('Cannot build an empty metric distribution.');
  const counts = new Map();
  for (const row of observations) {
    if (!row.publisher || !Number.isFinite(row.value) || row.value < 0 || row.value > 100) {
      throw new Error('Invalid metric observation.');
    }
    counts.set(row.publisher, (counts.get(row.publisher) ?? 0) + 1);
  }
  const mass = new Map();
  for (const row of observations) {
    const weight = 100 / (counts.size * counts.get(row.publisher));
    mass.set(row.value, (mass.get(row.value) ?? 0) + weight);
  }
  let cumulative = 0;
  const points = [...mass.entries()].sort((left, right) => left[0] - right[0]).map(([value, weight], index, all) => {
    const belowPercent = round(cumulative);
    cumulative += weight;
    return {value, belowPercent, atOrBelowPercent:index === all.length - 1 ? 100 : round(cumulative)};
  });
  return Array.from({length:21}, (_, index) => {
    const percentile = index * 5;
    const point = percentile === 100 ? points[points.length - 1]
      : points.find(candidate => candidate.atOrBelowPercent + 1e-8 >= percentile);
    return {percentile, ...point};
  });
}

function publisherId(value) {
  if (typeof value !== 'string') return null;
  const canonical = value.trim().toLowerCase().replace(/^(?:www\.|m\.|biz\.)/, '');
  return PUBLISHERS.has(canonical) ? canonical : null;
}

function articleIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {return null;}
}

/** The shared module is the only implementation of sentence and metric rules. */
export async function scoreCorpusRows(rows, metricsModule) {
  const shared = metricsModule ?? await import('../lib/relative-metrics.ts');
  const topics = new Set(shared.RELATIVE_TOPICS.map(topic => topic.id));
  const urls = new Set(), bodies = new Set();
  return rows.map(row => {
    const publisher = publisherId(row.publisherId);
    const identity = articleIdentity(row.url);
    const published = Date.parse(row.publishedAt);
    if (!publisher || !identity || typeof row.text !== 'string' || row.text.trim().length < 300
      || !topics.has(row.topicId) || !Number.isFinite(published) || published < START || published >= END
      || (row.politicalLabel !== null && row.politicalLabel !== undefined)) {
      throw new Error('Reviewed corpus has an invalid article, topic, publication date or label.');
    }
    const bodyHash = sha256(row.text.replace(/\s+/g, ' ').trim());
    if (urls.has(identity) || bodies.has(bodyHash)) throw new Error('Reviewed corpus contains duplicate articles.');
    urls.add(identity); bodies.add(bodyHash);
    const values = shared.computeRelativeMetrics(row.text);
    if (values.scopeCharacters !== shared.RELATIVE_SCOPE_CHARACTERS || !values.totalSentences
      || METRICS.some(metric => !Number.isFinite(values[metric].value))) {
      throw new Error('Shared metric calculation returned an unusable observation.');
    }
    return {topic:row.topicId, publisher, values};
  });
}

export async function buildRelativeBaselines(rows, options = {}) {
  const shared = options.metricsModule ?? await import('../lib/relative-metrics.ts');
  const comparison = await import('../lib/article-comparison-groups.ts');
  if (rows.length !== (options.expectedCount ?? 3000)) throw new Error('Reviewed corpus count does not match the expected snapshot.');
  const scored = await scoreCorpusRows(rows, shared);
  const publisherCount = new Set(scored.map(row => row.publisher)).size;
  if (publisherCount !== (options.expectedPublishers ?? 4)) throw new Error('Reviewed corpus does not contain the expected publisher set.');
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const formats = rows.map(row=>comparison.classifyArticleFormat({title:row.title,section:row.section,body:row.text}));
  const distributions = selected => Object.fromEntries(METRICS.map(metric => [metric, {
    boundaries:weightedBoundaries(selected.map(row => ({publisher:row.publisher,value:row.values[metric].value}))),
  }]));
  const topics = shared.RELATIVE_TOPICS.map(topic => {
    const selected = scored.filter(row => row.topic === topic.id);
    if (!selected.length) throw new Error('Reviewed corpus lacks a required topic.');
    return {id:topic.id, label:topic.label, n:selected.length,
      publisherCount:new Set(selected.map(row => row.publisher)).size,
      metrics:distributions(selected),
      formats:comparison.ARTICLE_FORMATS.flatMap(format=>{
        const members=scored.filter((row,index)=>row.topic===topic.id&&formats[index].id===format.id);
        return members.length?[{id:format.id,label:format.label,n:members.length,
          publisherCount:new Set(members.map(row=>row.publisher)).size,metrics:distributions(members)}]:[];
      })};
  });
  const formatCounts=comparison.ARTICLE_FORMATS.map(format=>({id:format.id,label:format.label,
    n:formats.filter(item=>item.id===format.id).length}));
  const baseline = {
    schemaVersion:'relative-baselines-1.0', version:'relative-baselines-2026-11-12.2', generatedAt,
    scopeCharacters:shared.RELATIVE_SCOPE_CHARACTERS, metricVersions:shared.relativeMetricVersions,
    articlePeriod:ARTICLE_PERIOD, sourceArticleCount:rows.length, publisherCount,
    formatRulesVersion:comparison.ARTICLE_FORMAT_VERSION,formatCounts,topics,
  };
  const summary = {
    schemaVersion:'relative-baseline-build-report-1.0', version:baseline.version, generatedAt,
    sourceArticleCount:rows.length, acceptedArticleCount:scored.length, publisherCount,
    scopeCharacters:baseline.scopeCharacters, metricVersions:baseline.metricVersions, articlePeriod:ARTICLE_PERIOD,
    formatRulesVersion:comparison.ARTICLE_FORMAT_VERSION,formatCounts,
    unidentifiedFormatPercent:round((formatCounts.find(format=>format.id==='unknown')?.n??0)/rows.length*100),
    checks:{uniqueUrls:scored.length, uniqueBodies:scored.length, validDates:scored.length,
      politicalLabelsCreated:0, equalPublisherWeight:true},
    topics:topics.map(topic => ({id:topic.id,label:topic.label,n:topic.n,publisherCount:topic.publisherCount,
      metrics:Object.fromEntries(METRICS.map(metric => {
        const bounds = topic.metrics[metric].boundaries;
        const zero = bounds.find(boundary => boundary.value === 0);
        return [metric,{min:bounds[0].value,max:bounds[bounds.length-1].value,
          zeroPercent:zero?.atOrBelowPercent ?? 0,boundaryCount:bounds.length}];
      }))})),
  };
  return {baseline, summary};
}

/** Complete-link clustering avoids joining separate events through a chain of weakly similar articles. */
export async function buildEventBaselines(rows, options = {}) {
  const shared=options.metricsModule??await import('../lib/relative-metrics.ts');
  const comparison=await import('../lib/article-comparison-groups.ts');
  const scored=await scoreCorpusRows(rows,shared);
  const frequency=new Map();
  for(const row of rows){
    const terms=new Set([...Object.keys(comparison.eventTermCounts(row.text.slice(0,2000))),
      ...Object.keys(comparison.eventTermCounts(row.title??''))]);
    for(const term of terms)frequency.set(term,(frequency.get(term)??0)+1);
  }
  const idf=Object.fromEntries([...frequency].sort((left,right)=>left[0].localeCompare(right[0]))
    .map(([term,count])=>[term,round(Math.log((1+rows.length)/(1+count))+1)]));
  const documents=rows.map(row=>comparison.eventDocument(row.text,row.title??'',idf));
  const ordered=rows.map((row,index)=>({index,time:Date.parse(row.publishedAt),identity:articleIdentity(row.url)}))
    .sort((left,right)=>left.time-right.time||left.identity.localeCompare(right.identity));
  const groups=[];
  const similaritySamples=[];
  const maximumDistance=comparison.EVENT_RULES.maximumDayDistance*86400000;
  for(const article of ordered){
    const topic=rows[article.index].topicId;
    let best=null;
    for(const group of groups){
      if(group.topic!==topic||article.time-group.start>maximumDistance)continue;
      let minimum=1,total=0,compatible=true;
      for(const member of group.indices){
        const similarity=comparison.eventSimilarity(documents[article.index],documents[member]);
        if(similarity.value<comparison.EVENT_RULES.minimumSimilarity
          ||similarity.title!==null&&similarity.title<comparison.EVENT_RULES.minimumTitleSimilarity){compatible=false;break;}
        minimum=Math.min(minimum,similarity.value);total+=similarity.value;
      }
      if(compatible&&(!best||total/group.indices.length>best.mean))best={group,minimum,mean:total/group.indices.length};
    }
    if(best){
      best.group.indices.push(article.index);best.group.through=article.time;
      if(similaritySamples.length<40)similaritySamples.push(round(best.minimum));
    }else groups.push({topic,start:article.time,through:article.time,indices:[article.index]});
  }
  const centroid=(indices,kind,limit)=>{
    const sum=new Map();
    for(const index of indices)for(const [token,value] of documents[index][kind])sum.set(token,(sum.get(token)??0)+value);
    return comparison.normalizeEventVector([...sum],limit);
  };
  const localArticleGroups={};
  const localEvents=[];
  const events=[];
  for(const group of groups){
    const members=group.indices.map(index=>rows[index]);
    const publisherCount=new Set(group.indices.map(index=>scored[index].publisher)).size;
    const id='event_'+sha256(members.map(row=>articleIdentity(row.url)).sort().join('\n')).slice(0,24);
    for(const index of group.indices){
      const articleId=rows[index].id??sha256(articleIdentity(rows[index].url));
      if(localArticleGroups[articleId])throw new Error('Corpus article identities are duplicated.');
      localArticleGroups[articleId]=id;
    }
    localEvents.push({id,topicId:group.topic,start:new Date(group.start).toISOString(),through:new Date(group.through).toISOString(),
      n:members.length,publisherCount,members:members.map(row=>({id:row.id,title:row.title,url:row.url,publishedAt:row.publishedAt}))});
    if(members.length<comparison.EVENT_RULES.minimumArticles||publisherCount<comparison.EVENT_RULES.minimumPublishers)continue;
    events.push({id,topicId:group.topic,start:new Date(group.start).toISOString(),through:new Date(group.through).toISOString(),
      n:members.length,publisherCount,
      centroid:centroid(group.indices,'body',comparison.EVENT_RULES.bodyFeatures),
      titleCentroid:centroid(group.indices,'title',comparison.EVENT_RULES.titleFeatures),
      metrics:Object.fromEntries(METRICS.map(metric=>[metric,{boundaries:weightedBoundaries(group.indices.map(index=>({
        publisher:scored[index].publisher,value:scored[index].values[metric].value,
      })))}]))});
  }
  const generatedAt=options.generatedAt??new Date().toISOString();
  const index={schemaVersion:'event-baselines-1.0',version:'event-baselines-2026-11-12.1',generatedAt,
    scopeCharacters:shared.RELATIVE_SCOPE_CHARACTERS,metricVersions:shared.relativeMetricVersions,
    articlePeriod:ARTICLE_PERIOD,sourceArticleCount:rows.length,publisherCount:new Set(scored.map(row=>row.publisher)).size,
    rules:comparison.EVENT_RULES,idf,events};
  const summary={version:index.version,groupingVersion:comparison.EVENT_GROUPING_VERSION,rules:comparison.EVENT_RULES,
    groupCount:groups.length,eligibleGroupCount:events.length,eligibleArticleCount:events.reduce((sum,event)=>sum+event.n,0),
    assignedArticleCount:Object.keys(localArticleGroups).length,
    byTopic:shared.RELATIVE_TOPICS.map(topic=>({id:topic.id,label:topic.label,
      groupCount:groups.filter(group=>group.topic===topic.id).length,
      eligibleGroupCount:events.filter(event=>event.topicId===topic.id).length,
      eligibleArticleCount:events.filter(event=>event.topicId===topic.id).reduce((sum,event)=>sum+event.n,0)})),
    thresholdReview:{sampleCount:similaritySamples.length,acceptedMinimumSimilarities:similaritySamples,
      method:'complete-link cosine; title/body weights 0.35/0.65; every pair within 3 days and similarity threshold',
      note:'Keyword proximity forms candidate event groups. This is not a human-validated event accuracy score.'}};
  return {index,summary,localMapping:{version:index.version,articleGroups:localArticleGroups,events:localEvents}};
}

function parseArguments(args) {
  const result = {
    input:path.join(ROOT,'.sites-runtime/collection-1000-20261105/articles-reviewed-3000.local.jsonl'),
    output:path.join(ROOT,'lib/data/relative-baselines.json'),
    report:path.join(ROOT,'docs/test-runs/2026-11-12-relative-baseline-step23/summary.json'),
    events:path.join(ROOT,'lib/data/event-baselines.json'),
    'local-groups':path.join(ROOT,'.sites-runtime/relative-baseline-step23/article-events.local.json'),
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!['input','output','report','events','local-groups'].includes(key) || !args[index+1]) {
      throw new Error('Use --input, --output, --events, --local-groups and --report with explicit file paths.');
    }
    result[key] = path.resolve(args[index+1]);
  }
  if (new Set(Object.values(result)).size !== Object.keys(result).length) throw new Error('Input and output files must be distinct.');
  if(!result['local-groups'].startsWith(path.join(ROOT,'.sites-runtime')+path.sep))throw new Error('Event members must stay in ignored local runtime storage.');
  return result;
}

async function saveJson(destination, value) {
  await mkdir(path.dirname(destination),{recursive:true});
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n');
  await rename(temporary,destination);
}

async function main() {
  registerHooks({resolve(specifier,context,next) {
    try {return next(specifier,context);} catch (error) {
      if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL?.endsWith('.ts')
        && ['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code)) return next(specifier+'.ts',context);
      throw error;
    }
  }});
  const files = parseArguments(process.argv.slice(2));
  const snapshot = await readFile(files.input,'utf8');
  const rows = snapshot.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const {baseline,summary} = await buildRelativeBaselines(rows);
  const event=await buildEventBaselines(rows,{generatedAt:baseline.generatedAt});
  summary.inputSha256 = sha256(snapshot);
  summary.events=event.summary;
  await saveJson(files.output,baseline);
  await saveJson(files.events,event.index);
  await saveJson(files['local-groups'],event.localMapping);
  await saveJson(files.report,summary);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
