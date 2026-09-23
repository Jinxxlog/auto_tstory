// Local-only R0.1 integration check. No AI, real accounts, worker or publication.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { chromium } from 'playwright';
import { openStore } from '../src/lib/store';
import { Publisher, AttentionRequired } from '../src/services/tistory/publisher';
import type { TistoryProbe } from '../src/services/tistory/probe';
import { renderMarkdown } from '../src/lib/content';

const origin = 'http://127.0.0.1:3000';
const blog = 'https://example.tistory.com';
const portCheck = createServer();
await new Promise<void>((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(3000, '127.0.0.1', resolve); });
await new Promise<void>((resolve, reject) => portCheck.close(error => error ? reject(error) : resolve()));
await mkdir('.local', { recursive: true });
const root = await mkdtemp(path.resolve('.local/r01-web-'));
const store = openStore(path.join(root, 'data'));
store.setSettings({ blog, categories: ['테스트'], connection: '미확인' });
const seed = (title: string) => {
  const draft = store.saveDraft({ id: '', version: 0, title, kind: 'project', summary: '', markdown: '## 합성 본문\n\n복구 검사를 위한 본문입니다.', category: '테스트', images: [], cover: null });
  const job = store.enqueue('publish', draft.id); store.updateJob(job.id, 'unknown', '실행기 중단 합성 사례'); return job;
};
const known = seed('주소 확보 후 중단'); store.recordPost(known.id, `${blog}/15`);
const missing = seed('주소 없이 중단');
const unpublished = seed('미발행 확인 대상');
store.acquire('local-ui-check');
const heartbeat = setInterval(() => store.heartbeat('local-ui-check'), 3000);
const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3000'], {
  env: { ...process.env, TSTORY_DATA_DIR: path.join(root, 'data') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = ''; server.stdout.on('data', value => { serverOutput += value.toString(); }); server.stderr.on('data', value => { serverOutput += value.toString(); });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local test server stopped: ${serverOutput}`);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'local test server must start');
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.getByRole('button', { name: /작업 내역/ }).click();
  const knownCard = page.getByRole('region', { name: '주소 확보 후 중단', exact: true });
  await knownCard.getByRole('button', { name: '저장 결과 다시 확인' }).click();
  await knownCard.getByText('기존 글 읽기 전용 확인 대기', { exact: true }).waitFor();
  assert.equal(store.job(known.id).kind, 'verify'); assert.equal(store.jobs().length, 3);
  const missingCard = page.getByRole('region', { name: '주소 없이 중단', exact: true });
  await missingCard.getByLabel('확인할 기존 글 주소').fill('https://other.tistory.com/15');
  await missingCard.getByRole('button', { name: '기존 글 연결 · 확인' }).click();
  await page.getByText(/이 작업의 블로그에 저장된 글 주소/).waitFor();
  assert.equal(store.job(missing.id).state, 'unknown');
  await missingCard.getByLabel('확인할 기존 글 주소').fill(`${blog}/16`);
  await missingCard.getByRole('button', { name: '기존 글 연결 · 확인' }).click();
  await missingCard.getByText('기존 글 읽기 전용 확인 대기', { exact: true }).waitFor();
  assert.equal(store.job(missing.id).result, null); assert.equal(store.job(missing.id).snapshot.candidatePostUrl, `${blog}/16`);
  const closedCard = page.getByRole('region', { name: '미발행 확인 대상', exact: true });
  await closedCard.locator('summary').click();
  assert.equal(await closedCard.getByRole('button', { name: '미발행 확인 · 작업 종료' }).isEnabled(), false);
  await closedCard.getByRole('checkbox').check();
  await closedCard.getByRole('button', { name: '미발행 확인 · 작업 종료' }).click();
  await closedCard.getByText(/사용자가 글 관리에서 미발행 확인/).waitFor();
  assert.equal(store.job(unpublished.id).state, 'cancelled'); assert.equal(store.jobs().length, 3);
  // A failed candidate check can be corrected without creating another job.
  store.updateJob(missing.id, 'needs_attention', '본문 불일치');
  await page.reload(); await page.getByRole('button', { name: /작업 내역/ }).click();
  assert.equal(await missingCard.getByLabel('확인할 기존 글 주소').inputValue(), `${blog}/16`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(root, 'recovery-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();

  // Exercise the real verifier against entirely intercepted synthetic Tistory pages.
  const remote = await browser.newContext();
  let mode: 'matching' | 'second-page' | 'body-mismatch' | 'public' | 'category-mismatch' | 'address-mismatch' = 'matching';
  const requests: { method: string; pathname: string }[] = [];
  const draft = missing.snapshot.draft!;
  await remote.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    requests.push({ method: request.method(), pathname: url.pathname });
    if (url.origin !== blog || request.method() !== 'GET') return route.abort();
    const firstPage = mode === 'second-page' && !url.search;
    const list = `<a class="link_write" href="/manage/post">글쓰기</a><ul><li><a href="/${mode === 'address-mismatch' || firstPage ? '99' : '16'}">${draft.title}</a><span class="txt_cate">${mode === 'category-mismatch' ? '다른 분류' : draft.category}</span>${mode === 'public' ? '' : '<span class="ico_private">비공개</span>'}</li></ul>${firstPage ? '<a href="/manage/posts?page=2">2</a>' : ''}`;
    const article = `<h1>${draft.title}</h1><div class="contents_style">${renderMarkdown(mode === 'body-mismatch' ? '다른 글 본문' : draft.markdown)}<div class="another_category">관련 글은 본문에서 제외</div></div>`;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body>${url.pathname === '/manage/posts' ? list : article}</body></html>` });
  });
  const publisher = new Publisher();
  publisher.probe = { blog, context: remote, persistIfAuthenticated: async () => {} } as unknown as TistoryProbe;
  const candidate = store.job(missing.id);
  assert.equal(await publisher.verify(candidate), `${blog}/16`);
  mode = 'second-page'; assert.equal(await publisher.verify(candidate), `${blog}/16`);
  for (const scenario of ['body-mismatch', 'public', 'category-mismatch', 'address-mismatch'] as const) {
    mode = scenario; await assert.rejects(publisher.verify(candidate), AttentionRequired);
  }
  assert.ok(requests.every(request => request.method === 'GET' && ['/manage/posts', '/16', '/favicon.ico'].includes(request.pathname)));
  assert.equal(store.jobs().length, 3); assert.equal(store.job(missing.id).snapshot.postUrl, undefined);
  await remote.close();
  console.log(JSON.stringify({ passed: true, scope: 'isolated-local-and-intercepted-pages', knownUrlRecovery: true, candidateNotConfirmedEarly: true, explicitUnpublishedClosure: true, wrongPostRejected: true, publicPostRejected: true, noPublicationRequests: true, mobileOverflow: false, realTistoryVerified: false, evidence: root }));
} finally {
  await browser?.close();
  clearInterval(heartbeat); store.release('local-ui-check'); store.db.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
}
