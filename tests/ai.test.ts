import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/lib/store';
import { aiStore } from '../src/lib/ai-store';
import { parseOutput } from '../src/services/ai/content';

test('AI results preserve versions, reject stale applications, and never enqueue publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-ai-')); const store = openStore(root); const ai = aiStore(store);
  try {
    ai.setConnection({ state: 'connected', message: '', models: [{ id: 'test-model', name: 'test', images: true, isDefault: true }] });
    const draft = store.saveDraft({ id: '', version: 0, title: '프로젝트', kind: 'project', summary: '사진 업로드와 원고 저장 기능을 구현한 로컬 프로젝트입니다.', markdown: '앞 문단\n\n바꿀 구간\n\n뒷 문단', category: '테스트', images: [], cover: null });
    const job = ai.enqueue(draft.id, 'test-model', '바꿀 구간', '쉽게 설명');
    assert.equal(ai.enqueue(draft.id, 'test-model', '', '').id, job.id);
    const output = parseOutput(JSON.stringify({ title: '다른 제목', outline: ['개요'], markdown: '새 구간 $&', captions: [], warnings: ['배포 여부 확인'] }), job);
    assert.equal(output.markdown, '앞 문단\n\n새 구간 $&\n\n뒷 문단'); assert.equal(output.title, draft.title);
    ai.put({ ...job, state: 'running', attempts: 1 }); ai.finish(job.id, output);
    const applied = ai.apply(job.id); assert.equal(applied.version, 2); assert.equal(applied.markdown, output.markdown);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM draft_versions WHERE id=?').get(draft.id)?.n, 2);
    assert.throws(() => ai.apply(job.id), /적용 가능한/); assert.equal(store.jobs().length, 0);
    const next = ai.enqueue(draft.id, 'test-model', '', ''); ai.put({ ...next, state: 'running' }); ai.finish(next.id, output);
    store.saveDraft({ ...applied, markdown: '사용자가 수정한 본문' });
    assert.throws(() => ai.apply(next.id), /수정되었습니다/); assert.equal(store.draft(draft.id).markdown, '사용자가 수정한 본문');
    assert.throws(() => ai.enqueue(draft.id, 'test-model', '없는 구간', '요청'), /구간/);
    assert.throws(() => parseOutput(JSON.stringify({ ...output, captions: [{ id: 'unknown', caption: 'bad' }] }), next), /일치/);
  } finally { store.db.close(); await rm(root, { recursive: true, force: true }); }
});

test('AI cancellation ignores late success, retries are bounded, and restart does not regenerate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-ai-')); const store = openStore(root); const ai = aiStore(store);
  try {
    ai.setConnection({ state: 'connected', message: '', models: [{ id: 'test', name: 'test', images: true, isDefault: true }] });
    const draft = store.saveDraft({ id: '', version: 0, title: '테스트', kind: 'project', summary: 'TypeScript로 구현한 원고 저장 및 사진 정리 프로젝트입니다.', markdown: '', category: '', images: [], cover: null });
    const job = ai.enqueue(draft.id, 'test', '', ''); ai.put({ ...job, state: 'running', attempts: 1 }); ai.cancel(job.id);
    ai.finish(job.id, { title: '늦은 결과', outline: [], markdown: '본문', captions: [], warnings: [] }); assert.equal(ai.job(job.id).output, undefined);
    ai.recover(); assert.equal(ai.job(job.id).state, 'cancelled');
    const second = ai.enqueue(draft.id, 'test', '', ''); ai.put({ ...second, state: 'running', attempts: 1 }); ai.recover(); assert.equal(ai.job(second.id).state, 'failed');
    ai.retry(second.id); assert.equal(ai.job(second.id).state, 'queued'); ai.put({ ...ai.job(second.id), state: 'failed', attempts: 2 }); assert.throws(() => ai.retry(second.id), /한 번/);
    assert.equal(store.draft(draft.id).version, 1);
  } finally { store.db.close(); await rm(root, { recursive: true, force: true }); }
});
