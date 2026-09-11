import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const generate = process.argv.includes('--generate');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const ids: { kind: string; draftId: string; jobId?: string }[] = [];
const resultFile = generate ? '.local/p4-test-ids.json' : '.local/p4-web-smoke-ids.json';
try {
  await page.goto('http://127.0.0.1:3000');
  const api = (action: string, values: object = {}) => page.evaluate(async ({ action, values }) => {
    const r = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tstory-Request': 'local-web' }, body: JSON.stringify({ action, ...values }) });
    const body = await r.json(); if (!r.ok) throw new Error(body.error); return body;
  }, { action, values });
  let referenceId = '';
  if (generate) {
    const ref = await api('reference-fetch', { url: 'https://docs.python.org/3/library/bisect.html' });
    assert.equal(ref.method, 'fetched'); assert.equal(ref.official, true); referenceId = ref.id;
    await api('ai-connect');
    await page.waitForFunction(async () => (await (await fetch('/api/app')).json()).ai.connection.state === 'connected', undefined, { timeout: 60000 });
  }
  for (const kind of ['technical', 'ps'] as const) {
    await page.getByRole('button', { name: '＋ 새 원고 작성' }).click();
    await page.getByLabel('글 유형', { exact: false }).selectOption(kind);
    const title = `[P4 비공개 테스트] ${kind === 'technical' ? 'bisect로 삽입 위치 찾기' : '정수 배열의 합'} ${Date.now()}`;
    await page.getByLabel('제목', { exact: true }).fill(title);
    await page.getByLabel('요약 · 작성 메모').fill(kind === 'technical' ? 'Python 입문자를 대상으로 bisect_left와 bisect_right의 차이, 중복 값 예시와 시간 복잡도를 설명한다. 공식 자료를 근거로 800자 내외로 작성하고 비교 표와 Python 코드 한 개를 포함한다. 제목의 P4 비공개 테스트 표기를 유지한다.' : '직접 만든 연습 문제이며 온라인 저지 원문이 아니다. 정수 배열 합을 순회로 계산하는 풀이를 800자 내외로 설명하고 예제 표, 정당성, 시간·공간 복잡도, Python 코드 블록 하나를 포함한다. 제목의 P4 비공개 테스트 표기를 유지한다.');
    if (kind === 'technical') {
      await page.getByLabel('기술 주제', { exact: true }).fill('Python bisect_left와 bisect_right');
      await page.getByLabel('나의 해석 · 궁금한 점').fill('탐색이 로그 시간이면 insort로 넣는 것도 항상 로그 시간인지 확인하고 싶다.');
      if (referenceId) {
        await page.locator(`[data-reference-id="${referenceId}"] input[type=checkbox]`).check();
      }
    } else {
      await page.getByLabel('문제 본문', { exact: true }).fill('첫 줄에 정수 N이 주어진다. 둘째 줄에 N개의 정수가 공백으로 구분되어 주어진다. 모든 정수의 합을 한 줄에 출력하라. 정수에는 음수와 0이 포함될 수 있다.');
      await page.getByLabel('제약 조건', { exact: true }).fill('1 <= N <= 100000, -1000000 <= 각 정수 <= 1000000. 시간 제한 1초, 메모리 제한 128MB. 입력은 항상 조건을 만족한다.');
      await page.getByLabel('검토·실행할 코드').fill('n = int(input())\na = list(map(int, input().split()))\ns = 0\nfor x in a:\n    s += x\nprint(s)');
      for (const [index, input, expected] of [[1, '3\n1 -2 3\n', '2'], [2, '1\n-1000000\n', '-1000000']] as const) {
        await page.getByRole('button', { name: '예제 추가', exact: true }).click();
        await page.getByLabel(`입력 ${index}`, { exact: true }).fill(input); await page.getByLabel(`기대 출력 ${index}`, { exact: true }).fill(expected);
        if (index === 2) await page.getByLabel('사례 2 유형').selectOption('edge');
      }
    }
    await page.getByRole('button', { name: '원고 저장', exact: true }).click();
    await page.getByText('원고를 저장했습니다.', { exact: false }).waitFor();
    const saved = await page.evaluate(async title => (await (await fetch('/api/app')).json()).drafts.find((d: any) => d.title === title), title);
    assert.ok(saved.material); const result: typeof ids[number] = { kind, draftId: saved.id }; ids.push(result);
    if (generate) {
      await page.getByRole('button', { name: kind === 'technical' ? '기술 글 초안 생성' : 'PS 해설 초안 생성', exact: true }).click();
      console.log(`${kind}: generation requested`);
      await page.getByText('생성 완료 · 검토 후 원고에 적용하세요.', { exact: true }).waitFor({ timeout: 330000 });
      const state = await page.evaluate(async () => (await fetch('/api/app')).json());
      const job = state.ai.jobs.find((j: any) => j.draft.id === saved.id); result.jobId = job.id;
      assert.equal(job.state, 'succeeded'); assert.ok(job.output.markdown.length > 100);
      if (kind === 'technical') assert.equal(job.references[0].id, referenceId);
      else assert.match(job.output.markdown, /코드는 실행하지 않았습니다/);
      await page.getByRole('button', { name: '검토한 결과를 원고에 적용', exact: true }).click();
      await page.getByRole('button', { name: 'v2에 적용됨' }).waitFor();
      await page.locator('.preview-panel pre').first().waitFor();
      await writeFile(`.local/p4-${kind}-output.json`, JSON.stringify(job.output, null, 2));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `.local/p4-${kind}-mobile.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (kind === 'ps') {
      await page.getByRole('button', { name: '저장한 Python 코드 예제 검증' }).click();
      let check;
      for (let attempt = 0; attempt < 30; attempt++) {
        check = await page.evaluate(async id => (await (await fetch('/api/app', { cache: 'no-store' })).json()).checks.find((c: any) => c.draftId === id), saved.id);
        if (check && !['queued', 'running'].includes(check.state)) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      assert.ok(check && !['queued', 'running'].includes(check.state));
      console.log(`code check: ${check.state}`);
    }
    await page.getByRole('button', { name: '나의 원고', exact: false }).click();
  }
  await writeFile(resultFile, JSON.stringify(ids, null, 2));
  console.log(JSON.stringify({ savedBothKinds: true, generated: generate, mobileOverflow: false, published: false }));
} finally { await writeFile(resultFile, JSON.stringify(ids, null, 2)); await browser.close(); }
