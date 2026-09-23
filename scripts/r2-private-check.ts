// Opt-in integration: one synthetic 10-photo PRIVATE post, then read-only recovery.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
if (!process.argv.includes('--private-test') && !process.argv.includes('--check-login')) throw new Error('Specify --check-login or --private-test.');
const root = path.resolve('.local/r2-private'); await mkdir(root, { recursive: true });
process.env.TSTORY_DATA_DIR = path.join(root, 'data');
const { Publisher, LoginRequired } = await import('../src/services/tistory/publisher');
const { openStore } = await import('../src/lib/store');
const { importImage } = await import('../src/lib/assets');
const { withBlocks } = await import('../src/lib/blocks');
const db = new DatabaseSync(path.resolve('data/app.sqlite'), { readOnly: true });
const settings = JSON.parse(String(db.prepare('SELECT body FROM settings WHERE id=1').get()?.body)); db.close();
const publisher = new Publisher();
const store = openStore(); const owner = 'r2-private-check';
let timer: ReturnType<typeof setInterval> | undefined;
try {
  if (process.argv.includes('--check-login')) {
    const until = Date.now() + (process.argv.includes('--wait-login') ? 15 * 60_000 : 0);
    for (;;) {
      try { await publisher.connect(settings.blog); console.log(JSON.stringify({ authenticated: true })); break; }
      catch (error) { if (!(error instanceof LoginRequired) || Date.now() >= until) throw error; await new Promise(resolve => setTimeout(resolve, 5000)); }
    }
  }
  else {
    assert.ok(store.acquire(owner)); timer = setInterval(() => store.heartbeat(owner), 3000);
    const file = path.join(root, 'publication.json');
    let marker: { jobId: string; draftId: string } | undefined;
    try { marker = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!marker) {
      const categories = await publisher.categories(settings.blog); assert.ok(categories.includes('테스트'), 'Existing test category required');
      store.setSettings({ blog: settings.blog, categories, connection: '연결됨' });
      const blocks: import('../src/lib/model').DraftBlock[] = [];
      for (let index = 0; index < 10; index++) {
        const bytes = await sharp({ create: { width: 640 + index * 11, height: 400 + index * 7, channels: 3, background: { r: 30 + index * 20, g: 70 + index * 12, b: 160 - index * 9 } } }).png().toBuffer();
        const asset = await importImage(new File([bytes], `R2-${index + 1}.png`, { type: 'image/png' }), false); store.addAsset(asset);
        blocks.push({ id: `text-${index}`, type: 'text', markdown: `## 장면 ${index + 1}\n\n사진 ${index + 1} 앞의 합성 문단입니다.${index === 0 ? '\n\n```python\nprint("R2")\n```\n\n| 항목 | 값 |\n| --- | --- |\n| 사진 | 10 |' : ''}` });
        blocks.push({ id: `image-${index}`, type: 'image', imageId: asset.id, note: `게시 금지 메모 ${index + 1}`, group: '합성 검사', caption: `R2 사진 ${index + 1}`, description: `사진 ${index + 1} 뒤의 긴 본문 설명입니다. 순서가 유지되어야 합니다.` });
      }
      blocks.push({ id: 'closing', type: 'text', markdown: '모든 사진 뒤의 마무리 문단입니다.' });
      const firstPhoto = blocks.find(block => block.type === 'image')!;
      const draft = store.saveDraft(withBlocks({ id: '', version: 0, title: '[R2 비공개 테스트] 사진 10장 블록 배치', kind: 'project', summary: '사진 중심 편집의 합성 검사입니다. 실제 사용자 경험이나 원본 사진은 포함하지 않습니다.', markdown: '', category: '테스트', images: [], cover: firstPhoto.type === 'image' ? firstPhoto.imageId : null, updatedAt: '' }, blocks));
      const job = store.enqueue('publish', draft.id); marker = { jobId: job.id, draftId: draft.id }; await writeFile(file, JSON.stringify(marker));
    }
    const job = store.job(marker.jobId);
    let submitted = false;
    try {
      let url: string;
      if (job.snapshot.postUrl || job.result) url = await publisher.verify(job);
      else {
        if (job.state !== 'queued') throw new Error('Interrupted test without a URL: inspect the blog manually; never republish.');
        store.updateJob(job.id, 'running', '브라우저 연결');
        url = await publisher.publish(job, (step, postUrl, imagePaths) => {
          assert.ok(store.heartbeat(owner)); store.updateJob(job.id, 'running', step);
          if (imagePaths) store.recordImagePaths(job.id, imagePaths);
          if (postUrl) store.recordPost(job.id, postUrl);
          if (step === '저장 요청') submitted = true;
          console.log(step);
        });
      }
      store.recordPost(job.id, url); store.updateJob(job.id, 'succeeded', 'R2 사진 10장 비공개·본문 순서 검증 완료', url);
      const anonymous = await publisher.probe!.context.browser()!.newContext();
      try { const page = await anonymous.newPage(); await page.goto(url); assert.equal(await page.getByRole('heading', { name: job.snapshot.draft!.title, exact: true }).count(), 0); } finally { await anonymous.close(); }
      await writeFile(path.join(root, 'result.json'), JSON.stringify({ verified: true, private: true, photos: 10, anonymousBlocked: true, url, draftId: marker.draftId, jobId: job.id, checkedAt: new Date().toISOString() }, null, 2));
      console.log(JSON.stringify({ verified: true, private: true, photos: 10, anonymousBlocked: true }));
    } catch (error) {
      const current = store.job(job.id); store.updateJob(job.id, submitted && !current.snapshot.postUrl ? 'unknown' : 'needs_attention', 'R2 검사 중단 · 자동 재발행 금지', current.snapshot.postUrl || current.result);
      await writeFile(path.join(root, 'error.txt'), error instanceof Error ? error.stack || error.message : String(error));
      console.log(JSON.stringify({ verified: false, savedUrlKnown: !!current.snapshot.postUrl, requiresLogin: error instanceof LoginRequired })); process.exitCode = 1;
    }
  }
} catch (error) { console.log(JSON.stringify({ authenticated: false, requiresLogin: error instanceof LoginRequired })); await writeFile(path.join(root, 'error.txt'), error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; }
finally { clearInterval(timer); await publisher.close(); store.release(owner); store.db.close(); }
