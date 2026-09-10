import { spawn } from 'node:child_process';
import path from 'node:path';
const production = process.argv.includes('--production');
const children = [
  spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), production ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', '3000'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['--import', 'tsx', 'scripts/worker.ts'], { stdio: ['inherit','inherit','inherit','ipc'], windowsHide: true }),
];
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  children[0].kill('SIGTERM');
  if (children[1].connected) children[1].send('shutdown');
  else children[1].kill('SIGTERM');
  setTimeout(() => children[1].kill('SIGTERM'), 10_000).unref();
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => { if (!stopping) { process.exitCode = code || 0; stop(); } });
