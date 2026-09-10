import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByRole('button', { name: '＋ 새 원고 작성', exact: true }).waitFor();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/p1-home.png', fullPage: true });
  await page.getByRole('button', { name: '＋ 새 원고 작성', exact: true }).click();
  const title = `[P1 비공개 테스트] 로컬 웹앱 검증 ${new Date().toISOString()}`;
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('요약 · 작성 메모').fill('합성 사진으로 원고 저장, 재편집, 사진 순서와 캡션을 검증합니다.');
  await page.getByLabel('본문', { exact: false }).fill('## 로컬 웹앱 검증\n\nP1 수동 원고 테스트입니다. 특수문자 & < > 를 보존합니다.\n\n- 초안 저장\n- 사진 첨부\n\n```js\nconst sum = (a, b) => a + b;\nconsole.log(sum(2, 3));\n```\n\n| 항목 | 결과 |\n| --- | --- |\n| 공개 범위 | 비공개 |');
  await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles([path.resolve('.local/fixtures/p0-image-1.png'), path.resolve('.local/fixtures/p0-image-2.png')]);
  await page.getByLabel('사진 2 설명').waitFor();
  await page.getByLabel('사진 1 설명').fill('첫 번째 파란 테스트 사진');
  await page.getByLabel('사진 2 설명').fill('두 번째 초록 테스트 사진');
  await page.getByRole('button', { name: '원고 저장', exact: true }).click();
  await page.getByText('저장됨 · 버전 1', { exact: true }).waitFor();
  await page.reload(); await page.getByRole('button').filter({ hasText: title }).click();
  assert.equal(await page.getByLabel('제목', { exact: true }).inputValue(), title);
  assert.equal(await page.getByLabel('사진 1 설명').inputValue(), '첫 번째 파란 테스트 사진');
  await page.getByLabel('요약 · 작성 메모').fill('재편집 후 두 번째 버전을 저장했습니다.');
  await page.getByRole('button', { name: '원고 저장', exact: true }).click();
  await page.getByText('저장됨 · 버전 2', { exact: true }).waitFor();
  await page.locator('article table').waitFor();
  await page.waitForFunction(() => Array.from(document.images).length >= 4 && Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: '.local/p1-editor.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: '.local/p1-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.argv.includes('--connect')) {
    await page.getByRole('button', { name: '⚙ 블로그 연결' }).click();
    await page.getByRole('button', { name: '로그인 확인 · 카테고리 새로고침' }).click();
    await page.getByRole('heading', { name: '작업 내역', exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, title, draftSavedAndReopened: true, images: 2, mobileOverflow: false, connectionJobQueued: process.argv.includes('--connect') }));
} finally { await browser.close(); }
