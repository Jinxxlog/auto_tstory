import { chromium } from 'playwright';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localRoot } from '../src/services/tistory/config.js';
import { createTestDraft } from '../src/services/tistory/fixture.js';

const directory = path.join(localRoot, 'fixtures');
await mkdir(directory, { recursive: true });
const draftFile = path.join(directory, 'draft.json');
if (await access(draftFile).then(() => true, () => false)) {
  console.log('기존 테스트 원고를 유지합니다. .local/fixtures/draft.json');
} else {
  const draft = createTestDraft();
  await writeFile(draftFile, JSON.stringify(draft, null, 2), { flag: 'wx' });
  await writeFile(path.join(directory, 'draft.html'), draft.html, 'utf8');
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  for (let index = 1; index <= 2; index++) {
    await page.setContent(`<html lang="ko"><meta charset="utf-8"><body style="margin:0;background:${index === 1 ? '#17324d' : '#146b55'};color:white;font:32px sans-serif;display:grid;place-content:center;height:100vh"><b>P0 TEST IMAGE ${index}</b><p>티스토리 이미지 첨부 검증</p></body></html>`);
    await page.screenshot({ path: path.join(directory, `p0-image-${index}.png`) });
  }
  console.log('테스트 이미지 2장 준비 완료: .local/fixtures/');
} finally { await browser.close(); }
