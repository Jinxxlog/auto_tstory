import { createHash, randomUUID } from 'node:crypto';
import { openStore } from '../src/lib/store';
import { Publisher } from '../src/services/tistory/publisher';
import { runPublicationOnce } from '../src/services/publication-runner';
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
    const outcome = await runPublicationOnce(store, owner, publisher, () => stopped, async (_error, job) => {
      // Avoid logging account URLs, article content, error stacks or DOM snapshots.
      console.log(JSON.stringify({ jobKey: createHash('sha256').update(job.id).digest('hex').slice(0, 24), state: store.job(job.id).state }));
    });
    if (outcome === 'lost-lease') stop();
    if (outcome === 'idle') await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { clearInterval(heartbeat); ai.close(); await publisher.close(); store.release(owner); store.db.close(); if (process.connected) process.disconnect(); }
