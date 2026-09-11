import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

if (!process.argv.includes('--generate')) throw new Error('--generate를 지정해야 ChatGPT 구독 한도를 사용하는 실제 생성 검증을 실행합니다. 티스토리에는 발행하지 않습니다.');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:3000');
  await page.getByRole('button', { name: '＋ 새 원고 작성' }).click();
  await page.getByLabel('제목', { exact: true }).fill(`[P2 테스트] 사진 기록 프로젝트 ${new Date().toISOString()}`);
  await page.getByLabel('요약 · 작성 메모').fill('사진 기록 프로젝트의 개발 기록이다. TypeScript와 Next.js로 로컬 웹앱을 만들었다. 구현한 기능은 원고 수동 저장, 사진 업로드, 사진 순서 변경이다. 첨부 사진은 실제 제품 화면이 아니라 이미지 순서 검증을 위해 만든 파란색 합성 테스트 이미지다. 성능 측정이나 배포는 하지 않았다. 이 사실만 바탕으로 짧은 프로젝트 소개와 구현 내용 설명을 작성해줘.');
  await page.locator('input[type=file][accept]').first().setInputFiles('.local/fixtures/p0-image-1.png');
  await page.getByRole('status').filter({ hasText: '사진을 가져왔습니다' }).waitFor();
  await page.getByRole('button', { name: '원고 저장', exact: true }).click();
  await page.getByText('원고를 저장했습니다.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'ChatGPT 연결 · 새로고침' }).click();
  await page.getByText('ChatGPT 구독으로 연결됨', { exact: false }).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '요약·사진으로 초안 생성' }).click();
  console.log('GENERATION_REQUESTED');
  await page.getByText('생성 완료 · 검토 후 원고에 적용하세요.', { exact: true }).waitFor({ timeout: 330000 });
  await page.screenshot({ path: '.local/p2-generated.png', fullPage: true });
  await page.getByRole('button', { name: '검토한 결과를 원고에 적용' }).click();
  await page.getByRole('button', { name: 'v2에 적용됨' }).waitFor();
  const markdown = await page.locator('textarea.markdown').inputValue(); assert.ok(markdown.length > 50);
  const state = await page.evaluate(async () => (await fetch('/api/app')).json());
  const job = state.ai.jobs.find((j: any) => j.appliedVersion === 2);
  assert.ok(job.output.captions.length === 1);
  await writeFile('.local/p2-generated-result.json', JSON.stringify({ jobId: job.id, draftId: job.draft.id, title: job.output.title, output: job.output, usage: job.usage, appliedVersion: job.appliedVersion }, null, 2));
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '.local/p2-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log(JSON.stringify({ chatgptConnected: true, generatedWithImage: true, appliedVersion: 2, mobileOverflow: false, noPublication: true }));
} finally { await browser.close(); }
