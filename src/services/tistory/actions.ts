import type { TistoryProbe } from './probe.js';
import { writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { localRoot, safeUrl } from './config.js';
import type { TestDraft } from './fixture.js';

export async function run(probe: TistoryProbe, args: string[]) {
  const page = probe.requireBlog();
  switch (args[0]) {
    case 'post-list':
      await page.getByRole('link', { name: '글 관리', exact: true }).click();
      await page.getByRole('link', { name: '글 쓰기', exact: true }).waitFor();
      return { url: safeUrl(page.url()) };
    case 'open-edit': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      const record = JSON.parse(await readFile(path.join(localRoot, `publication-${draft.id}.json`), 'utf8'));
      if (!record.editUrl || new URL(record.editUrl).origin !== probe.blog) throw new Error('확인된 수정 URL이 없습니다.');
      await page.goto(record.editUrl, { waitUntil: 'domcontentloaded' });
      await page.locator('#post-title-inp').waitFor();
      return { postId: record.postId, title: await page.locator('#post-title-inp').inputValue() };
    }
    case 'anonymous-check': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      const record = JSON.parse(await readFile(path.join(localRoot, `publication-${draft.id}.json`), 'utf8'));
      const browser = probe.context.browser();
      if (!browser) throw new Error('브라우저 연결 없음');
      const anonymous = await browser.newContext();
      try {
        const anonymousPage = await anonymous.newPage();
        await anonymousPage.goto(record.url, { waitUntil: 'domcontentloaded' });
        const result = { url: safeUrl(anonymousPage.url()), title: await anonymousPage.title(), text: (await anonymousPage.locator('body').innerText()).slice(0, 700) };
        await writeFile(path.join(localRoot, 'anonymous-post-result.json'), JSON.stringify(result, null, 2));
        return result;
      } finally { await anonymous.close(); }
    }
    case 'back-to-manager':
      if (probe.context.pages().length < 2 || new URL(page.url()).pathname.startsWith('/manage')) throw new Error('글 보기 탭에서만 실행하세요.');
      await page.close();
      return probe.status();
    case 'verify-saved': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      const journal = path.join(localRoot, `publication-${draft.id}.json`);
      const record = JSON.parse(await readFile(journal, 'utf8'));
      if (page.url() !== record.url) throw new Error('저장된 글 페이지에서 실행하세요.');
      await page.waitForFunction(() => Array.from(document.images).filter(image => image.naturalWidth === 640 && image.naturalHeight === 360).length === 2);
      const checks = await page.evaluate(expected => ({
        title: Array.from(document.querySelectorAll('h1,h2')).some(el => el.textContent?.trim() === expected.title),
        paragraph: document.body.innerText.includes(expected.id) && document.body.innerText.includes('특수문자 & < >'),
        list: Array.from(document.querySelectorAll('li')).some(el => el.textContent?.trim() === '첫 번째 항목'),
        code: Array.from(document.querySelectorAll('pre')).some(el => el.textContent?.includes('function sum(a, b) {\n  return a + b;\n}\nconsole.log(sum(2, 3)); // 5')),
        table: Array.from(document.querySelectorAll('table')).some(el => el.textContent?.replace(/\s/g, '') === '항목기대값이미지2장공개범위비공개'),
        imageIndexes: Array.from(document.images).map((image, index) => ({ index, width: image.naturalWidth, height: image.naturalHeight })).filter(image => image.width === 640 && image.height === 360).map(image => image.index),
        cover: document.querySelector('meta[property="og:image"]')?.getAttribute('content') || (document.querySelector('.article-header') as HTMLElement)?.style.backgroundImage,
        firstImage: Array.from(document.images).find(image => image.naturalWidth === 640 && image.naturalHeight === 360)?.src,
      }), { title: draft.title, id: draft.id });
      const coverMatchesFirst = !!checks.cover && !!checks.firstImage && decodeURIComponent(checks.cover).includes(new URL(checks.firstImage).pathname);
      const verified = { title: checks.title, paragraph: checks.paragraph, list: checks.list, code: checks.code, table: checks.table, images: checks.imageIndexes.length === 2, coverMatchesFirst };
      for (const [index, imageIndex] of checks.imageIndexes.entries()) await page.locator('img').nth(imageIndex).screenshot({ path: path.join(localRoot, `saved-image-${index + 1}.png`) });
      await page.screenshot({ path: path.join(localRoot, 'saved-post.png'), fullPage: true });
      const result = { ...record, status: Object.values(verified).every(Boolean) ? 'verified' : 'needs_attention', checks: verified, verifiedAt: new Date().toISOString() };
      await writeFile(journal, JSON.stringify(result, null, 2));
      return { postId: record.postId, status: result.status, checks: verified, screenshots: '.local/saved-post.png and saved-image-{1,2}.png' };
    }
    case 'open-saved': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      const journal = path.join(localRoot, `publication-${draft.id}.json`);
      const record = JSON.parse(await readFile(journal, 'utf8'));
      const link = page.getByRole('link', { name: draft.title, exact: true });
      await link.waitFor();
      if (await link.count() !== 1) throw new Error('저장된 글을 유일하게 식별할 수 없습니다.');
      const row = page.locator('li').filter({ has: link });
      if ((await row.locator('.txt_cate').innerText()) !== record.category || !await row.locator('.ico_private').isVisible()) throw new Error('저장된 글의 카테고리·비공개 표시 확인 실패');
      const url = await link.getAttribute('href');
      const editHref = await row.getByRole('link', { name: '수정', exact: true, includeHidden: true }).getAttribute('href');
      if (!url || !editHref || new URL(url).origin !== probe.blog) throw new Error('저장 결과 URL 확인 실패');
      const result = { ...record, status: 'saved-metadata-verified', url, editUrl: new URL(editHref, probe.blog).href, postId: new URL(editHref, probe.blog).pathname.split('/').at(-1), metadataVerifiedAt: new Date().toISOString() };
      await writeFile(journal, JSON.stringify(result, null, 2));
      const [postPage] = await Promise.all([probe.context.waitForEvent('page'), link.click()]);
      await postPage.waitForLoadState('domcontentloaded');
      return { postId: result.postId, url, privateVerified: true, category: record.category };
    }
    case 'save-private': {
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      if (!/^P0-[0-9TZ-]+$/.test(draft.id)) throw new Error('잘못된 테스트 원고 ID');
      const category = args.slice(1).join(' ');
      if (!category || (await page.locator('#category-btn').innerText()).split('\n')[0] !== category) throw new Error('지정한 카테고리와 화면이 다릅니다.');
      if (await page.locator('#post-title-inp').inputValue() !== draft.title) throw new Error('테스트 원고 제목 불일치');
      if (draft.visibility !== 'private' || !await page.locator('#open0').isChecked() || (await page.locator('#publish-btn').innerText()).trim() !== '비공개 저장') throw new Error('비공개 설정 확인 실패');
      const body = page.frameLocator('#editor-tistory_ifr').locator('#tinymce');
      if (await body.locator('img').count() !== 2 || await body.locator('table').count() !== 1 || !(await body.innerText()).includes(draft.id)) throw new Error('원고 내용 확인 실패');
      if (await page.locator('.inner_box .thumb_g').count() !== 1) throw new Error('대표 이미지가 없습니다.');
      const firstImage = await body.locator('img').nth(0).getAttribute('src');
      const coverStyle = await page.locator('.inner_box .thumb_g').getAttribute('style');
      if (!firstImage || !coverStyle || !decodeURIComponent(coverStyle).includes(new URL(firstImage).pathname)) throw new Error('첫 이미지와 대표 이미지 일치 확인 실패');
      const journal = path.join(localRoot, `publication-${draft.id}.json`);
      const record = { id: draft.id, title: draft.title, blog: probe.blog, category, visibility: 'private', status: 'unknown', attemptedAt: new Date().toISOString() };
      // Exclusive creation prevents a second submit after a timeout or restart.
      await writeFile(journal, JSON.stringify(record, null, 2), { flag: 'wx' });
      try {
        await page.locator('#publish-btn').click();
        await page.waitForURL(url => url.origin === probe.blog && !url.pathname.startsWith('/manage/newpost'), { timeout: 30_000 });
        const result = { ...record, status: 'submitted-awaiting-verification', resultUrl: safeUrl(page.url()) };
        await writeFile(journal, JSON.stringify(result, null, 2));
        await probe.inspect();
        return result;
      } catch {
        throw new Error('저장 결과 확인이 필요합니다. 같은 원고를 다시 저장하지 말고 관리 목록을 확인하세요.');
      }
    }
    case 'cover-state':
      return {
        images: await page.frameLocator('#editor-tistory_ifr').locator('figure[data-ke-type="image"]').evaluateAll(elements => elements.map(el => Array.from(el.attributes).filter(attribute => /represent|class/.test(attribute.name)).map(attribute => ({ name: attribute.name, value: attribute.value })))),
        cover: await page.locator('.inner_box').evaluateAll(elements => elements.map(el => ({ class: el.className, html: el.innerHTML.replace(/https?:[^"\s)]+/g, '[image-url]').slice(0, 700) }))),
        privateSelected: await page.locator('#open0').isChecked(),
      };
    case 'representative-select':
      await page.locator('.mce-represent-image-btn').click();
      return { representativeControl: await page.locator('.mce-represent-image-btn').getAttribute('class') };
    case 'body-inspect': {
      const body = page.frameLocator('#editor-tistory_ifr').locator('#tinymce');
      await writeFile(path.join(localRoot, 'editor-body.html'), await body.innerHTML(), 'utf8');
      return body.evaluate(el => ({
        text: el.textContent,
        images: Array.from(el.querySelectorAll('img')).map(image => ({ alt: image.alt, width: image.naturalWidth, height: image.naturalHeight, parentTag: image.parentElement?.tagName, parentClass: image.parentElement?.className, parentRole: image.parentElement?.getAttribute('data-ke-type') })),
        code: el.querySelector('pre code')?.textContent,
        table: el.querySelector('table')?.textContent,
      }));
    }
    case 'image-one-select':
      await page.frameLocator('#editor-tistory_ifr').locator('#tinymce img').nth(0).click();
      await probe.inspect();
      return { saved: '.local/last-inspection.json' };
    case 'restore-fixture': {
      const dialog = probe.pendingDialog;
      if (!dialog || dialog.type() !== 'confirm' || !/^\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}:\d{2}에 저장된 글이 있습니다\.\n이어서 작성하시겠습니까\?$/.test(dialog.message())) throw new Error('자동 저장 복구 확인창이 아닙니다.');
      await dialog.accept();
      probe.pendingDialog = undefined;
      const draft: TestDraft = JSON.parse(await readFile(path.join(localRoot, 'fixtures/draft.json'), 'utf8'));
      await page.waitForFunction(title => (document.querySelector('#post-title-inp') as HTMLTextAreaElement)?.value === title, draft.title);
      await probe.inspect();
      return { recoveredTitle: draft.title, saved: '.local/last-inspection.json' };
    }
    case 'mode-basic': {
      const handler = async (dialog: import('playwright').Dialog) => {
        if (dialog.type() === 'confirm' && dialog.message() === '작성 모드를 변경하시겠습니까?\n현재 서식이 유지되지 않을 수 있습니다.') await dialog.accept();
        else { console.log(JSON.stringify({ unexpectedDialog: dialog.message() })); await dialog.dismiss(); }
      };
      page.once('dialog', handler);
      try {
        await page.locator('#html-editor-container button').filter({ hasText: /^HTML/ }).click();
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
      if (await access(path.join(localRoot, `publication-${draft.id}.json`)).then(() => true, () => false)) throw new Error('이미 저장을 시도한 원고입니다. 관리 목록에서 기존 글을 확인하세요.');
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
