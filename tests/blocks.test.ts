import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { openStore, validateDraft } from '../src/lib/store';
import { draftBlocks, withBlocks } from '../src/lib/blocks';
import { renderDraft } from '../src/lib/content';
import { publicationSequence } from '../src/services/tistory/publisher';
import { importImage, thumbnail, assetPath } from '../src/lib/assets';
import { createBackup, restoreBackup } from '../src/lib/backup';
import { aiStore } from '../src/lib/ai-store';
import { parseOutput } from '../src/services/ai/content';

test('block conversion creates a new version and preserves legacy bytes, snapshots and backup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-blocks-')); const data = path.join(root, 'data'); const store = openStore(data);
  try {
    const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#123456' } }).png().toBuffer();
    const asset = await importImage(new File([bytes], '합성.png', { type: 'image/png' }), false, data); store.addAsset(asset);
    store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '연결됨' });
    const old = store.saveDraft({ id: '', version: 0, title: '보존', kind: 'project', summary: '', markdown: '## 소제목\n\n```py\nprint(1)\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |', category: '테스트', images: [{ id: asset.id, caption: '기존 캡션' }], cover: asset.id });
    const raw = String(store.db.prepare('SELECT body FROM draft_versions WHERE id=?').get(old.id)?.body);
    const job = store.enqueue('publish', old.id); store.updateJob(job.id, 'failed', '저장 전 합성 실패');
    const blocks = draftBlocks(old); assert.equal(blocks[0].type, 'text');
    if (blocks[1].type !== 'image') throw new Error('missing image');
    blocks[1].note = '절대 게시되지 않는 작성 메모'; blocks[1].description = '긴 설명';
    blocks.push({ id: 'after', type: 'text', markdown: '> 사진 다음 인용\n\n- 목록' });
    const saved = store.saveDraft(withBlocks(old, blocks));
    assert.equal(saved.version, 2); assert.equal(saved.schemaVersion, 2); assert.equal(saved.cover, asset.id);
    assert.equal(String(store.db.prepare('SELECT body FROM draft_versions WHERE id=? AND version=1').get(old.id)?.body), raw);
    assert.equal(store.job(job.id).snapshot.draft?.schemaVersion, undefined);
    assert.equal(renderDraft(saved).includes('절대 게시되지'), false); assert.ok(renderDraft(saved).includes('<table>')); assert.ok(renderDraft(saved).includes('<pre>'));
    const invalid = structuredClone(saved); invalid.blocks![1] = { ...invalid.blocks![1], id: invalid.blocks![0].id }; assert.throws(() => store.saveDraft(invalid), /중복/); assert.equal(store.draft(saved.id).version, 2);
    const backed = await createBackup(data, path.join(root, 'backups')); await mkdir(path.join(root, 'restore'));
    await restoreBackup(backed.directory, path.join(root, 'restore'), path.join(root, 'safety'));
    const restored = openStore(path.join(root, 'restore')); try { assert.deepEqual(restored.draft(saved.id), saved); } finally { restored.db.close(); }
    const thumb = await thumbnail(asset.id, data); assert.equal((await sharp(thumb).metadata()).width, 480); assert.deepEqual(await readFile(assetPath(asset.id, data)), bytes);
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test('publication sequence detects moved photos and validates block limits and metadata exclusion', () => {
  assert.notEqual(publicationSequence('<p>A</p><img/><p>B</p>'), publicationSequence('<p>A</p><p>B</p><img/>'));
  const base = { id: '', version: 0, title: 'test', kind: 'project' as const, summary: '', markdown: '', images: [], cover: null, category: '', updatedAt: '' };
  const blocks = Array.from({ length: 50 }, (_, index) => ({ id: `block-${index}`, type: 'image' as const, imageId: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, note: '<script>secret</script>', group: 'private group', caption: '<caption>', description: `사진 ${index} 설명` }));
  const draft = validateDraft(withBlocks(base, blocks)); assert.equal(draft.images.length, 50);
  assert.equal(renderDraft(draft).includes('secret'), false); assert.equal(renderDraft(draft).includes('private group'), false); assert.ok(renderDraft(draft).includes('&lt;caption&gt;'));
  assert.throws(() => validateDraft(withBlocks(base, [...blocks, { ...blocks[0], id: 'extra' }])), /50/);
  assert.throws(() => validateDraft({ ...base, images: [{ id: '" onerror="alert(1)', caption: '' }] }), /이미지/);
});

test('AI block application preserves photo placement, private notes and nonselected content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-block-ai-')); const store = openStore(root); const ai = aiStore(store);
  try {
    const asset = { id: '00000000-0000-0000-0000-000000000001', caption: '' }; store.addAsset({ id: asset.id, name: 'test', mime: 'image/png', size: 1, library: false });
    ai.setConnection({ state: 'connected', message: '', models: [{ id: 'test', name: '', images: true, isDefault: true }] });
    const base = { id: '', version: 0, title: 'test', kind: 'project' as const, summary: '실제 구현 내용은 사진과 문단을 서로 교차 배치하는 편집기입니다.', markdown: '', category: '', images: [], cover: null, updatedAt: '' };
    const draft = store.saveDraft(withBlocks(base, [{ id: 'first', type: 'text', markdown: '앞 문단' }, { id: 'photo', type: 'image', imageId: asset.id, note: '내 메모', group: '1일', caption: '캡션', description: '바꿀 설명' }, { id: 'last', type: 'text', markdown: '뒷 문단' }]));
    const job = ai.enqueue(draft.id, 'test', '바꿀 설명', '짧게');
    const output = parseOutput(JSON.stringify({ title: 'test', markdown: '새 설명', outline: [], warnings: [], captions: draft.images, blocks: [] }), job);
    ai.put({ ...job, state: 'running' }); ai.finish(job.id, output); const saved = ai.apply(job.id);
    assert.equal(saved.blocks![1].type === 'image' && saved.blocks![1].description, '새 설명'); assert.equal(saved.blocks![1].type === 'image' && saved.blocks![1].note, '내 메모'); assert.deepEqual(saved.blocks![0], draft.blocks![0]); assert.deepEqual(saved.blocks![2], draft.blocks![2]);
    const next = ai.enqueue(draft.id, 'test', '', '');
    assert.throws(() => parseOutput(JSON.stringify({ ...output, blocks: [{ id: 'missing', markdown: 'bad' }] }), next), /블록/);
    const complete = parseOutput(JSON.stringify({ title: '새 제목', markdown: '파생 본문', captions: [{ id: asset.id, caption: '새 캡션' }], outline: [], warnings: [], blocks: [{ id: 'first', markdown: '새 도입' }, { id: 'photo', markdown: '사진 해설' }, { id: 'last', markdown: '새 마무리' }] }), next);
    ai.put({ ...next, state: 'running' }); ai.finish(next.id, complete); const full = ai.apply(next.id);
    assert.deepEqual(full.blocks!.map(block => block.id), saved.blocks!.map(block => block.id)); assert.equal(full.images[0].caption, '새 캡션'); assert.equal(full.blocks![1].type === 'image' && full.blocks![1].note, '내 메모');
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});
