import { spawn } from 'node:child_process';
import path from 'node:path';
import { appRoot, origin } from './environment.mjs';
import { alive, control, readRuntime } from './runtime-control.mjs';

const action = process.argv[2] || 'start';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const openBrowser = () => {
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const browser = spawn('explorer.exe', [origin], { windowsHide: true, stdio: 'ignore', detached: true }); browser.on('error', () => {}); browser.unref();
  }
};
try {
  let state = await readRuntime(); let status = state ? await control(state).catch(() => null) : null;
  if (action === 'status') console.log(status ? `글담 상태: ${status.phase}` : '글담이 실행 중이지 않습니다.');
  else if (action === 'stop') {
    if (!status) {
      if (state && alive(state.pid)) throw new Error('실행기의 응답을 확인하지 못했습니다. 다른 프로세스를 임의로 종료하지 않습니다.');
      console.log('글담이 실행 중이지 않습니다.');
    } else {
      await control(state, 'stop');
      for (let attempt = 0; attempt < 120; attempt++) {
        const remaining = await readRuntime();
        if (!remaining || remaining.instance !== state.instance) { console.log('글담 종료 완료. 원고와 로그인 자료는 보존됩니다.'); break; }
        if (attempt === 119) throw new Error('종료가 지연되고 있습니다. 잠시 후 상태를 확인하세요.');
        await delay(250);
      }
    }
  } else if (action === 'start') {
    if (status?.phase === 'ready') { console.log(`이미 실행 중입니다: ${origin}`); openBrowser(); }
    else {
      if (status?.phase === 'stopping') throw new Error('종료 중입니다. 잠시 후 다시 실행하세요.');
      let child;
      if (!status) {
        child = spawn(process.execPath, [path.join(appRoot, 'scripts/run.mjs'), '--production'], { cwd: appRoot, env: process.env, windowsHide: true, detached: true, stdio: 'ignore' });
        child.on('error', () => {}); child.unref();
      }
      let ready = false;
      for (let attempt = 0; attempt < 320; attempt++) {
        state = await readRuntime(); status = state ? await control(state).catch(() => null) : null;
        if (status?.phase === 'ready') { ready = true; break; }
        if (child && (child.exitCode !== null || child.signalCode !== null)) break;
        await delay(250);
      }
      if (!ready) throw new Error('글담을 시작하지 못했습니다. Doctor.cmd와 .local/runtime/lifecycle.log를 확인하세요.');
      console.log(`글담 실행 완료: ${origin}`); openBrowser();
    }
  } else throw new Error('사용법: launcher.mjs start|stop|status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
