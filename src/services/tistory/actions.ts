import type { TistoryProbe } from './probe.js';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { localRoot, safeUrl } from './config.js';
import type { TestDraft } from './fixture.js';

export async function run(probe: TistoryProbe, args: string[]) {
  const page = probe.requireBlog();
  switch (args[0]) {
    case 'mode-basic': {
      const handler = async (dialog: import('playwright').Dialog) => {
        if (dialog.type() === 'confirm' && dialog.message() === '작성 모드를 변경하시겠습니까?\n현재 서식이 유지되지 않을 수 있습니다.') await dialog.accept();
        else { console.log(JSON.stringify({ unexpectedDialog: dialog.message() })); await dialog.dismiss(); }
      };
      page.once('dialog', handler);
      try {
        await page.locator('#html-editor-container').getByRole('button', { name: 'HTML더보기', exact: true }).click();
        await page.getByText('기본모드', { exact: true }).filter({ visible: true }).click();
      } finally { page.off('dialog', handler); }
      await probe.inspect();
      return { saved: '.local/last-inspection.json' };
    }
    case 'publish-cancel':
      await page.locator('#unpublish-btn').click();
      return { cancelled: true };
    case 'dialog-info': return { message: probe.pendingDialog?.message(), type: probe.pendingDialog?.type() };
    case 'dismiss-dialog':
      if (probe.pendingDialog) await probe.pendingDialog.dismiss();
      probe.pendingDialog = undefined;
      return { dismissed: true };
    case 'cover-fixture':
      page.once('dialog', async dialog => { console.log(JSON.stringify({ uploadDialog: dialog.message() })); await dialog.dismiss(); });
      await page.locator('input.inp_g[type="file"]').setInputFiles(path.join(localRoot, 'fixtures/p0-image-1.png'));
      return { coverSelected: 'p0-image-1.png', next: 'inspect' };
    case 'publish-inspect':
      return {
        privateSelected: await page.locator('#open0').isChecked(),
        cover: await page.getByText('대표이미지 추가', { exact: true }).evaluate(el => el.parentElement?.outerHTML),
        fileInputs: await page.locator('input[type=file]').evaluateAll(elements => elements.map(el => ({ id: el.id, parent: el.parentElement?.outerHTML.slice(0, 1800) }))),
      };
    case 'preview-verify': {
      const frame = page.frame({ name: 'previewIframe' });
      if (!frame) throw new Error('미리보기 프레임 없음');
      await frame.waitForFunction(() => Array.from(document.images).filter(image => image.naturalWidth === 640 && image.naturalHeight === 360).length === 2);
      const result = await frame.evaluate(() => ({
        headings: Array.from(document.querySelectorAll('h2')).map(el => el.textContent),
        code: document.querySelector('pre code')?.textContent,
        tables: Array.from(document.querySelectorAll('table')).map(el => el.textContent),
        images: Array.from(document.images).map((image, index) => ({ index, width: image.naturalWidth, height: image.naturalHeight })).filter(image => image.width === 640 && image.height === 360),
      }));
      for (const [index, image] of result.images.entries()) await frame.locator('img').nth(image.index).screenshot({ path: path.join(localRoot, `preview-image-${index + 1}.png`) });
      await writeFile(path.join(localRoot, 'preview-result.json'), JSON.stringify(result, null, 2));
      return result;
    }
    case 'frames': return page.frames().map(frame => ({ name: frame.name(), url: safeUrl(frame.url()) }));
    case 'preview-close':
      await page.locator('#preview-close-btn').click();
      return { closed: true };
    case 'preview':
      await page.locator('#preview-btn').click();
      return probe.status();
    case 'publish-options':
      await page.locator('#publish-layer-btn').click();
      await probe.inspect();
      return { saved: '.local/last-inspection.json', submitted: false };
    case 'upload-fixtures':
      await page.locator('#html-editor-container #attach-image').setInputFiles([
        path.join(localRoot, 'fixtures/p0-image-1.png'),
        path.join(localRoot, 'fixtures/p0-image-2.png'),
      ]);
      return { filesSelected: 2, next: 'inspect to verify upload completion' };
    case 'fill-fixture': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      const title = page.locator('#post-title-inp');
      const oldTitle = await title.inputValue();
      const oldCode = (await page.locator('.cm-s-tistory-html .CodeMirror-line').allTextContents()).join('\n');
      if (oldTitle || oldCode.replace(/[\s\u200b]/g, '')) throw new Error('빈 새 글에서만 테스트 원고를 입력합니다. 기존 원고는 덮어쓰지 않습니다.');
      await title.fill(draft.title);
      await page.locator('.cm-s-tistory-html textarea').focus();
      await page.keyboard.insertText(draft.html);
      await title.click();
      const code = await page.locator('.cm-s-tistory-html .CodeMirror-code').innerText();
      if (!code.includes(draft.id) || !code.includes('<table>') || !code.includes('console.log')) throw new Error('HTML 입력 확인 실패');
      return { id: draft.id, title: await title.inputValue(), htmlInputVerified: true };
    }
    case 'attach-menu':
      await page.locator('#html-editor-container #attach-layer-btn').click();
      await probe.inspect();
      return { saved: '.local/last-inspection.json' };
    case 'html-inspect':
      return page.locator('textarea').evaluateAll(elements => elements.map(el => ({ html: el.parentElement?.outerHTML.slice(0, 2200), visible: el.getClientRects().length > 0 })));
    case 'mode-inspect':
      return page.getByText('HTML', { exact: true }).evaluateAll(elements => elements.map(el => ({ html: el.outerHTML.slice(0, 1600), visible: el.getClientRects().length > 0 })));
    case 'mode-html': {
      let dialogMessage: string | undefined;
      if (!await page.locator('#editor-mode-html-text').isVisible()) await page.locator('#editor-mode-layer-btn-open').click();
      const handler = async (dialog: import('playwright').Dialog) => {
        dialogMessage = dialog.message();
        if (dialog.type() === 'confirm' && dialogMessage === '작성 모드를 변경하시겠습니까?\n현재 서식이 유지되지 않을 수 있습니다.') await dialog.accept();
        else await dialog.dismiss();
      };
      page.once('dialog', handler);
      try { await page.locator('#editor-mode-html-text').click(); }
      finally { page.off('dialog', handler); }
      await probe.inspect();
      return { dialogMessage, saved: '.local/last-inspection.json' };
    }
    case 'category-select': {
      const name = args.slice(1).join(' ');
      if (!name) throw new Error('카테고리 이름이 필요합니다.');
      const option = page.getByRole('option', { name, exact: true });
      await option.click();
      return { selected: await page.locator('#category-btn').innerText() };
    }
    case 'category-menu':
      await page.locator('#category-btn').click();
      await probe.inspect();
      return { saved: '.local/last-inspection.json' };
    case 'mode-menu':
      await page.locator('#editor-mode-layer-btn-open').click();
      await probe.inspect();
      return { saved: '.local/last-inspection.json' };
    case 'categories':
      await page.getByRole('link', { name: '카테고리 관리', exact: true }).click();
      await page.waitForURL(`${probe.blog}/manage/category`);
      return { url: safeUrl(page.url()), next: 'inspect' };
    case 'session-check': {
      const browser = probe.context.browser();
      if (!browser) throw new Error('브라우저 연결 없음');
      const isolated = await browser.newContext();
      try {
        const anonymousPage = await isolated.newPage();
        await anonymousPage.goto(`${probe.blog}/manage`, { waitUntil: 'domcontentloaded' });
        await anonymousPage.waitForURL(url => url.hostname === 'www.tistory.com' && url.pathname === '/auth/login');
        const result = { at: new Date().toISOString(), scenario: 'missing-session', status: 'needs_login', url: safeUrl(anonymousPage.url()), primarySessionUntouched: true };
        await writeFile(path.join(localRoot, 'missing-session-result.json'), JSON.stringify(result, null, 2));
        return result;
      } finally { await isolated.close(); }
    }
    default: throw new Error(`에디터 동작 ${args[0] ?? '(미지정)'}은 아직 구현되지 않았습니다.`);
  }
}
