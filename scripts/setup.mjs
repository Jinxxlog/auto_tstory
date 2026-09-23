import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { appRoot, checkEnvironment, portAvailable } from './environment.mjs';
import { alive, readRuntime } from './runtime-control.mjs';

process.chdir(appRoot);
try {
  const state = await readRuntime();
  if (state && alive(state.pid)) throw new Error('설치 전에 Stop.cmd로 글담을 종료하세요.');
  if (!await portAvailable()) throw new Error('3000 포트가 사용 중입니다. 실행 중인 앱을 먼저 종료하세요.');
  const checks = await checkEnvironment({ production: false, dependencies: false, checkPort: false });
  for (const item of checks) console.log(`[${item.level}] ${item.message}`);
  if (checks.some(item => item.level === 'error')) throw new Error('설치 환경을 먼저 준비하세요.');
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  let npmCli;
  for (const candidate of candidates) if (path.basename(candidate) === 'npm-cli.js' && await access(candidate).then(() => true, () => false)) { npmCli = candidate; break; }
  if (!npmCli) throw new Error('Node.js와 함께 설치된 npm을 찾지 못했습니다. Node.js 설치 상태를 확인하세요.');
  async function npm(args) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npmCli, ...args], { cwd: appRoot, windowsHide: true, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', npm_config_cache: path.join(appRoot, '.local/npm-cache') } });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`설치 단계 실패: npm ${args[0]}. 원고와 인증 자료는 삭제하지 않았습니다.`)));
    });
  }
  console.log('1/3 잠금 파일 기준으로 빌드 의존성을 설치합니다.');
  await npm(['ci', '--include=dev', '--no-audit', '--no-fund']);
  console.log('2/3 배포용 앱을 빌드합니다.');
  await npm(['run', 'build']);
  await npm(['run', 'test:build-artifacts']);
  console.log('3/3 실행 의존성만 남깁니다.');
  await npm(['prune', '--omit=dev', '--no-audit', '--no-fund']);
  console.log('설치 완료. Start.cmd로 실행하세요. 업데이트/롤백 자동화는 아직 지원하지 않습니다.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
