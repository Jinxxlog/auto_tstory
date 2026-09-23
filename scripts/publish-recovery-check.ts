import path from 'node:path';
import os from 'node:os';
import { executionSummary } from './recovery/measurements';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { openStore } from '../src/lib/store';
import { importImage } from '../src/lib/assets';
import { withBlocks } from '../src/lib/blocks';
import type { DraftBlock } from '../src/lib/model';
import { action, assertTestRoot, changeLedger, check, emptyLedger, events, installTrace, privateMarker, readLedger, type Fault, type Variant, type SafeEvent } from './recovery/support';

check(process.argv.includes('--recovery-test'), 'EXPLICIT_TEST_REQUIRED');
Object.assign(process.env, { NODE_ENV: 'test' });
await mkdir('.local', { recursive: true }); await mkdir('measurements', { recursive: true });
const root = await mkdtemp(path.resolve('.local/publish-recovery-')); assertTestRoot(root);
const scenarios = ['S1','S2','S3','S4','S5','S6'] as const;
type Scenario = typeof scenarios[number];
export type Measurement = {
  scenario: string; repetition: number; mode: 'mock' | 'live'; passed: boolean; failure: string | null;
  duplicateJobs: number; duplicatePosts: number; automaticRepublish: number; falseSuccesses: number;
  posts: number; publishCalls: number; saveClicks: number; recoverySuccesses: number; restartRecoveries: number;
  restartIdPreserved: boolean | null; snapshotPreserved: boolean | null; recoveryMs: number | null;
  leaseRemaining: number; activeJobsRemaining: number; finalState: string; rejectedCandidates: number; events: SafeEvent[];
};
const results: Measurement[] = [];
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replaceAll('-','');
const output = path.resolve(`measurements/blog-publish-recovery-${date}.json`);
// Never overwrite earlier failures: each invocation is an independently retained batch.
let prior: { batches: { total: number; passed: number }[]; live?: Parameters<typeof executionSummary>[0]['live'] } = { batches: [] };
try { prior = JSON.parse(readFileSync(output, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const startedAt = new Date().toISOString();
const metadata = { os: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, playwright: JSON.parse(readFileSync('node_modules/playwright/package.json', 'utf8')).version, commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(), dirty: !!execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8',windowsHide:true}).trim(), platform: 'tistory', visibility: 'private', mode: 'mock', repetitions: 5 };
function save() {
  const times = results.flatMap(r => r.recoveryMs === null ? [] : [r.recoveryMs]).sort((a,b)=>a-b);
  const sum = (key: 'duplicateJobs'|'duplicatePosts'|'automaticRepublish'|'falseSuccesses'|'recoverySuccesses'|'restartRecoveries') => results.reduce((n,r)=>n+r[key],0);
  const batch = { startedAt, metadata, total: results.length, passed: results.filter(r=>r.passed).length, byScenario: Object.fromEntries(scenarios.map(s=>[s,{total:results.filter(r=>r.scenario===s).length,passed:results.filter(r=>r.scenario===s&&r.passed).length}])), duplicateJobs:sum('duplicateJobs'),duplicatePosts:sum('duplicatePosts'),automaticRepublish:sum('automaticRepublish'),falseSuccesses:sum('falseSuccesses'),recoverySuccesses:sum('recoverySuccesses'),restartRecoveries:sum('restartRecoveries'),recoveryTime:{samples:times.length,meanMs:times.length?times.reduce((a,b)=>a+b,0)/times.length:null,p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,definition:'Explicit verification request through terminal successful state; lease waiting excluded.'},results };
  const report={schemaVersion:1,batches:[...prior.batches,batch],live:prior.live??{status:'not-run',total:0,results:[]}};
  writeFileSync(output,JSON.stringify({...report,executionSummary:executionSummary(report)},null,2));
}
async function child(directory: string, mode='run', kill=false) {
  return new Promise<{ids:string[];exit:number|null}>(resolve=>{
    const ids:string[]=[];
    const p=spawn(process.execPath,['--import','tsx','scripts/recovery/child.ts',directory,mode,'--recovery-test'],{env:{...process.env,NODE_ENV:'test'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    let barrier=false;
    const timer=setTimeout(()=>p.kill(),45000);
    p.on('message',(message: {barrier?:string;enqueued?:string})=>{if(message.enqueued)ids.push(message.enqueued);if(message.barrier){barrier=true;if(kill)p.kill();}});
    p.on('error',()=>{clearTimeout(timer);resolve({ids,exit:1});});
    p.on('exit',(code)=>{clearTimeout(timer);resolve({ids,exit:kill&&barrier?86:code});});
  });
}
async function scenario(scenario: Scenario,repetition:number):Promise<Measurement> {
  const directory=path.join(root,`${scenario}-${repetition}`);await mkdir(directory);const store=openStore(path.join(directory,'data'));installTrace(store.db,scenario);
  const result:Measurement={scenario,repetition,mode:'mock',passed:false,failure:null,duplicateJobs:0,duplicatePosts:0,automaticRepublish:0,falseSuccesses:0,posts:0,publishCalls:0,saveClicks:0,recoverySuccesses:0,restartRecoveries:0,restartIdPreserved:null,snapshotPreserved:null,recoveryMs:null,leaseRemaining:0,activeJobsRemaining:0,finalState:'not-started',rejectedCandidates:0,events:[]};
  let jobId='';
  try {
    store.setSettings({blog:'https://example.tistory.com',categories:['테스트'],connection:'synthetic'});
    const blocks:DraftBlock[]=[{id:'intro',type:'text',markdown:'## Synthetic recovery check\n\nBody before photos.'}];
    for(let i=0;i<2;i++) {
      const bytes=await sharp({create:{width:64+i,height:40+i,channels:3,background:i?'#228855':'#3355aa'}}).png().toBuffer();
      const asset=await importImage(new File([bytes],`synthetic-${i}.png`,{type:'image/png'}),false,store.root);store.addAsset(asset);
      blocks.push({id:`photo-${i}`,type:'image',imageId:asset.id,note:'',caption:`Synthetic ${i}`,description:`After photo ${i}.`,group:''});
    }
    const draft=store.saveDraft(withBlocks({id:'',version:0,title:`Synthetic ${scenario} ${repetition}`,kind:'project',summary:'',markdown:'',category:'테스트',images:[],cover:null,updatedAt:''},blocks));
    writeFileSync(path.join(directory,'external.json'),JSON.stringify(emptyLedger()));
    const config={jobId:'',draftId:draft.id,fault:'none' as Fault};
    const configure=(fault:Fault)=>{config.fault=fault;config.jobId=jobId;writeFileSync(path.join(directory,'config.json'),JSON.stringify(config));};
    configure('none');
    if(scenario==='S1') {
      const pair=await Promise.all([child(directory,'enqueue'),child(directory,'enqueue')]);
      check(pair.every(r=>r.exit===0&&r.ids.length===1),'CONCURRENT_ENQUEUE_FAILED');
      jobId=pair[0].ids[0];check(pair[1].ids[0]===jobId,'DUPLICATE_JOB_ID');
    } else jobId=store.enqueue('publish',draft.id).id;
    configure(scenario==='S2'?'before-request-kill':scenario==='S4'?'after-url-kill':scenario==='S5'?'created-before-url-kill':scenario==='S3'||scenario==='S6'?'response-lost':'none');
    const crash=['S2','S4','S5'].includes(scenario);
    check((await child(directory,'run',crash)).exit===(crash?86:0),'FIRST_WORKER_FAILED');
    const before=privateMarker(store.job(jobId));
    if(crash) {
      check(store.job(jobId).state==='running','CRASH_NOT_DURABLE');
      const expires=Number(store.db.prepare('SELECT expires FROM lease').get()?.expires);
      check(expires>Date.now(),'MISSING_CRASH_LEASE');
      // Real expiry, no forged timestamps or manual lease deletion.
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now())+80));
    }
    configure('none');
    check((await child(directory)).exit===0,'RESTART_FAILED');
    if(crash) {result.restartIdPreserved=store.job(jobId).id===before.id;result.snapshotPreserved=JSON.stringify(store.job(jobId).snapshot)===before.snapshot;check(result.restartIdPreserved&&result.snapshotPreserved,'RESTART_CHANGED_SNAPSHOT');}
    if(scenario==='S1') check(store.job(jobId).state==='succeeded','NORMAL_NOT_VERIFIED');
    else {
      check(['unknown','needs_attention'].includes(store.job(jobId).state),'UNSAFE_UNCERTAIN_STATE');
      check(store.enqueue('publish',draft.id).id===jobId,'DUPLICATE_AFTER_RESTART');
      let refused=false;try{store.resume(jobId);}catch{refused=true;}check(refused,'UNSAFE_RESUME_ALLOWED');
      check((await child(directory)).exit===0,'IDLE_GUARD_FAILED');
      const verify=async(variant:Variant,expectSuccess:boolean)=>{
        changeLedger(directory,value=>{value.variant=variant;});action(store.db,'explicit-verification');
        const start=performance.now();store.verify(jobId,'https://example.tistory.com/1');check((await child(directory)).exit===0,'VERIFY_CHILD_FAILED');
        const succeeded=store.job(jobId).state==='succeeded';if(!expectSuccess&&succeeded)result.falseSuccesses++;
        check(succeeded===expectSuccess,'WRONG_VERIFY_RESULT');
        if(succeeded){result.recoverySuccesses++;result.recoveryMs=performance.now()-start;}
        else {check(store.job(jobId).state==='needs_attention','VERIFY_NOT_ATTENTION');result.rejectedCandidates++;}
      };
      if(scenario==='S2') {
        await verify('matching',false); // No post exists: must never report success.
        action(store.db,'explicit-close');store.resolveUnpublished(jobId,true);
        check(store.enqueue('publish',draft.id).id===jobId,'CLOSED_JOB_DUPLICATED');
      } else if(scenario==='S6') {
        let refused=false;try{store.verify(jobId,'https://other.tistory.com/1');}catch{refused=true;}
        check(refused,'OTHER_BLOG_ACCEPTED');result.rejectedCandidates++;
        for(const variant of ['address','title','body','public','category','count','order'] as const)await verify(variant,false);
      } else {
        if(scenario==='S4') await verify('network-error',false);
        if(scenario==='S5'){let refused=false;try{store.verify(jobId);}catch{refused=true;}check(refused,'MISSING_URL_ACCEPTED');}
        await verify('matching',true);
        if(crash)result.restartRecoveries++;
      }
    }
    const ledger=readLedger(directory);
    check(ledger.publishCalls===1&&ledger.posts<2&&ledger.automaticRepublish===0,'DUPLICATE_PUBLICATION');
    check(ledger.nonGetRequests===0,'VERIFIER_MUTATED_REMOTE');
    result.passed=true;
  } catch(error) {result.failure=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'SCENARIO_EXCEPTION';}
  finally {
    const counts=store.db.prepare('SELECT COUNT(*) AS total,COUNT(DISTINCT dedupe) AS distinctKeys FROM jobs').get()!;
    result.duplicateJobs=Number(counts.total)-Number(counts.distinctKeys);
    result.leaseRemaining=Number(store.db.prepare('SELECT COUNT(*) AS n FROM lease').get()!.n);
    result.activeJobsRemaining=Number(store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running')").get()!.n);
    if(jobId)result.finalState=store.job(jobId).state;
    try {const ledger=readLedger(directory);result.posts=ledger.posts;result.publishCalls=ledger.publishCalls;result.saveClicks=ledger.clicks;result.duplicatePosts=Math.max(0,ledger.posts-1);result.automaticRepublish=ledger.automaticRepublish;} catch { /* setup failure remains failed */ }
    result.events=events(store.db);store.db.close();
    if(result.leaseRemaining||result.activeJobsRemaining||result.duplicateJobs||result.duplicatePosts||result.automaticRepublish||result.falseSuccesses){result.passed=false;result.failure??='COMMON_CONDITION_FAILED';}
  }
  return result;
}
for(const id of scenarios) {
  // Each repetition owns an isolated DB, process and synthetic remote ledger.
  const wave=await Promise.all(Array.from({length:5},(_,index)=>scenario(id,index+1)));
  results.push(...wave);save();console.log(JSON.stringify({scenario:id,total:wave.length,passed:wave.filter(r=>r.passed).length,failures:wave.filter(r=>!r.passed).map(r=>r.failure)}));
}
await writeFile(path.join(root,'complete.json'),JSON.stringify({output:path.basename(output),total:results.length,passed:results.filter(r=>r.passed).length}));
check(results.length===30&&results.every(r=>r.passed),'RECOVERY_MATRIX_FAILED');
