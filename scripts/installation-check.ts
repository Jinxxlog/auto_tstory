// No accounts, credentials or real content are copied into this installation.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

const source = process.cwd(); const origin = 'http://127.0.0.1:3000';
const install = process.argv.includes('--install');
const noBrowser = process.argv.includes('--no-browser');
await mkdir(path.join(source, '.local'), { recursive: true });
const root = await mkdtemp(path.join(source, '.local/installation-'));
const target = path.join(root, 'clean install');
await mkdir(target);
const files = ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'src', 'scripts', 'tests', '.gitignore', '.nvmrc', 'Install.cmd', 'Start.cmd', 'Stop.cmd', 'Doctor.cmd'];
for (const file of files) await cp(path.join(source, file), path.join(target, file), { recursive: true, errorOnExist: true });
// This fast mode validates lifecycle changes; --install is the release check.
if (!install) {
  await cp(path.join(source, '.next'), path.join(target, '.next'), { recursive: true });
  await cp(path.join(source, 'node_modules'), path.join(target, 'node_modules'), { recursive: true });
}
const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', TSTORY_CODEX_BIN: path.join(target, 'not-installed-codex.exe') };
for (const key of ['TSTORY_APP_ROOT','TSTORY_DATA_DIR','TSTORY_RUNTIME_DIR','TSTORY_INSTANCE_ID','NODE_PATH','NODE_OPTIONS','CODEX_HOME','OPENAI_API_KEY','CODEX_API_KEY']) delete env[key];
env.PATH = process.platform === 'win32' ? [path.dirname(process.execPath), path.join(process.env.SystemRoot || 'C:/Windows', 'System32'), process.env.SystemRoot || 'C:/Windows'].join(path.delimiter) : [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter);
async function command(file: string, args: string[] = [], expected = 0) {
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: target, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    child.stdout.on('data', value => { output = (output + value).slice(-16000); }); child.stderr.on('data', value => { output = (output + value).slice(-16000); });
    child.once('error', reject); child.once('exit', code => resolve({ code, output }));
  });
  assert.equal(result.code, expected, `${file}: ${result.output}`); return result.output;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function request(action: string, values = {}) {
  return fetch(`${origin}/api/app`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Tstory-Request': 'local-web' }, body: JSON.stringify({ action, ...values }) });
}
const statePath = path.join(target, '.local/runtime/launcher.json');
let running = false;
try {
  console.log(install ? 'Installing a fresh allowlisted source copy with npm ci/build/prune…' : 'Checking copied local build lifecycle…');
  if (install) {
    await command('scripts/setup.mjs');
    await assert.rejects(access(path.join(target, 'node_modules/typescript/package.json')));
    assert.ok(await access(path.join(target, 'node_modules/tsx/package.json')).then(() => true));
  }
  console.log('Checking initial setup, draft persistence and process lifecycle…');
  await command('scripts/launcher.mjs', ['start']); running = true;
  const runtime = JSON.parse(await readFile(statePath, 'utf8'));
  const initial = await fetch(`${origin}/api/app`).then(response => response.json());
  assert.equal(initial.settings.blog, ''); assert.equal(initial.drafts.length, 0); assert.equal(initial.workerOnline, true);
  const missingBlog = await request('connect'); assert.equal(missingBlog.status, 400);
  const diagnostics = await request('diagnostics').then(response => response.json());
  assert.equal(diagnostics.find((item: { id: string }) => item.id === 'codex').level, 'warning');
  assert.equal(diagnostics.find((item: { id: string }) => item.id === 'data').level, 'ok');
  const unauth = await fetch(`http://127.0.0.1:${runtime.port}/stop`, { method: 'POST' }); assert.equal(unauth.status, 403);
  if (!noBrowser) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext();
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.getByRole('button', { name: '내 블로그 설정', exact: true }).click();
      assert.equal(await page.getByLabel('블로그 주소', { exact: true }).inputValue(), '');
      await page.getByLabel('블로그 주소', { exact: true }).fill('https://example.tistory.com');
      await page.getByRole('button', { name: '주소 저장', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '블로그 주소를 저장했습니다.' }).waitFor();
      await page.getByRole('button', { name: '실행 환경 확인', exact: true }).click();
      await page.getByText(/AI 실행 도구를 찾지 못했습니다/).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(root, 'first-setup.png'), fullPage: true });
      await page.getByRole('button', { name: /나의 원고/ }).click();
      await page.getByRole('button', { name: '＋ 새 원고 작성', exact: true }).click();
      await page.getByLabel('제목', { exact: true }).fill('새 설치의 합성 원고');
      await page.locator('textarea.markdown').fill('계정 없이 저장하는 합성 본문');
      await page.getByRole('button', { name: '원고 저장', exact: true }).click();
      await page.getByText('저장됨 · 버전 1', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  } else {
    assert.equal((await request('settings', { blog: 'https://example.tistory.com' })).status, 200);
    assert.equal((await request('save', { draft: { id: '', version: 0, title: '새 설치의 합성 원고', kind: 'project', summary: '', markdown: '계정 없이 저장하는 합성 본문', category: '', images: [], cover: null } })).status, 200);
  }
  await command('scripts/launcher.mjs', ['start']);
  assert.equal(JSON.parse(await readFile(statePath, 'utf8')).instance, runtime.instance);
  await command('scripts/launcher.mjs', ['stop']); running = false;
  await assert.rejects(access(statePath));
  const db = new DatabaseSync(path.join(target, 'data/app.sqlite'), { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lease').get()?.count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM jobs').get()?.count, 0); db.close();
  await command('scripts/launcher.mjs', ['start']); running = true;
  const reopened = await fetch(`${origin}/api/app`).then(response => response.json());
  assert.equal(reopened.drafts.length, 1); assert.equal(reopened.drafts[0].markdown, '계정 없이 저장하는 합성 본문'); assert.equal(reopened.workerOnline, true);
  const second = JSON.parse(await readFile(statePath, 'utf8'));
  const lifecycle = await fetch(`http://127.0.0.1:${second.port}/status`, { headers: { Authorization: `Bearer ${second.token}` } }).then(response => response.json());
  assert.ok(Number.isSafeInteger(lifecycle.workerPid));
  process.kill(lifecycle.workerPid); // Only the worker created in this isolated installation.
  await waitFor(() => access(statePath).then(() => false, () => true), 'worker failure must stop sibling and controller'); running = false;
  const conflict = createServer();
  await new Promise<void>((resolve, reject) => { conflict.once('error', reject); conflict.listen(3000, '127.0.0.1', resolve); });
  try { await command('scripts/run.mjs', ['--production'], 1); assert.equal(conflict.listening, true); await assert.rejects(access(statePath)); }
  finally { await new Promise<void>(resolve => conflict.close(() => resolve())); }
  console.log(JSON.stringify({ passed: true, freshNpmInstall: install, runtimeOnlyDependencies: install, firstSetup: true, manualDraftSaved: true, restartPersistence: true, duplicateStartSafe: true, gracefulStop: true, siblingStoppedOnWorkerFailure: true, otherPortOwnerPreserved: true, browserVerified: !noBrowser, externalPublication: false, evidence: root }));
} finally {
  if (running) await command('scripts/launcher.mjs', ['stop']).catch(() => {});
}
