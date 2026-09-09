import { chromium, type BrowserContext, type Page, type Dialog } from 'playwright';
import { mkdir, writeFile, access, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { localRoot, normalizeBlogUrl, safeUrl } from './config.js';

export class TistoryProbe {
  context!: BrowserContext;
  blog?: string;
  private closing = false;
  private restarting = false;
  onClosed?: () => void;
  pendingDialog?: Dialog;
  private authTimer?: NodeJS.Timeout;
  private savingAuth?: Promise<void>;

  constructor(blog?: string, readonly stateRoot = localRoot) { this.blog = blog ? normalizeBlogUrl(blog) : undefined; }

  async start() {
    await mkdir(this.stateRoot, { recursive: true });
    this.context = await chromium.launchPersistentContext(path.join(this.stateRoot, 'tistory-profile'), {
      channel: 'chrome', headless: false, viewport: null, locale: 'ko-KR',
      acceptDownloads: false,
    });
    this.context.setDefaultTimeout(10_000);
    this.context.setDefaultNavigationTimeout(30_000);
    const authFile = path.join(this.stateRoot, 'tistory-auth.json');
    if (await access(authFile).then(() => true, () => false)) {
      const state = JSON.parse(await readFile(authFile, 'utf8'));
      // The persistent profile already holds localStorage/IndexedDB. Restore
      // cookies only, without replacing newer origin storage with an old snapshot.
      await this.context.addCookies(state.cookies);
    }
    this.context.on('close', () => { if (!this.restarting) this.onClosed?.(); });
    // Never auto-accept alerts, mode switches or unexpected confirmation dialogs.
    this.context.on('page', page => this.watchDialogs(page));
    this.context.pages().forEach(page => this.watchDialogs(page));
    await this.page().goto(this.blog ? `${this.blog}/manage` : 'https://www.tistory.com/auth/login', { waitUntil: 'domcontentloaded' });
    clearInterval(this.authTimer);
    this.authTimer = setInterval(() => { void this.persistIfAuthenticated().catch(() => undefined); }, 3000);
    this.authTimer.unref();
  }

  private watchDialogs(page: Page) {
    page.on('dialog', dialog => {
      this.pendingDialog = dialog;
      console.log('브라우저 확인창 감지: action dialog-info로 확인할 수 있습니다.');
    });
  }

  page(): Page {
    const pages = this.context.pages().filter(page => !page.isClosed());
    const page = pages.at(-1);
    if (!page) throw new Error('브라우저 창이 닫혔습니다. 다시 실행하세요.');
    return page;
  }

  async status() {
    return { blog: this.blog ?? null, pages: this.context.pages().map(page => ({ url: safeUrl(page.url()) })) };
  }

  async setBlog(value: string) {
    this.blog = normalizeBlogUrl(value);
    await this.page().goto(`${this.blog}/manage`, { waitUntil: 'domcontentloaded' });
    return this.status();
  }

  requireBlog(): Page {
    const page = this.page();
    if (!this.blog || new URL(page.url()).origin !== this.blog) {
      throw new Error('블로그 관리 화면으로 이동하거나 브라우저에서 직접 로그인하세요. 인증 화면은 검사하지 않습니다.');
    }
    return page;
  }

  async inspect() {
    const page = this.requireBlog();
    const frames = [];
    for (const frame of page.frames()) {
      const frameUrl = frame.url();
      if (frame !== page.mainFrame() && frameUrl !== 'about:blank' && !frameUrl.startsWith(`${this.blog}/`)) continue;
      const dom = await frame.evaluate(() => {
        return {
          text: document.body?.innerText.slice(0, 18_000),
          controls: Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"], [role="option"], [contenteditable="true"], iframe'))
            .filter(el => el.getClientRects().length > 0 || el.getAttribute('type') === 'file')
            .map(el => ({
              tag: el.tagName, id: el.id, role: el.getAttribute('role'),
              type: el.getAttribute('type'), name: el.getAttribute('name'),
              label: el.getAttribute('aria-label'), placeholder: el.getAttribute('placeholder'),
              text: (el.textContent ?? '').trim().slice(0, 180),
              href: el instanceof HTMLAnchorElement ? el.getAttribute('href')?.split('?')[0] : undefined,
              class: el.className,
            })),
        };
      });
      frames.push({ name: frame.name(), url: safeUrl(frameUrl), ...dom });
    }
    const result = { capturedAt: new Date().toISOString(), url: safeUrl(page.url()), frames };
    await writeFile(path.join(this.stateRoot, 'last-inspection.json'), JSON.stringify(result, null, 2), 'utf8');
    return result;
  }

  async editor() {
    const page = this.requireBlog();
    const link = page.locator('a.link_write[href="/manage/post"]');
    if (await link.count() !== 1) throw new Error('글쓰기 링크를 유일하게 찾지 못했습니다. inspect로 화면을 확인하세요.');
    await link.click();
    return this.status();
  }

  async screenshot() {
    await this.requireBlog().screenshot({ path: path.join(this.stateRoot, 'last-page.png'), fullPage: true });
    return { saved: '.local/last-page.png' };
  }

  async checkpoint() {
    const page = this.requireBlog();
    if (!new URL(page.url()).pathname.startsWith('/manage') || !await page.locator('a.link_write[href="/manage/post"]').isVisible()) {
      throw new Error('로그인된 관리 홈에서만 인증 상태를 저장할 수 있습니다.');
    }
    await this.saveCookies();
    return { saved: '.local/tistory-auth.json', credentialsPrinted: false };
  }

  private async saveCookies() {
    if (this.savingAuth) return this.savingAuth;
    this.savingAuth = (async () => {
      const temporary = path.join(this.stateRoot, 'tistory-auth.tmp.json');
      await writeFile(temporary, JSON.stringify({ cookies: await this.context.cookies(), origins: [] }), { mode: 0o600 });
      await rename(temporary, path.join(this.stateRoot, 'tistory-auth.json'));
    })();
    try { await this.savingAuth; } finally { this.savingAuth = undefined; }
  }

  async persistIfAuthenticated() {
    const page = this.page();
    if (!this.blog || !page.url().startsWith(`${this.blog}/manage`)) return;
    if (await page.locator('a.link_write[href="/manage/post"], #post-title-inp').count() === 0) return;
    await this.saveCookies();
  }

  async restart() {
    this.restarting = true;
    try {
      await this.checkpoint();
      clearInterval(this.authTimer);
      await this.context.close();
      await this.start();
      return this.status();
    } finally { this.restarting = false; }
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
