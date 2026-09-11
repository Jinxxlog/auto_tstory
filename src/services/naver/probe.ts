import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { localRoot, safeUrl } from '../tistory/config.js';

const categoryText = (value: string) => value.replace(/^하위 카테고리/, '').replace(/\s+/g, ' ').trim();

function naverPostUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'blog.naver.com') return undefined;
    const direct = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
    if (direct) return `${url.origin}/${direct[1]}/${direct[2]}`;
    const blogId = url.searchParams.get('blogId');
    const logNo = url.searchParams.get('logNo');
    if (blogId && logNo && /^[A-Za-z0-9_-]+$/.test(blogId) && /^\d+$/.test(logNo)) {
      return `${url.origin}/${blogId}/${logNo}`;
    }
  } catch {}
  return undefined;
}

export class NaverProbe {
  context!: BrowserContext;
  private closing = false;
  private authTimer?: NodeJS.Timeout;
  private savingAuth?: Promise<void>;
  onClosed?: () => void;

  constructor(readonly stateRoot = localRoot) {}

  async start() {
    await mkdir(this.stateRoot, { recursive: true });
    this.context = await chromium.launchPersistentContext(path.join(this.stateRoot, 'naver-profile'), {
      channel: 'chrome',
      headless: false,
      viewport: null,
      locale: 'ko-KR',
      acceptDownloads: false,
    });
    this.context.setDefaultTimeout(10_000);
    this.context.setDefaultNavigationTimeout(30_000);
    const authFile = path.join(this.stateRoot, 'naver-auth.json');
    if (await access(authFile).then(() => true, () => false)) {
      const state = JSON.parse(await readFile(authFile, 'utf8'));
      await this.context.addCookies(state.cookies);
    }
    this.context.on('close', () => this.onClosed?.());
    await this.page().goto('https://blog.naver.com/', { waitUntil: 'domcontentloaded' });
    this.authTimer = setInterval(() => { void this.persistIfAuthenticated().catch(() => undefined); }, 3_000);
    this.authTimer.unref();
  }

  page(): Page {
    const page = this.context.pages().filter(candidate => !candidate.isClosed()).at(-1);
    if (!page) throw new Error('네이버 검증용 브라우저 창이 없습니다. 검증을 다시 시작해 주세요.');
    return page;
  }

  async status() {
    const pages = await Promise.all(this.context.pages().filter(page => !page.isClosed()).map(async page => ({
      url: safeUrl(page.url()),
      title: await page.title().catch(() => ''),
    })));
    return { pages };
  }

  async openWriter() {
    const page = this.page();
    await page.goto('https://blog.naver.com/GoBlogWrite.naver', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('iframe')).some(frame => {
      try { return new URL((frame as HTMLIFrameElement).src).pathname === '/PostWriteForm.naver'; } catch { return false; }
    }), { timeout: 30_000 });
    await page.frameLocator('#mainFrame').locator('body').waitFor({ state: 'visible', timeout: 30_000 });
    return this.status();
  }

  editorFrame() {
    const frame = this.page().frames().find(candidate => {
      try { return new URL(candidate.url()).pathname === '/PostWriteForm.naver'; } catch { return false; }
    });
    if (!frame) throw new Error('네이버 스마트에디터 프레임을 찾지 못했습니다. 로그인과 글쓰기 화면을 확인해 주세요.');
    return frame;
  }

  async editorState() {
    const frame = this.editorFrame();
    const closeHelp = frame.getByRole('button', { name: '닫기', exact: true });
    if (await closeHelp.isVisible().catch(() => false)) await closeHelp.click();
    const selectors = [
      '[contenteditable="true"]',
      '.se-title-text',
      '.se-text-paragraph',
      '.se-placeholder',
      'input[type="file"]',
      'button',
    ];
    const counts = Object.fromEntries(await Promise.all(selectors.map(async selector => [selector, await frame.locator(selector).count()])));
    const editables = await frame.locator('[contenteditable="true"]').evaluateAll(elements => elements.map(element => ({
      tag: element.tagName,
      class: typeof element.className === 'string' ? element.className : '',
      text: (element.textContent ?? '').trim().slice(0, 160),
      ariaLabel: element.getAttribute('aria-label'),
      dataPlaceholder: element.getAttribute('data-placeholder'),
    })));
    return { url: safeUrl(frame.url()), counts, editables };
  }

  async restoreFixture() {
    const frame = this.editorFrame();
    const notice = frame.getByText('작성 중인 글이 있습니다.', { exact: true });
    if (!await notice.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false)) {
      return { restored: false, reason: 'restore-prompt-not-visible' };
    }
    await frame.getByRole('button', { name: '확인', exact: true }).click();
    const expectedTitle = this.fixture().title;
    await frame.waitForFunction(title => {
      const element = document.querySelector('.se-documentTitle .se-title-text');
      return element?.textContent?.includes(title);
    }, expectedTitle, { timeout: 30_000 });
    const state = await this.fixtureState();
    if (state.title !== expectedTitle) throw new Error('복구된 원고가 R1 테스트 원고와 달라 작업을 중단했습니다.');
    return { restored: true, ...state };
  }

  private fixture() {
    return {
      id: 'R1-NAVER-20260911',
      title: '[R1 테스트] 네이버 자동화 검증',
      paragraphs: [
        '자동화 경로 검증을 위한 비공개 테스트 글입니다.',
        '첫 번째 사진 뒤에 이어지는 설명 문단입니다. 사진과 글의 순서를 확인합니다.',
        '마지막 문단입니다. R1-NAVER-20260911 식별자로 저장 결과를 확인합니다.',
      ],
      captions: [
        '첫 번째 사진: 프로젝트 입력 화면 검증용 이미지',
        '두 번째 사진: 다중 이미지 순서 검증용 이미지',
      ],
      images: [
        path.join(this.stateRoot, 'fixtures', 'p0-image-1.png'),
        path.join(this.stateRoot, 'fixtures', 'p0-image-2.png'),
      ],
    };
  }

  async fillFixture() {
    const frame = this.editorFrame();
    const fixture = this.fixture();
    const closeHelp = frame.getByRole('button', { name: '닫기', exact: true });
    if (await closeHelp.isVisible().catch(() => false)) await closeHelp.click();
    const title = frame.locator('.se-documentTitle .se-title-text');
    const body = frame.locator('.se-component.se-text .se-text-paragraph').last();
    const blankTitle = await title.locator('.se-placeholder').count() === 1;
    const blankBody = await body.locator('.se-placeholder').count() === 1;
    if (!blankTitle || !blankBody || await frame.locator('.se-component.se-image').count()) {
      throw new Error('빈 글쓰기 화면에서만 R1 테스트 원고를 입력할 수 있습니다. 기존 원고는 건드리지 않았습니다.');
    }
    await title.click();
    await this.page().keyboard.insertText(fixture.title);
    await body.click();
    for (const [index, paragraph] of fixture.paragraphs.entries()) {
      if (index > 0) {
        await this.page().keyboard.press('Enter');
        await this.page().keyboard.press('Enter');
      }
      await this.page().keyboard.insertText(paragraph);
    }
    return this.fixtureState();
  }

  private async uploadAfter(paragraphText: string, imagePath: string) {
    const frame = this.editorFrame();
    const closeSidebar = frame.locator('button.se-sidebar-close-button');
    if (await closeSidebar.isVisible().catch(() => false)) await closeSidebar.click();
    const paragraph = frame.locator('.se-component.se-text .se-text-paragraph').filter({ hasText: paragraphText });
    if (await paragraph.count() !== 1) throw new Error('사진을 넣을 기준 문단을 하나로 식별하지 못했습니다.');
    const before = await frame.locator('.se-component.se-image').count();
    await paragraph.click();
    await this.page().keyboard.press('End');
    const chooserPromise = this.page().waitForEvent('filechooser', { timeout: 30_000 });
    await frame.locator('button.se-image-toolbar-button').click();
    const chooser = await chooserPromise;
    await chooser.setFiles(imagePath);
    await frame.locator('.se-component.se-image').nth(before).waitFor({ state: 'visible', timeout: 30_000 });
    await frame.waitForFunction(expected => Array.from(document.querySelectorAll('.se-component.se-image img')).filter(image => (image as HTMLImageElement).naturalWidth > 0).length >= expected, before + 1, { timeout: 30_000 });
  }

  async uploadFixtureImages() {
    const fixture = this.fixture();
    const existingImages = await this.editorFrame().locator('.se-component.se-image').count();
    if (existingImages > 2) throw new Error('R1 테스트보다 많은 이미지가 있어 업로드를 중단했습니다.');
    if (existingImages === 0) await this.uploadAfter(fixture.paragraphs[0], fixture.images[0]);
    if (existingImages <= 1) await this.uploadAfter(fixture.paragraphs[1], fixture.images[1]);
    const captions = this.editorFrame().locator('.se-component.se-image .se-module-text.se-caption .se-text-paragraph');
    if (await captions.count() !== 2) throw new Error('업로드한 사진의 설명 입력란 두 개를 식별하지 못했습니다.');
    const closeSidebar = this.editorFrame().locator('button.se-sidebar-close-button');
    if (await closeSidebar.isVisible().catch(() => false)) await closeSidebar.click({ force: true });
    for (const [index, caption] of fixture.captions.entries()) {
      const image = this.editorFrame().locator('.se-component.se-image').nth(index).locator('img').first();
      await image.scrollIntoViewIfNeeded();
      await image.click();
      const target = captions.nth(index);
      if (await target.locator('.se-placeholder').count()) {
        const placeholder = target.locator('.se-placeholder');
        await placeholder.waitFor({ state: 'visible' });
        await placeholder.click();
        await this.page().keyboard.insertText(caption);
      }
    }
    return this.fixtureState();
  }

  async fixtureState() {
    const frame = this.editorFrame();
    const fixture = this.fixture();
    const components = await frame.locator('.se-content .se-component, .se-main-container > .se-component').evaluateAll(elements => elements.map(element => ({
      type: Array.from(element.classList).find(name => /^se-(documentTitle|text|image)$/.test(name)) ?? 'other',
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      images: element.querySelectorAll('img').length,
    })));
    const captions = await frame.locator('.se-component.se-image .se-module-text.se-caption .se-text-paragraph').allInnerTexts();
    return {
      id: fixture.id,
      title: await frame.locator('.se-documentTitle .se-title-text').innerText(),
      imageCount: await frame.locator('.se-component.se-image').count(),
      captionCount: await frame.locator('.se-component.se-image .se-module-text.se-caption .se-text-paragraph').count(),
      components,
      captions,
    };
  }

  async openPublishOptions() {
    const frame = this.editorFrame();
    if (!await frame.locator('input[name="open_type"]').first().isVisible().catch(() => false)) {
      await frame.getByRole('button', { name: '발행', exact: true }).click();
    }
    const controls = await frame.locator('button, input, label, [role="option"], [role="radio"]').filter({ visible: true }).evaluateAll(elements => elements.map(element => ({
      tag: element.tagName,
      type: element.getAttribute('type'),
      name: element.getAttribute('name'),
      label: element.getAttribute('aria-label'),
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
      checked: element instanceof HTMLInputElement ? element.checked : undefined,
      class: typeof element.className === 'string' ? element.className : '',
    })));
    return { text: (await frame.locator('body').innerText()).slice(-4_000), controls };
  }

  async listCategories() {
    const frame = this.editorFrame();
    await this.openPublishOptions();
    const button = frame.getByRole('button', { name: '카테고리 목록 버튼', exact: true });
    const categoryLabels = frame.locator('label').filter({ visible: true });
    const visibleCategoryCount = await categoryLabels.evaluateAll(labels => labels.filter(label => /^\d+_/.test((label as HTMLLabelElement).htmlFor)).length);
    if (!visibleCategoryCount) await button.click();
    const entries = await categoryLabels.evaluateAll(elements => elements
      .filter(element => /^\d+_/.test((element as HTMLLabelElement).htmlFor))
      .map(element => ({
        text: (element.textContent ?? '').replace(/^하위 카테고리/, '').replace(/\s+/g, ' ').trim(),
        nested: (element.textContent ?? '').trim().startsWith('하위 카테고리'),
        for: (element as HTMLLabelElement).htmlFor,
      })));
    return { current: categoryText(await button.innerText()), entries };
  }

  private async selectCategory(category: string) {
    const frame = this.editorFrame();
    const button = frame.getByRole('button', { name: '카테고리 목록 버튼', exact: true });
    if (categoryText(await button.innerText()) === category) return;
    const labels = frame.locator('label').filter({ visible: true });
    if (!await labels.evaluateAll(items => items.some(label => /^\d+_/.test((label as HTMLLabelElement).htmlFor)))) await button.click();
    const match = await labels.evaluateAll((items, expected) => {
      const candidates = items
        .map((label, index) => ({ index, id: (label as HTMLLabelElement).htmlFor, text: (label.textContent ?? '').replace(/^하위 카테고리/, '').replace(/\s+/g, ' ').trim() }))
        .filter(item => /^\d+_/.test(item.id) && item.text === expected);
      return { count: candidates.length, index: candidates[0]?.index ?? -1 };
    }, category);
    if (match.count !== 1) throw new Error(`카테고리 '${category}'를 하나로 식별하지 못했습니다.`);
    await labels.nth(match.index).click();
    await frame.waitForFunction(({ expected }) => {
      const button = document.querySelector('button[aria-label="카테고리 목록 버튼"]');
      return (button?.textContent ?? '').replace(/^하위 카테고리/, '').replace(/\s+/g, ' ').trim() === expected;
    }, { expected: category });
  }

  private async visibilityState() {
    const frame = this.editorFrame();
    return frame.locator('input[name="open_type"]').evaluateAll(inputs => inputs.map(input => {
      const element = input as HTMLInputElement;
      const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
      return {
        id: element.id,
        value: element.value,
        label: (label?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        checked: element.checked,
      };
    }));
  }

  async preparePrivate(category: string) {
    const frame = this.editorFrame();
    const fixture = this.fixture();
    const state = await this.fixtureState();
    const meaningful = state.components.filter(component => component.type === 'se-text' || component.type === 'se-image');
    const firstParagraph = meaningful.findIndex(component => component.type === 'se-text' && component.text.includes(fixture.paragraphs[0]));
    const firstImage = meaningful.findIndex(component => component.type === 'se-image' && component.text.includes(fixture.captions[0]));
    const secondParagraph = meaningful.findIndex(component => component.type === 'se-text' && component.text.includes(fixture.paragraphs[1]));
    const secondImage = meaningful.findIndex(component => component.type === 'se-image' && component.text.includes(fixture.captions[1]));
    const lastParagraph = meaningful.findIndex(component => component.type === 'se-text' && component.text.includes(fixture.paragraphs[2]));
    const orderValid = firstParagraph < firstImage && firstImage < secondParagraph && secondParagraph < secondImage && secondImage < lastParagraph;
    const captionsValid = state.captions.map(caption => caption.trim()).every((caption, index) => caption === fixture.captions[index]);
    const representativeButtons = frame.locator('.se-component.se-image .se-set-rep-image-button');
    const representativeValid = await representativeButtons.count() === 2
      && await representativeButtons.nth(0).evaluate(element => element.classList.contains('se-is-selected'))
      && !await representativeButtons.nth(1).evaluate(element => element.classList.contains('se-is-selected'));
    if (state.title !== fixture.title || state.imageCount !== 2 || state.captionCount !== 2 || !orderValid || !captionsValid || !representativeValid) {
      throw new Error('R1 테스트 원고 검증에 실패해 공개 설정을 바꾸지 않았습니다.');
    }
    await this.openPublishOptions();
    const categoryButton = frame.getByRole('button', { name: '카테고리 목록 버튼', exact: true });
    await this.selectCategory(category);
    const privateLabel = frame.locator('label').filter({ visible: true }).filter({ hasText: '비공개' });
    const exactPrivateLabels = await privateLabel.evaluateAll(labels => labels.filter(label => (label.textContent ?? '').replace(/\s+/g, ' ').trim() === '비공개').length);
    if (exactPrivateLabels !== 1) throw new Error('비공개 선택 항목을 하나로 식별하지 못했습니다.');
    await privateLabel.first().click();
    const radios = await this.visibilityState();
    const checked = radios.filter(radio => radio.checked);
    if (checked.length !== 1 || checked[0]?.label !== '비공개') {
      throw new Error('비공개 공개 범위를 확인하지 못했습니다.');
    }
    return {
      id: fixture.id,
      title: fixture.title,
      category: categoryText(await categoryButton.innerText()),
      visibility: 'private',
      images: state.imageCount,
      captions: fixture.captions,
      submitted: false,
      radios,
    };
  }

  async savePrivate(category: string) {
    const prepared = await this.preparePrivate(category);
    const frame = this.editorFrame();
    const fixture = this.fixture();
    const journal = path.join(this.stateRoot, 'r1-naver-publication.json');
    if (await access(journal).then(() => true, () => false)) {
      throw new Error('이 R1 원고는 이미 저장을 시도했습니다. 중복 발행하지 않고 기존 결과를 확인해야 합니다.');
    }
    const confirm = frame.locator('button.confirm_btn__byZZW').filter({ visible: true });
    if (await confirm.count() !== 1 || (await confirm.innerText()).trim() !== '발행') {
      throw new Error('최종 발행 버튼을 하나로 식별하지 못해 저장하지 않았습니다.');
    }
    const record = {
      id: fixture.id,
      title: fixture.title,
      category: prepared.category,
      visibility: 'private',
      status: 'unknown',
      attemptedAt: new Date().toISOString(),
    };
    await writeFile(journal, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
    const page = this.page();
    const frameChanged = page.waitForFunction(() => {
      const iframe = document.querySelector('iframe#mainFrame') as HTMLIFrameElement | null;
      if (!iframe) return true;
      try { return new URL(iframe.src).pathname !== '/PostWriteForm.naver'; } catch { return false; }
    }, undefined, { timeout: 30_000 });
    const directPost = page.waitForURL(url => url.hostname === 'blog.naver.com' && /^\/[A-Za-z0-9_-]+\/\d+\/?$/.test(url.pathname), { timeout: 30_000 });
    try {
      await confirm.click();
      await Promise.any([frameChanged, directPost]);
      await page.waitForTimeout(1_500);
      const resultUrl = naverPostUrl(page.url())
        ?? page.frames().map(candidate => naverPostUrl(candidate.url())).find(Boolean);
      if (!resultUrl) throw new Error('저장된 글 주소를 판별하지 못했습니다.');
      const result = { ...record, status: 'submitted-awaiting-verification', resultUrl };
      await writeFile(journal, JSON.stringify(result, null, 2), { mode: 0o600 });
      return result;
    } catch {
      throw new Error('저장 요청 뒤 결과를 확정하지 못했습니다. 같은 원고를 다시 저장하지 말고 네이버 글 관리에서 확인하세요.');
    }
  }

  async verifyPrivate() {
    const fixture = this.fixture();
    const journal = path.join(this.stateRoot, 'r1-naver-publication.json');
    const record = JSON.parse(await readFile(journal, 'utf8')) as {
      id: string; title: string; category: string; visibility: string; status: string; resultUrl?: string;
    };
    if (record.id !== fixture.id || !record.resultUrl || !naverPostUrl(record.resultUrl)) {
      throw new Error('검증할 R1 네이버 저장 결과가 없습니다.');
    }
    const page = this.page();
    await page.goto(record.resultUrl, { waitUntil: 'domcontentloaded' });
    let contentFrame = page.mainFrame();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const candidates = page.frames();
      const match = (await Promise.all(candidates.map(async candidate => ({
        candidate,
        text: await candidate.locator('body').innerText().catch(() => ''),
      })))).find(item => item.text.includes(fixture.id));
      if (match) { contentFrame = match.candidate; break; }
      await page.waitForTimeout(500);
    }
    const bodyText = await contentFrame.locator('body').innerText();
    const expectedText = [fixture.title, ...fixture.paragraphs, ...fixture.captions];
    if (!expectedText.every(text => bodyText.includes(text))) throw new Error('저장된 글의 제목·본문·캡션 확인에 실패했습니다.');
    if (!bodyText.includes(record.category) || !bodyText.includes('비공개')) {
      throw new Error('저장된 글의 카테고리·비공개 표시 확인에 실패했습니다.');
    }
    const components = await contentFrame.locator('.se-main-container .se-component').evaluateAll(elements => elements.map(element => ({
      type: Array.from(element.classList).find(name => /^se-(text|image)$/.test(name)) ?? 'other',
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
      images: element.querySelectorAll('img').length,
    })));
    const meaningful = components.filter(component => component.type === 'se-text' || component.type === 'se-image');
    if (meaningful.length < 5 || meaningful.filter(component => component.type === 'se-image').length !== 2) {
      throw new Error('저장된 글의 사진 두 장을 확인하지 못했습니다.');
    }
    const firstParagraph = meaningful.findIndex(component => component.text.includes(fixture.paragraphs[0]));
    const firstImage = meaningful.findIndex(component => component.type === 'se-image' && component.text.includes(fixture.captions[0]));
    const secondParagraph = meaningful.findIndex(component => component.text.includes(fixture.paragraphs[1]));
    const secondImage = meaningful.findIndex(component => component.type === 'se-image' && component.text.includes(fixture.captions[1]));
    const lastParagraph = meaningful.findIndex(component => component.text.includes(fixture.paragraphs[2]));
    if (!(firstParagraph < firstImage && firstImage < secondParagraph && secondParagraph < secondImage && secondImage < lastParagraph)) {
      throw new Error('저장된 글의 문단·사진 순서가 원고와 다릅니다.');
    }
    const browser = this.context.browser();
    if (!browser) throw new Error('비공개 접근 검증용 브라우저 컨텍스트를 만들지 못했습니다.');
    const anonymous = await browser.newContext({ locale: 'ko-KR' });
    let anonymousResult: { hidden: boolean; url: string };
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto(record.resultUrl, { waitUntil: 'domcontentloaded' });
      await anonymousPage.waitForTimeout(2_000);
      const texts = await Promise.all(anonymousPage.frames().map(candidate => candidate.locator('body').innerText().catch(() => '')));
      const combined = texts.join('\n');
      anonymousResult = {
        hidden: !combined.includes(fixture.id) && !combined.includes(fixture.title),
        url: safeUrl(anonymousPage.url()),
      };
    } finally {
      await anonymous.close();
    }
    if (!anonymousResult.hidden) throw new Error('로그아웃 상태에서도 테스트 글이 보여 비공개 검증에 실패했습니다.');
    const result = {
      ...record,
      status: 'verified-private',
      verifiedAt: new Date().toISOString(),
      checks: {
        authenticatedTitleAndText: true,
        imageCount: 2,
        paragraphImageOrder: true,
        captions: true,
        category: true,
        authenticatedPrivateLabel: true,
        firstImageSelectedAsRepresentativeBeforeSubmit: true,
        anonymousHidden: true,
      },
      anonymous: anonymousResult,
    };
    await writeFile(journal, JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  }

  async inspect() {
    const page = this.page();
    const frames = [];
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      let allowed = frameUrl === 'about:blank';
      try { allowed ||= new URL(frameUrl).hostname.endsWith('naver.com'); } catch {}
      if (!allowed) continue;
      const dom = await frame.evaluate(() => ({
        text: (document.body?.innerText ?? '').slice(0, 18_000),
        controls: Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="option"], [contenteditable="true"], iframe'))
          .filter(element => element.getClientRects().length > 0 || element.getAttribute('type') === 'file')
          .map(element => ({
            tag: element.tagName,
            id: element.id,
            role: element.getAttribute('role'),
            type: element.getAttribute('type'),
            name: element.getAttribute('name'),
            label: element.getAttribute('aria-label'),
            placeholder: element.getAttribute('placeholder'),
            text: (element.textContent ?? '').trim().slice(0, 180),
            href: element instanceof HTMLAnchorElement ? element.getAttribute('href')?.split('?')[0] : undefined,
            class: typeof element.className === 'string' ? element.className : undefined,
          })),
      }));
      frames.push({ name: frame.name(), url: safeUrl(frameUrl), ...dom });
    }
    const result = { capturedAt: new Date().toISOString(), url: safeUrl(page.url()), frames };
    await writeFile(path.join(this.stateRoot, 'r1-naver-inspection.json'), JSON.stringify(result, null, 2), 'utf8');
    return {
      saved: '.local/r1-naver-inspection.json',
      url: result.url,
      frames: frames.map(frame => ({ name: frame.name, url: frame.url, controls: frame.controls.length })),
    };
  }

  async screenshot() {
    const target = path.join(this.stateRoot, 'r1-naver-page.png');
    await this.page().screenshot({ path: target, fullPage: true });
    return { saved: '.local/r1-naver-page.png' };
  }

  private async saveCookies() {
    if (this.savingAuth) return this.savingAuth;
    this.savingAuth = (async () => {
      const temporary = path.join(this.stateRoot, 'naver-auth.tmp.json');
      await writeFile(temporary, JSON.stringify({ cookies: await this.context.cookies(), origins: [] }), { mode: 0o600 });
      await rename(temporary, path.join(this.stateRoot, 'naver-auth.json'));
    })();
    try { await this.savingAuth; } finally { this.savingAuth = undefined; }
  }

  async persistIfAuthenticated() {
    const pages = this.context.pages().filter(page => !page.isClosed());
    for (const page of pages) {
      const accountControl = page.locator('#gnb_my');
      const hasVisibleAccount = await accountControl.isVisible().catch(() => false)
        && (await accountControl.innerText().catch(() => '')).trim().length > 0;
      if (hasVisibleAccount || page.frames().some(frame => {
        try { return new URL(frame.url()).pathname === '/PostWriteForm.naver'; } catch { return false; }
      })) {
        await this.saveCookies();
        return { saved: '.local/naver-auth.json', credentialsPrinted: false };
      }
    }
    throw new Error('로그인된 네이버 화면에서만 인증 상태를 저장할 수 있습니다.');
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.authTimer);
    await this.persistIfAuthenticated().catch(() => undefined);
    await this.savingAuth?.catch(() => undefined);
    await this.context?.close();
  }
}
