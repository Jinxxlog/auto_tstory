import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { normalizePostUrl } from '../src/services/tistory/url';
import { Publisher } from '../src/services/tistory/publisher';

const blog = 'https://example.tistory.com';
const input = { id: '', version: 0, title: '복구 합성 원고', kind: 'project', summary: '', markdown: '전송한 본문', category: '테스트', images: [], cover: null };

test('saved-post addresses reject editors, unrelated blogs and hidden path separators', () => {
  assert.equal(normalizePostUrl(`${blog}/15/`, blog), `${blog}/15`);
  assert.equal(normalizePostUrl(`${blog}/entry/test`, blog), `${blog}/entry/test`);
  for (const value of [`${blog}/manage/post/15`, `${blog}/`, `${blog}/15?redirect=/manage`, `${blog}/15#token`, 'https://other.tistory.com/15', 'https://user:pass@example.tistory.com/15', `${blog}/entry/a%2fb`, `${blog}/entry/a%5cb`, `${blog}/entry/%00`, `${blog}/0`, 'http://example.tistory.com/15']) assert.throws(() => normalizePostUrl(value, blog), value);
});

test('restart after a saved URL reuses the same job, including login resume, without publishing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-recovery-')); const store = openStore(root);
  try {
    store.setSettings({ blog, categories: ['테스트'], connection: '연결됨' });
    const draft = store.saveDraft(input); const first = store.enqueue('publish', draft.id);
    store.acquire('before'); store.claim('before'); store.recordPost(first.id, `${blog}/15`); store.updateJob(first.id, 'running', '결과 확인');
    store.acquire('after', Date.now() + 16000);
    assert.equal(store.job(first.id).state, 'unknown');
    assert.throws(() => store.resume(first.id));
    const check = store.verify(first.id); assert.equal(check.kind, 'verify'); assert.equal(check.id, first.id);
    assert.equal(check.snapshot.postUrl, `${blog}/15`); assert.equal(store.enqueue('publish', draft.id).id, first.id);
    assert.throws(() => store.verify(first.id), /지금/); assert.throws(() => store.cancel(first.id));
    store.claim('after'); store.acquire('third', Date.now() + 32000);
    assert.equal(store.job(first.id).state, 'needs_attention');
    assert.equal(store.verify(first.id).kind, 'verify', 'a crash during verification must still recover read-only');
    store.saveDraft({ ...draft, markdown: '나중에 수정' }); assert.throws(() => store.enqueue('publish', draft.id), /이전 전송/);
    store.updateJob(first.id, 'needs_login', '로그인 필요');
    assert.equal(store.resume(first.id).kind, 'verify');
    await assert.rejects(new Publisher().publish({ ...first, snapshot: { ...first.snapshot, postUrl: `${blog}/15` } }, () => assert.fail('publish step invoked')), /새 글/);
    store.updateJob(first.id, 'needs_attention', '검사 대기');
    assert.throws(() => store.verify(first.id, `${blog}/16`), /바꿀 수/);
    assert.throws(() => store.resolveUnpublished(first.id, true));
    assert.equal(store.jobs().length, 1);
  } finally { store.db.close(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});

test('a crash before submission or during upload waits for explicit recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-recovery-')); const store = openStore(root);
  try {
    store.setSettings({ blog, categories: ['테스트'], connection: '연결됨' });
    for (const step of ['원고 입력', '사진 첨부 1/2']) {
      const draft = store.saveDraft(input); const first = store.enqueue('publish', draft.id);
      store.acquire('before'); store.claim('before'); store.updateJob(first.id, 'running', step);
      store.acquire('after', Date.now() + 16000);
      assert.equal(store.job(first.id).state, 'needs_attention'); assert.equal(store.claim('after'), undefined);
      assert.throws(() => store.resume(first.id));
      assert.equal(store.resolveUnpublished(first.id, true).state, 'cancelled');
      assert.equal(store.enqueue('publish', draft.id).id, first.id);
      store.release('after');
    }
    assert.equal(store.jobs().length, 2);
  } finally { store.db.close(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});

test('missing-URL recovery keeps a candidate unconfirmed and records explicit unpublished closure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-recovery-')); const store = openStore(root);
  try {
    store.setSettings({ blog, categories: ['테스트'], connection: '연결됨' });
    const draft = store.saveDraft(input); const first = store.enqueue('publish', draft.id);
    store.acquire('before'); store.claim('before'); store.updateJob(first.id, 'running', '저장 요청'); store.acquire('after', Date.now() + 16000);
    assert.throws(() => store.verify(first.id), /주소/);
    assert.throws(() => store.verify(first.id, 'https://other.tistory.com/15'));
    const check = store.verify(first.id, `${blog}/15`);
    assert.equal(check.kind, 'verify'); assert.equal(check.snapshot.postUrl, undefined); assert.equal(check.result, null);
    assert.equal(check.snapshot.candidatePostUrl, `${blog}/15`);
    assert.throws(() => store.resolveUnpublished(first.id, true));
    store.updateJob(first.id, 'needs_attention', '본문 불일치');
    const corrected = store.verify(first.id, `${blog}/16`); assert.equal(corrected.snapshot.candidatePostUrl, `${blog}/16`);
    store.updateJob(first.id, 'needs_attention', '아직 확인하지 못함');
    assert.throws(() => store.resolveUnpublished(first.id, false));
    const closed = store.resolveUnpublished(first.id, true); assert.equal(closed.state, 'cancelled'); assert.ok(closed.snapshot.unpublishedConfirmedAt);
    assert.equal(store.enqueue('publish', draft.id).state, 'cancelled'); assert.equal(store.jobs().length, 1);
    store.saveDraft({ ...draft, markdown: '사용자가 새 버전으로 저장' });
    const next = store.enqueue('publish', draft.id); assert.notEqual(next.id, first.id);
    store.updateJob(next.id, 'needs_attention', '저장 전 중단');
    store.verify(next.id, `${blog}/17`); store.recordPost(next.id, `${blog}/17`);
    assert.equal(store.job(next.id).snapshot.candidatePostUrl, undefined); assert.equal(store.job(next.id).snapshot.postUrl, `${blog}/17`);
    assert.equal(store.jobs().length, 2);
  } finally { store.db.close(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});

test('restoration artifacts exclude photographs even with a custom data folder name', () => {
  const paths = ['data.before-restore-test/images/photo.png', 'custom.failed-restore-test/images/photo.png', '.restore-test/images/photo.png', 'nested/custom.before-restore-test/images/photo.png', '.creating-test/images/photo.png'];
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], { input: paths.join('\n') + '\n', encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, paths);
});
