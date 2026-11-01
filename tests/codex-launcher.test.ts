import {describe, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildCodexArgs} from '../scripts/codex-routing-policy.mjs';

const session = '01a195f9-e6c1-77a2-b5eb-497bebe37e34';
describe('Codex launcher boundaries', () => {
  it('requires ChatGPT authentication only for the built-in provider and preserves the session', () => {
    const chatgpt = buildCodexArgs('openai', session);
    expect(chatgpt).toContain('forced_login_method=chatgpt');
    expect(chatgpt.slice(chatgpt.indexOf('resume'), chatgpt.indexOf('resume') + 2)).toEqual(['resume', session]);
    expect(buildCodexArgs('factchat', session)).not.toContain('forced_login_method=chatgpt');
    expect(() => buildCodexArgs('other', session)).toThrow();
    expect(() => buildCodexArgs('openai', `${session} & echo unsafe`)).toThrow();
  });

  it.skipIf(process.platform !== 'win32')('launches through PowerShell with the workspace intact and propagates exit status without API-key environment', () => {
    const temp = mkdtempSync(join(tmpdir(), 'inforcast-codex-test-'));
    try {
      const npm = join(temp, 'npm');
      mkdirSync(npm);
      const output = join(temp, 'args.json');
      writeFileSync(join(npm, 'codex.cmd'), '@echo off\r\nnode "%~dp0record.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n');
      writeFileSync(join(npm, 'record.mjs'), `import fs from 'node:fs';
        if(process.argv.includes('login')) {console.log('Logged in using ChatGPT');process.exit(0);}
        fs.writeFileSync(process.env.INFORCAST_TEST_OUTPUT,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),keyPresent:!!process.env.OPENAI_API_KEY,urlPresent:!!process.env.OPENAI_BASE_URL}));process.exit(17);`);
      const result = spawnSync(process.execPath, ['scripts/codex-routing.mjs', 'start', '--provider', 'chatgpt'], {
        cwd: resolve('.'), encoding: 'utf8', timeout: 20000,
        env: {...process.env, APPDATA: temp, CODEX_HOME: temp, INFORCAST_TEST_OUTPUT: output,
          OPENAI_API_KEY: 'synthetic-test-only', OPENAI_BASE_URL: 'https://example.invalid'},
      });
      expect(result.status, result.stderr).toBe(17);
      const captured = JSON.parse(readFileSync(output, 'utf8'));
      expect(captured.args).toContain('model_provider=openai');
      expect(captured.args).toContain('forced_login_method=chatgpt');
      expect(captured.args[captured.args.indexOf('-C') + 1].replace(/[\\/]$/, '')).toBe(resolve('.'));
      expect(captured.cwd).toBe(resolve('.'));
      expect(captured.keyPresent).toBe(false);
      expect(captured.urlPresent).toBe(false);
    } finally {rmSync(temp, {recursive: true, force: true});}
  }, 25000);
});
