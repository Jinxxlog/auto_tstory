import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { renderMarkdown } from '../src/lib/content';
import { checkRequest } from '../src/lib/security';
import { assetPath, importImage } from '../src/lib/assets';
import sharp from 'sharp';

test('draft versions, immutable snapshot, deduplication and crash recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-test-')); const store = openStore(root); const other = openStore(root);
  try {
    store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '연결됨' });
    const initial = { id: '', version: 0, title: '테스트', kind: 'technical', summary: '', markdown: '첫 본문', category: '테스트', images: [], cover: null };
    const draft = store.saveDraft(initial); const first = store.enqueue('publish', draft.id);
    assert.equal(store.enqueue('publish', draft.id).id, first.id);
    store.saveDraft({ ...draft, markdown: '수정 본문' });
    assert.equal(store.job(first.id).snapshot.draft?.markdown, '첫 본문');
    assert.throws(() => other.saveDraft(draft), /다른 화면/);
    assert.equal(store.acquire('one'), true); assert.equal(other.acquire('two'), false);
    assert.equal(other.claim('two'), undefined); assert.equal(store.claim('one')?.id, first.id);
    store.updateJob(first.id, 'running', '저장 요청');
    assert.equal(other.acquire('two', Date.now()+16000), true);
    assert.equal(store.job(first.id).state, 'unknown'); assert.throws(() => store.resume(first.id));
    assert.throws(() => store.enqueue('publish', draft.id), /이전 전송/);
    store.recordPost(first.id, 'https://example.tistory.com/entry/test');
    store.updateJob(first.id, 'needs_attention', '이미지 처리 대기');
    const verification = store.verify(first.id);
    assert.equal(verification.kind, 'verify');
    assert.equal(verification.snapshot.postUrl, 'https://example.tistory.com/entry/test');
    assert.equal(store.jobs().length, 1, 'verification reuses the existing job, never creates a publication');
    assert.throws(() => store.enqueue('publish', draft.id), /이전 전송/);
    store.updateJob(first.id, 'succeeded', '관리 화면에서 검증 완료');
    assert.equal(store.enqueue('publish', draft.id).snapshot.draft?.version, 2);
    assert.equal(store.heartbeat('one'), false);
    const second = store.jobs().find(job => job.id !== first.id)!;
    store.updateJob(second.id, 'failed', '저장 전 실패'); store.resume(second.id); assert.equal(store.job(second.id).state, 'queued');
    store.cancel(second.id); assert.equal(store.job(second.id).state, 'cancelled');
  } finally { store.db.close(); other.db.close(); await rm(root, { recursive: true, force: true }); }
});
test('preview strips executable markup, remote images and unsafe links but keeps code/tables', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n![tracking](https://evil.test/image)\n\n[x](javascript:alert(1))\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```');
  assert.doesNotMatch(html, /<script|<img|javascript:/); assert.match(html, /<table>/); assert.match(html, /const x = 1/);
});
test('mutations require matching loopback origin and application header', () => {
  const request = (origin: string, host = '127.0.0.1:3000', marker = 'local-web') => new Request('http://127.0.0.1:3000/api/app', { headers: { host, origin, 'x-tstory-request': marker } });
  assert.doesNotThrow(() => checkRequest(request('http://127.0.0.1:3000'), true));
  assert.throws(() => checkRequest(request('https://evil.test'), true));
  assert.throws(() => checkRequest(request('http://127.0.0.1:3000', 'evil.test'), true));
  assert.throws(() => checkRequest(request('http://127.0.0.1:3000', '127.0.0.1:3000', ''), true));
});
test('image import decodes bytes, rejects spoofed MIME and paths, normalizes names', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-images-'));
  try {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4468e8' } }).png().toBuffer();
    const image = await importImage(new File([png], '../folder/test.png', { type: 'image/png' }), true, root);
    assert.equal(image.name, 'test.png'); assert.equal(image.library, true); assert.ok(assetPath(image.id, root).startsWith(root));
    await assert.rejects(importImage(new File([png], 'fake.jpg', { type: 'image/jpeg' }), false, root));
    await assert.rejects(importImage(new File(['<svg></svg>'], 'fake.png', { type: 'image/png' }), false, root));
    assert.throws(() => assetPath('../../secrets', root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
