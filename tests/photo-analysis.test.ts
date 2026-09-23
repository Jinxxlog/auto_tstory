import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openStore } from '../src/lib/store';
import { importImage } from '../src/lib/assets';
import { withBlocks } from '../src/lib/blocks';
import { aiStore } from '../src/lib/ai-store';
import { photoAnalysisStore, photoCacheKey } from '../src/lib/photo-analysis';
import { createBackup, restoreBackup } from '../src/lib/backup';

test('photo cache keys include bytes, model, note and grouping; stale/cancelled results never apply', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'photo-analysis-')); const data = path.join(root, 'data'); const store = openStore(data); const photos = photoAnalysisStore(store);
  try {
    const ai = aiStore(store); ai.setConnection({ state: 'connected', message: '', models: [{ id: 'model', name: '', images: true, isDefault: true }] });
    const bytes = await sharp({ create: { width: 50, height: 40, channels: 3, background: '#123456' } }).png().toBuffer();
    const asset = await importImage(new File([bytes], 'test.png', { type: 'image/png' }), false, data); store.addAsset(asset);
    const draft = store.saveDraft(withBlocks({ id: '', version: 0, title: 'test', kind: 'project', summary: '', markdown: '', category: '', images: [], cover: null, updatedAt: '' }, [{ id: 'photo', type: 'image', imageId: asset.id, note: '사용자 메모', group: '날짜', caption: '', description: '' }]));
    const job = await photos.enqueue(draft.id, 'model', [asset.id]); assert.equal(job.state, 'queued'); photos.put({ ...job, state: 'running' });
    photos.finish(job.id, [{ id: asset.id, caption: '사진', description: '긴 설명', uncertainty: '장소 확인' }]);
    const saved = photos.apply(job.id); assert.equal(saved.version, 2); assert.equal(saved.blocks![0].type === 'image' && saved.blocks![0].note, '사용자 메모'); assert.equal(store.jobs().length, 0);
    const cached = await photos.enqueue(draft.id, 'model', [asset.id]); assert.equal(cached.state, 'succeeded'); assert.equal(cached.cached, 1);
    store.saveDraft(withBlocks(saved, saved.blocks!.map(block => block.type === 'image' ? { ...block, note: '새 메모' } : block))); assert.throws(() => photos.apply(cached.id), /수정/);
    const changed = await photos.enqueue(draft.id, 'model', [asset.id]); assert.equal(changed.cached, 0); photos.put({ ...changed, state: 'running' }); photos.cancel(changed.id); photos.finish(changed.id, [{ id: asset.id, caption: '늦은 결과', description: '', uncertainty: '' }]); assert.equal(photos.get(changed.id).state, 'cancelled');
    assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS n FROM photo_cache').get()?.n), 1);
    const base = photoCacheKey('hash', 'model', 'note', 'group');
    for (const args of [['other', 'model', 'note', 'group'], ['hash', 'other', 'note', 'group'], ['hash', 'model', 'other', 'group'], ['hash', 'model', 'note', 'other']]) assert.notEqual(photoCacheKey(...args as [string,string,string,string]), base);
    const backup = await createBackup(data, path.join(root, 'backup')); await restoreBackup(backup.directory, path.join(root, 'restored'), path.join(root, 'safety'));
    const restored = openStore(path.join(root, 'restored')); try { assert.equal(Number(restored.db.prepare('SELECT COUNT(*) AS n FROM photo_cache').get()?.n), 1); } finally { restored.db.close(); }
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});
