// Synthetic local UI/API only. No worker, account or remote publication.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { openStore } from '../src/lib/store';
import { withBlocks } from '../src/lib/blocks';
import { portAvailable } from './environment.mjs';

assert.ok(await portAvailable()); await mkdir('.local', { recursive: true });
const root = await mkdtemp(path.resolve('.local/r2-web-')); const data = path.join(root, 'data'); const store = openStore(data);
const origin = 'http://127.0.0.1:3000';
const files: string[] = [];
for (let index = 0; index < 50; index++) {
  const file = path.join(root, `photo-${String(index).padStart(2, '0')}.png`); files.push(file);
  await sharp({ create: { width: 900 + index, height: 600 + index, channels: 3, background: { r: 20 + index * 4, g: 100, b: 200 - index * 3 } } }).png().toFile(file);
}
const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1'], { env: { ...process.env, TSTORY_DATA_DIR: data }, windowsHide: true, stdio: 'ignore' });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => failures.push(error.message));
  for (let attempt = 0; ; attempt++) { try { if ((await fetch(origin)).ok) break; } catch {} assert.ok(attempt < 100); await new Promise(resolve => setTimeout(resolve, 200)); }
  await page.goto(origin); await page.getByRole('button', { name: '＋ 새 원고 작성', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill('R2 합성 50장 편집'); await page.locator('textarea.markdown').fill('## 도입\n\n앞 문단');
  let failedOnce = false;
  await page.route('**/api/assets', async route => { if (!failedOnce && route.request().method() === 'POST') { failedOnce = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '합성 업로드 실패' }) }); } else await route.continue(); });
  const started = performance.now();
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '사진 선택', exact: true }).click(); await (await chooser).setFiles(files);
  await page.getByText('50/50 처리 완료 · 원고를 저장해주세요.', { exact: true }).waitFor({ timeout: 120000 });
  assert.equal(store.assets().length, 49); assert.equal(await page.getByRole('button', { name: '이 사진 재시도' }).count(), 1);
  await page.getByRole('button', { name: '이 사진 재시도' }).click();
  await page.getByText('1/1 처리 완료 · 원고를 저장해주세요.', { exact: true }).waitFor(); assert.equal(store.assets().length, 50);
  await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 1', { exact: true }).waitFor();
  const uploadMs = Math.round(performance.now() - started);
  const original = store.drafts()[0]; assert.equal(original.images.length, 50); assert.equal(original.blocks!.length, 51);
  // Ten interleaved images with code/table, notes and descriptions via real API.
  const blocks: import('../src/lib/model').DraftBlock[] = [];
  for (let index = 0; index < 10; index++) {
    blocks.push({ id: `body-${index}`, type: 'text', markdown: `## 사진 ${index + 1} 전\n\n본문 ${index + 1}${index === 0 ? '\n\n```py\nprint(1)\n```\n\n| 항목 | 값 |\n| --- | --- |\n| 사진 | 10 |' : ''}` });
    blocks.push({ id: `image-${index}`, type: 'image', imageId: original.images[index].id, note: `비공개 작성 메모 ${index + 1}`, group: '첫째 날', caption: `짧은 캡션 ${index + 1}`, description: `긴 본문 설명 ${index + 1}` });
  }
  const response = await fetch(`${origin}/api/app`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Tstory-Request': 'local-web' }, body: JSON.stringify({ action: 'save', draft: withBlocks(original, blocks) }) }); assert.equal(response.status, 200);
  await page.reload(); await page.getByRole('button').filter({ hasText: 'R2 합성 50장 편집' }).click(); await page.locator('article figure').last().waitFor();
  assert.equal(await page.locator('article figure').count(), 10); assert.equal((await page.locator('article').innerText()).includes('비공개 작성 메모'), false);
  await page.locator('article table').waitFor(); assert.equal((await page.locator('article pre').innerText()).trim(), 'print(1)');
  const photo = page.getByRole('region', { name: '블록 2', exact: true });
  await photo.getByLabel('작성 메모 · 게시되지 않음', { exact: true }).fill('새 작성 메모');
  await photo.getByLabel('짧은 캡션', { exact: true }).fill('수정한 캡션');
  await page.getByRole('button', { name: '블록 2 아래로', exact: true }).click();
  const dragged = page.getByRole('region', { name: '블록 3', exact: true }).locator('strong[draggable]');
  await dragged.dragTo(page.getByRole('region', { name: '블록 2', exact: true }));
  await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 3', { exact: true }).waitFor();
  const saved = store.drafts()[0]; assert.equal(saved.blocks![1].type, 'image'); assert.equal(saved.images[0].caption, '수정한 캡션');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM draft_versions WHERE id=?').get(saved.id)?.n, 3);
  const replace = page.waitForEvent('filechooser'); await page.getByRole('region', { name: '블록 2', exact: true }).getByRole('button', { name: '사진 교체' }).click(); await (await replace).setFiles(files[1]);
  await page.getByText('1/1 처리 완료 · 원고를 저장해주세요.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 4', { exact: true }).waitFor();
  assert.equal(store.drafts()[0].blocks![1].id, saved.blocks![1].id); assert.notEqual(store.drafts()[0].images[0].id, saved.images[0].id);
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(root, 'blocks-mobile.png'), fullPage: true }); assert.deepEqual(failures, []);
  await page.getByRole('region', { name: '블록 2', exact: true }).screenshot({ path: path.join(root, 'photo-fields-mobile.png') });
  const report = { passed: true, photosUploaded: 50, uploadAndSaveMs: uploadMs, failedPhotoRetry: true, interleavedPreview: 10, legacyVersionsPreserved: true, dragAndButtons: true, imageReplacement: true, mobileOverflow: false, externalPublication: false };
  await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, evidence: root }));
} finally { await browser.close(); server.kill(); store.db.close(); }
