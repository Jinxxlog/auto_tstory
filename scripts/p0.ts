import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { TistoryProbe } from '../src/services/tistory/probe.js';

const { values } = parseArgs({ options: { blog: { type: 'string' }, help: { type: 'boolean' } } });
const help = '명령: status | blog https://이름.tistory.com | inspect | editor | screenshot | restart | quit';
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
    console.log('이 도구는 인증 정보를 터미널로 받지 않습니다. 현재 버전은 글을 발행하지 않습니다.');
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
          case 'inspect': result = await probe.inspect(); break;
          case 'editor': result = await probe.editor(); break;
          case 'screenshot': result = await probe.screenshot(); break;
          case 'restart': result = await probe.restart(); break;
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
