import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const traces = globSync('.next/**/*.nft.json');
assert.ok(traces.length, '배포 빌드 후 검사하세요.');
let privateFiles = 0;
for (const file of traces) {
  const trace = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of trace.files) {
    const relative = path.relative(root, path.resolve(path.dirname(file), entry));
    const parts = relative.split(path.sep);
    if (['data', 'backups', '.local'].includes(parts[0]) || parts.some(part => /(?:\.before-restore-|\.failed-restore-|^\.restore-|^\.creating-)/.test(part)) || /^\.env(?:\.|$)/.test(parts[0])) privateFiles++;
  }
}
// Report counts only: the paths themselves can identify private material.
assert.equal(privateFiles, 0, '빌드 추적에 사용자 자료가 포함되어 있습니다. 배포하지 마세요.');
console.log(`빌드 추적 ${traces.length}개 검사: 사용자 데이터·인증·백업 경로 0개`);
