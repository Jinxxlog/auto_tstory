// Creates up to three synthetic PRIVATE posts. Never retries a publication.
import path from 'node:path';
import os from 'node:os';
import { appendAttempts, executionSummary } from './recovery/measurements';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { openStore } from '../src/lib/store';
import { importImage } from '../src/lib/assets';
import { withBlocks } from '../src/lib/blocks';
import type { DraftBlock, Job } from '../src/lib/model';
import { assertTestRoot, check, events, installTrace, privateMarker } from './recovery/support';

check(process.argv.includes('--private-test') && process.argv.includes('--recovery-test'), 'EXPLICIT_PRIVATE_TEST_REQUIRED');
Object.assign(process.env, { NODE_ENV: 'test' });
const root = path.resolve('.local/publish-recovery-live'); assertTestRoot(root); await mkdir(root, { recursive: true });
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');
const output = path.resolve('measurements/blog-publish-recovery-' + date + '.json');
check(existsSync(output), 'RUN_MOCK_MATRIX_FIRST');
const report = JSON.parse(readFileSync(output, 'utf8'));
check(report.batches.at(-1)?.total === 30 && report.batches.at(-1)?.passed === 30, 'MOCK_MATRIX_MUST_PASS');
const db = new DatabaseSync(path.resolve('data/app.sqlite'), { readOnly: true });
const settings = JSON.parse(String(db.prepare('SELECT body FROM settings WHERE id=1').get()?.body)); db.close();
const metadata = {
  os: os.platform() + ' ' + os.release() + ' ' + os.arch(), node: process.version,
  playwright: JSON.parse(readFileSync('node_modules/playwright/package.json', 'utf8')).version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
  dirty: true, platform: 'tistory', visibility: 'private', accountCount: 1, skinCount: 1,
};
type LiveResult = {
  scenario: string; mode: string; attempted: boolean; passed: boolean; failure: string | null;
  posts: number | null; duplicateJobs: number; duplicatePosts: number | null; automaticRepublish: number;
  falseSuccesses: number; publishCalls: number; saveClicks: number; recoverySuccesses: number; restartRecoveries: number;
  restartIdPreserved: boolean | null; snapshotPreserved: boolean | null; appRestarted: boolean;
  workerRestarted: boolean; recoveryMs: number | null; finalState: string; leaseRemaining: number;
  activeJobsRemaining: number; events: ReturnType<typeof events>;
};
const results: LiveResult[] = (report.live?.results ?? []).filter((r: LiveResult) => r.passed);
const executedScenarios: string[] = [];
const previous = report.live?.attempts ?? [];
function save() {
  const sum = (key: 'duplicateJobs'|'automaticRepublish'|'falseSuccesses'|'recoverySuccesses'|'restartRecoveries') => results.reduce((n,r)=>n+r[key],0);
  const times = results.flatMap(r=>r.recoveryMs===null?[]:[r.recoveryMs]).sort((a,b)=>a-b);
  report.live = {
    status: results.length===3 && results.every(r=>r.passed) ? 'passed' : 'incomplete',
    checkedAt: new Date().toISOString(), metadata, total: results.filter(r=>r.attempted).length,
    passed: results.filter(r=>r.passed).length, duplicateJobs:sum('duplicateJobs'),
    duplicatePosts:results.some(r=>r.duplicatePosts===null)?null:results.reduce((n,r)=>n+r.duplicatePosts!,0),
    automaticRepublish:sum('automaticRepublish'),falseSuccesses:sum('falseSuccesses'),
    recoverySuccesses:sum('recoverySuccesses'),restartRecoveries:sum('restartRecoveries'),
    recoveryTime:{samples:times.length,meanMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,definition:'Explicit read-only recovery through verification and private access check; excludes initial fault and app restart.'},
    attempts:appendAttempts(previous,results,executedScenarios),
    totalAttempts:previous.length+executedScenarios.length,
    failedAttempts:previous.filter((r: LiveResult)=>!r.passed).length+results.filter(r=>executedScenarios.includes(r.scenario)&&!r.passed).length,executedScenarios,results,
  };
  report.executionSummary=executionSummary(report);
  writeFileSync(output,JSON.stringify(report,null,2));
}
async function child(directory:string,mode:string) {
  return new Promise<{pid:number|undefined;state?:string;failure?:string;exit:number|null}>(resolve=>{
    const p=spawn(process.execPath,['--import','tsx','scripts/recovery/live-child.ts',directory,mode,'--recovery-test','--private-test'],{env:{...process.env,NODE_ENV:'test'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const status:{pid:number|undefined;state?:string;failure?:string;exit:number|null}={pid:p.pid,exit:null};
    // A long operation is failed conservatively; never automatically republish it.
    const timer=setTimeout(()=>p.kill(),240000);
    p.on('message',(m:{state?:string;failure?:string})=>Object.assign(status,m));
    p.on('error',()=>{clearTimeout(timer);resolve({...status,exit:1,failure:'LIVE_CHILD_START_FAILED'});});
    p.on('exit',exit=>{clearTimeout(timer);resolve({...status,exit});});
  });
}
let server:ChildProcess|undefined;
async function stopServer() { if(server && server.exitCode===null) { const ended=once(server,'exit');server.kill();await ended; } server=undefined; }
async function startServer(directory:string) {
  server=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3000'],{env:{...process.env,NODE_ENV:'production',TSTORY_DATA_DIR:path.join(directory,'data'),PORT:'3000'},windowsHide:true,stdio:'ignore'});
  for(let i=0;i<100;i++) {
    check(server.exitCode===null,'LIVE_APP_START_FAILED');
    try { if((await fetch('http://127.0.0.1:3000/api/app')).ok)return server.pid; } catch { /* starting */ }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('LIVE_APP_NOT_READY');
}
for(const scenario of ['E1','E2','E3']) {
  if(results.some(r=>r.scenario===scenario && r.passed))continue;
  executedScenarios.push(scenario);
  const directory=path.join(root,scenario);await mkdir(directory,{recursive:true});
  const store=openStore(path.join(directory,'data'));installTrace(store.db,scenario);
  const result:LiveResult={scenario,mode:'live',attempted:false,passed:false,failure:null,posts:null,duplicateJobs:0,duplicatePosts:null,automaticRepublish:0,falseSuccesses:0,publishCalls:0,saveClicks:0,recoverySuccesses:0,restartRecoveries:0,restartIdPreserved:null,snapshotPreserved:null,appRestarted:false,workerRestarted:false,recoveryMs:null,finalState:'not-started',leaseRemaining:0,activeJobsRemaining:0,events:[]};
  const configFile=path.join(directory,'live.json');let jobId='';
  try {
    // Marker is intentionally stable across invocations. Reruns may verify, never republish.
    if(!existsSync(configFile)) {
      store.setSettings({blog:settings.blog,categories:settings.categories,connection:'연결됨'});
      const blocks:DraftBlock[]=[{id:'intro',type:'text',markdown:'## 비공개 복구 검증\n\n합성 자료로 중복 게시 방지와 기존 결과 확인을 검사합니다.'}];
      for(let i=0;i<2;i++) {
        const buffer=await sharp({create:{width:640+i*19,height:400+i*13,channels:3,background:i?'#39784d':'#3b59a1'}}).png().toBuffer();
        const asset=await importImage(new File([buffer],'synthetic-'+i+'.png',{type:'image/png'}),false,store.root);store.addAsset(asset);
        blocks.push({id:'image-'+i,type:'image',imageId:asset.id,caption:'합성 사진 '+(i+1),description:'사진 뒤의 검증 문단 '+(i+1),note:'',group:''});
      }
      const draft=store.saveDraft(withBlocks({id:'',version:0,title:'[복구 비공개 검증 '+scenario+'] '+date+' '+randomUUID().slice(0,8),kind:'project',summary:'합성 검증',markdown:'',category:'테스트',images:[],cover:null,updatedAt:''},blocks));
      jobId=store.enqueue('publish',draft.id).id;
      await writeFile(configFile,JSON.stringify({jobId,scenario,posts:null,publishCalls:0,saveClicks:0,automaticRepublish:0}));
    } else jobId=JSON.parse(readFileSync(configFile,'utf8')).jobId;
    result.attempted=true;
    let firstPid:number|undefined;let appPid:number|undefined;
    if(scenario==='E3')appPid=await startServer(directory);
    const priorConfig=JSON.parse(readFileSync(configFile,'utf8'));
    if(priorConfig.publishCalls===0 && store.job(jobId).state==='queued') {
      const initial=await child(directory,'publish');firstPid=initial.pid;
      check(initial.exit===0,initial.failure??'INITIAL_LIVE_WORKER_FAILED');
    }
    const current=store.job(jobId);
    if(scenario==='E1') check(current.state==='succeeded','E1_NORMAL_NOT_VERIFIED');
    else {
      check(['unknown','needs_attention','succeeded'].includes(current.state),'LIVE_EXPECTED_UNCERTAINTY');
      const before=privateMarker(current);
      if(scenario==='E3') {
        const response=await fetch('http://127.0.0.1:3000/api/app');const data=await response.json();
        check(data.jobs.some((j:Job)=>j.id===jobId&&JSON.stringify(j.snapshot)===before.snapshot),'APP_BEFORE_RESTART_MISMATCH');
        await stopServer(); const newPid=await startServer(directory);
        result.appRestarted=appPid!==newPid;
        const after=await (await fetch('http://127.0.0.1:3000/api/app')).json();
        const restored=after.jobs.find((j:Job)=>j.id===jobId);
        result.restartIdPreserved=restored?.id===before.id;
        result.snapshotPreserved=JSON.stringify(restored?.snapshot)===before.snapshot;
        check(result.appRestarted&&result.restartIdPreserved&&result.snapshotPreserved,'LIVE_APP_RESTART_MISMATCH');
      }
      const idle=await child(directory,'idle');check(idle.exit===0,'LIVE_IDLE_FAILED');
      result.workerRestarted=!!firstPid&&firstPid!==idle.pid;
      check(store.enqueue('publish',current.snapshot.draft!.id).id===jobId,'LIVE_DUPLICATE_JOB');
      const t=performance.now();const verified=await child(directory,'verify');
      check(verified.exit===0,verified.failure??'LIVE_VERIFY_CHILD_FAILED');
      check(store.job(jobId).state==='succeeded','LIVE_EXISTING_POST_NOT_VERIFIED');
      result.recoveryMs=performance.now()-t;result.recoverySuccesses=1;
      if(scenario==='E3') {check(result.workerRestarted,'LIVE_WORKER_NOT_RESTARTED');result.restartRecoveries=1;}
    }
    const counts=JSON.parse(readFileSync(configFile,'utf8'));
    check(counts.publishCalls===1&&counts.saveClicks===1&&counts.posts===1&&counts.automaticRepublish===0,'LIVE_DUPLICATE_OR_CLICK_MISMATCH');
    result.passed=true;
  } catch(error) {
    result.failure=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'LIVE_SCENARIO_EXCEPTION';
  } finally {
    await stopServer();
    if(existsSync(configFile)) {
      const c=JSON.parse(readFileSync(configFile,'utf8'));
      result.posts=c.posts;result.duplicatePosts=c.posts===null?null:Math.max(0,c.posts-1);
      result.publishCalls=c.publishCalls;result.saveClicks=c.saveClicks;result.automaticRepublish=c.automaticRepublish;
    }
    const count=store.db.prepare('SELECT COUNT(*) n FROM jobs').get()!;
    result.duplicateJobs=Math.max(0,Number(count.n)-1);
    result.leaseRemaining=Number(store.db.prepare('SELECT COUNT(*) n FROM lease').get()!.n);
    result.activeJobsRemaining=Number(store.db.prepare("SELECT COUNT(*) n FROM jobs WHERE state IN ('queued','running')").get()!.n);
    if(jobId)result.finalState=store.job(jobId).state;
    result.events=events(store.db);store.db.close();
    if(result.leaseRemaining||result.activeJobsRemaining||result.duplicateJobs||result.duplicatePosts||result.automaticRepublish) {result.passed=false;result.failure??='LIVE_COMMON_CONDITION_FAILED';}
    results.push(result);save();console.log(JSON.stringify({scenario,passed:result.passed,state:result.finalState,failure:result.failure,saveClicks:result.saveClicks,posts:result.posts}));
  }
  if(!result.passed)break; // Do not create more external posts after an unexpected failure.
}
check(results.length===3&&results.every(r=>r.passed),'LIVE_MATRIX_INCOMPLETE');



