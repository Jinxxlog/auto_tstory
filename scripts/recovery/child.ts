import path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { TistoryProbe } from '../../src/services/tistory/probe';
import type { Job } from '../../src/lib/model';
import { assertTestRoot, check, changeLedger, readLedger, hadUncertainty, action, injectedStop, type Fault } from './support';

const root = path.resolve(process.argv[2]); assertTestRoot(root);
process.env.TSTORY_DATA_DIR = path.join(root, 'data');
const { openStore } = await import('../../src/lib/store');
const { Publisher } = await import('../../src/services/tistory/publisher');
const { runPublicationOnce } = await import('../../src/services/publication-runner');
const { renderDraft, escapeHtml } = await import('../../src/lib/content');
const config = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8')) as { jobId: string; draftId: string; fault: Fault };
const store = openStore(); const owner = randomUUID(); const mode = process.argv[3];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
class MockPublisher extends Publisher {
  override async publish(job: Job, step: (v: string, url?: string, images?: string[]) => void) {
    changeLedger(root, value => { value.publishCalls++; if (hadUncertainty(store.db)) value.automaticRepublish++; });
    step('원고 입력');
    if (config.fault === 'before-request-kill') await injectedStop('before-request');
    const paths = job.snapshot.draft!.images.map((_, i) => `/synthetic-${i}.png`);
    step('사진·순서 기록', undefined, paths); job.snapshot.imagePaths = paths;
    step('저장 요청');
    changeLedger(root, value => { value.posts++; value.clicks++; });
    if (config.fault === 'response-lost') throw new Error('INJECTED_RESPONSE_LOSS');
    step('결과 확인');
    if (config.fault === 'created-before-url-kill') await injectedStop('created-before-url');
    const url = `${job.snapshot.blog}/1`; step('결과 확인', url); job.snapshot.postUrl = url;
    if (config.fault === 'after-url-kill') await injectedStop('after-url');
    return this.verify(job);
  }
  override async verify(job: Job) {
    changeLedger(root, value => { value.verifyCalls++; });
    if (!browser) browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext(); context.setDefaultTimeout(1500);
    const draft = job.snapshot.draft!;
    await context.route('**/*', async route => {
      const ledger = readLedger(root); const request = route.request(); const url = new URL(request.url());
      if (request.method() !== 'GET') { changeLedger(root, value => { value.nonGetRequests++; }); return route.abort(); }
      if (url.origin !== job.snapshot.blog || ledger.variant === 'network-error') return route.abort();
      if (/^\/synthetic-\d+\.png$/.test(url.pathname)) {
        const index = Number(url.pathname.match(/\d+/)![0]);
        return route.fulfill({ contentType: 'image/png', body: readFileSync(path.join(root, 'data/images', `${draft.images[index].id}.png`)) });
      }
      const title = ledger.variant === 'title' ? 'different synthetic title' : draft.title;
      const rows = ledger.posts ? Array.from({ length: ledger.posts }, (_, i) => `<li><a href="/${ledger.variant === 'address' ? 99 : i + 1}">${escapeHtml(title)}</a><span class="txt_cate">${escapeHtml(ledger.variant === 'category' ? 'different' : draft.category)}</span>${ledger.variant === 'public' ? '' : '<span class="ico_private">private</span>'}</li>`).join('') : '<li><a href="/99">not published</a><span class="txt_cate">none</span></li>';
      const list = `<a class="link_write" href="/manage/post">write</a><ul>${rows}</ul>`;
      let index = 0;
      let html = renderDraft(draft, block => { const i = index++; if (ledger.variant === 'count' && i === 1) return ''; const actual = ledger.variant === 'order' ? 1 - i : i; return `<figure><img src="/synthetic-${actual}.png"><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`; });
      if (ledger.variant === 'body') html += '<p>unexpected content</p>';
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body>${url.pathname === '/manage/posts' ? list : `<h1>${escapeHtml(title)}</h1><div class="contents_style">${html}</div>`}</body></html>` });
    });
    const verifier = new Publisher();
    verifier.probe = { blog: job.snapshot.blog, context, persistIfAuthenticated: async () => {} } as unknown as TistoryProbe;
    try { return await verifier.verify(job); } finally { await context.close(); }
  }
}
try {
  if (mode === 'enqueue') {
    const job = store.enqueue('publish', config.draftId); process.send?.({ enqueued: job.id });
  } else {
    check(store.acquire(owner), 'LEASE_NOT_EXPIRED');
    heartbeat = setInterval(() => store.heartbeat(owner), 3000);
    action(store.db, 'automatic'); const publisher = new MockPublisher();
    for (let i = 0; i < 3; i++) await runPublicationOnce(store, owner, publisher);
    process.send?.({ finished: true });
  }
} catch { process.send?.({ failed: 'CHILD_CHECK_FAILED' }); process.exitCode = 1; }
finally { clearInterval(heartbeat); await browser?.close(); store.release(owner); store.db.close(); if (process.connected) process.disconnect(); }
