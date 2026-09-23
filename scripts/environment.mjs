import path from 'node:path';
import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const appRoot = path.resolve(/* turbopackIgnore: true */ process.env.TSTORY_APP_ROOT || process.cwd());
export const origin = 'http://127.0.0.1:3000';
// These directories contain runtime data; never include them in build tracing.
export const runtimeRoot = () => path.resolve(/* turbopackIgnore: true */ process.env.TSTORY_RUNTIME_DIR || path.join(appRoot, '.local/runtime'));
export const dataDirectory = () => path.resolve(/* turbopackIgnore: true */ process.env.TSTORY_DATA_DIR || path.join(appRoot, 'data'));
export const supportedNode = (version = process.versions.node) => {
  const [major, minor] = version.split('.').map(Number); return major === 22 && minor >= 20;
};
// Node 22.20 on Windows failed to honor CommonJS package boundaries under
// non-ASCII paths in our installation check. Fail before downloading/building.
export const supportedInstallPath = (directory = appRoot) => !/[^\x20-\x7e]/.test(directory);
export async function portAvailable() {
  const server = createServer();
  return new Promise(resolve => {
    server.once('error', () => resolve(false));
    server.listen(3000, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
async function writable(directory) {
  const probe = path.join(directory, `.write-check-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  await writeFile(probe, '', { flag: 'wx' }); await unlink(probe);
}
export async function checkEnvironment({ checkPort = true, production = true, dependencies = true } = {}) {
  const items = [];
  items.push({ id: 'installationPath', level: supportedInstallPath() ? 'ok' : 'error', message: supportedInstallPath() ? '설치 경로를 사용할 수 있습니다.' : '현재 배포판은 영문·숫자 경로에 설치해야 합니다. 한글 등 비ASCII 문자가 없는 사용자 소유 폴더로 소스를 옮기세요. 공백은 사용할 수 있습니다.' });
  items.push({ id: 'node', level: supportedNode() ? 'ok' : 'error', message: supportedNode() ? `Node.js ${process.versions.node}` : 'Node.js 22.20 이상인 22.x 버전을 설치하세요.' });
  if (dependencies) {
    try {
      for (const name of ['next', 'tsx', 'sharp', 'playwright']) await access(path.join(appRoot, 'node_modules', name, 'package.json'));
      items.push({ id: 'dependencies', level: 'ok', message: '앱 실행 의존성을 찾았습니다.' });
    } catch { items.push({ id: 'dependencies', level: 'error', message: '실행 의존성이 없습니다. Install.cmd 또는 npm run setup을 실행하세요.' }); }
  }
  if (production) {
    try { await access(path.join(appRoot, '.next/BUILD_ID')); items.push({ id: 'build', level: 'ok', message: '배포용 빌드가 있습니다.' }); }
    catch { items.push({ id: 'build', level: 'error', message: '배포용 빌드가 없습니다. Install.cmd 또는 npm run setup을 실행하세요.' }); }
  }
  for (const [id, directory] of [['data', dataDirectory()], ['runtime', runtimeRoot()]]) {
    try { await writable(directory); items.push({ id, level: 'ok', message: `${id === 'data' ? '원고' : '실행 상태'} 폴더에 저장할 수 있습니다.` }); }
    catch { items.push({ id, level: 'error', message: `${id === 'data' ? '원고' : '실행 상태'} 폴더에 쓰기 권한이 없습니다. 사용자 소유의 폴더에 설치하세요.` }); }
  }
  if (checkPort) {
    const available = await portAvailable();
    items.push({ id: 'port', level: available ? 'ok' : 'error', message: available ? '로컬 3000 포트를 사용할 수 있습니다.' : '3000 포트를 사용 중입니다. 실행 중인 글담은 Stop.cmd로 종료하세요. 다른 프로그램은 자동 종료하지 않습니다.' });
  }
  const chromePaths = process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(base => path.join(base, 'Google/Chrome/Application/chrome.exe')) : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const chrome = (await Promise.all(chromePaths.map(file => access(file).then(() => true, () => false)))).some(Boolean);
  items.push({ id: 'chrome', level: chrome ? 'ok' : 'warning', message: chrome ? 'Google Chrome을 찾았습니다.' : 'Google Chrome을 찾지 못했습니다. 블로그 연결·전송 전에 설치하세요. 수동 원고 작성은 가능합니다.' });
  const cli = spawnSync(/* turbopackIgnore: true */ process.env.TSTORY_CODEX_BIN || 'codex', ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 3000, maxBuffer: 8192, shell: false });
  const version = cli.status === 0 ? cli.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] : undefined;
  items.push({
    id: 'codex', level: version ? 'ok' : 'warning',
    message: version
      ? `AI 실행 도구 ${version} 확인. 계정 연결과 모델 호환성은 별도 확인이 필요합니다.`
      : 'AI 실행 도구를 찾지 못했습니다. AI 사용 전 실행 가능한 Codex를 PATH 또는 TSTORY_CODEX_BIN으로 지정하세요. 수동 원고 작성은 가능합니다.',
  });
  return items;
}
