import { DatabaseSync } from 'node:sqlite';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateDraft } from './store';

export type AuditFinding = { level: 'error' | 'warning'; code: string; count: number; message: string };
export type AuditReport = { checkedAt: string; integrity: boolean; counts: Record<string, number>; findings: AuditFinding[] };

const stateTables = ['ai_jobs', 'style_jobs', 'code_checks', 'photo_jobs'];
function tables(db: DatabaseSync) { return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name))); }

export async function auditData(root: string): Promise<AuditReport> {
  const dataRoot = path.resolve(root); const dbPath = path.join(dataRoot, 'app.sqlite');
  const info = await stat(dbPath); if (!info.isFile()) throw new Error('로컬 DB를 찾을 수 없습니다.');
  const db = new DatabaseSync(dbPath, { readOnly: true }); const findings: AuditFinding[] = []; const counts: Record<string, number> = {};
  try {
    const names = tables(db); const integrity = String(db.prepare('PRAGMA integrity_check').get()?.integrity_check || '') === 'ok';
    if (!integrity) findings.push({ level: 'error', code: 'database-integrity', count: 1, message: 'SQLite 무결성 검사에 실패했습니다.' });
    for (const required of ['migrations', 'documents', 'draft_versions', 'assets', 'jobs']) if (!names.has(required)) findings.push({ level: 'error', code: 'missing-table', count: 1, message: `필수 테이블이 없습니다: ${required}` });
    for (const name of names) if (!name.startsWith('sqlite_')) counts[name] = Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get()?.count || 0);
    if (names.has('documents')) {
      let invalid = 0;
      for (const row of db.prepare('SELECT body FROM documents').all()) { try { validateDraft(JSON.parse(String(row.body))); } catch { invalid++; } }
      if (invalid) findings.push({ level: 'error', code: 'invalid-draft', count: invalid, message: '형식 검증에 실패한 원고가 있습니다.' });
    }
    if (names.has('draft_versions')) {
      let invalid = 0;
      for (const row of db.prepare('SELECT body FROM draft_versions').all()) { try { validateDraft(JSON.parse(String(row.body))); } catch { invalid++; } }
      if (invalid) findings.push({ level: 'error', code: 'invalid-version', count: invalid, message: '형식 검증에 실패한 원고 버전이 있습니다.' });
    }
    const assetIds = names.has('assets') ? db.prepare('SELECT body FROM assets').all().flatMap(row => { try { const asset = JSON.parse(String(row.body)); return typeof asset.id === 'string' ? [asset.id] : []; } catch { return []; } }) : [];
    const missing: string[] = [];
    for (const id of assetIds) { try { const image = await stat(path.join(dataRoot, 'images', `${id}.png`)); if (!image.isFile() || !image.size) missing.push(id); } catch { missing.push(id); } }
    if (missing.length) findings.push({ level: 'error', code: 'missing-image', count: missing.length, message: 'DB에는 있지만 파일이 없는 이미지가 있습니다.' });
    const files = await readdir(path.join(dataRoot, 'images')).catch(() => []);
    const orphan = files.filter(name => /^[a-f0-9-]{36}\.png$/.test(name) && !assetIds.includes(name.slice(0, -4)));
    if (orphan.length) findings.push({ level: 'warning', code: 'orphan-image', count: orphan.length, message: 'DB에서 참조하지 않는 이미지 파일이 있습니다. 자동 삭제하지 않았습니다.' });
    if (names.has('jobs')) {
      const active = Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state IN ('queued','running')").get()?.count || 0);
      const unresolved = Number(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE state IN ('unknown','needs_attention','needs_login')").get()?.count || 0);
      if (active) findings.push({ level: 'warning', code: 'active-publication', count: active, message: '대기 또는 실행 중인 블로그 작업이 있습니다.' });
      if (unresolved) findings.push({ level: 'warning', code: 'unresolved-publication', count: unresolved, message: '로그인·확인·결과 재확인이 필요한 블로그 작업이 있습니다.' });
    }
    for (const name of stateTables) if (names.has(name)) {
      let active = 0; let invalid = 0;
      for (const row of db.prepare(`SELECT body FROM ${name}`).all()) { try { if (['queued', 'running'].includes(String(JSON.parse(String(row.body)).state))) active++; } catch { invalid++; } }
      if (invalid) findings.push({ level: 'error', code: `invalid-${name}`, count: invalid, message: `${name} 작업 데이터를 읽을 수 없습니다.` });
      if (active) findings.push({ level: 'warning', code: `active-${name}`, count: active, message: `${name}에 대기 또는 실행 중인 작업이 있습니다.` });
    }
    return { checkedAt: new Date().toISOString(), integrity, counts, findings };
  } finally { db.close(); }
}
