import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { appRoot, runtimeRoot } from './environment.mjs';

export const installationId = createHash('sha256').update(path.resolve(appRoot)).digest('hex');
export const stateFile = () => path.join(runtimeRoot(), 'launcher.json');
export async function readRuntime() {
  try {
    const state = JSON.parse(await readFile(stateFile(), 'utf8'));
    if (state.installation !== installationId || !Number.isSafeInteger(state.pid) || state.pid <= 0 || !Number.isSafeInteger(state.port) || state.port < 1 || state.port > 65535 || !/^[a-f0-9]{64}$/.test(state.token) || typeof state.instance !== 'string') throw new Error('실행 상태 파일을 확인할 수 없습니다. 다른 설치 폴더의 상태를 재사용하지 마세요.');
    return state;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function control(state, command = 'status') {
  const response = await fetch(`http://127.0.0.1:${state.port}/${command}`, { method: command === 'stop' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000), redirect: 'error' });
  if (!response.ok) throw new Error('이 설치의 실행기를 확인하지 못했습니다.');
  const value = await response.json();
  if (value.instance !== state.instance || value.installation !== installationId) throw new Error('다른 프로그램의 응답입니다. 종료하지 않습니다.');
  return value;
}
export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
