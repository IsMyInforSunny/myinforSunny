import {readFileSync, mkdirSync, writeFileSync, existsSync, renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {decideProvider, buildCodexArgs} from './codex-routing-policy.mjs';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const local = join(root, '.sites-runtime');
const statePath = join(local, 'baze-monthly-usage.json');
const defaultSession = '01a195f9-e6c1-77a2-b5eb-497bebe37e34';
const [command = 'status', ...rest] = process.argv.slice(2);
const labels = {
  below_threshold: '확인한 월간 크레딧 사용량이 95% 미만입니다.',
  threshold_reached: '확인한 월간 크레딧 사용량이 95% 이상입니다.',
  usage_unknown: '최신 BAZE 사용량이 등록되지 않았습니다.',
  usage_stale: '사용량 확인 후 15분이 지났거나 월간 갱신일이 도래했습니다.',
  usage_invalid: '사용량 기록이 유효하지 않습니다.',
};
function options() {
  const out = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('옵션과 값을 함께 입력해 주세요.');
    if (Object.hasOwn(out, rest[i])) throw new Error('중복 옵션입니다.');
    out[rest[i]] = rest[i + 1];
  }
  return out;
}
function readUsage() {try {return JSON.parse(readFileSync(statePath, 'utf8'));} catch {return null;}}
function codexBin() {
  const installed = join(process.env.APPDATA ?? '', 'npm', 'codex.cmd');
  if (!existsSync(installed)) throw new Error('Codex CLI를 찾지 못했습니다. APPDATA/npm 설치를 확인해 주세요.');
  return installed;
}
function invocation(args) {
  const env = {...process.env};
  if (args.includes('model_provider=openai')) {
    for (const key of Object.keys(env)) if (['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORGANIZATION', 'OPENAI_PROJECT'].includes(key.toUpperCase())) delete env[key];
  }
  env.INFORCAST_CODEX_BIN = codexBin();
  env.INFORCAST_CODEX_ARGS = JSON.stringify(args);
  return {file: 'powershell.exe', args: ['-NoProfile', '-Command', '$routingArgs = @(ConvertFrom-Json $env:INFORCAST_CODEX_ARGS); & $env:INFORCAST_CODEX_BIN @routingArgs; exit $LASTEXITCODE'], env};
}
function chatgptReady() {
  const call = invocation(['-c', 'model_provider=openai', 'login', 'status']);
  const result = spawnSync(call.file, call.args, {env: call.env, cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true});
  // Do not echo raw status: API-key mode may contain a masked credential.
  return result.status === 0 && /Logged in using ChatGPT/i.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}
function ensureBuiltinOpenai() {
  const home = process.env.CODEX_HOME || join(process.env.USERPROFILE ?? '', '.codex');
  for (const path of [join(home, 'config.toml'), join(root, '.codex', 'config.toml')]) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (/^\s*\[\s*model_providers\.(?:openai|"openai"|'openai')\s*(?:\.|\])/m.test(text) || /^\s*model_providers\s*=/m.test(text) || /^\s*chatgpt_base_url\s*=/m.test(text))
      throw new Error('내장 OpenAI 경로를 덮어쓰는 설정이 있어 자동 실행을 중지했습니다. 설정 검토가 필요합니다.');
  }
}
async function main() {
  const opt = options();
  const allowed = command === 'record' ? ['--used','--limit','--renewal'] : command === 'start' ? ['--provider','--session'] : [];
  if (Object.keys(opt).some(k => !allowed.includes(k))) throw new Error('지원하지 않는 옵션입니다.');
  if (command === 'record') {
    if (!opt['--used'] || !opt['--limit'] || !opt['--renewal']) throw new Error('record --used 사용량 --limit 월간한도 --renewal YYYY-MM-DD 형식입니다.');
    const data = {version: 1, unit: 'credits', scope: 'monthly', used: Number(opt['--used']), limit: Number(opt['--limit']), checkedAt: new Date().toISOString(), renewalDate: opt['--renewal'], source: 'user_confirmed_dashboard'};
    const decision = decideProvider(data);
    if (['usage_invalid','usage_stale'].includes(decision.reason)) throw new Error('사용량·월간 한도·다음 갱신일을 확인해 주세요.');
    mkdirSync(local, {recursive: true});
    const temp = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2), {mode: 0o600});
    renameSync(temp, statePath);
    console.log('월간 크레딧 사용량을 로컬에 기록했습니다. 자동 조회값이 아니며 15분 뒤 만료됩니다.');
    console.log(labels[decision.reason]);
    return;
  }
  if (!['status', 'start', 'auth-check'].includes(command)) throw new Error('status, auth-check, record, start 명령을 사용해 주세요.');
  const decision = decideProvider(readUsage());
  const chosen = opt['--provider'] ?? 'auto';
  if (!['auto','chatgpt'].includes(chosen)) throw new Error('provider는 auto 또는 chatgpt입니다.');
  const provider = chosen === 'chatgpt' ? 'openai' : decision.provider;
  console.log(`실행 시 선택: ${provider === 'openai' ? 'ChatGPT 로그인 사용량' : 'BAZE / factchat'}`);
  console.log(labels[decision.reason]);
  console.log('실행 시점에만 판단합니다. 실시간 조회·실행 중 전환·자정 초기화는 하지 않습니다.');
  if (command === 'status') return;
  ensureBuiltinOpenai();
  if ((provider === 'openai' || command === 'auth-check') && !chatgptReady())
    throw new Error('ChatGPT 로그인을 확인하지 못했습니다. codex login을 완료해 주세요. API 키 방식으로 대체하지 않습니다.');
  if (command === 'auth-check') {console.log('ChatGPT 로그인 확인 완료. 모델 호출·과금·설정 변경은 하지 않았습니다.'); return;}
  const args = [...buildCodexArgs(provider, opt['--session'] ?? defaultSession), '-C', root];
  console.log('기존 대화가 다른 창에서 실행 중이면 그 창을 정상 종료한 뒤 재개해 주세요.');
  const call = invocation(args);
  const child = spawn(call.file, call.args, {cwd: root, env: call.env, stdio: 'inherit'});
  child.on('error', () => {console.error('Codex를 실행하지 못했습니다.'); process.exitCode = 1;});
  child.on('exit', code => {process.exitCode = code ?? 1;});
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
