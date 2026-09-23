import type { Job } from '../../lib/model';
import { renderMarkdown, renderDraft } from '../../lib/content';
import { imageBlocks } from '../../lib/blocks';
import { load } from 'cheerio';
import { assetPath } from '../../lib/assets';
import { TistoryProbe } from './probe';
import type { Dialog, Page } from 'playwright';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { normalizePostUrl } from './url';

async function editorHtml(page: Page) {
  await page.locator('.cm-s-tistory-html .CodeMirror-line').first().waitFor();
  return page.locator('.cm-s-tistory-html.CodeMirror').evaluate(el => (el as HTMLElement & { CodeMirror: { getValue(): string } }).CodeMirror.getValue());
}

export class LoginRequired extends Error {}
export class AttentionRequired extends Error {}
const modeMessage = '작성 모드를 변경하시겠습니까?\n현재 서식이 유지되지 않을 수 있습니다.';
export class Publisher {
  probe?: TistoryProbe;
  private verificationPage?: Page;
  private unexpectedDialog = false;
  async connect(blog: string) {
    if (this.probe && (this.probe.blog !== blog || !this.probe.context.pages().some(page => !page.isClosed()))) await this.close();
    if (!this.probe) {
      const probe = new TistoryProbe(blog); this.probe = probe;
      try { await probe.start(); } catch (error) { await this.close(); throw error; }
      const watch = (page: Page) => page.on('dialog', async (dialog: Dialog) => {
        // Accept only the observed mode-conversion and autosave-read prompts.
        if (dialog.type() === 'confirm' && dialog.message() === modeMessage) await dialog.accept();
        // Load the autosaved draft for inspection; publish() still refuses any nonempty draft.
        else if (dialog.type() === 'confirm' && /^\d{4}\. \d{1,2}\. \d{1,2}\. \d{1,2}:\d{2}에 저장된 글이 있습니다\.\n이어서 작성하시겠습니까\?$/.test(dialog.message())) await dialog.accept();
        else { this.unexpectedDialog = true; await writeFile(path.join(probe.stateRoot, 'last-dialog.json'), JSON.stringify({ type: dialog.type(), message: dialog.message() })); await dialog.dismiss(); }
        probe.pendingDialog = undefined;
      });
      probe.context.pages().forEach(watch); probe.context.on('page', watch);
    }
    const probe = this.probe; let page = probe.page();
    if (new URL(page.url()).origin !== blog) throw new LoginRequired('열린 Chrome에서 티스토리에 로그인한 뒤 재개를 눌러주세요.');
    await page.goto(`${blog}/manage`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin !== blog || !await page.locator('a.link_write[href="/manage/post"]').isVisible()) throw new LoginRequired('열린 Chrome에서 로그인한 뒤 재개를 눌러주세요.');
    await probe.checkpoint(); this.unexpectedDialog = false; return probe;
  }
  private assertDialog() { if (this.unexpectedDialog) throw new AttentionRequired('예상하지 못한 확인창이 나타났습니다. 전용 Chrome에서 확인하세요. 자동 저장 원고가 있다면 먼저 직접 정리해주세요.'); }
  async categories(blog: string) {
    const probe = await this.connect(blog); await probe.editor(); this.assertDialog();
    const page = probe.page(); await page.locator('#post-title-inp').waitFor(); this.assertDialog();
    await page.locator('#category-btn').click();
    const names = await page.getByRole('option').allTextContents();
    await page.locator('#category-btn').click();
    if (!names.length) throw new AttentionRequired('카테고리 목록을 찾지 못했습니다.');
    await probe.persistIfAuthenticated(); return names.map(name => name.trim());
  }
  async publish(job: Job, step: (value: string, postUrl?: string, imagePaths?: string[]) => void) {
    if (job.snapshot.postUrl || job.snapshot.candidatePostUrl || job.result || job.kind === 'verify') throw new AttentionRequired('저장 결과가 있는 작업은 새 글을 만들 수 없습니다. 기존 글을 재확인하세요.');
    const draft = job.snapshot.draft; if (!draft) throw new Error('발행 원고가 없습니다.');
    const marker = (id: string) => `R2PHOTO-${id}`;
    const inputHtml = draft.schemaVersion === 2 ? renderDraft(draft, block => `<p>${marker(block.id)}</p>`) : renderMarkdown(draft.markdown);
    const probe = await this.connect(job.snapshot.blog); const page = probe.page();
    step('원고 입력'); await probe.editor(); await page.locator('#post-title-inp').waitFor(); this.assertDialog();
    if (!await page.locator('#editor-mode-html-text').isVisible()) await page.locator('#editor-mode-layer-btn-open').click();
    await page.locator('#editor-mode-html-text').click(); this.assertDialog();
    await page.locator('.cm-s-tistory-html .CodeMirror-line').first().waitFor();
    const oldCode = await editorHtml(page);
    const oldTitle = await page.locator('#post-title-inp').inputValue();
    const empty = !oldTitle && !oldCode.replace(/<p data-ke-size="size16"><\/p>/g, '').replace(/[\s\u200b]/g, '');
    // A interrupted upload may leave only this exact draft's HTML. Refuse images,
    // different titles, or any text edit rather than replacing another draft.
    const sameUnuploadedDraft = oldTitle === draft.title && await page.evaluate(({ html, expected }) => new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s/g, '') === new DOMParser().parseFromString(expected, 'text/html').body.textContent?.replace(/\s/g, '') && !/\[##|<img/i.test(html), { html: oldCode, expected: inputHtml });
    if (!empty && !sameUnuploadedDraft) throw new AttentionRequired('편집기에 다른 원고나 첨부 사진이 있어 중단했습니다. 직접 확인해주세요.');
    await page.locator('#post-title-inp').fill(draft.title);
    await page.locator('.cm-s-tistory-html textarea').focus();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(inputHtml + '\n<p><br></p>');
    await page.locator('#post-title-inp').click();
    await page.locator('#html-editor-container button').filter({ hasText: /^HTML/ }).click();
    await page.getByText('기본모드', { exact: true }).filter({ visible: true }).click(); this.assertDialog();
    const body = page.frameLocator('#editor-tistory_ifr').locator('#tinymce');
    await body.waitFor();
    for (const [index, image] of draft.images.entries()) {
      step(`사진 첨부 ${index + 1}/${draft.images.length}`);
      await body.press('ControlOrMeta+End');
      await page.getByRole('button', { name: '첨부', exact: true }).click();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('사진', { exact: true }).click()]);
      await chooser.setFiles(assetPath(image.id));
      const frame = page.frame({ name: 'editor-tistory_ifr' });
      if (!frame) throw new AttentionRequired('본문 편집기를 찾지 못했습니다.');
      await frame.waitForFunction(count => document.querySelectorAll('#tinymce img').length === count && Array.from(document.querySelectorAll<HTMLImageElement>('#tinymce img')).every(image => image.complete && image.naturalWidth > 0), index+1, { timeout: 30_000 });
    }
    step('사진·설명 확인');
    if (draft.images.length) {
      await body.locator('img').last().waitFor();
      await page.frame({ name: 'editor-tistory_ifr' })?.waitForFunction(count => document.querySelectorAll('#tinymce img').length === count, draft.images.length);
      if (await body.locator('img').count() !== draft.images.length) throw new AttentionRequired('첨부한 사진 수가 원고와 다릅니다.');
      // Captions use the editor's native image caption fields, preserving uploaded image markup.
      for (const [index, image] of draft.images.entries()) {
        if (!image.caption) continue;
        await body.locator('img').nth(index).click();
        const caption = body.locator('figure[data-ke-type="image"]').nth(index).locator('figcaption');
        if (!await caption.count()) throw new AttentionRequired('사진 설명 입력란을 찾지 못했습니다.');
        await caption.fill(image.caption);
      }
      if (draft.schemaVersion === 2) {
        const moved = await body.evaluate((root, markers) => {
          const figures = Array.from(root.querySelectorAll('figure[data-ke-type="image"]'));
          if (figures.length !== markers.length) return false;
          const anchors = markers.map(text => Array.from(root.querySelectorAll('p')).filter(p => p.textContent === text));
          if (anchors.some(matches => matches.length !== 1)) return false;
          anchors.forEach((matches, index) => matches[0].replaceWith(figures[index]));
          root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
          return !root.textContent?.includes('R2PHOTO-');
        }, imageBlocks(draft).map(block => marker(block.id)));
        if (!moved) throw new AttentionRequired('본문 사이 사진 배치를 확인하지 못했습니다. 발행하지 않았습니다.');
      }
      const coverIndex = draft.images.findIndex(image => image.id === draft.cover);
      if (coverIndex >= 0) { await body.locator('img').nth(coverIndex).click(); const control = page.locator('.mce-represent-image-btn'); if (!(await control.getAttribute('class'))?.split(' ').includes('active')) await control.click(); }
    }
    step('비공개 설정 확인');
    await page.locator('#category-btn').click(); await page.getByRole('option', { name: draft.category, exact: true }).click();
    // Save expected editor text after Tistory's mode normalization, before submitting.
    const expectedText = (await body.innerText()).replace(/\s/g, '');
    const expectedImages = await body.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    job.snapshot.imagePaths = expectedImages.map(src => new URL(src).pathname);
    step('사진·순서 기록', undefined, job.snapshot.imagePaths);
    if (!expectedText) throw new AttentionRequired('본문이 비어 있습니다.');
    if (draft.schemaVersion === 2) {
      const expected = load(renderDraft(draft));
      const actual = load(await body.innerHTML());
      if (publicationSequence(actual.root().html() || '') !== publicationSequence(expected.root().html() || '')) throw new AttentionRequired('사진·문단 순서가 원고와 다릅니다. 저장하지 않았습니다.');
    }
    await page.locator('#publish-layer-btn').click();
    await page.locator('#open0').check();
    if (!await page.locator('#open0').isChecked() || (await page.locator('#publish-btn').innerText()).trim() !== '비공개 저장') throw new AttentionRequired('비공개 설정을 확인할 수 없습니다.');
    if ((await page.locator('#category-btn').innerText()).split('\n')[0] !== draft.category || await page.locator('#post-title-inp').inputValue() !== draft.title) throw new AttentionRequired('제목 또는 카테고리가 원고와 다릅니다.');
    if (draft.cover) {
      const cover = await page.locator('.inner_box .thumb_g').getAttribute('style');
      const selected = expectedImages[draft.images.findIndex(image => image.id === draft.cover)];
      if (!cover || !selected || !decodeURIComponent(cover).includes(new URL(selected).pathname)) throw new AttentionRequired('대표 이미지 확인에 실패했습니다.');
    }
    this.assertDialog(); step('저장 요청'); // durable boundary BEFORE external side effect
    await page.locator('#publish-btn').click();
    await page.waitForURL(url => url.origin === job.snapshot.blog && !url.pathname.startsWith('/manage/newpost'), { timeout: 30_000 });
    step('결과 확인');
    const link = page.getByRole('link', { name: draft.title, exact: true }); await link.waitFor();
    if (await link.count() !== 1) throw new AttentionRequired('같은 제목의 글이 있어 저장 결과를 식별할 수 없습니다.');
    const row = page.locator('li').filter({ has: link });
    if ((await row.locator('.txt_cate').innerText()) !== draft.category || !await row.locator('.ico_private').isVisible()) throw new AttentionRequired('저장된 글의 비공개·카테고리 확인에 실패했습니다.');
    const href = await link.getAttribute('href'); const edit = await row.getByRole('link', { name: '수정', exact: true, includeHidden: true }).getAttribute('href');
    if (!href || !edit || new URL(href, job.snapshot.blog).origin !== job.snapshot.blog || new URL(edit, job.snapshot.blog).origin !== job.snapshot.blog) throw new AttentionRequired('저장된 글 주소 확인 실패');
    const editUrl = new URL(edit, job.snapshot.blog); if (!/\/manage\/post\/\d+$/.test(editUrl.pathname)) throw new AttentionRequired('글 ID 확인 실패');
    const postUrl = new URL(href, job.snapshot.blog).href;
    step('결과 확인', postUrl);
    await page.goto(editUrl.href, { waitUntil: 'domcontentloaded' }); await page.locator('#post-title-inp').waitFor(); this.assertDialog();
    const savedBody = page.frameLocator('#editor-tistory_ifr').locator('#tinymce');
    if (await page.locator('#post-title-inp').inputValue() !== draft.title || (await savedBody.innerText()).replace(/\s/g, '') !== expectedText) throw new AttentionRequired('다시 연 원고의 본문이 전송 전과 다릅니다.');
    const savedImages = await savedBody.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    if (savedImages.length !== expectedImages.length || savedImages.some((src, index) => new URL(src).pathname !== new URL(expectedImages[index]).pathname)) throw new AttentionRequired('저장 후 사진 순서 검증 실패');
    await probe.persistIfAuthenticated();
    return this.verify({ ...job, snapshot: { ...job.snapshot, postUrl } });
  }
  async verify(job: Job) {
    const { blog, draft } = job.snapshot;
    if (!draft) throw new AttentionRequired('재확인할 원고가 없습니다.');
    const postUrl = normalizePostUrl(job.snapshot.postUrl || job.result || job.snapshot.candidatePostUrl || '', blog);
    const probe = this.probe?.blog === blog ? this.probe : await this.connect(blog);
    // Read-only checks use a separate tab: an editor's beforeunload prompt must
    // not discard a potentially edited draft just to inspect the saved post.
    // The next publication can reuse the last tab through probe.page(). Never
    // navigate that tab away once it has become an editor, even after a save.
    const verificationIsEditor = this.verificationPage && !this.verificationPage.isClosed() && /^\/manage\/(?:post(?:\/|$)|newpost)/.test(new URL(this.verificationPage.url()).pathname);
    if (!this.verificationPage || this.verificationPage.isClosed() || verificationIsEditor) this.verificationPage = await probe.context.newPage();
    const page = this.verificationPage;
    await page.goto(`${blog}/manage/posts`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).origin !== blog) throw new LoginRequired('전용 Chrome에서 티스토리에 로그인한 뒤 재개하세요.');
    await page.locator('a.link_write[href="/manage/post"]').waitFor();
    await probe.persistIfAuthenticated();
    // Match both the saved address and immutable draft, not merely a shared title.
    const visited = new Set<string>(); const pending = [`${blog}/manage/posts`]; let matched = false;
    while (pending.length && visited.size < 20) {
      const listUrl = pending.shift()!; if (visited.has(listUrl)) continue;
      visited.add(listUrl);
      if (page.url() !== listUrl) await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).origin !== blog) throw new LoginRequired('전용 Chrome에서 로그인한 뒤 재확인하세요.');
      await page.locator('.txt_cate').first().waitFor({ timeout: 5000 }).catch(() => {});
      const links = page.getByRole('link', { name: draft.title, exact: true });
      const matching: number[] = [];
      for (let index = 0; index < await links.count(); index++) {
        const href = await links.nth(index).getAttribute('href');
        try { if (href && normalizePostUrl(new URL(href, blog).href, blog) === postUrl) matching.push(index); } catch { /* not a saved-post link */ }
      }
      if (matching.length > 1) throw new AttentionRequired('같은 주소의 글을 여러 개 찾았습니다. 관리 목록을 확인하세요.');
      if (matching.length === 1) {
        const row = page.locator('li').filter({ has: links.nth(matching[0]) });
        if (await row.count() !== 1 || await row.locator('.txt_cate').count() !== 1 || (await row.locator('.txt_cate').innerText()).trim() !== draft.category || !await row.locator('.ico_private').isVisible()) throw new AttentionRequired('기존 글의 비공개 설정 또는 카테고리가 원고와 다릅니다. 자동 변경하지 않습니다.');
        matched = true; break;
      }
      // Follow only pagination links actually present in the management UI.
      for (const href of await page.locator('a[href]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href))) {
        const url = new URL(href);
        if (url.origin === blog && url.pathname === '/manage/posts' && !url.username && !url.password && !url.hash && /^\d+$/.test(url.searchParams.get('page') || '') && Array.from(url.searchParams.keys()).every(key => key === 'page') && !visited.has(url.href) && !pending.includes(url.href)) pending.push(url.href);
      }
    }
    if (!matched) throw new AttentionRequired('글 관리 목록에서 주소와 제목이 일치하는 글을 찾지 못했습니다. 저장된 글 주소와 목록을 확인하세요.');
    await page.goto(postUrl, { waitUntil: 'domcontentloaded' });
    if (normalizePostUrl(page.url(), blog) !== postUrl) throw new AttentionRequired('다른 주소로 이동되어 기존 글을 확인하지 못했습니다.');
    await page.getByRole('heading', { name: draft.title, exact: true }).waitFor();
    const article = page.locator('.tt_article_useless_p_margin, .contents_style, #article-view').first();
    if (!await article.count()) throw new AttentionRequired('현재 스킨에서 본문 영역을 확인하지 못했습니다.');
    const expectedBody = load(renderDraft(draft));
    const actualBody = load(await article.innerHTML());
    actualBody('.another_category, .container_postbtn, script, style').remove();
    const compact = (text: string) => text.replace(/[\s\u200b]/g, '');
    if (publicationSequence(actualBody.root().html() || '') !== publicationSequence(expectedBody.root().html() || '')) throw new AttentionRequired('기존 글 본문·사진 설명 또는 문단 사이 사진 위치가 전송 당시 원고와 다릅니다. 글을 연결하거나 덮어쓰지 않았습니다.');
    {
      const expected = load(renderDraft(draft));
      const normalize = (text: string) => text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
      const codes = expected('pre').toArray().map(el => normalize(expected(el).text()));
      const actualCodes = (await article.locator('pre').allTextContents()).map(normalize);
      if (codes.length !== actualCodes.length || codes.some((code, i) => code !== actualCodes[i])) throw new AttentionRequired('저장된 코드 블록의 내용·줄바꿈을 확인해주세요.');
      const cells = expected('table th, table td').toArray().map(el => normalize(expected(el).text()));
      const actualCells = (await article.locator('table th, table td').evaluateAll(cells => cells.filter(cell => !cell.closest('.another_category, .container_postbtn')).map(cell => cell.textContent || ''))).map(normalize);
      if (cells.length !== actualCells.length || cells.some((cell, i) => cell !== actualCells[i])) throw new AttentionRequired('저장된 표 내용을 확인해주세요.');
    }
    const photos = article.locator('figure img');
    if (await photos.count() !== draft.images.length) throw new AttentionRequired('글은 저장되었지만 사진 개수가 다릅니다. 글 관리에서 확인하세요.');
    if (draft.images.length && (!job.snapshot.imagePaths || job.snapshot.imagePaths.length !== draft.images.length)) throw new AttentionRequired('사진 식별자 기록이 없어 원고 사진의 일치와 순서를 확정할 수 없습니다. 자동으로 성공 처리하지 않습니다.');
    if (job.snapshot.imagePaths) {
      const paths = await photos.evaluateAll(images => images.map(image => new URL((image as HTMLImageElement).src).pathname));
      if (paths.some(value => value === '/tistory_admin/static/images/pc-image-censoring-v1.gif')) throw new AttentionRequired('글은 비공개로 저장되었지만 일부 사진이 티스토리 검토 안내로 표시됩니다. 같은 글에서 저장 결과를 재확인하세요. 자동 재발행하지 않습니다.');
      if (paths.some((value, index) => value !== job.snapshot.imagePaths![index])) throw new AttentionRequired('저장된 사진 식별자 또는 순서가 업로드 기록과 다릅니다.');
    }
    const dimensions = await Promise.all(draft.images.map(async image => { const meta = await sharp(assetPath(image.id)).metadata(); return { width: meta.width, height: meta.height }; }));
    for (let i=0; i<draft.images.length; i++) await photos.nth(i).scrollIntoViewIfNeeded();
    try { await page.waitForFunction(expected => Array.from(document.querySelector('.tt_article_useless_p_margin, .contents_style, #article-view')?.querySelectorAll<HTMLImageElement>('figure img') || []).every((image, index) => image.complete && image.naturalWidth === expected[index]?.width && image.naturalHeight === expected[index]?.height), dimensions, { timeout: 15_000 }); }
    catch { throw new AttentionRequired('글은 비공개로 저장되었습니다. 티스토리 사진 처리·검토가 끝난 뒤 저장 결과를 다시 확인하세요.'); }
    for (const [index, image] of draft.images.entries()) {
      const caption = await photos.nth(index).locator('xpath=ancestor::figure[1]').locator('figcaption').allTextContents();
      if (compact(caption.join('')) !== compact(image.caption)) throw new AttentionRequired('저장된 사진 설명 또는 순서를 확인해주세요.');
    }
    if (draft.cover) {
      const src = await photos.nth(draft.images.findIndex(image => image.id === draft.cover)).getAttribute('src');
      const cover = await page.locator('.article-header').getAttribute('style');
      if (!src || !cover || !decodeURIComponent(cover).includes(new URL(src, postUrl).pathname)) throw new AttentionRequired('현재 스킨에서 대표 이미지 일치를 확인하지 못했습니다.');
    }
    return postUrl;
  }
  async close() { const probe = this.probe; this.probe = undefined; this.verificationPage = undefined; await probe?.close().catch(() => {}); }
}
// Compare image positions relative to all published text, not just photo count.
export function publicationSequence(html: string) {
  const $ = load(html); $('.another_category, .container_postbtn, script, style').remove();
  $('img').each((_index, element) => { $(element).replaceWith('[R2-IMAGE]'); });
  return $.root().text().replace(/[\s\u200b]/g, '');
}
