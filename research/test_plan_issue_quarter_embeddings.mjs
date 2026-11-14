import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const runtime = path.join(root, '.sites-runtime');
const planner = path.join(root, 'research/plan_issue_quarter_embeddings.mjs');
const extractor = path.join(root, 'scripts/extract-voice-embeddings.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

async function fixture(directory, rows) {
  const snapshot = path.join(directory, 'snapshot');
  await mkdir(snapshot);
  const records = rows.flatMap(row => Array.from({length:row.cache.missing}, (_, index) => {
    const text = `Retained article ${row.id} sentence ${index}.`;
    return {key:sha(text), text, partition:'corpus', sourceIDs:[{articleId:row.id, sentenceId:`sentence-${index}`} ]};
  }));
  const input = {schemaVersion:'voice-embedding-input-1.0', embedding:{model:'nvidia/nemotron-3.5-embed-1b', input_type:'passage', encoding_format:'float', truncate:'NONE', dimensions:2048}, records};
  input.inputDigest = sha(canonical(input));
  await writeFile(path.join(snapshot, 'pending-embedding-input.local.json'), JSON.stringify(input));
  await writeFile(path.join(snapshot, 'summary.local.json'), JSON.stringify({modelVersion:'test', supportedTopics:['nuclear_energy'], counts:{articles:rows.length}}));
  await writeFile(path.join(snapshot, 'coordinates.local.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return snapshot;
}

function row(id, publisher, extra = {}) {
  return {id, publisher, bodyHash:sha(id), url:`https://${publisher}/${id}`, publishedAt:'2026-07-01T00:00:00+09:00',
    modelVersion:'test', topic:'nuclear_energy', issue:'expansion', trainingOriginal:false,
    coordinate:1, source:{support:5, oppose:0}, cache:{missing:1}, ...extra};
}
const population = () => Array.from({length:6}, (_, index) => row(`article-${index}`, index < 3 ? 'dailian.co.kr' : 'pressian.com'));
test('topic-directed recovery does not spend requests on an already supported different topic',async()=>{
  await temporary(async directory=>{
    const rows=[...population(),...population().map(item=>({...item,id:'wage-'+item.id,bodyHash:sha('wage-'+item.id),url:item.url+'/wage',topic:'minimum_wage',issue:'increase'}))];
    const snapshot=await fixture(directory,rows);
    await writeFile(path.join(snapshot,'summary.local.json'),JSON.stringify({modelVersion:'test',supportedTopics:['nuclear_energy','minimum_wage'],counts:{articles:rows.length}}));
    const result=spawnSync(process.execPath,[planner,'--snapshot',snapshot,'--output',path.join(directory,'selected'),'--topic','minimum_wage'],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.candidateArticleCount,6);assert.equal(report.target.topic,'minimum_wage');
    assert.equal(report.excluded.outside_requested_topic,6);
  });
});
function run(snapshot, output, calls = 18) {
  return spawnSync(process.execPath, [planner, '--snapshot', snapshot, '--output', output, '--max-calls', String(calls)], {cwd:root, encoding:'utf8'});
}
async function temporary(action) {
  await mkdir(runtime, {recursive:true});
  const directory = await mkdtemp(path.join(runtime, 'embedding-planner-test-'));
  try { await action(directory); }
  finally {
    if (!directory.startsWith(runtime + path.sep) || !path.basename(directory).startsWith('embedding-planner-test-')) throw new Error('Unexpected cleanup path');
    await rm(directory, {recursive:true, force:true});
  }
}

test('plans a complete quarter seed, excludes unavailable articles, and produces extractor-compatible dry-run input', async () => {
  await temporary(async directory => {
    const rows = [...population(), row('training', 'dailian.co.kr', {trainingOriginal:true}),
      row('other-topic', 'dailian.co.kr', {topic:'minimum_wage'}), row('no-issue', 'dailian.co.kr', {issue:null})];
    const snapshot = await fixture(directory, rows);
    const output = path.join(directory, 'output');
    const result = run(snapshot, output);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.candidateArticleCount, 6);
    assert.equal(report.target.period.key, '2026-Q3');
    assert.equal(report.target.selectedSeedArticleCount, 6);
    assert.equal(report.cohortReady, false);
    assert.equal(report.apiCalls, 0);
    assert.deepEqual(report.excluded, {training_original:1, unsupported_topic:1, issue_unassigned:1});
    const extracted = spawnSync(process.execPath, [extractor, '--input', path.join(output, 'embedding-input.local.json'),
      '--output', path.join(directory, 'vectors.local.json')], {cwd:root, encoding:'utf8'});
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.equal(JSON.parse(extracted.stdout).mode, 'dry-run');
    assert.equal(JSON.parse(extracted.stdout).pendingRecords, 6);
    const second = run(snapshot, output);
    assert.notEqual(second.status, 0, 'An existing plan must be preserved');
  });
});

test('article choice is invariant to predicted directions and coordinates', async () => {
  await temporary(async directory => {
    const snapshot = await fixture(directory, [...population(), row('extra', 'dailian.co.kr', {cache:{missing:2}})]);
    const firstOutput = path.join(directory, 'first');
    assert.equal(run(snapshot, firstOutput).status, 0);
    const coordinatePath = path.join(snapshot, 'coordinates.local.jsonl');
    const changed = (await readFile(coordinatePath, 'utf8')).trim().split('\n').map(line => {
      const value = JSON.parse(line);
      return {...value, coordinate:-1, directional:0, eligible:false, source:{support:0, oppose:5}};
    });
    await writeFile(coordinatePath, changed.map(value => JSON.stringify(value)).join('\n'));
    const secondOutput = path.join(directory, 'second');
    assert.equal(run(snapshot, secondOutput).status, 0);
    const queue = async output => JSON.parse(await readFile(path.join(output, 'article-queue.local.json'), 'utf8'));
    assert.deepEqual(await queue(firstOutput), await queue(secondOutput));
  });
});

test('falls back to a half year without mixing quarters into a quarter label', async () => {
  await temporary(async directory => {
    const snapshot = await fixture(directory, population().map((value, index) => ({...value,
      publishedAt:index % 3 === 0 ? '2026-10-01T00:00:00+09:00' : value.publishedAt})));
    const result = run(snapshot, path.join(directory, 'output'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).target.period.key, '2026-H2');
  });
});

test('respects the call budget without splitting the first article and rejects corrupt prepared input', async () => {
  await temporary(async directory => {
    const snapshot = await fixture(directory, population().map(value => ({...value, cache:{missing:33}})));
    const result = run(snapshot, path.join(directory, 'output'), 1);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.selectedArticleCount, 0);
    assert.equal(report.plannedCalls, 0);
    const inputPath = path.join(snapshot, 'pending-embedding-input.local.json');
    const corrupt = JSON.parse(await readFile(inputPath, 'utf8'));
    corrupt.records[0].text += 'changed';
    await writeFile(inputPath, JSON.stringify(corrupt));
    assert.notEqual(run(snapshot, path.join(directory, 'corrupt')).status, 0);
  });
});

test('larger plans require an explicit unlimited budget policy', async () => {
  await temporary(async directory => {
    const snapshot = await fixture(directory, population());
    assert.notEqual(run(snapshot, path.join(directory, 'bounded'), 60).status, 0);
    const result = spawnSync(process.execPath, [planner, '--snapshot', snapshot, '--output', path.join(directory, 'unlimited'),
      '--max-calls', '60', '--budget', 'unlimited', '--target-only'], {cwd:root, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.budgetPolicy, 'unlimited');
    assert.equal(report.maximumDailyReservation, null);
    assert.equal(report.targetOnly, true);
    assert.equal(report.apiCalls, 0);
  });
});
