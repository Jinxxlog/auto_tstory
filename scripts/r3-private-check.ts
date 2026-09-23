// Opt-in synthetic integration. Reuses saved post IDs; never retries a URL-less interrupted submission.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import type { Draft, DraftKind } from '../src/lib/model';
if (!process.argv.includes('--generate') && !process.argv.includes('--private-test') && !process.argv.includes('--verify')) throw new Error('Specify --generate, --private-test or --verify.');
const root = path.resolve('.local/r3-private'); await mkdir(root, { recursive: true }); process.env.TSTORY_DATA_DIR = path.join(root, 'data');
const { openStore } = await import('../src/lib/store'); const { aiStore } = await import('../src/lib/ai-store'); const { CodexClient } = await import('../src/services/ai/codex');
const { withBlocks } = await import('../src/lib/blocks'); const { outlineItems, outlineToken, emptyWriting } = await import('../src/lib/writing');
const { emptyMaterial } = await import('../src/lib/material'); const { importImage } = await import('../src/lib/assets'); const { Publisher } = await import('../src/services/tistory/publisher');
const store = openStore(); const ai = aiStore(store); const client = new CodexClient(); const publisher = new Publisher();
const owner = 'r3-private-check'; assert.ok(store.acquire(owner)); const timer = setInterval(() => store.heartbeat(owner), 3000);
const file = path.join(root, 'progress.json');
type Progress = { draftId: string; generated?: boolean; rewritten?: boolean; jobId?: string; verified?: boolean; anonymousBlocked?: boolean; error?: string };
let progress: Partial<Record<DraftKind, Progress>> = {};
try { progress = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const checkpoint = () => writeFile(file, JSON.stringify(progress, null, 2));
try {
  const kinds = ['travel', 'information', 'free'] as const;
  if (process.argv.includes('--generate')) {
    const status = await client.status(); assert.equal(status.state, 'connected'); ai.setConnection(status);
    const model = status.models.find(model => model.isDefault && model.images) || status.models.find(model => model.images); assert.ok(model);
    for (const kind of kinds) {
      if (!progress[kind]) {
        const blocks: import('../src/lib/model').DraftBlock[] = [{ id: 'intro', type: 'text', locked: true, markdown: '이 글은 편집과 비공개 전송을 확인하기 위한 합성 테스트입니다. 실제 방문·가격·체험을 안내하지 않습니다.' }];
        for (let index = 0; index < 2; index++) {
          const svg = `<svg width="640" height="420"><rect width="640" height="420" fill="${index ? '#e9d8a6' : '#94d2bd'}"/><path d="M0 300 L180 140 L320 260 L480 80 L640 300 V420 H0" fill="#005f73"/><circle cx="100" cy="80" r="40" fill="#ee9b00"/><text x="30" y="390" fill="white" font-size="24">R3 synthetic scene ${index + 1}</text></svg>`;
          const bytes = await sharp(Buffer.from(svg)).png().toBuffer(); const asset = await importImage(new File([bytes], `${kind}-${index}.png`, { type: 'image/png' }), false); store.addAsset(asset);
          blocks.push({ id: `section-${index}`, type: 'text', markdown: index ? '## 정리' : '## 이야기' }, { id: `photo-${index}`, type: 'image', imageId: asset.id, caption: `합성 장면 ${index + 1}`, note: '실제 장소나 체험을 나타내지 않는 도형 그림입니다. 색과 모양만 설명하세요.', group: '합성 검사', description: '' });
        }
        const summary = kind === 'travel' ? '가상의 달빛공원 여행 기록 형식을 시험한다. 실제로 방문하지 않았다. 두 그림은 산 모양 도형과 원으로 만든 합성 그림이다. 날짜·가게·비용·감정은 알 수 없으며 추정하지 않는다.' : kind === 'information' ? '합성 그림의 색과 도형을 비교하는 안내문이다. 첫 그림은 청록색 배경, 두 번째는 베이지색 배경이고 둘 다 산 모양과 원을 포함한다. 실제 관광·가격·영업시간 정보가 아니다.' : '도형 그림 두 장을 모아 한 페이지를 만드는 과정을 담백하게 소개한다. 실제 여행 경험이나 감정은 없으며 창작 비유를 사실처럼 쓰지 않는다.';
        let draft: Draft = withBlocks({ id: '', version: 0, title: `[R3 비공개 합성 테스트] ${kind}`, kind, summary, writing: { ...emptyWriting(), place: kind === 'travel' ? '가상의 달빛공원 · 방문하지 않음' : '', audience: '도형 그림을 보는 독자', scope: '제공된 두 그림의 색과 형태', checkedAt: '2026-09-23 합성 검사', mood: '담백하고 짧게' }, material: { ...emptyMaterial(), topic: '두 합성 그림의 색·모양 비교' }, markdown: '', category: '테스트', images: [], cover: blocks[2].type === 'image' ? blocks[2].imageId : null, updatedAt: '' }, blocks);
        draft = { ...draft, outline: outlineItems(draft).map(item => ({ ...item, purpose: '제공된 사실만 사용해 짧게 1~2문장 작성' })) }; draft.reviewedOutline = outlineToken(draft);
        progress[kind] = { draftId: store.saveDraft(draft).id }; await checkpoint();
      }
      const entry = progress[kind]!;
      if (!entry.generated) {
        const job = ai.enqueue(entry.draftId, model.id, '', '합성 검사임을 유지하고 전체 본문은 짧게 700자 이내로 작성하세요.', 'none');
        assert.equal(job.state, 'queued'); ai.put({ ...job, state: 'running', attempts: 1 }); console.log(`${kind}: generation requested`);
        try { const result = await client.generate(job, new AbortController().signal); ai.finish(job.id, result.output, result.usage); ai.apply(job.id); }
        catch (error) { ai.put({ ...ai.job(job.id), state: 'failed', step: '실제 검사 실패 · 자동 재생성 없음' }); throw error; }
        entry.generated = true; await checkpoint();
      }
      if (!entry.rewritten) {
        let draft = store.draft(entry.draftId); const original = structuredClone(draft);
        const blocks = [...draft.blocks!]; const photo = blocks.find(block => block.id === 'photo-0')!; assert.equal(photo.type, 'image');
        blocks.splice(blocks.indexOf(photo), 1); blocks.splice(1, 0, { ...photo, caption: '직접 편집한 합성 그림 캡션', description: '직접 수정한 사진 설명. 실제 장소가 아닌 합성 그림이다.' });
        draft = store.saveDraft(withBlocks(draft, blocks));
        const job = ai.enqueue(draft.id, model.id, '', '합성 그림임을 유지하고 긴 설명을 간단한 두 문장으로 바꿔주세요. 실제 체험은 추가하지 마세요.', 'none', 'photo-0');
        ai.put({ ...job, state: 'running', attempts: 1 }); console.log(`${kind}: block rewrite requested`);
        try { const result = await client.generate(job, new AbortController().signal); ai.finish(job.id, result.output, result.usage); const saved = ai.apply(job.id); assert.deepEqual(saved.blocks![0], original.blocks![0]); assert.deepEqual(saved.blocks!.filter(block => block.id !== 'photo-0'), draft.blocks!.filter(block => block.id !== 'photo-0')); assert.equal(saved.images[0].caption, '직접 편집한 합성 그림 캡션'); }
        catch (error) { ai.put({ ...ai.job(job.id), state: 'failed', step: '실제 재작성 검사 실패' }); throw error; }
        entry.rewritten = true; await checkpoint();
      }
      console.log(`${kind}: generation/edit/rewrite passed`);
    }
    await writeFile(path.join(root, 'review.json'), JSON.stringify(store.drafts().map(draft => ({ kind: draft.kind, title: draft.title, markdown: draft.markdown, blocks: draft.blocks })), null, 2));
  } else {
    const db = new DatabaseSync(path.resolve('data/app.sqlite'), { readOnly: true }); const settings = JSON.parse(String(db.prepare('SELECT body FROM settings WHERE id=1').get()?.body)); db.close();
    const categories = await publisher.categories(settings.blog); assert.ok(categories.includes('테스트')); store.setSettings({ blog: settings.blog, categories, connection: '연결됨' });
    for (const kind of kinds) {
      const entry = progress[kind]; assert.ok(entry?.rewritten, 'Generate and review first');
      if (!entry.jobId) { if (process.argv.includes('--verify')) continue; entry.jobId = store.enqueue('publish', entry.draftId).id; await checkpoint(); }
      const job = store.job(entry.jobId); let submitted = false;
      try {
        let url: string;
        if (job.snapshot.postUrl || job.result) url = await publisher.verify(job);
        else {
          assert.equal(job.state, 'queued', 'Interrupted without URL: do not republish'); assert.ok(!process.argv.includes('--verify'));
          store.updateJob(job.id, 'running', 'R3 비공개 검사');
          url = await publisher.publish(job, (step, postUrl, imagePaths) => { assert.ok(store.heartbeat(owner)); store.updateJob(job.id, 'running', step); if (imagePaths) store.recordImagePaths(job.id, imagePaths); if (postUrl) store.recordPost(job.id, postUrl); if (step === '저장 요청') submitted = true; console.log(`${kind}: ${step}`); });
        }
        entry.verified = true; entry.error = undefined; store.recordPost(job.id, url); store.updateJob(job.id, 'succeeded', 'R3 비공개·사진·순서 재확인 완료', url);
      } catch (error) {
        const current = store.job(job.id); entry.error = error instanceof Error ? error.message : 'verification failed'; entry.verified = false;
        store.updateJob(job.id, submitted && !current.snapshot.postUrl ? 'unknown' : 'needs_attention', 'R3 검사 확인 대기 · 재발행 금지', current.snapshot.postUrl || current.result);
        console.log(`${kind}: verification pending`); process.exitCode = 1;
      }
      const current = store.job(job.id); const url = current.snapshot.postUrl || current.result;
      if (url) {
        const anonymous = await publisher.probe!.context.browser()!.newContext();
        try { const page = await anonymous.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded' }); assert.equal(await page.getByRole('heading', { name: job.snapshot.draft!.title, exact: true }).count(), 0); assert.ok(!(await page.locator('body').innerText()).includes('직접 편집한 합성 그림 캡션')); entry.anonymousBlocked = true; } finally { await anonymous.close(); }
      }
      await checkpoint(); await publisher.close();
    }
  }
  console.log(JSON.stringify({ evidence: root, results: progress }));
} catch (error) { await writeFile(path.join(root, 'error.txt'), error instanceof Error ? error.stack || error.message : String(error)); console.log('R3 check stopped; inspect local error file. No automatic retry.'); process.exitCode = 1; }
finally { clearInterval(timer); client.close(); await publisher.close(); store.release(owner); store.db.close(); }
