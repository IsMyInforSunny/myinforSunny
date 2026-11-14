/** Plan bounded article completion from retained sentences. No provider or budget writes. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {issueQuarterPeriods} from '../lib/issue-quarter-baseline.ts';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const runtime = fs.realpathSync(path.join(root, '.sites-runtime'));
const reservation = 6500;
const dailyBudget = 117000;
const options = {};
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index++) {
  const flag = argumentsList[index];
  if (flag === '--target-only') { options.targetOnly = true; continue; }
  if (!['--snapshot', '--output', '--max-calls', '--budget', '--topic'].includes(flag) || !argumentsList[index + 1]) {
    throw new Error('Use --snapshot LOCAL_DIRECTORY --output NEW_LOCAL_DIRECTORY [--max-calls N] [--budget unlimited] [--topic TOPIC] [--target-only]');
  }
  options[flag.slice(2)] = argumentsList[++index];
}

function localPath(value) {
  if (typeof value !== 'string' || !value) throw new Error('A local runtime path is required');
  const resolved = path.resolve(value);
  if (!resolved.startsWith(runtime + path.sep)) throw new Error('Research files must stay beneath .sites-runtime');
  let existing = resolved;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== runtime && !real.startsWith(runtime + path.sep)) throw new Error('Research path resolves outside .sites-runtime');
  return resolved;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const snapshot = localPath(options.snapshot);
const output = localPath(options.output);
if (fs.existsSync(output)) throw new Error('Preserve existing plans and choose a new output directory');
if (options.budget !== undefined && options.budget !== 'unlimited') throw new Error('Only an explicit --budget unlimited overrides the existing reservation ceiling');
const unlimited = options.budget === 'unlimited';
const maximumCalls = options['max-calls'] === undefined ? 18 : Number(options['max-calls']);
if (!Number.isSafeInteger(maximumCalls) || maximumCalls < 1 || !unlimited && maximumCalls > dailyBudget / reservation) {
  throw new Error('The existing daily reservation permits at most 18 calls');
}

const summary = read(path.join(snapshot, 'summary.local.json'));
const prepared = read(path.join(snapshot, 'pending-embedding-input.local.json'));
const {inputDigest, ...payload} = prepared;
if (prepared.schemaVersion !== 'voice-embedding-input-1.0' || sha(canonical(payload)) !== inputDigest) {
  throw new Error('Prepared input digest mismatch');
}
const embedding = {model:'nvidia/nemotron-3.5-embed-1b', input_type:'passage', encoding_format:'float', truncate:'NONE', dimensions:2048};
if (canonical(prepared.embedding) !== canonical(embedding)) throw new Error('Embedding model/options mismatch');
if (!Array.isArray(summary.supportedTopics) || !summary.modelVersion) throw new Error('Snapshot model scope is missing');
if(options.topic&&!summary.supportedTopics.includes(options.topic))throw new Error('Requested topic has no model in this snapshot');
const coordinatesBytes = fs.readFileSync(path.join(snapshot, 'coordinates.local.jsonl'), 'utf8');
const rows = coordinatesBytes.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
if (rows.length !== summary.counts.articles) throw new Error('Snapshot article count mismatch');

const records = new Map();
const missingByArticle = new Map();
for (const record of prepared.records) {
  if (typeof record.text !== 'string' || !record.text.trim() || sha(record.text) !== record.key || records.has(record.key)
    || !Array.isArray(record.sourceIDs) || !record.sourceIDs.length) {
    throw new Error('Invalid or duplicated pending sentence identity');
  }
  records.set(record.key, record);
  for (const source of record.sourceIDs) {
    if (typeof source.articleId !== 'string' || typeof source.sentenceId !== 'string') throw new Error('Invalid pending source identity');
    const keys = missingByArticle.get(source.articleId) ?? new Set();
    keys.add(record.key);
    missingByArticle.set(source.articleId, keys);
  }
}

const requestBytes = items => Buffer.byteLength(JSON.stringify({...embedding, input:items.map(item => item.text)}), 'utf8');
function batches(items) {
  const result = [];
  let batch = [];
  for (const item of items) {
    if (batch.length && (batch.length === 32 || requestBytes([...batch, item]) > 6000)) {
      result.push(batch);
      batch = [];
    }
    batch.push(item);
    if (requestBytes(batch) > 6000) throw new Error('A retained sentence exceeds the existing 6000-byte ceiling');
  }
  if (batch.length) result.push(batch);
  return result;
}

const publishers = new Set(['dailian.co.kr', 'newdaily.co.kr', 'ohmynews.com', 'pressian.com']);
const excluded = {};
function exclude(reason) { excluded[reason] = (excluded[reason] ?? 0) + 1; }
const candidates = [];
const identities = new Set();
const hashes = new Set();
const urls = new Set();
for (const row of rows) {
  if (row.modelVersion !== summary.modelVersion) throw new Error('Mixed model versions in coordinate snapshot');
  if (row.trainingOriginal) { exclude('training_original'); continue; }
  if (options.topic&&row.topic!==options.topic) { exclude('outside_requested_topic'); continue; }
  if (!summary.supportedTopics.includes(row.topic)) { exclude('unsupported_topic'); continue; }
  if (!row.issue) { exclude('issue_unassigned'); continue; }
  if (!publishers.has(row.publisher)) { exclude('outside_four_publishers'); continue; }
  if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/i.test(row.bodyHash) || !Number.isSafeInteger(row.cache?.missing) || row.cache.missing < 0) {
    throw new Error('Invalid article/cache identity');
  }
  const url = row.url ? new URL(row.url) : null;
  if (url) { url.hash = ''; url.hostname = url.hostname.replace(/^(www\.|m\.)/, ''); }
  const normalizedUrl = url?.href;
  if (identities.has(row.id) || hashes.has(row.bodyHash) || normalizedUrl && urls.has(normalizedUrl)) {
    exclude('duplicate_article');
    continue;
  }
  identities.add(row.id);
  hashes.add(row.bodyHash);
  if (normalizedUrl) urls.add(normalizedUrl);
  const keys = [...(missingByArticle.get(row.id) ?? [])].sort();
  if (row.cache.missing > 0 && !keys.length) throw new Error('Article missing vectors are absent from pending input');
  if (row.cache.missing === 0 && keys.length) throw new Error('Article cache and pending input disagree');
  if (keys.length > row.cache.missing) throw new Error('Unique pending sentence count exceeds missing occurrences');
  candidates.push({id:row.id, bodyHash:row.bodyHash, topic:row.topic, issue:row.issue, publisher:row.publisher,
    publishedAt:row.publishedAt ?? '', missingKeys:keys});
}

// Never inspect a predicted direction, speaker, coordinate, score or eligibility flag when choosing articles.
const order = (left, right) => left.missingKeys.length - right.missingKeys.length
  || left.publishedAt.localeCompare(right.publishedAt) || left.id.localeCompare(right.id);
candidates.sort(order);

const groups = new Map();
for (const article of candidates) {
  for (const period of issueQuarterPeriods(article.publishedAt)) {
    const key = [article.topic, article.issue, period.key].join('|');
    const group = groups.get(key) ?? {key, topic:article.topic, issue:article.issue, period, publishers:new Map()};
    const articles = group.publishers.get(article.publisher) ?? [];
    articles.push(article);
    group.publishers.set(article.publisher, articles);
    groups.set(key, group);
  }
}

const possible = [];
for (const group of groups.values()) {
  const sufficient = [...group.publishers.entries()].filter(([, articles]) => articles.length >= 3);
  for (let first = 0; first < sufficient.length; first++) {
    for (let second = first + 1; second < sufficient.length; second++) {
      const seed = [...sufficient[first][1].slice(0, 3), ...sufficient[second][1].slice(0, 3)];
      const keys = new Set(seed.flatMap(article => article.missingKeys));
      possible.push({group, seed, missingSentences:keys.size});
    }
  }
}
const periodRank = {quarter:0, half:1, all:2};
possible.sort((left, right) => periodRank[left.group.period.kind] - periodRank[right.group.period.kind]
  || left.missingSentences - right.missingSentences || left.group.key.localeCompare(right.group.key)
  || left.seed.map(article => article.id).join('|').localeCompare(right.seed.map(article => article.id).join('|')));
const target = possible[0] ?? null;

const queue = [];
const queued = new Set();
function append(article) {
  if (!queued.has(article.id)) { queue.push(article); queued.add(article.id); }
}
function roundRobin(articles) {
  const buckets = new Map();
  for (const article of articles) {
    if (queued.has(article.id)) continue;
    const bucket = buckets.get(article.publisher) ?? [];
    bucket.push(article);
    buckets.set(article.publisher, bucket);
  }
  const names = [...buckets.keys()].sort();
  while (names.some(name => buckets.get(name).length)) {
    for (const name of names) {
      const article = buckets.get(name).shift();
      if (article) append(article);
    }
  }
}
if (target) {
  roundRobin(target.seed.sort(order));
  roundRobin([...target.group.publishers.values()].flat().sort(order));
}
if (!options.targetOnly) roundRobin(candidates);

const selected = [];
const selectedKeys = new Set();
let pendingRecords = [];
let plannedBatches = [];
for (const article of queue) {
  const additions = article.missingKeys.filter(key => !selectedKeys.has(key)).map(key => records.get(key));
  const next = [...pendingRecords, ...additions];
  const nextBatches = batches(next);
  if (nextBatches.length > maximumCalls) break;
  selected.push(article);
  for (const record of additions) selectedKeys.add(record.key);
  pendingRecords = next;
  plannedBatches = nextBatches;
}
const selectedIds = new Set(selected.map(article => article.id));
pendingRecords = pendingRecords.map(record => ({...record, sourceIDs:record.sourceIDs.filter(source => selectedIds.has(source.articleId))}));
const seedIds = new Set(target?.seed.map(article => article.id));
const completedSeed = [...seedIds].filter(id => selectedIds.has(id)).length;
const report = {
  schemaVersion:'issue-quarter-embedding-plan-1.0', generatedAt:new Date().toISOString(), researchOnly:true, apiCalls:0,
  modelVersion:summary.modelVersion, supportedTopics:summary.supportedTopics,
  requestedTopic:options.topic??null,
  sourceArticleCount:rows.length, candidateArticleCount:candidates.length, excluded,
  target:target ? {topic:target.group.topic, issue:target.group.issue, period:target.group.period,
    seedArticleCount:6, seedMissingSentences:target.missingSentences, selectedSeedArticleCount:completedSeed,
    articleCount:[...target.group.publishers.values()].reduce((total, articles) => total + articles.length, 0),
    publisherCounts:[...target.group.publishers.entries()].map(([publisher, articles]) => ({publisher, count:articles.length}))} : null,
  selection:'Unlabelled workload planning only: missing unique sentence count, publication date and article ID; publisher round-robin. No predicted directions or coordinates used.',
  selectedArticleCount:selected.length, alreadyCachedSelectedArticleCount:selected.filter(article => !article.missingKeys.length).length,
  queueArticleCount:queue.length, pendingRecords:pendingRecords.length, plannedCalls:plannedBatches.length,
  maximumCalls, requiredReservation:plannedBatches.length * reservation, maximumDailyReservation:unlimited ? null : dailyBudget,
  budgetPolicy:unlimited ? 'unlimited' : 'bounded', targetOnly:!!options.targetOnly,
  largestRequestBytes:Math.max(0, ...plannedBatches.map(requestBytes)), maximumRequestRecords:Math.max(0, ...plannedBatches.map(batch => batch.length)),
  cohortReady:false,
  limitations:[
    'Completing vectors does not guarantee an eligible point coordinate or a ready comparison cohort.',
    'Low-missing-cost selection can overrepresent shorter or already cached articles. This is a research pilot, not the full corpus distribution.',
    'The extractor rechecks its configured shared budget policy before dispatch; this plan does not reserve or confirm remaining budget.'
  ],
  sourceDigests:{coordinates:sha(coordinatesBytes), pendingInput:inputDigest, modelVersion:summary.modelVersion}
};
const result = {schemaVersion:'voice-embedding-input-1.0', embedding, records:pendingRecords, sets:{corpus:[]}, pairs:[],
  preparation:{articles:selected.length, uniqueTexts:pendingRecords.length, plannedCalls:plannedBatches.length,
    reservedTokensRequired:plannedBatches.length * reservation, dailyBudget:unlimited ? null : dailyBudget,
    budgetPolicy:unlimited ? 'unlimited' : 'bounded', callsPerFullBudgetDay:unlimited ? null : 18},
  humanEvaluationCount:0, sourceDigests:report.sourceDigests};
result.inputDigest = sha(canonical(result));

fs.mkdirSync(output, {recursive:true});
for (const [filename, value] of [
  ['embedding-input.local.json', result],
  ['plan-summary.local.json', report],
  ['article-queue.local.json', {targetSeedArticleIds:[...seedIds], selectedArticleIds:[...selectedIds], articles:queue.map(article => ({
    id:article.id, topic:article.topic, issue:article.issue, publisher:article.publisher,
    publishedAt:article.publishedAt, missingSentences:article.missingKeys.length
  }))}]
]) fs.writeFileSync(path.join(output, filename), JSON.stringify(value, null, 2) + '\n', {encoding:'utf8', flag:'wx'});
console.log(JSON.stringify(report));
