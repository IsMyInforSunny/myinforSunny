import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

// Verification history contains command output, never environment variables or article input.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const websiteOnly = process.argv.includes('--website-only');
const directory = path.resolve('docs', 'test-runs', stamp + (websiteOnly ? '-website' : ''));
await mkdir(directory, {recursive: true});
const commands = [
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['test', ['node_modules/vitest/vitest.mjs', 'run', ...(websiteOnly ?
    ['--exclude', 'tests/codex-launcher.test.ts', '--exclude', 'tests/codex-routing.test.ts'] : [])]],
  ['build', ['scripts/run-framework.mjs', 'build']],
];
const records = [];
for (const [name, args] of commands) {
  const started = new Date();
  const child = spawn(process.execPath, args, {shell: false, env: {...process.env, NO_COLOR: '1'}});
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    const text = chunk.toString(); output += text; process.stdout.write(text);
  });
  const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', resolve);});
  const record = {name, command: ['node', ...args], started: started.toISOString(), durationMs: Date.now()-started.getTime(), exitCode: code};
  records.push(record);
  await writeFile(path.join(directory, `${name}.log`), output, 'utf8');
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(records, null, 2)+'\n', 'utf8');
  if (code !== 0) {process.exitCode = 1; break;}
}
console.log(`Verification history: ${directory}`);
