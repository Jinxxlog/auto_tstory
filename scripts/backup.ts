import path from 'node:path';
import { createBackup, listBackups, restoreBackup, verifyBackup } from '../src/lib/backup';
import { dataRoot } from '../src/lib/store';

const command = process.argv[2] || 'create';
const backupRoot = path.resolve(process.env.TSTORY_BACKUP_DIR || path.join(process.cwd(), 'backups'));
if (command === 'create') {
  const result = await createBackup(dataRoot, backupRoot);
  console.log(`백업 완료: ${result.directory}`);
  console.log(`원고 ${result.manifest.database.tables.documents || 0}개 · 이미지 ${result.manifest.images.length}개 · 인증 정보 제외`);
} else if (command === 'list') {
  const values = await listBackups(backupRoot);
  if (!values.length) console.log('검증 가능한 백업이 없습니다.');
  for (const value of values) console.log(`${value.directory} · ${value.manifest.createdAt} · 원고 ${value.manifest.database.tables.documents || 0}개 · 이미지 ${value.manifest.images.length}개`);
} else if (command === 'verify') {
  const directory = process.argv[3]; if (!directory) throw new Error('검증할 백업 폴더를 지정하세요.');
  const result = await verifyBackup(directory); console.log(`백업 검증 완료: ${result.directory}`);
} else if (command === 'restore') {
  const directory = process.argv[3];
  if (!directory || !process.argv.includes('--confirm-replace-local-data')) throw new Error('사용법: npm run restore -- <백업 폴더> --confirm-replace-local-data');
  const result = await restoreBackup(directory, dataRoot, backupRoot);
  console.log(`복원 완료: ${result.restoredFrom}`); console.log(`복원 직전 안전 백업: ${result.safetyBackup}`); console.log(`교체 전 데이터: ${result.previousData}`);
} else throw new Error('지원 명령: create, list, verify, restore');
