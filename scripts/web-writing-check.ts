// Local synthetic UI with controlled AI responses; no external AI or blog access.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { openStore } from '../src/lib/store';
import { aiStore } from '../src/lib/ai-store';
import { parseOutput } from '../src/services/ai/content';
import { outlineReviewed } from '../src/lib/writing';
import { portAvailable } from './environment.mjs';
assert.ok(await portAvailable()); await mkdir('.local', { recursive: true }); const root = await mkdtemp(path.resolve('.local/r3-web-'));
const data = path.join(root, 'data'); const store = openStore(data); const ai = aiStore(store);
store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '합성 UI 검사' }); store.acquire('ui-fixture'); const heartbeat = setInterval(() => store.heartbeat('ui-fixture'), 3000);
ai.setConnection({ state: 'connected', message: '로컬 합성 응답', models: [{ id: 'fixture', name: '합성 모델', images: true, isDefault: true }] });
const photos: string[] = [];
for (let index = 0; index < 2; index++) { const file = path.join(root, `photo-${index}.png`); await sharp({ create: { width: 640, height: 420, channels: 3, background: index ? '#94d2bd' : '#005f73' } }).png().toFile(file); photos.push(file); }
const origin = 'http://127.0.0.1:3000'; const server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1'], { env: { ...process.env, TSTORY_DATA_DIR: data }, windowsHide: true, stdio: 'ignore' });
const browser = await chromium.launch({ channel: 'chrome', headless: true }); const failures: string[] = [];
try {
  for (let attempt = 0; ; attempt++) { try { if ((await fetch(origin)).ok) break; } catch {} assert.ok(attempt < 100); await new Promise(resolve => setTimeout(resolve, 200)); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => failures.push(error.message)); await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  for (const [kind, name] of [['travel', '여행'], ['information', '정보'], ['free', '자유']]) {
    await page.goto(origin); await page.getByRole('button', { name: '＋ 새 원고 작성', exact: true }).click();
    await page.getByLabel('글 유형', { exact: true }).selectOption(kind); await page.getByLabel('제목', { exact: true }).fill(`R3 ${name} 합성 UI`); await page.getByLabel('카테고리', { exact: true }).selectOption('테스트'); await page.getByLabel('요약 · 작성 메모').fill('실제 경험을 나타내지 않는 합성 원고입니다. 사진 두 장과 함께 편집 기능을 확인합니다.');
    assert.equal(await page.getByLabel('문제 본문', { exact: true }).count(), 0);
    if (kind === 'travel') await page.getByLabel('여행 장소', { exact: true }).fill('가상의 공원');
    if (kind === 'information') { await page.getByLabel('정보 주제', { exact: true }).fill('그림 안내'); await page.getByLabel('정보 글 독자').fill('그림을 보는 사람'); await page.getByLabel('정보 설명 범위').fill('합성 그림의 도형'); }
    if (kind === 'free') { await page.getByLabel('원하는 분위기').fill('담백하게'); assert.equal(await page.getByText('참고 URL 가져오기 · 본문 붙여넣기', { exact: true }).count(), 0); }
    const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '사진 선택', exact: true }).click(); await (await chooser).setFiles(photos); await page.getByText('2/2 처리 완료 · 원고를 저장해주세요.', { exact: true }).waitFor();
    await page.getByRole('button', { name: '유형별 개요 준비' }).click(); await page.getByLabel('개요 제목 1', { exact: true }).fill('검토한 도입'); await page.getByLabel('담을 내용 1', { exact: true }).fill('합성 검사라는 사실');
    await page.getByRole('button', { name: '개요 3 위로', exact: true }).click();
    await page.locator('.block-lock input').first().check();
    await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 1', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: `${name} 초안 생성`, exact: true }).isEnabled(), false);
    await page.getByRole('button', { name: '개요·사진 배치 검토 완료', exact: true }).click(); await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 2', { exact: true }).waitFor();
    const initial = store.drafts().find(draft => draft.kind === kind)!; assert.ok(outlineReviewed(initial)); assert.equal(initial.blocks![1].type, 'image');
    await page.getByRole('button', { name: `${name} 초안 생성`, exact: true }).click(); await page.getByText('생성 대기', { exact: true }).waitFor();
    const job = ai.jobs().find(job => job.draft.id === initial.id)!; ai.put({ ...job, state: 'running' }); ai.finish(job.id, parseOutput(JSON.stringify({ title: initial.title, markdown: '합성 본문', outline: ['합성 개요'], warnings: ['실제 자료 아님'], captions: initial.images.map(image => ({ id: image.id, caption: '합성 캡션' })), blocks: initial.blocks!.map(block => ({ id: block.id, markdown: '합성 새 본문' })) }), job));
    await page.getByRole('button', { name: '검토한 결과를 원고에 적용', exact: true }).click({ timeout: 15000 }); await page.getByText('저장됨 · 버전 3', { exact: true }).waitFor();
    assert.deepEqual(store.draft(initial.id).blocks![0], initial.blocks![0]);
    await page.getByLabel('짧은 캡션', { exact: true }).first().fill('직접 바꾼 캡션'); await page.getByLabel('작성 메모 · 게시되지 않음', { exact: true }).first().fill('게시 금지 비밀 메모');
    await page.getByRole('button', { name: '원고 저장', exact: true }).click(); await page.getByText('저장됨 · 버전 4', { exact: true }).waitFor();
    const edited = store.draft(initial.id); await page.getByLabel('재작성할 블록').selectOption(edited.blocks![1].id); await page.getByLabel('수정 요청', { exact: true }).fill('간단히');
    await page.getByRole('button', { name: '선택 블록 재작성', exact: true }).click(); await page.getByText('생성 대기', { exact: true }).waitFor();
    const rewrite = ai.jobs().find(job => job.targetBlockId && job.draft.id === initial.id)!; ai.put({ ...rewrite, state: 'running' }); ai.finish(rewrite.id, parseOutput(JSON.stringify({ markdown: '재작성한 사진 긴 설명', warnings: [] }), rewrite));
    await page.getByRole('button', { name: '검토한 결과를 원고에 적용', exact: true }).click({ timeout: 15000 }); await page.getByText('저장됨 · 버전 5', { exact: true }).waitFor();
    const saved = store.draft(initial.id); assert.equal(saved.images[0].caption, '직접 바꾼 캡션'); assert.equal(saved.blocks![1].type === 'image' && saved.blocks![1].note, '게시 금지 비밀 메모'); assert.deepEqual(saved.blocks!.filter(block => block.id !== rewrite.targetBlockId), edited.blocks!.filter(block => block.id !== rewrite.targetBlockId));
    await page.locator('article').getByText('재작성한 사진 긴 설명', { exact: true }).waitFor(); assert.equal((await page.locator('article').innerText()).includes('게시 금지'), false);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.locator('.outline-panel').screenshot({ path: path.join(root, `${kind}-outline-mobile.png`) }); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '비공개 전송', exact: true }).click(); await page.getByRole('button', { name: '확인하고 전송', exact: true }).click(); await page.getByRole('heading', { name: '작업 내역', exact: true }).waitFor();
    const publish = store.jobs().find(job => job.snapshot.draft?.id === initial.id)!; assert.equal(publish.snapshot.target?.visibility, 'private'); assert.deepEqual(publish.snapshot.draft, saved); assert.equal(publish.state, 'queued');
  }
  assert.deepEqual(failures, []); const report = { passed: true, kinds: ['travel', 'information', 'free'], uiDraftEditRewrite: true, outlineReviewGuard: true, lockAndNotesPreserved: true, privateQueueSnapshots: 3, mobileOverflow: false, externalGeneration: false, externalPublication: false, evidence: root }; await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { clearInterval(heartbeat); store.release('ui-fixture'); await browser.close(); server.kill(); store.db.close(); }
