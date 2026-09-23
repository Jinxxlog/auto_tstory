import { randomUUID } from 'node:crypto';
import { openStore } from '../src/lib/store';
import { Publisher, LoginRequired, AttentionRequired } from '../src/services/tistory/publisher';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AiRunner } from '../src/services/ai/runner';
import { checkStore, runCodeCheck } from '../src/services/code-check';

const store = openStore(); const owner = randomUUID(); const publisher = new Publisher();
let acquired = store.acquire(owner);
for (let attempt = 0; !acquired && attempt < 16; attempt++) { await new Promise(resolve => setTimeout(resolve, 1000)); acquired = store.acquire(owner); }
if (!acquired) { console.error('다른 실행기가 이미 실행 중입니다.'); store.db.close(); process.exit(1); }
let stopped = false;
const ai = new AiRunner(store);
const checks = checkStore(store); checks.recover();
const stop = () => { stopped = true; ai.close(); void publisher.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('message', message => { if (message === 'shutdown') stop(); });
const heartbeat = setInterval(() => { if (!store.heartbeat(owner)) stop(); }, 3000);
console.log('로컬 실행기 준비 완료');
if (process.connected) process.send?.('ready');
try {
  while (!stopped) {
    if (await ai.tick()) continue;
    const check = checks.list().find(j => j.state === 'queued');
    if (check) { checks.put({ ...check, state: 'running', message: '격리 환경에서 예제 확인 중' }); const result = await runCodeCheck(check); if (!stopped) checks.put(result); continue; }
    const job = store.claim(owner);
    if (!job) { await new Promise(resolve => setTimeout(resolve, 500)); continue; }
    let submitted = false;
    try {
      if (job.kind === 'connect') {
        const categories = await publisher.categories(job.snapshot.blog);
        store.setSettings({ ...store.settings(), categories, connection: '연결됨', checkedAt: new Date().toISOString() });
        store.updateJob(job.id, 'succeeded', `연결 완료 · 카테고리 ${categories.length}개`);
      } else if (job.kind === 'verify' || job.snapshot.postUrl || job.result || job.snapshot.candidatePostUrl) {
        const url = await publisher.verify(job);
        if (stopped || !store.heartbeat(owner)) throw new AttentionRequired('실행기가 중단되어 재확인 결과를 확정하지 못했습니다.');
        store.recordPost(job.id, url);
        store.updateJob(job.id, 'succeeded', '기존 글 제목·본문·비공개·카테고리·사진 확인 완료', url);
      } else {
        const url = await publisher.publish(job, (step, postUrl, imagePaths) => {
          if (stopped || !store.heartbeat(owner)) throw new AttentionRequired('실행기 연결이 중단되었습니다.');
          store.updateJob(job.id, 'running', step);
          if (imagePaths) store.recordImagePaths(job.id, imagePaths);
          if (postUrl) store.recordPost(job.id, postUrl);
          if (step === '저장 요청') submitted = true;
        });
        if (stopped || !store.heartbeat(owner)) throw new AttentionRequired('실행기가 중단되어 저장 결과를 확정하지 못했습니다.');
        store.updateJob(job.id, 'succeeded', '비공개 저장 · 다시 열어 본문과 사진 순서 확인 완료', url);
      }
    } catch (error) {
      // A released/expired worker must not overwrite recovery by its successor.
      if (stopped || !store.heartbeat(owner)) { stop(); continue; }
      if (publisher.probe) await writeFile(path.join(publisher.probe.stateRoot, 'last-worker-error.txt'), error instanceof Error ? error.stack || error.message : 'Unknown error').catch(() => {});
      await publisher.probe?.inspect().catch(() => {});
      const knownUrl = store.job(job.id).snapshot.postUrl || store.job(job.id).result;
      if (submitted && !knownUrl) store.updateJob(job.id, 'unknown', '저장 요청 이후 결과를 확정하지 못했습니다. 글 관리에서 확인하세요.');
      else if (error instanceof LoginRequired) { store.updateJob(job.id, 'needs_login', error.message, knownUrl); store.setSettings({ ...store.settings(), connection: '로그인 필요' }); }
      else if (error instanceof AttentionRequired || knownUrl || job.kind === 'verify' || job.snapshot.candidatePostUrl) store.updateJob(job.id, 'needs_attention', error instanceof AttentionRequired ? error.message : '기존 글 확인을 완료하지 못했습니다. 주소와 로그인 상태를 확인하고 다시 검사하세요.', knownUrl);
      else store.updateJob(job.id, 'failed', '브라우저 작업에 실패했습니다. Chrome이 열려 있는지, P0 실행기가 함께 켜져 있지 않은지 확인하세요.');
      // Raw Playwright errors may contain page content or signed URLs; do not log them.
      console.log(`작업 ${job.id}: ${store.job(job.id).state}`);
    }
  }
} finally { clearInterval(heartbeat); ai.close(); await publisher.close(); store.release(owner); store.db.close(); if (process.connected) process.disconnect(); }
