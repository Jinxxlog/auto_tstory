import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { supportedNode, supportedInstallPath } from '../scripts/environment.mjs';

test('fresh users have no developer blog and can save a draft before connecting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-first-setup-')); const store = openStore(root);
  try {
    assert.equal(store.settings().blog, ''); assert.deepEqual(store.settings().categories, []);
    const draft = store.saveDraft({ id: '', version: 0, title: '새 원고', kind: 'project', summary: '', markdown: '로그인 없는 저장', category: '', images: [], cover: null });
    assert.equal(store.draft(draft.id).markdown, '로그인 없는 저장');
    assert.throws(() => store.enqueue('connect'), /주소/); assert.throws(() => store.enqueue('publish', draft.id), /주소/);
    store.setSettings({ blog: 'https://example.tistory.com', categories: [], connection: '미확인' });
    const reopened = openStore(root);
    try { assert.equal(reopened.settings().blog, 'https://example.tistory.com'); assert.equal(reopened.drafts().length, 1); } finally { reopened.db.close(); }
  } finally { store.db.close(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});
test('runtime support follows the tested Node 22 SQLite baseline', () => {
  for (const version of ['22.20.0', '22.21.1']) assert.equal(supportedNode(version), true);
  for (const version of ['20.20.0', '22.19.0', '23.0.0', '24.0.0']) assert.equal(supportedNode(version), false);
});
test('unsupported Unicode installation paths are rejected before setup', () => {
  assert.equal(supportedInstallPath('C:/Users/test/clean install'), true);
  assert.equal(supportedInstallPath('C:/Users/사용자/app'), false);
});
