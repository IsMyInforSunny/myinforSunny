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
  if (rows.length !== (options.expectedCount ?? 3000)) throw new Error('Reviewed corpus count does not match the expected snapshot.');
  const scored = await scoreCorpusRows(rows, shared);
  const publisherCount = new Set(scored.map(row => row.publisher)).size;
  if (publisherCount !== (options.expectedPublishers ?? 4)) throw new Error('Reviewed corpus does not contain the expected publisher set.');
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const topics = shared.RELATIVE_TOPICS.map(topic => {
    const selected = scored.filter(row => row.topic === topic.id);
    if (!selected.length) throw new Error('Reviewed corpus lacks a required topic.');
    return {id:topic.id, label:topic.label, n:selected.length,
      publisherCount:new Set(selected.map(row => row.publisher)).size,
      metrics:Object.fromEntries(METRICS.map(metric => [metric, {
        boundaries:weightedBoundaries(selected.map(row => ({publisher:row.publisher, value:row.values[metric].value}))),
      }]))};
  });
  const baseline = {
    schemaVersion:'relative-baselines-1.0', version:'relative-baselines-2026-11-12.1', generatedAt,
    scopeCharacters:shared.RELATIVE_SCOPE_CHARACTERS, metricVersions:shared.relativeMetricVersions,
    articlePeriod:ARTICLE_PERIOD, sourceArticleCount:rows.length, publisherCount, topics,
  };
  const summary = {
    schemaVersion:'relative-baseline-build-report-1.0', version:baseline.version, generatedAt,
    sourceArticleCount:rows.length, acceptedArticleCount:scored.length, publisherCount,
    scopeCharacters:baseline.scopeCharacters, metricVersions:baseline.metricVersions, articlePeriod:ARTICLE_PERIOD,
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

function parseArguments(args) {
  const result = {
    input:path.join(ROOT,'.sites-runtime/collection-1000-20261105/articles-reviewed-3000.local.jsonl'),
    output:path.join(ROOT,'lib/data/relative-baselines.json'),
    report:path.join(ROOT,'docs/test-runs/2026-11-12-relative-baseline-step1/summary.json'),
  };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!['input','output','report'].includes(key) || !args[index+1]) {
      throw new Error('Use --input, --output and --report with explicit file paths.');
    }
    result[key] = path.resolve(args[index+1]);
  }
  if (new Set(Object.values(result)).size !== 3) throw new Error('Input and output files must be distinct.');
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
  summary.inputSha256 = sha256(snapshot);
  await saveJson(files.output,baseline);
  await saveJson(files.report,summary);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
