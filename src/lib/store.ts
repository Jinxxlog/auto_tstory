import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Asset, Draft, Job, Settings } from './model';
import { normalizeBlogUrl } from '../services/tistory/url';

export const dataRoot = path.resolve(/* turbopackIgnore: true */ process.env.TSTORY_DATA_DIR || path.join(process.cwd(), 'data'));
export function openStore(root = dataRoot) {
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, 'app.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, dedupe TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, step TEXT NOT NULL, snapshot TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES (1);`);
  const now = () => new Date().toISOString();
  function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  const settings = (): Settings => { const row = db.prepare('SELECT body FROM settings WHERE id=1').get(); return row ? JSON.parse(String(row.body)) : { blog: 'https://mid-night-coding.tistory.com', categories: [], connection: '미확인' }; };
  const setSettings = (value: Settings) => { value.blog = normalizeBlogUrl(value.blog); db.prepare('INSERT OR REPLACE INTO settings VALUES (1,?)').run(JSON.stringify(value)); return value; };
  const assets = (): Asset[] => db.prepare('SELECT body FROM assets ORDER BY rowid DESC').all().map(row => JSON.parse(String(row.body)));
  const asset = (id: string): Asset => { const row = db.prepare('SELECT body FROM assets WHERE id=?').get(id); if (!row) throw new Error('이미지를 찾을 수 없습니다.'); return JSON.parse(String(row.body)); };
  const drafts = (): Draft[] => db.prepare('SELECT body FROM documents ORDER BY rowid DESC').all().map(row => JSON.parse(String(row.body)));
  const draft = (id: string): Draft => { const row = db.prepare('SELECT body FROM documents WHERE id=?').get(id); if (!row) throw new Error('원고를 찾을 수 없습니다.'); return JSON.parse(String(row.body)); };
  function saveDraft(input: unknown) {
    const value = validateDraft(input);
    return transaction(() => {
      if (value.id) { const previous = draft(value.id); if (previous.version !== value.version) throw new Error('다른 화면에서 수정되었습니다. 새로고침 후 다시 저장하세요.'); }
      for (const image of value.images) asset(image.id);
      const saved: Draft = { ...value, id: value.id || randomUUID(), version: value.version + 1, updatedAt: now() };
      db.prepare('INSERT OR REPLACE INTO documents VALUES (?,?)').run(saved.id, JSON.stringify(saved)); return saved;
    });
  }
  const toJob = (row: Record<string, unknown>): Job => ({ id: String(row.id), kind: row.kind as Job['kind'], state: String(row.state), step: String(row.step), snapshot: JSON.parse(String(row.snapshot)), result: row.result == null ? null : String(row.result), createdAt: String(row.created_at), updatedAt: String(row.updated_at) });
  const jobs = () => db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').all().map(toJob);
  const job = (id: string) => { const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (!row) throw new Error('작업을 찾을 수 없습니다.'); return toJob(row); };
  function enqueue(kind: 'connect' | 'publish', draftId?: string) {
    return transaction(() => {
      const config = settings(); const doc = kind === 'publish' ? draft(draftId || '') : undefined;
      if (doc) {
        const unresolved = db.prepare("SELECT * FROM jobs WHERE kind IN ('publish','verify') AND state IN ('queued','running','needs_login','unknown','needs_attention')").all().map(toJob).find(job => job.snapshot.blog === config.blog && job.snapshot.draft?.id === doc.id && job.snapshot.draft.version !== doc.version);
        if (unresolved) throw new Error('이 원고의 이전 전송 작업을 먼저 확인하세요. 버전을 바꿔 다시 전송할 수 없습니다.');
      }
      if (doc && (!doc.title.trim() || !doc.markdown.trim() || !config.categories.includes(doc.category))) throw new Error('제목·본문과 새로고침한 카테고리를 확인하세요.');
      const dedupe = doc ? `${config.blog}:${doc.id}:${doc.version}:private` : `connect:${config.blog}`;
      const existing = db.prepare('SELECT * FROM jobs WHERE dedupe=?').get(dedupe);
      if (existing && (doc || ['queued', 'running', 'needs_login'].includes(String(existing.state)))) return toJob(existing);
      if (existing) db.prepare('UPDATE jobs SET dedupe=? WHERE id=?').run(`${dedupe}:${randomUUID()}`, String(existing.id));
      const id = randomUUID(); const time = now();
      db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)').run(id, dedupe, kind, 'queued', '실행 대기', JSON.stringify({ blog: config.blog, draft: doc }), null, time, time); return job(id);
    });
  }
  const updateJob = (id: string, state: string, step: string, result: string | null = null) => { db.prepare('UPDATE jobs SET state=?,step=?,result=?,updated_at=? WHERE id=?').run(state, step, result, now(), id); };
  function acquire(owner: string, time = Date.now()) {
    return transaction(() => {
      const lock = db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (lock && Number(lock.expires) > time && lock.owner !== owner) return false;
      if (!lock || lock.owner !== owner) {
        db.prepare("UPDATE jobs SET state=CASE WHEN step='저장 요청' OR step='결과 확인' THEN 'unknown' ELSE 'needs_attention' END, step='실행 프로세스 중단: 자동 재발행하지 않습니다', updated_at=? WHERE state='running'").run(now());
      }
      db.prepare('INSERT OR REPLACE INTO lease VALUES (1,?,?)').run(owner, time + 15_000); return true;
    });
  }
  function claim(owner: string): Job | undefined {
    return transaction(() => {
      const lock = db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (!lock || lock.owner !== owner || Number(lock.expires) <= Date.now()) return;
      const row = db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").get();
      if (!row) return; updateJob(String(row.id), 'running', '브라우저 연결'); return job(String(row.id));
    });
  }
  return { db, settings, setSettings, assets, asset, drafts, draft, saveDraft, jobs, job, enqueue, updateJob, acquire, claim,
    recordPost(id: string, url: string) { const current = job(id); if (new URL(url).origin !== current.snapshot.blog) throw new Error('저장 결과 주소 불일치'); db.prepare('UPDATE jobs SET snapshot=?,result=? WHERE id=?').run(JSON.stringify({ ...current.snapshot, postUrl: url }), url, id); },
    verify(id: string) { return transaction(() => { const current = job(id); const url = current.snapshot.postUrl || current.result; if (!url || new URL(url).origin !== current.snapshot.blog || !['needs_attention','succeeded','failed'].includes(current.state)) throw new Error('확인 가능한 저장 결과가 없습니다.'); db.prepare("UPDATE jobs SET kind='verify',state='queued',step='저장 결과 다시 확인 대기',snapshot=?,result=?,updated_at=? WHERE id=?").run(JSON.stringify({ ...current.snapshot, postUrl: url }), url, now(), id); return job(id); }); },
    addAsset(value: Asset) { db.prepare('INSERT INTO assets VALUES (?,?)').run(value.id, JSON.stringify(value)); },
    heartbeat(owner: string) { return db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=? AND expires>?').run(Date.now()+15_000, owner, Date.now()).changes === 1; },
    release(owner: string) { db.prepare('DELETE FROM lease WHERE owner=?').run(owner); },
    workerOnline() { const row = db.prepare('SELECT expires FROM lease WHERE id=1').get(); return !!row && Number(row.expires) > Date.now(); },
    resume(id: string) { return transaction(() => { const current = job(id); if (!['needs_login','failed'].includes(current.state)) throw new Error('이 작업은 자동 재시도할 수 없습니다. 티스토리 관리 화면에서 결과를 확인하세요.'); updateJob(id, 'queued', '재개 대기'); return job(id); }); },
    cancel(id: string) { const count = db.prepare("UPDATE jobs SET state='cancelled', step='사용자가 취소',updated_at=? WHERE id=? AND state IN ('queued','needs_login','failed')").run(now(), id).changes; if (!count) throw new Error('진행 중이거나 저장 결과 확인이 필요한 작업은 취소할 수 없습니다.'); },
  };
}
export function validateDraft(input: unknown): Draft {
  if (!input || typeof input !== 'object') throw new Error('잘못된 원고입니다.');
  const v = input as Record<string, unknown>;
  for (const [key, max] of Object.entries({ id: 36, title: 150, summary: 20000, markdown: 100000, category: 200 })) if (typeof v[key] !== 'string' || (v[key] as string).length > max) throw new Error(`${key} 입력 길이를 확인하세요.`);
  if (v.id && !/^[a-f0-9-]{36}$/.test(String(v.id))) throw new Error('잘못된 원고 ID');
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 0 || (!v.id && v.version !== 0)) throw new Error('잘못된 원고 버전');
  if (!['project','technical','ps'].includes(String(v.kind))) throw new Error('글 유형을 확인하세요.');
  if (!Array.isArray(v.images) || v.images.length > 20) throw new Error('이미지는 최대 20장입니다.');
  const images = v.images.map(image => { if (!image || typeof image.id !== 'string' || typeof image.caption !== 'string' || image.caption.length > 500) throw new Error('이미지 설명을 확인하세요.'); return { id: image.id, caption: image.caption }; });
  if (new Set(images.map(i => i.id)).size !== images.length) throw new Error('같은 이미지를 중복으로 넣을 수 없습니다.');
  if (v.cover !== null && !images.some(i => i.id === v.cover)) throw new Error('대표 이미지는 원고 사진에서 선택하세요.');
  return { id: String(v.id), version: Number(v.version), title: String(v.title), kind: v.kind as Draft['kind'], summary: String(v.summary), markdown: String(v.markdown), category: String(v.category), images, cover: v.cover as string | null, updatedAt: '' };
}
