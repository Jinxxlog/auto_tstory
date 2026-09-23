import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { createBackup, restoreBackup, verifyBackup } from '../src/lib/backup';
import { auditData } from '../src/lib/audit';
import { aiStore } from '../src/lib/ai-store';
import { DatabaseSync } from 'node:sqlite';

test('backup captures a consistent DB/image set and restore keeps a safety copy', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'tstory-backup-')); const source = path.join(base, 'data'); const backups = path.join(base, 'backups');
  try {
    const store = openStore(source); const id = '00000000-0000-4000-8000-000000000001';
    store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '연결됨', checkedAt: new Date().toISOString() });
    aiStore(store).setConnection({ state: 'login', message: '로그인', authUrl: 'https://example.test/secret-login-token', models: [] });
    store.db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run('old-worker', 1);
    await mkdir(path.join(source, 'images'), { recursive: true }); await writeFile(path.join(source, 'images', `${id}.png`), Buffer.from('immutable-image'));
    store.addAsset({ id, name: 'test.png', mime: 'image/png', size: 15, library: false });
    const draft = store.saveDraft({ id: '', version: 0, title: '백업 원고', kind: 'project', summary: '일관된 백업과 복원을 검증하기 위한 충분한 길이의 요약입니다.', markdown: '첫 본문', category: '테스트', images: [{ id, caption: '사진' }], cover: id }); store.db.close();
    const backup = await createBackup(source, backups); assert.equal(backup.manifest.images.length, 1); assert.equal(backup.manifest.database.tables.documents, 1);
    await verifyBackup(backup.directory);
    const snapshot = new DatabaseSync(path.join(backup.directory, 'app.sqlite'), { readOnly: true });
    assert.equal(JSON.parse(String(snapshot.prepare('SELECT body FROM settings WHERE id=1').get()?.body)).connection, '미확인');
    const ai = JSON.parse(String(snapshot.prepare('SELECT body FROM ai_settings WHERE id=1').get()?.body)); assert.equal(ai.state, 'disconnected'); assert.equal(ai.authUrl, undefined);
    assert.equal(snapshot.prepare('SELECT COUNT(*) AS count FROM lease').get()?.count, 0); snapshot.close();
    const changed = openStore(source); changed.saveDraft({ ...draft, markdown: '복원 전 변경 본문' }); changed.db.close();
    const restored = await restoreBackup(backup.directory, source, backups);
    const result = openStore(source); assert.equal(result.draft(draft.id).markdown, '첫 본문'); result.db.close();
    assert.ok(restored.previousData); const previous = openStore(restored.previousData); assert.equal(previous.draft(draft.id).markdown, '복원 전 변경 본문'); previous.db.close();
    assert.ok(restored.safetyBackup?.startsWith(path.resolve(backups)));
    const audit = await auditData(source); assert.equal(audit.integrity, true); assert.equal(audit.findings.filter(f => f.level === 'error').length, 0);
    await writeFile(path.join(backup.directory, 'images', `${id}.png`), Buffer.from('tampered'));
    await assert.rejects(verifyBackup(backup.directory), /손상/);
  } finally { const resolved = path.resolve(base); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(resolved, { recursive: true, force: true }); }
});

test('restore imports into absent and empty directories and refuses unrelated files', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'tstory-backup-'));
  try {
    const source = path.join(base, 'source'); const backups = path.join(base, 'backups');
    const store = openStore(source);
    const draft = store.saveDraft({ id: '', version: 0, title: '새 설치', kind: 'project', summary: '', markdown: '원본 유지', category: '테스트', images: [], cover: null }); store.db.close();
    const backup = await createBackup(source, backups);
    for (const exists of [false, true]) {
      const target = path.join(base, exists ? 'empty' : 'nested/new-data');
      if (exists) await mkdir(target);
      const restored = await restoreBackup(backup.directory, target, backups);
      assert.equal(restored.safetyBackup, null);
      assert.equal(!!restored.previousData, exists);
      const imported = openStore(target); assert.equal(imported.draft(draft.id).markdown, '원본 유지'); imported.db.close();
      if (restored.previousData) assert.deepEqual(await readdir(restored.previousData), []);
    }
    const unrelated = path.join(base, 'unrelated'); await mkdir(unrelated); await writeFile(path.join(unrelated, 'keep.txt'), 'keep');
    await assert.rejects(restoreBackup(backup.directory, unrelated, backups), /비어 있지 않은/);
    assert.equal(await readFile(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep');
    await assert.rejects(restoreBackup(backup.directory, path.join(backup.directory, 'nested'), backups), /분리/);
    await writeFile(path.join(backup.directory, 'app.sqlite'), 'corrupted');
    await assert.rejects(restoreBackup(backup.directory, path.join(base, 'never-created'), backups), /해시/);
    await assert.rejects(stat(path.join(base, 'never-created')), { code: 'ENOENT' });
  } finally { assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(base, { recursive: true, force: true }); }
});

test('a failure after installing a restored DB rolls back to the previous empty directory', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'tstory-backup-'));
  try {
    const store = openStore(path.join(base, 'source')); store.db.close();
    const backup = await createBackup(path.join(base, 'source'), path.join(base, 'backups'));
    const target = path.join(base, 'empty'); await mkdir(target);
    const prepare = DatabaseSync.prototype.prepare; let checks = 0;
    const mocked = t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
      if (sql === 'PRAGMA integrity_check' && ++checks === 2) throw new Error('simulated post-swap validation failure');
      return prepare.call(this, sql);
    });
    await assert.rejects(restoreBackup(backup.directory, target, path.join(base, 'backups')), /simulated/);
    mocked.mock.restore();
    assert.deepEqual(await readdir(target), []);
    assert.equal((await readdir(base)).filter(name => name.startsWith('empty.failed-restore-')).length, 1);
    await verifyBackup(backup.directory);
  } finally { t.mock.restoreAll(); assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(base, { recursive: true, force: true }); }
});

test('backup refuses active jobs and restore refuses an online worker lease', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'tstory-backup-')); const source = path.join(base, 'data'); const backups = path.join(base, 'backups');
  try {
    const store = openStore(source); store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '연결됨' });
    const draft = store.saveDraft({ id: '', version: 0, title: '작업 원고', kind: 'project', summary: '진행 중 작업의 백업 거절을 확인하기 위한 충분한 요약입니다.', markdown: '본문', category: '테스트', images: [], cover: null });
    store.enqueue('publish', draft.id); store.db.close();
    await assert.rejects(createBackup(source, backups), /진행 중인 작업/);
    const state = openStore(source); state.updateJob(state.jobs()[0].id, 'succeeded', '검사 완료'); state.db.close();
    const backup = await createBackup(source, backups); const online = openStore(source); online.acquire('test-worker'); online.db.close();
    await assert.rejects(restoreBackup(backup.directory, source, backups), /실행기가 켜져/);
  } finally { const resolved = path.resolve(base); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(resolved, { recursive: true, force: true }); }
});
