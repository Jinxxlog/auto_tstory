import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { TistoryProbe } from '../src/services/tistory/probe.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { projectRoot } from '../src/services/tistory/config.js';

const { values } = parseArgs({ options: { blog: { type: 'string' }, help: { type: 'boolean' } } });
const help = '명령: status | blog https://이름.tistory.com | checkpoint | inspect | editor | screenshot | restart | action <단계> | quit';
if (values.help) {
  console.log('npm run p0 -- --blog https://이름.tistory.com\n' + help);
} else {
  const probe = new TistoryProbe(values.blog);
  let lines: ReturnType<typeof createInterface> | undefined;
  probe.onClosed = () => lines?.close();
  const close = async () => { lines?.close(); await probe.close(); };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  try {
    await probe.start();
    console.log('전용 Chrome이 열렸습니다. 로그인은 브라우저에서 직접 진행하세요.');
    console.log('로그인은 브라우저에서 진행하세요. action save-private <카테고리>는 실제 비공개 글을 저장합니다.');
    console.log(help);
    console.log(JSON.stringify(await probe.status()));
    lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of lines) {
      const [command, ...args] = line.trim().split(/\s+/);
      if (!command) continue;
      try {
        if (command === 'quit') break;
        let result: unknown;
        switch (command) {
          case 'status': result = await probe.status(); break;
          case 'blog': result = await probe.setBlog(args.join(' ')); break;
          case 'inspect': {
            const inspection = await probe.inspect();
            result = { saved: '.local/last-inspection.json', url: inspection.url, frames: inspection.frames.map(frame => ({ name: frame.name, controls: frame.controls.length })) };
            break;
          }
          case 'editor': result = await probe.editor(); break;
          case 'screenshot': result = await probe.screenshot(); break;
          case 'checkpoint': result = await probe.checkpoint(); break;
          case 'restart': result = await probe.restart(); break;
          case 'action': {
            // Reload the inspected editor adapter between P0 development steps.
            const moduleUrl = pathToFileURL(path.join(projectRoot, 'src/services/tistory/actions.ts'));
            moduleUrl.searchParams.set('version', String(Date.now()));
            const adapter = await import(moduleUrl.href);
            result = await adapter.run(probe, args);
            break;
          }
          default: result = help;
        }
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(error instanceof Error ? error.message.split('\n')[0] : '작업 실패');
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message.split('\n')[0] : '브라우저 실행 실패');
    process.exitCode = 1;
  } finally { await close(); }
}
