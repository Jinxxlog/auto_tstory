import { createHash, randomUUID } from 'node:crypto';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

const formatVersion = 2;
const databaseFile = 'app.sqlite';
const manifestFile = 'manifest.json';
const idPattern = /^[a-f0-9-]{36}$/;
const includedTables = ['migrations', 'documents', 'draft_versions', 'assets', 'settings', 'jobs', 'ai_settings', 'ai_jobs', 'style_sources', 'style_jobs', 'style_profiles', 'style_defaults', 'reference_sources', 'code_checks', 'photo_jobs', 'photo_cache'];

export type BackupManifest = {
  formatVersion: number;
  createdAt: string;
  app: 'auto_tstory';
  database: { file: 'app.sqlite'; size: number; sha256: string; integrity: 'ok'; tables: Record<string, number>; migrations: number[] };
  images: { id: string; file: string; size: number; sha256: string }[];
  excluded: ['browser authentication', 'AI authentication', 'diagnostic logs'];
  normalized: ['connection status', 'worker lease'];
};

export type VerifiedBackup = { directory: string; manifest: BackupManifest };

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function resolved(value: string) { return path.resolve(value); }

async function renameDirectory(source: string, destination: string) {
  // Windows can briefly retain a handle after SQLite/file reads have closed.
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (process.platform !== 'win32' || attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

function assertDataRoot(root: string) {
  const value = resolved(root);
  if (path.parse(value).root === value || !path.basename(value)) throw new Error('데이터 폴더 경로를 확인하세요.');
  return value;
}

async function regularFile(file: string) {
  const info = await stat(file);
  if (!info.isFile()) throw new Error(`일반 파일이 아닙니다: ${path.basename(file)}`);
  return info;
}

async function sha256(file: string) {
  const data = await readFile(file);
  return createHash('sha256').update(data).digest('hex');
}

function tableNames(db: DatabaseSync) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
}

function databaseSummary(db: DatabaseSync) {
  const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || '');
  if (integrity !== 'ok') throw new Error('SQLite 무결성 검사에 실패했습니다.');
  const names = tableNames(db); const tables: Record<string, number> = {};
  for (const name of includedTables) if (names.has(name)) tables[name] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get()?.count || 0);
  if (!names.has('documents') || !names.has('assets') || !names.has('migrations')) throw new Error('필수 데이터 테이블이 없습니다.');
  const migrations = db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => Number(row.version));
  return { tables, migrations };
}

function activeWork(db: DatabaseSync) {
  const names = tableNames(db); const active: string[] = [];
  if (names.has('jobs') && Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state IN ('queued','running')").get()?.count)) active.push('블로그 전송');
  for (const [table, label] of [['ai_jobs', 'AI 생성'], ['style_jobs', '문체 분석'], ['code_checks', '코드 검증'], ['photo_jobs', '사진 분석']] as const) {
    if (!names.has(table)) continue;
    const rows = db.prepare(`SELECT body FROM ${table}`).all();
    if (rows.some(row => ['queued', 'running'].includes(String((JSON.parse(String(row.body)) as { state?: string }).state)))) active.push(label);
  }
  return active;
}

function normalizeSnapshot(file: string) {
  const db = new DatabaseSync(file); const names = tableNames(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (names.has('settings')) {
      const row = db.prepare('SELECT body FROM settings WHERE id=1').get();
      if (row) { const value = JSON.parse(String(row.body)); delete value.checkedAt; db.prepare('UPDATE settings SET body=? WHERE id=1').run(JSON.stringify({ ...value, connection: '미확인' })); }
    }
    if (names.has('ai_settings')) {
      const row = db.prepare('SELECT body FROM ai_settings WHERE id=1').get();
      if (row) db.prepare('UPDATE ai_settings SET body=? WHERE id=1').run(JSON.stringify({ state: 'disconnected', message: '복원 후 ChatGPT 연결을 다시 확인하세요.', models: [] }));
    }
    if (names.has('lease')) db.exec('DELETE FROM lease');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

async function removeCreating(directory: string) {
  const target = resolved(directory);
  if (!path.basename(target).startsWith('.creating-')) throw new Error('임시 백업 폴더 경로가 올바르지 않습니다.');
  await rm(target, { recursive: true, force: true });
}

export async function createBackup(sourceRoot: string, backupRoot: string): Promise<VerifiedBackup> {
  const source = assertDataRoot(sourceRoot); const destinationRoot = assertDataRoot(backupRoot);
  if (destinationRoot === source || destinationRoot.startsWith(source + path.sep)) throw new Error('백업 폴더는 데이터 폴더 밖에 지정하세요.');
  const sourceDbPath = path.join(source, databaseFile); await regularFile(sourceDbPath);
  await mkdir(destinationRoot, { recursive: true });
  const suffix = `${stamp()}-${randomUUID().slice(0, 8)}`;
  const temporary = path.join(destinationRoot, `.creating-${suffix}`); const destination = path.join(destinationRoot, suffix);
  await mkdir(path.join(temporary, 'images'), { recursive: true });
  const sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true });
  try {
    const work = activeWork(sourceDb); if (work.length) throw new Error(`진행 중인 작업을 먼저 마치세요: ${work.join(', ')}`);
    await sqliteBackup(sourceDb, path.join(temporary, databaseFile));
  } catch (error) { sourceDb.close(); await removeCreating(temporary); throw error; }
  sourceDb.close();
  try {
    const snapshotPath = path.join(temporary, databaseFile); normalizeSnapshot(snapshotPath);
    const normalizedSnapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    let summary: ReturnType<typeof databaseSummary>; let assets: { id: string }[];
    try {
      summary = databaseSummary(normalizedSnapshot);
      assets = normalizedSnapshot.prepare('SELECT body FROM assets ORDER BY id').all().map(row => JSON.parse(String(row.body)) as { id: string });
    } finally { normalizedSnapshot.close(); }
    const images: BackupManifest['images'] = [];
    for (const asset of assets) {
      if (!idPattern.test(asset.id)) throw new Error('백업할 이미지 ID가 올바르지 않습니다.');
      const sourceImage = path.join(source, 'images', `${asset.id}.png`); const info = await regularFile(sourceImage);
      const relative = `images/${asset.id}.png`; const copied = path.join(temporary, 'images', `${asset.id}.png`);
      await copyFile(sourceImage, copied, fsConstants.COPYFILE_EXCL);
      images.push({ id: asset.id, file: relative, size: info.size, sha256: await sha256(copied) });
    }
    const dbInfo = await regularFile(snapshotPath);
    const manifest: BackupManifest = { formatVersion, createdAt: new Date().toISOString(), app: 'auto_tstory', database: { file: databaseFile, size: dbInfo.size, sha256: await sha256(snapshotPath), integrity: 'ok', ...summary }, images, excluded: ['browser authentication', 'AI authentication', 'diagnostic logs'], normalized: ['connection status', 'worker lease'] };
    await writeFile(path.join(temporary, manifestFile), JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
    await renameDirectory(temporary, destination);
    return verifyBackup(destination);
  } catch (error) { await removeCreating(temporary); throw error; }
}

function parseManifest(value: unknown): BackupManifest {
  const m = value as BackupManifest;
  if (!m || m.formatVersion !== formatVersion || m.app !== 'auto_tstory' || !m.database || m.database.file !== databaseFile || !Array.isArray(m.images) || !Array.isArray(m.database.migrations) || !m.database.tables || JSON.stringify(m.normalized) !== JSON.stringify(['connection status', 'worker lease'])) throw new Error('지원하지 않거나 손상된 백업 manifest입니다.');
  if (m.images.some(image => !idPattern.test(image.id) || image.file !== `images/${image.id}.png` || !Number.isSafeInteger(image.size) || image.size < 1 || !/^[a-f0-9]{64}$/.test(image.sha256))) throw new Error('백업 이미지 목록이 올바르지 않습니다.');
  if (!Number.isSafeInteger(m.database.size) || m.database.size < 1 || !/^[a-f0-9]{64}$/.test(m.database.sha256)) throw new Error('백업 DB 정보가 올바르지 않습니다.');
  return m;
}

export async function verifyBackup(directory: string): Promise<VerifiedBackup> {
  const root = assertDataRoot(directory); const manifestPath = path.join(root, manifestFile);
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const dbPath = path.join(root, manifest.database.file); const dbInfo = await regularFile(dbPath);
  if (dbInfo.size !== manifest.database.size || await sha256(dbPath) !== manifest.database.sha256) throw new Error('백업 DB 해시가 일치하지 않습니다.');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const summary = databaseSummary(db);
    if (JSON.stringify(summary.tables) !== JSON.stringify(manifest.database.tables) || JSON.stringify(summary.migrations) !== JSON.stringify(manifest.database.migrations)) throw new Error('백업 DB 내용 요약이 manifest와 다릅니다.');
    const assetIds = db.prepare('SELECT body FROM assets ORDER BY id').all().map(row => String((JSON.parse(String(row.body)) as { id: string }).id));
    if (JSON.stringify(assetIds) !== JSON.stringify(manifest.images.map(image => image.id))) throw new Error('백업 DB와 이미지 목록이 다릅니다.');
  } finally { db.close(); }
  for (const image of manifest.images) {
    const file = path.join(root, ...image.file.split('/')); const info = await regularFile(file);
    if (info.size !== image.size || await sha256(file) !== image.sha256) throw new Error(`백업 이미지가 손상되었습니다: ${image.id}`);
  }
  const imageDirectory = path.join(root, 'images');
  const actual = await readdir(imageDirectory).catch(() => []);
  if (actual.some(name => !manifest.images.some(image => path.basename(image.file) === name))) throw new Error('manifest에 없는 이미지 파일이 백업에 포함되어 있습니다.');
  return { directory: root, manifest };
}

export async function restoreBackup(directory: string, targetRoot: string, safetyBackupRoot: string) {
  const verified = await verifyBackup(directory); const target = assertDataRoot(targetRoot); const parent = path.dirname(target);
  if (verified.directory === target || verified.directory.startsWith(target + path.sep) || target.startsWith(verified.directory + path.sep)) throw new Error('복원 원본과 대상 데이터 폴더는 서로 분리되어야 합니다.');
  const targetInfo = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (targetInfo && (!targetInfo.isDirectory() || targetInfo.isSymbolicLink())) throw new Error('복원 대상은 일반 데이터 폴더여야 합니다.');
  const entries = targetInfo ? await readdir(target) : [];
  if (entries.length && !entries.includes(databaseFile)) throw new Error('DB가 없는 비어 있지 않은 폴더에는 복원할 수 없습니다. 빈 폴더를 선택하세요.');
  let safetyBackup: string | null = null;
  if (entries.includes(databaseFile)) {
    const currentDb = new DatabaseSync(path.join(target, databaseFile), { readOnly: true });
    try {
      const lease = tableNames(currentDb).has('lease') ? currentDb.prepare('SELECT expires FROM lease WHERE id=1').get() : undefined;
      if (lease && Number(lease.expires) > Date.now()) throw new Error('웹앱 실행기가 켜져 있습니다. Stop.cmd 또는 Ctrl+C로 정상 종료한 뒤 복원하세요.');
      const work = activeWork(currentDb); if (work.length) throw new Error(`진행 대기 중인 작업이 있어 복원할 수 없습니다: ${work.join(', ')}`);
    } finally { currentDb.close(); }
    safetyBackup = (await createBackup(target, safetyBackupRoot)).directory;
  }
  const suffix = `${stamp()}-${randomUUID().slice(0, 8)}`; const staging = path.join(parent, `.restore-${suffix}`); const previous = path.join(parent, `${path.basename(target)}.before-restore-${suffix}`);
  const failed = path.join(parent, `${path.basename(target)}.failed-restore-${suffix}`); let swapped = false; let movedPrevious = false;
  await mkdir(path.join(staging, 'images'), { recursive: true });
  try {
    await copyFile(path.join(verified.directory, databaseFile), path.join(staging, databaseFile), fsConstants.COPYFILE_EXCL);
    for (const image of verified.manifest.images) await copyFile(path.join(verified.directory, ...image.file.split('/')), path.join(staging, ...image.file.split('/')), fsConstants.COPYFILE_EXCL);
    if (targetInfo) { await renameDirectory(target, previous); movedPrevious = true; }
    // For a new installation, refuse to replace a directory created while copying.
    else if (await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('복원 중 대상 폴더가 생성되었습니다. 앱을 종료하고 다시 확인하세요.');
    await renameDirectory(staging, target); swapped = true;
    const restoredDb = new DatabaseSync(path.join(target, databaseFile), { readOnly: true });
    try { databaseSummary(restoredDb); } finally { restoredDb.close(); }
    return { restoredFrom: verified.directory, previousData: movedPrevious ? previous : null, safetyBackup };
  } catch (error) {
    if (swapped) {
      await renameDirectory(target, failed);
    }
    if (movedPrevious) await renameDirectory(previous, target);
    if (!swapped && path.dirname(staging) === parent && path.basename(staging).startsWith('.restore-')) await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function listBackups(backupRoot: string) {
  const root = assertDataRoot(backupRoot); const names = await readdir(root, { withFileTypes: true }).catch(() => []);
  const values: VerifiedBackup[] = [];
  for (const item of names.filter(item => item.isDirectory() && !item.name.startsWith('.'))) {
    try { values.push(await verifyBackup(path.join(root, item.name))); } catch { /* invalid entries are not offered as restore points */ }
  }
  return values.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}
