// Explicit opt-in only: the production worker never imports this adapter.
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Job } from '../../src/lib/model';
import { assertTestRoot, check, action, hadUncertainty } from './support';

const root = path.resolve(process.argv[2]); assertTestRoot(root);
check(process.argv.includes('--private-test'), 'PRIVATE_OPT_IN_REQUIRED');
process.env.TSTORY_DATA_DIR = path.join(root, 'data');
const { openStore } = await import('../../src/lib/store');
const { Publisher, LoginRequired } = await import('../../src/services/tistory/publisher');
const { runPublicationOnce } = await import('../../src/services/publication-runner');
const store = openStore(); const owner = randomUUID();
const configFile = path.join(root, 'live.json');
const config = JSON.parse(readFileSync(configFile, 'utf8')) as {
  jobId: string; scenario: string; candidate?: string; posts: number | null;
  publishCalls: number; saveClicks: number; automaticRepublish: number; lastFailure?: string;
};
const save = () => writeFileSync(configFile, JSON.stringify(config));
const mode = process.argv[3]; let heartbeat: ReturnType<typeof setInterval> | undefined;
class LiveAdapter extends Publisher {
  private instrumented = false;
  override async connect(blog: string) {
    const probe = await super.connect(blog);
    if (!this.instrumented) {
      await probe.context.exposeBinding('recoverySaveClick', () => { config.saveClicks++; save(); });
      await probe.context.addInitScript(() => {
        document.addEventListener('click', event => {
          if ((event.target as Element)?.closest('#publish-btn')) {
            void (window as unknown as { recoverySaveClick(): Promise<void> }).recoverySaveClick();
          }
        }, true);
      });
      this.instrumented = true;
    }
    return probe;
  }
  override async publish(job: Job, step: (value: string, url?: string, images?: string[]) => void) {
    config.publishCalls++; if (hadUncertainty(store.db)) config.automaticRepublish++; save();
    return super.publish(job, (value, url, images) => {
      step(value, url, images);
      // Real save completed; deliberately discard application completion before URL persistence.
      // This is NOT a simulated dropped packet on Tistory's servers.
      if (config.scenario === 'E2' && value === '결과 확인' && !url) throw new Error('INJECTED_COMPLETION_LOSS');
      if (config.scenario === 'E3' && value === '결과 확인' && url) throw new Error('INJECTED_AFTER_URL');
    });
  }
}
const publisher = new LiveAdapter();
try {
  check(store.acquire(owner), 'LIVE_LEASE_BUSY');
  heartbeat = setInterval(() => store.heartbeat(owner), 3000);
  if (mode === 'publish') {
    check(store.job(config.jobId).state === 'queued' && config.publishCalls === 0, 'REPUBLISH_FORBIDDEN');
  }
  action(store.db, mode === 'verify' ? 'explicit-verification' : 'automatic');
  if (mode === 'verify') store.verify(config.jobId, config.candidate);
  for (let i = 0; i < 3; i++) await runPublicationOnce(store, owner, publisher, () => false, async error => {
    config.lastFailure = error instanceof LoginRequired ? 'LOGIN_REQUIRED' :
      error instanceof Error && /^INJECTED_[A-Z_]+$/.test(error.message) ? error.message :
      error instanceof Error && error.message.includes('사진') ? 'PHOTO_VERIFY_PENDING' : 'PUBLISH_OR_VERIFY_FAILED';
    save();
  });
  const job = store.job(config.jobId);
  if (mode !== 'idle') {
    const probe = await publisher.connect(job.snapshot.blog);
    const page = await probe.context.newPage();
    await page.goto(job.snapshot.blog + '/manage/posts', { waitUntil: 'domcontentloaded' });
    await page.locator('.txt_cate').first().waitFor();
    const links = page.getByRole('link', { name: job.snapshot.draft!.title, exact: true });
    config.posts = await links.count(); save();
    check(config.posts === 1, 'LIVE_POST_COUNT_MISMATCH');
    const row = page.locator('li').filter({ has: links });
    check(await row.locator('.ico_private').isVisible(), 'LIVE_NOT_PRIVATE');
    check((await row.locator('.txt_cate').innerText()).trim() === job.snapshot.draft!.category, 'LIVE_CATEGORY_MISMATCH');
    const href = await links.getAttribute('href'); check(href, 'LIVE_URL_MISSING');
    const candidate = new URL(href, job.snapshot.blog).href;
    check(new URL(candidate).origin === job.snapshot.blog, 'LIVE_WRONG_BLOG');
    config.candidate = candidate; save();
    if (job.state === 'succeeded') {
      const anonymous = await probe.context.browser()!.newContext();
      try {
        const view = await anonymous.newPage(); await view.goto(candidate);
        check(await view.getByRole('heading', { name: job.snapshot.draft!.title, exact: true }).count() === 0, 'ANONYMOUS_CONTENT_VISIBLE');
      } finally { await anonymous.close(); }
    }
    await page.close();
  }
  process.send?.({ finished: true, state: store.job(config.jobId).state, failure: config.lastFailure ?? null });
} catch (error) {
  const code = error instanceof LoginRequired ? 'LOGIN_REQUIRED' : error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_CHILD_FAILED';
  process.send?.({ failure: code }); process.exitCode = 1;
} finally {
  clearInterval(heartbeat); await publisher.close(); store.release(owner); store.db.close();
  if (process.connected) process.disconnect();
}

