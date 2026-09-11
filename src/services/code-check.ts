import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { Draft } from '../lib/model';
import type { Example } from '../lib/material';
import type { openStore } from '../lib/store';

export type CodeCheck = { id: string; draftId: string; version: number; hash: string; code: string; cases: Example[]; state: 'queued' | 'running' | 'passed' | 'failed' | 'unavailable'; message: string; results: { actual: string; passed: boolean }[]; createdAt: string };
export const codeHash = (code: string, cases: Example[]) => createHash('sha256').update(JSON.stringify({ code, cases })).digest('hex');
export const dockerImage = 'python:3.12-slim';
export const dockerArgs = (name: string) => ['run', '--rm', '--pull=never', '--name', name, '--network=none', '--read-only', '--user=65534:65534', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=32', '--memory=128m', '--memory-swap=128m', '--cpus=1', '--ulimit=cpu=2:2', '--ulimit=nofile=64:64', '--tmpfs=/tmp:rw,noexec,nosuid,size=8m', '-i', dockerImage, 'python', '-I', '-B', '-c', 'import json,sys,subprocess\nv=json.load(sys.stdin)\np=subprocess.run([sys.executable,"-I","-B","-c",v["code"]],input=v["input"],text=True,cwd="/tmp")\nsys.exit(p.returncode)'];
function command(args: string[], input = '', timeout = 6000): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let bytes = 0; let failed = false; let settled = false;
    const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: ok && !failed, output: Buffer.concat(chunks).toString('utf8') }); };
    const timer = setTimeout(() => { failed = true; child.kill(); finish(false); }, timeout);
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32000) { failed = true; child.kill(); finish(false); } else chunks.push(chunk); });
    // Do not persist Docker stderr, which can contain environment details.
    child.stderr.on('data', () => {}); child.stdin.on('error', () => {});
    child.on('error', () => finish(false)); child.on('close', code => finish(code === 0)); child.stdin.end(input);
  });
}
export function checkStore(store: ReturnType<typeof openStore>) {
  const db = store.db; db.exec('CREATE TABLE IF NOT EXISTS code_checks (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
  const list = (): CodeCheck[] => db.prepare('SELECT body FROM code_checks ORDER BY rowid DESC LIMIT 50').all().map(r => JSON.parse(String(r.body)));
  const put = (v: CodeCheck) => db.prepare('INSERT OR REPLACE INTO code_checks VALUES (?,?)').run(v.id, JSON.stringify(v));
  return { list, put, enqueue(draft: Draft) {
    if (draft.kind !== 'ps' || draft.material?.language !== 'Python' || !draft.material.code.trim() || !draft.material.cases.length) throw new Error('Python 코드와 하나 이상의 예제를 저장하세요. 다른 언어의 실행 검증은 아직 지원하지 않습니다.');
    if (list().some(j => ['queued', 'running'].includes(j.state))) throw new Error('이전 코드 검증을 마친 뒤 실행하세요.');
    const { code, cases } = draft.material;
    const value: CodeCheck = { id: randomUUID(), draftId: draft.id, version: draft.version, hash: codeHash(code, cases), code, cases, state: 'queued', message: '격리 환경 확인 대기', results: [], createdAt: new Date().toISOString() }; put(value); return value;
  }, recover() { for (const value of list().filter(j => j.state === 'running')) put({ ...value, state: 'failed', message: '실행기가 중단되어 결과를 확정하지 못했습니다. 자동 재실행하지 않습니다.' }); } };
}
export async function runCodeCheck(value: CodeCheck): Promise<CodeCheck> {
  if (!(await command(['image', 'inspect', dockerImage], '', 4000)).ok) return { ...value, state: 'unavailable', message: '코드 미실행: Docker 실행 환경과 로컬 python:3.12-slim 이미지가 필요합니다. 이미지를 자동 설치하지 않습니다.' };
  const results: CodeCheck['results'] = [];
  for (const example of value.cases) {
    const name = `tstory-check-${randomUUID()}`;
    let run: { ok: boolean; output: string };
    try { run = await command(dockerArgs(name), JSON.stringify({ code: value.code, input: example.input })); }
    finally { await command(['rm', '-f', name], '', 3000); }
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
    results.push({ actual: run.output, passed: run.ok && normalize(run.output) === normalize(example.expected) });
    if (!run.ok) return { ...value, results, state: 'failed', message: '실행 실패 또는 시간·출력 제한 초과. 통과로 판정하지 않았습니다.' };
  }
  const passed = results.every(r => r.passed);
  return { ...value, results, state: passed ? 'passed' : 'failed', message: passed ? '입력한 예제만 일치했습니다. 정당성 증명이나 온라인 저지 정답 판정이 아닙니다.' : '기대 출력과 다른 결과가 있습니다.' };
}
