/** Select retained news for additional training annotation, without model predictions. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const runtime = fs.realpathSync(path.join(root, '.sites-runtime'));
const directory = path.join(runtime, 'voice-expansion-20261115');
const options = {
  corpus: path.join(runtime, 'collection-1000-20261105/articles-reviewed-3000.local.jsonl'),
  existing: path.join(directory, 'five-topics-corpus.local.jsonl'),
  split: path.join(directory, 'six-topics-frozen-split.local.json'),
  events: path.join(runtime, 'relative-baseline-step23/article-events.local.json'),
  output: path.join(directory, 'additional-training-corpus.local.jsonl'),
  report: path.join(directory, 'plan-summary.local.json'),
};
const argumentsList = process.argv.slice(2);
for (let index = 0; index < argumentsList.length; index++) {
  const name = argumentsList[index].replace(/^--/, '');
  if (!Object.hasOwn(options, name) || !argumentsList[index + 1]) {
    throw new Error('Use optional --corpus PATH --existing PATH --split PATH --events PATH --output NEW_PATH --report NEW_PATH');
  }
  options[name] = argumentsList[++index];
}

function localPath(value) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(runtime + path.sep)) throw new Error('All research files must stay beneath .sites-runtime');
  let existing = resolved;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== runtime && !real.startsWith(runtime + path.sep)) throw new Error('Research path resolves outside .sites-runtime');
  return resolved;
}
for (const name of Object.keys(options)) options[name] = localPath(options[name]);
if (options.output === options.report || fs.existsSync(options.output) || fs.existsSync(options.report)) {
  throw new Error('Preserve existing outputs and select new destination paths');
}
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = Object.fromEntries(['corpus', 'existing', 'split', 'events'].map(name => [name, fs.readFileSync(options[name])]));
const json = name => JSON.parse(bytes[name].toString('utf8').replace(/^\uFEFF/, ''));
const rows = name => bytes[name].toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const corpus = rows('corpus');
const previous = rows('existing');
const split = json('split');
const eventsFile = json('events');
const events = eventsFile.articleGroups ?? eventsFile;
if (split.schemaVersion !== 'voice-multitopic-split-1.0') throw new Error('Unexpected frozen split schema');

const server = await createServer({root, configFile:false, server:{middlewareMode:true, hmr:false},
  optimizeDeps:{noDiscovery:true}, appType:'custom'});
try {
  const {voiceAnnotationInput, voiceArticleHash, VOICE_TOPICS} = await server.ssrLoadModule('/lib/sentence-voice.ts');
  const {selectArticleVoiceIssue} = await server.ssrLoadModule('/lib/voice-article-issue.ts');
  const {issueQuarterPeriods} = await server.ssrLoadModule('/lib/issue-quarter-baseline.ts');
  const topics = Object.keys(VOICE_TOPICS).filter(topic => topic !== 'nuclear_energy');
  const all = new Map();
  for (const article of [...corpus, ...previous]) {
    if (!article.id || typeof article.text !== 'string' || !article.topicId) throw new Error('Invalid retained article');
    const hash = await voiceArticleHash(article.text);
    const known = all.get(article.id);
    if (known && known.hash !== hash) throw new Error('Retained article ID has conflicting bodies');
    if (!known) all.set(article.id, {article, hash});
  }
  const articles = [...all.values()];
  const parent = articles.map((_, index) => index);
  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  function union(left, right) { parent[find(left)] = find(right); }
  const identities = new Map();
  const dateKeys = article => {
    const periods = issueQuarterPeriods(article.publishedAt);
    if (!periods.some(period => period.kind === 'quarter')) return [];
    const timestamp = Date.parse(article.publishedAt.length === 10 ? article.publishedAt + 'T00:00:00+09:00' : article.publishedAt);
    const koreanDay = Math.floor((timestamp + 9 * 3600000) / 86400000) + 719163;
    const prefixDay = Math.floor(Date.parse(article.publishedAt.slice(0, 10) + 'T00:00:00Z') / 86400000) + 719163;
    // Include the old trainer's calendar prefix as well as the KST calendar day.
    return [`date-kst:${article.topicId}:${Math.floor(koreanDay / 6)}`,
            `date-prefix:${article.topicId}:${Math.floor(prefixDay / 6)}`];
  };
  for (const [index, item] of articles.entries()) {
    const {article, hash} = item;
    const event = events[article.id] ?? article.eventId;
    const keys = [`body:${hash}`, ...dateKeys(article)];
    if (event) keys.push(`event:${event}`);
    if (article.sourceGroupId) keys.push(`original:${article.sourceGroupId}`);
    for (const key of keys) {
      if (identities.has(key)) union(index, identities.get(key));
      else identities.set(key, index);
    }
  }
  const frozenIds = new Set(Object.values(split.topics).flatMap(topic => topic.evaluationArticleIds));
  const frozenHashes = new Set(Object.values(split.topics).flatMap(topic => topic.evaluationArticleIds.map(id => topic.articleHashes?.[id]).filter(Boolean)));
  const matchedFrozen = new Set();
  const frozenRoots = new Set();
  for (const [index, item] of articles.entries()) {
    if (frozenIds.has(item.article.id) || frozenHashes.has(item.hash)) {
      frozenRoots.add(find(index));
      if (frozenIds.has(item.article.id)) matchedFrozen.add(item.article.id);
    }
  }
  const unresolvedFrozen = [...frozenIds].filter(id => !matchedFrozen.has(id));
  if (unresolvedFrozen.length) throw new Error('Frozen evaluation article is unavailable in the retained corpus');
  const previousIds = new Set(previous.map(article => article.id));
  const previousHashes = new Set(await Promise.all(previous.map(article => voiceArticleHash(article.text))));
  const rejectCounts = {};
  const reject = reason => { rejectCounts[reason] = (rejectCounts[reason] ?? 0) + 1; };
  const candidates = new Map(topics.map(topic => [topic, []]));
  const seen = new Set();
  const argumentCue = /주장|촉구|찬성|반대|말했|강조|요구|지적|비판|우려|필요하|해야\s*(?:한다|합니다|한)|바란다|호소/g;
  const corpusIds = new Set(corpus.map(article => article.id));
  for (const [index, item] of articles.entries()) {
    const {article, hash} = item;
    if (!corpusIds.has(article.id) || !candidates.has(article.topicId)) continue;
    if (previousIds.has(article.id) || previousHashes.has(hash)) { reject('previous_annotation_article_or_body'); continue; }
    if (frozenRoots.has(find(index))) { reject('connected_to_frozen_evaluation'); continue; }
    const quarter = issueQuarterPeriods(article.publishedAt).find(period => period.kind === 'quarter');
    if (!quarter) { reject('publication_date_unverified'); continue; }
    const issue = selectArticleVoiceIssue(article.text, article.topicId, undefined, article.title ?? '');
    if (!issue) { reject('article_issue_unassigned'); continue; }
    if (seen.has(hash)) { reject('duplicate_candidate_body'); continue; }
    seen.add(hash);
    const voice = voiceAnnotationInput(article.text, article.topicId);
    const scopedText = voice.sentences.map(sentence => sentence.text).join(' ');
    const argumentCueCount = [...scopedText.matchAll(argumentCue)].length;
    candidates.get(article.topicId).push({article, hash, issue, quarter:quarter.key,
      voice, argumentCueCount, hasArgumentCue:argumentCueCount > 0});
  }

  const selected = [];
  const summaryTopics = {};
  for (const topic of topics) {
    const issues = Object.keys(VOICE_TOPICS[topic].issues);
    const summaryIssues = {};
    for (const issue of issues) {
      const available = candidates.get(topic).filter(item => item.issue === issue);
      const strata = new Map();
      for (const item of available) {
        const key = `${item.article.publisherId}:${item.quarter}`;
        if (!strata.has(key)) strata.set(key, []);
        strata.get(key).push(item);
      }
      for (const bucket of strata.values()) bucket.sort((left, right) =>
        Number(right.hasArgumentCue) - Number(left.hasArgumentCue) || left.hash.localeCompare(right.hash));
      const publisherCounts = new Map();
      const quarterCounts = new Map();
      const picked = [];
      while (picked.length < 8) {
        const buckets = [...strata.entries()].filter(([, bucket]) => bucket.length);
        if (!buckets.length) break;
        buckets.sort(([leftKey, left], [rightKey, right]) =>
          (publisherCounts.get(left[0].article.publisherId) ?? 0) - (publisherCounts.get(right[0].article.publisherId) ?? 0)
          || (quarterCounts.get(left[0].quarter) ?? 0) - (quarterCounts.get(right[0].quarter) ?? 0)
          || Number(right[0].hasArgumentCue) - Number(left[0].hasArgumentCue)
          || sha(leftKey).localeCompare(sha(rightKey)));
        const item = buckets[0][1].shift();
        picked.push(item);
        publisherCounts.set(item.article.publisherId, (publisherCounts.get(item.article.publisherId) ?? 0) + 1);
        quarterCounts.set(item.quarter, (quarterCounts.get(item.quarter) ?? 0) + 1);
      }
      selected.push(...picked);
      summaryIssues[issue] = {available:available.length, requested:8, selected:picked.length,
        shortfall:Math.max(0, 8 - picked.length), cuePresent:picked.filter(item => item.hasArgumentCue).length,
        publisherCounts:Object.fromEntries(publisherCounts), quarterCounts:Object.fromEntries(quarterCounts)};
    }
    summaryTopics[topic] = {requested:24, selected:Object.values(summaryIssues).reduce((total, item) => total + item.selected, 0), issues:summaryIssues};
  }
  const outputRows = selected.map(item => ({...item.article, text:item.article.text.slice(0, 2000),
    voiceVersion:item.voice.version, segmenter:item.voice.segmenter, scopeCharacters:item.voice.scopeCharacters,
    sentences:item.voice.sentences, voiceHash:item.hash, articleIssue:item.issue,
    voiceSampling:'training-only-publisher-issue-kst-quarter-with-argument-cue-priority',
    trainingSelection:{quarter:item.quarter, argumentCueCount:item.argumentCueCount,
      meaning:'Lexical annotation priority only; no inferred stance or verified label'},
    trainingOnlySelection:true, eligibleForComparisonDistribution:false}));
  const report = {schemaVersion:'voice-additional-training-plan-1.0', generatedAt:new Date().toISOString(),
    researchOnly:true, trainingOnlySelection:true, eligibleForComparisonDistribution:false,
    sourceDigests:Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, sha(value)])),
    retainedArticles:corpus.length, previousAnnotationArticles:previous.length,
    frozenEvaluationArticles:frozenIds.size, unresolvedFrozenArticles:unresolvedFrozen.length,
    selectedArticles:outputRows.length, selectedSentences:outputRows.reduce((total, row) => total + row.sentences.length, 0),
    exclusions:rejectCounts, topics:summaryTopics, apiCalls:0,
    selection:'Up to eight per declared issue, publisher/quarter strata, argument-cue presence then deterministic body-hash order',
    leakageExclusions:'Input ID/body duplicates and transitive frozen-evaluation body/date/event/original groups; KST and legacy date-prefix six-day buckets',
    limitations:['Lexical cues are candidate priority and do not establish directional labels',
      'Known issue selection is a deterministic rule and needs independent annotation',
      'This deliberately enriched training sample must not supply comparison distributions']};
  fs.mkdirSync(path.dirname(options.output), {recursive:true});
  fs.mkdirSync(path.dirname(options.report), {recursive:true});
  fs.writeFileSync(options.output, outputRows.map(row => JSON.stringify(row)).join('\n') + '\n', {flag:'wx'});
  fs.writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n', {flag:'wx'});
  console.log(JSON.stringify(report));
} finally {
  await server.close();
}
