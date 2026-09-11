import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/lib/store';
import { aiStore } from '../src/lib/ai-store';
import { emptyMaterial, validateMaterial } from '../src/lib/material';
import { referenceStore, referenceUrl, extractReference } from '../src/services/references';
import { checkStore, codeHash, dockerArgs } from '../src/services/code-check';
import { parseOutput, prompt } from '../src/services/ai/content';

test('technical/PS inputs and source provenance survive versions and generation snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tstory-material-')); const store = openStore(root);
  try {
    const refs = referenceStore(store); const ai = aiStore(store);
    const ref = refs.paste({ title: '자료', url: 'https://docs.python.org/3/tutorial/datastructures.html', text: '직접 붙여넣은 Python 자료입니다. '.repeat(6), ...{ official: true, method: 'fetched' } });
    assert.equal(ref.official, false); assert.equal(ref.method, 'pasted');
    ai.setConnection({ state: 'connected', message: '', models: [{ id: 'test', name: 'test', images: false, isDefault: true }] });
    const base = { id: '', version: 0, title: '기술', kind: 'technical', summary: 'Python 리스트를 활용한 스택의 동작을 초보자에게 설명한다.', markdown: '', category: '테스트', images: [], cover: null };
    const draft = store.saveDraft({ ...base, material: { ...emptyMaterial(), topic: 'Python 스택', referenceIds: [ref.id] } });
    const job = ai.enqueue(draft.id, 'test', '', '');
    assert.equal(job.references?.[0].method, 'pasted'); assert.match(prompt(job), /기술 글:/);
    store.saveDraft({ ...draft, material: { ...draft.material!, referenceIds: [] } });
    assert.equal(ai.job(job.id).references?.length, 1);
    const ps = store.saveDraft({ ...base, kind: 'ps', material: { ...emptyMaterial(), problem: '정수 N개를 입력받고 그 합을 출력하는 문제입니다.', constraints: '1 <= N <= 100', code: 'print(1)', cases: [{ input: '', expected: '1', kind: 'edge' }] } });
    const psJob = ai.enqueue(ps.id, 'test', '', ''); assert.match(prompt(psJob), /정당성 증명/);
    const output = parseOutput(JSON.stringify({ title: '합', markdown: '해설 본문', outline: [], captions: [], warnings: [] }), psJob);
    assert.match(output.markdown, /코드는 실행하지 않았습니다/);
    assert.equal(parseOutput(JSON.stringify(output), psJob).markdown, output.markdown);
    const checks = checkStore(store); const check = checks.enqueue(ps); checks.put({ ...check, state: 'running' }); checks.recover(); assert.equal(checks.list()[0].state, 'failed');
    assert.notEqual(check.hash, codeHash('print(2)', ps.material!.cases));
    assert.equal(store.jobs().length, 0);
    assert.throws(() => ai.enqueue(store.saveDraft({ ...base, kind: 'ps' }).id, 'test', '', ''), /제약 조건/);
    assert.throws(() => validateMaterial({ ...emptyMaterial(), cases: Array(6).fill({}) }), /최대 5/);
  } finally { store.db.close(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, { recursive: true, force: true }); }
});

test('reference fetching allows exact approved hosts; extraction excludes navigation; execution has no host mounts', () => {
  for (const url of ['http://docs.python.org/x', 'https://localhost/x', 'https://docs.python.org.evil.test/x', 'https://user:pass@docs.python.org/x', 'https://docs.python.org:8080/x']) assert.throws(() => referenceUrl(url, true));
  assert.equal(referenceUrl('https://docs.python.org/3/#test', true).hash, '');
  const source = extractReference(`<title>공식 문서</title><nav>remove navigation</nav><main><p>${'본문 자료 '.repeat(20)}</p><pre>print(1)\nprint(2)</pre></main>`);
  assert.ok(!source.text.includes('navigation')); assert.match(source.text, /print\(1\)\nprint\(2\)/);
  assert.throws(() => extractReference('<body>login</body>'), /본문/);
  const args = dockerArgs('tstory-check-test');
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--pull=never', '--memory=128m', '--user=65534:65534']) assert.ok(args.includes(flag));
  assert.ok(!args.some(a => a === '-v' || a.startsWith('--mount')));
});
