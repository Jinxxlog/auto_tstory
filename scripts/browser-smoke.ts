import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { localRoot } from '../src/services/tistory/config.js';
import { createTestDraft } from '../src/services/tistory/fixture.js';
import { TistoryProbe } from '../src/services/tistory/probe.js';

// Uses an isolated local test profile, never the user's Tistory session.
await mkdir(localRoot, { recursive: true });
const profile = await mkdtemp(path.join(localRoot, 'smoke-profile-'));
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>P0 local smoke</title><input aria-label="title"><input type="file" multiple><div contenteditable="true" aria-label="body"></div>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Local server unavailable');
const origin = `http://127.0.0.1:${address.port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  let page = context.pages()[0];
  await page.goto(origin);
  await page.getByLabel('title').fill('P0 한글 입력 확인');
  await page.getByLabel('body').fill('본문 입력 확인');
  assert.equal(await page.getByLabel('title').inputValue(), 'P0 한글 입력 확인');
  await context.addCookies([{ name: 'p0-test', value: 'persisted', url: origin, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await context.addCookies([{ name: 'p0-session', value: 'session-only', url: origin }]);
  await page.evaluate(() => localStorage.setItem('p0-test', 'persisted'));
  const authState = await context.storageState({ indexedDB: true });
  await context.close();
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  await context.addCookies(authState.cookies);
  page = context.pages()[0];
  await page.goto(origin);
  assert.equal((await context.cookies(origin)).find(cookie => cookie.name === 'p0-test')?.value, 'persisted');
  assert.equal((await context.cookies(origin)).find(cookie => cookie.name === 'p0-session')?.value, 'session-only');
  assert.equal(await page.evaluate(() => localStorage.getItem('p0-test')), 'persisted');
  const probe = new TistoryProbe(undefined, profile);
  probe.context = context;
  probe.blog = origin;
  const inspection = await probe.inspect();
  assert.ok(inspection.frames[0].controls.some(control => control.type === 'file'));
  probe.blog = 'https://different-blog.tistory.com';
  await assert.rejects(() => probe.inspect(), /인증 화면은 검사하지 않습니다/);

  const fixtureDir = path.join(profile, 'fixtures');
  await mkdir(fixtureDir, { recursive: true });
  const draft = createTestDraft();
  await writeFile(path.join(fixtureDir, 'draft.json'), JSON.stringify(draft, null, 2), 'utf8');
  await writeFile(path.join(fixtureDir, 'draft.html'), draft.html, 'utf8');
  const imagePage = await context.newPage();
  await imagePage.setViewportSize({ width: 640, height: 360 });
  const files = [];
  for (let index = 1; index <= 2; index++) {
    await imagePage.setContent(`<html lang="ko"><meta charset="utf-8"><body style="margin:0;background:${index === 1 ? '#17324d' : '#146b55'};color:white;font:32px sans-serif;display:grid;place-content:center;height:100vh"><b>P0 TEST IMAGE ${index}</b><p>티스토리 이미지 첨부 검증</p></body></html>`);
    const file = path.join(fixtureDir, `p0-image-${index}.png`);
    await imagePage.screenshot({ path: file });
    files.push(file);
  }
  await page.locator('input[type=file]').setInputFiles(files);
  assert.equal(await page.locator('input[type=file]').evaluate((el: HTMLInputElement) => el.files?.length), 2);
  const result = { at: new Date().toISOString(), scope: 'local-only', textInput: true, persistentCookie: true, restoredSessionCookie: true, persistentLocalStorage: true, domInspection: true, authenticationPageInspectionBlocked: true, twoFileSelection: true, tistoryVerified: false };
  await writeFile(path.join(localRoot, 'smoke-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
