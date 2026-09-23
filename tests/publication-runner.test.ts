import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../src/lib/store';
import { runPublicationOnce, type PublicationAdapter } from '../src/services/publication-runner';

test('publication uncertainty is durable before diagnostics; idle ticks never republish', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'tstory-runner-'));const store=openStore(root);
  try {
    store.setSettings({blog:'https://example.tistory.com',categories:['test'],connection:'synthetic'});
    const draft=store.saveDraft({id:'',version:0,title:'Synthetic',kind:'project',summary:'',markdown:'Synthetic body',category:'test',images:[],cover:null});
    const job=store.enqueue('publish',draft.id);store.acquire('owner');let calls=0;
    const adapter:PublicationAdapter={categories:async()=>[],verify:async()=>{throw new Error('not expected');},publish:async(_job,step)=>{calls++;step('저장 요청');throw new Error('response lost');}};
    await runPublicationOnce(store,'owner',adapter,()=>false,async()=>{assert.equal(store.job(job.id).state,'unknown');throw new Error('diagnostic failure');});
    assert.equal(store.job(job.id).state,'unknown');assert.equal(await runPublicationOnce(store,'owner',adapter),'idle');assert.equal(calls,1);
  } finally {store.release('owner');store.db.close();}
});

test('an expired worker cannot confirm a publication or overwrite successor recovery', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'tstory-runner-'));const store=openStore(root);
  try {
    store.setSettings({blog:'https://example.tistory.com',categories:['test'],connection:'synthetic'});
    const draft=store.saveDraft({id:'',version:0,title:'Synthetic',kind:'project',summary:'',markdown:'Synthetic body',category:'test',images:[],cover:null});
    const job=store.enqueue('publish',draft.id);store.acquire('old');
    const adapter:PublicationAdapter={categories:async()=>[],verify:async()=>'',publish:async(_job,step)=>{step('저장 요청');store.acquire('new',Date.now()+16000);return 'https://example.tistory.com/1';}};
    assert.equal(await runPublicationOnce(store,'old',adapter),'lost-lease');assert.equal(store.job(job.id).state,'unknown');assert.equal(store.job(job.id).result,null);
    store.release('new');
  } finally {store.db.close();}
});
