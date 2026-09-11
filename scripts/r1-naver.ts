import { createInterface } from 'node:readline';
import { NaverProbe } from '../src/services/naver/probe.js';

const help = '명령: status | checkpoint | writer | restore-fixture | editor-state | fill-fixture | upload-fixtures | fixture-state | publish-options | categories | prepare-private <카테고리> | save-private <카테고리> | verify-private | inspect | screenshot | quit';
const probe = new NaverProbe();
let lines: ReturnType<typeof createInterface> | undefined;

probe.onClosed = () => lines?.close();
const close = async () => {
  lines?.close();
  await probe.close();
};
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });

try {
  await probe.start();
  console.log('네이버 검증용 Chrome을 열었습니다. 계정 정보는 브라우저에만 입력하세요.');
  console.log(help);
  console.log(JSON.stringify(await probe.status(), null, 2));
  lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const [command, ...args] = line.trim().split(/\s+/);
    if (!command) continue;
    try {
      if (command === 'quit') break;
      const result = command === 'status' ? await probe.status()
        : command === 'checkpoint' ? await probe.persistIfAuthenticated()
        : command === 'writer' ? await probe.openWriter()
          : command === 'restore-fixture' ? await probe.restoreFixture()
          : command === 'editor-state' ? await probe.editorState()
            : command === 'fill-fixture' ? await probe.fillFixture()
              : command === 'upload-fixtures' ? await probe.uploadFixtureImages()
                : command === 'fixture-state' ? await probe.fixtureState()
                  : command === 'publish-options' ? await probe.openPublishOptions()
                    : command === 'categories' ? await probe.listCategories()
                      : command === 'prepare-private' ? await probe.preparePrivate(args.join(' '))
                        : command === 'save-private' ? await probe.savePrivate(args.join(' '))
                          : command === 'verify-private' ? await probe.verifyPrivate()
          : command === 'inspect' ? await probe.inspect()
            : command === 'screenshot' ? await probe.screenshot()
              : help;
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : '네이버 검증 작업 실패');
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message.split('\n')[0] : '네이버 검증용 브라우저 실행 실패');
  process.exitCode = 1;
} finally {
  await close();
}
