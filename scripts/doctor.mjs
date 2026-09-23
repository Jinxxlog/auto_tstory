import { checkEnvironment } from './environment.mjs';
const items = await checkEnvironment();
for (const item of items) console.log(`[${item.level === 'ok' ? 'OK' : item.level === 'warning' ? '안내' : '오류'}] ${item.message}`);
if (items.some(item => item.level === 'error')) process.exitCode = 1;
