import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { aiStore } from '../src/lib/ai-store';
import { styleStore } from '../src/lib/style-store';
import { withBlocks } from '../src/lib/blocks';
import { emptyWriting, outlineItems, outlineToken, outlineReviewed, seedOutline } from '../src/lib/writing';
import { emptyMaterial } from '../src/lib/material';
import { kindNames, type Draft } from '../src/lib/model';
import { parseOutput, prompt } from '../src/services/ai/content';
import { renderDraft } from '../src/lib/content';
import { createBackup, restoreBackup } from '../src/lib/backup';
import { referenceUrl } from '../src/services/references';

const base = (kind: Draft['kind']): Draft => withBlocks({ id: '', version: 0, title: '합성 검사', kind, summary: '실제 방문이나 측정 사실이 아닌 합성 자료로 편집 흐름을 검증하는 글입니다.', material: { ...emptyMaterial(), topic: '합성 정보', problem: '정수 두 개를 입력받아 더한 결과를 출력하는 문제입니다.', constraints: '0~100', language: 'Python' }, writing: { ...emptyWriting(), place: '가상의 공원', audience: '합성 안내문 독자', scope: '제공된 안내문 비교' }, markdown: '', category: '테스트', images: [], cover: null, updatedAt: '' }, [{ id: 'first', type: 'text', markdown: '같은 문장', locked: true }, { id: 'second', type: 'text', markdown: '같은 문장' }]);
const reviewed = (draft: Draft) => { const value = { ...draft, outline: outlineItems(draft) }; return { ...value, reviewedOutline: outlineToken(value) }; };
const connect = (ai: ReturnType<typeof aiStore>) => ai.setConnection({ state: 'connected', message: '', models: [{ id: 'test', name: 'test', images: true, isDefault: true }] });

test('six kinds retain old versions, review freshness, locks and private metadata through generation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-writing-')); const store = openStore(root); const ai = aiStore(store); connect(ai);
  try {
    for (const kind of Object.keys(kindNames) as Draft['kind'][]) {
      const draft = store.saveDraft(reviewed(base(kind))); const raw = store.db.prepare('SELECT body FROM draft_versions WHERE id=? AND version=1').get(draft.id)!.body;
      assert.ok(outlineReviewed(draft)); assert.equal(outlineReviewed({ ...draft, summary: 'changed' }), false);
      assert.deepEqual(seedOutline(draft).blocks, draft.blocks);
      const job = ai.enqueue(draft.id, 'test', '', '');
      const output = parseOutput(JSON.stringify({ title: '새 합성 제목', outline: ['구성'], markdown: '새 본문', warnings: [], captions: [], blocks: [{ id: 'first', markdown: '잠금 변경 시도' }, { id: 'second', markdown: '새 본문' }] }), job);
      ai.put({ ...job, state: 'running' }); ai.finish(job.id, output); const saved = ai.apply(job.id);
      assert.deepEqual(saved.blocks![0], draft.blocks![0]); assert.match(saved.markdown, /새 본문/); assert.equal(saved.version, 2);
      assert.equal(store.db.prepare('SELECT body FROM draft_versions WHERE id=? AND version=1').get(draft.id)!.body, raw);
      assert.equal(outlineReviewed(saved), false); assert.doesNotMatch(renderDraft(saved), /가상의 공원/);
      if (['travel', 'information', 'free'].includes(kind)) assert.throws(() => ai.enqueue(draft.id, 'test', '', ''), /개요/);
      if (kind === 'travel') { assert.match(prompt(job), /방문일, 가격, 가게 이름, 감정/); assert.doesNotMatch(prompt(job), /정수 두 개를 입력받아/); }
      if (kind === 'information') assert.match(prompt(job), /주장 바로 옆/);
      assert.throws(() => ai.enqueue(draft.id, 'test', '', '쉽게', '', 'first'), /잠기지/);
      const rewrite = ai.enqueue(draft.id, 'test', '', '쉽게', '', 'second');
      ai.put({ ...rewrite, state: 'running' }); ai.finish(rewrite.id, parseOutput(JSON.stringify({ markdown: '바꾼 한 블록 $&', warnings: [] }), rewrite));
      const edited = ai.apply(rewrite.id); assert.deepEqual(edited.blocks![0], saved.blocks![0]); assert.equal(edited.blocks![1].type === 'text' && edited.blocks![1].markdown, '바꾼 한 블록 $&');
      const partial = ai.enqueue(draft.id, 'test', '바꾼 한 블록 $&', '부분만 수정');
      ai.put({ ...partial, state: 'running' }); ai.finish(partial.id, parseOutput(JSON.stringify({ title: edited.title, outline: [], markdown: '부분 교체 결과', captions: [], warnings: [] }), partial));
      const selected = ai.apply(partial.id); assert.equal(selected.blocks![1].type === 'text' && selected.blocks![1].markdown, '부분 교체 결과'); assert.deepEqual(selected.blocks![0], draft.blocks![0]);
    }
    assert.equal(store.jobs().length, 0);
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test('ID rewrite handles repeated text, fifty photos, stale results, and immutable captions/notes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-target-')); const store = openStore(root); const ai = aiStore(store); connect(ai);
  try {
    const photos = Array.from({ length: 50 }, (_, index) => ({ id: `photo-${index}`, type: 'image' as const, imageId: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, note: '개인 메모', caption: '캡션', group: '묶음', description: '같은 문장' }));
    for (const photo of photos) store.addAsset({ id: photo.imageId, name: 'synthetic', mime: 'image/png', size: 1, library: false });
    const draft = store.saveDraft(reviewed(withBlocks(base('travel'), [...base('travel').blocks!, ...photos])));
    assert.throws(() => ai.enqueue(draft.id, 'test', '', ''), /10장/);
    const job = ai.enqueue(draft.id, 'test', '', '두 문장으로', '', 'photo-23'); ai.put({ ...job, state: 'running' });
    ai.finish(job.id, parseOutput(JSON.stringify({ markdown: '선택한 사진 설명', warnings: [] }), job)); const saved = ai.apply(job.id);
    for (const [index, block] of saved.blocks!.entries()) assert.deepEqual(block, block.id === 'photo-23' ? { ...draft.blocks![index], description: '선택한 사진 설명' } : draft.blocks![index]);
    const next = ai.enqueue(saved.id, 'test', '', '줄이기', '', 'second'); ai.put({ ...next, state: 'running' }); ai.finish(next.id, parseOutput(JSON.stringify({ markdown: '늦은 결과', warnings: [] }), next));
    store.saveDraft({ ...saved, summary: '사용자가 고친 메모' }); assert.throws(() => ai.apply(next.id), /수정되었습니다/);
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test('blog-kind style defaults and overrides survive backup; other blog and technical examples stay separate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-default-style-')); const store = openStore(path.join(root, 'data')); const styles = styleStore(store); const ai = aiStore(store); connect(ai);
  try {
    store.setSettings({ blog: 'https://example.tistory.com', categories: ['테스트'], connection: '미확인' });
    const source = styles.saveSource({ title: '합성 여행 대표 글', body: '이는 실제 방문 경험이 아닌 합성 문체 검사 자료입니다. 짧은 문장과 사진 설명을 사용합니다. '.repeat(3), kind: 'travel', url: '' });
    const job = styles.enqueue([source.id], 'test', '여행 문체', 'travel'); styles.put({ ...job, state: 'running' }); styles.finish(job.id, { rules: '짧은 문장과 구체적인 사진 설명을 사용하고 사실이 아닌 경험을 추가하지 않습니다.', observations: [], warnings: ['합성 예시'] });
    const profile = styles.saveProfile({ version: 0, jobId: job.id, name: '여행 문체', kind: 'travel', rules: styles.job(job.id).output!.rules });
    styles.setDefault('travel', profile.id); assert.throws(() => styles.setDefault('information', profile.id), /유형/);
    let draft = store.saveDraft(reviewed({ ...base('travel'), styleProfileId: '@blog' })); const generated = ai.enqueue(draft.id, 'test', '', ''); assert.equal(generated.style?.id, profile.id); ai.cancel(generated.id);
    draft = store.saveDraft({ ...draft, styleProfileId: 'none' }); const plain = ai.enqueue(draft.id, 'test', '', ''); assert.equal(plain.style, undefined); ai.cancel(plain.id);
    const backup = await createBackup(store.root, path.join(root, 'backups')); await restoreBackup(backup.directory, path.join(root, 'restored'), path.join(root, 'safety'));
    const restored = openStore(path.join(root, 'restored')); try { assert.equal(styleStore(restored).defaults().travel, profile.id); assert.deepEqual(restored.draft(draft.id), draft); } finally { restored.db.close(); }
    store.setSettings({ blog: 'https://another.tistory.com', categories: [], connection: '미확인' }); assert.deepEqual(styles.defaults(), {});
    assert.equal(referenceUrl('https://korean.visitkorea.or.kr/detail', true).hostname, 'korean.visitkorea.or.kr');
    for (const url of ['https://korean.visitkorea.or.kr.evil.test', 'https://127.0.0.1', 'https://www.korea.kr:8080/a']) assert.throws(() => referenceUrl(url, true));
  } finally { store.db.close(); assert.ok(root.startsWith(os.tmpdir())); await rm(root, { recursive: true, force: true }); }
});
