import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile, unlink, appendFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { appRoot, checkEnvironment, runtimeRoot, origin } from './environment.mjs';
import { alive, control, installationId, readRuntime, stateFile } from './runtime-control.mjs';

process.chdir(appRoot);
const production = process.argv.includes('--production');
const instance = randomUUID(); const token = randomBytes(32).toString('hex');
let phase = 'starting'; let ownsState = false; let stopping; let worker; let web;
const exited = new Map();
const event = async message => {
  console.log(message);
  await appendFile(path.join(runtimeRoot(), 'lifecycle.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
};
const controller = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${token}` || request.headers.origin || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '')) { response.writeHead(403).end(); return; }
  const valid = request.method === 'GET' && request.url === '/status' || request.method === 'POST' && request.url === '/stop';
  if (!valid) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ installation: installationId, instance, phase, webPid: web?.pid, workerPid: worker?.pid }));
  if (request.url === '/stop') setImmediate(() => void shutdown());
});
controller.requestTimeout = 3000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForExit(child, timeout) {
  let timer;
  try { return await Promise.race([exited.get(child).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function finishChild(child, graceful) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (graceful && child.connected) child.send('shutdown', () => {}); else child.kill();
  if (await waitForExit(child, 10000)) return;
  await event('종료 대기 시간이 지나 이 실행기가 시작한 자식 프로세스를 정리합니다.');
  child.kill('SIGKILL');
  await waitForExit(child, 3000);
}
async function shutdown(code = 0) {
  if (stopping) return stopping;
  phase = 'stopping'; process.exitCode = code;
  stopping = (async () => {
    await finishChild(worker, true);
    await finishChild(web, false);
    if (controller.listening) { controller.closeAllConnections(); await new Promise(resolve => controller.close(resolve)); }
    if (ownsState) { const state = await readRuntime().catch(() => null); if (state?.instance === instance) await unlink(stateFile()).catch(() => {}); }
    await event(code ? '실행 오류로 종료했습니다. Doctor.cmd로 환경을 확인하세요.' : '웹앱과 작업 실행기를 종료했습니다.');
  })();
  return stopping;
}
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
function startChild(args, ipc = false) {
  const child = spawn(process.execPath, args, { cwd: appRoot, env: { ...process.env, TSTORY_APP_ROOT: appRoot, TSTORY_INSTANCE_ID: instance }, windowsHide: true, stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
  // Never persist child output: it may contain user content or account information.
  child.stdout.on('data', chunk => { if (!production) process.stdout.write(chunk); });
  child.stderr.on('data', chunk => { if (!production) process.stderr.write(chunk); });
  exited.set(child, new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); }));
  child.once('exit', () => { if (!stopping) void shutdown(1); });
  child.once('error', () => { if (!stopping) void shutdown(1); });
  return child;
}
try {
  await mkdir(runtimeRoot(), { recursive: true });
  const previous = await readRuntime();
  if (previous) {
    const status = await control(previous).catch(() => null);
    if (status || alive(previous.pid)) throw new Error('이 설치의 실행기가 이미 실행 중이거나 종료 중입니다. Start.cmd 또는 Stop.cmd를 사용하세요.');
    await unlink(stateFile());
  }
  const checks = await checkEnvironment({ production });
  for (const check of checks.filter(item => item.level !== 'ok')) await event(check.message);
  if (checks.some(item => item.level === 'error')) throw new Error('실행 환경을 먼저 준비하세요.');
  await new Promise((resolve, reject) => { controller.once('error', reject); controller.listen(0, '127.0.0.1', resolve); });
  const port = controller.address().port;
  await writeFile(stateFile(), JSON.stringify({ pid: process.pid, port, token, instance, installation: installationId }), { flag: 'wx', mode: 0o600 }); ownsState = true;
  web = startChild([path.join(appRoot, 'node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3000']);
  // Wait for our own server before allowing a worker to consume queued jobs.
  let ready = false;
  for (let attempt = 0; attempt < 180 && !stopping; attempt++) {
    try { const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) }); const health = await response.json(); if (health.instance === instance) { ready = true; break; } } catch { /* server starting */ }
    await delay(250);
  }
  if (!ready || stopping) throw new Error('웹 서버를 시작하지 못했습니다. 포트와 빌드를 확인하세요.');
  worker = startChild(['--import', 'tsx', path.join(appRoot, 'scripts/worker.ts')], true);
  let workerReady = false;
  worker.on('message', message => { if (message === 'ready') workerReady = true; });
  for (let attempt = 0; attempt < 120 && !workerReady && !stopping; attempt++) await delay(250);
  if (!workerReady || stopping) throw new Error('작업 실행기를 시작하지 못했습니다. 다른 실행기가 열려 있는지 확인하세요.');
  phase = 'ready'; await event(`글담 준비 완료: ${origin}`);
} catch (error) {
  // Startup errors here are controlled messages; filesystem values aren't logged.
  await event(error.code ? '실행 상태 또는 파일 접근 오류입니다. Doctor.cmd로 확인하세요.' : error.message);
  await shutdown(1);
}
