import { chromium } from 'playwright';
import assert from 'node:assert/strict';
// Explicit opt-in: this test sends only a previously saved synthetic P1 draft.
if (!process.argv.includes('--private-test')) throw new Error('--private-test 옵션을 지정해야 실제 비공개 테스트 글을 저장합니다.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:3000');
  const card = page.getByRole('button').filter({ hasText: '[P1 비공개 테스트] 로컬 웹앱 검증' });
  await card.waitFor();
  assert.equal(await card.count(), 1, '하나의 테스트 원고만 있어야 합니다.');
  await card.click(); await page.locator('article table').waitFor();
  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: '.local/p1-editor.png', fullPage: true });
  await page.getByRole('button', { name: '비공개 전송', exact: true }).click();
  await page.getByRole('button', { name: '확인하고 전송', exact: true }).click();
  await page.getByRole('heading', { name: '작업 내역', exact: true }).waitFor();
  console.log('비공개 테스트 전송 작업을 요청했습니다. 실제 결과는 작업 내역에서 확인합니다.');
} finally { await browser.close(); }
