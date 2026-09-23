import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { openStore } from './store';
import { imageBlocks, maxRequestImages, withBlocks } from './blocks';
import { assetPath } from './assets';
import { aiStore } from './ai-store';
import type { AiJob } from './ai-model';

export type PhotoInput = { id: string; blockId: string; hash: string; note: string; group: string; key: string };
export type PhotoResult = { id: string; caption: string; description: string; uncertainty: string };
export type PhotoAnalysisJob = { id: string; draftId: string; version: number; provider: 'chatgpt-codex'; model: string; photos: PhotoInput[]; results: PhotoResult[]; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; cancel: boolean; cached: number; message: string; createdAt: string; appliedVersion?: number; usage?: AiJob['usage'] };
export function photoCacheKey(hash: string, model: string, note: string, group: string) { return createHash('sha256').update(JSON.stringify(['photo-analysis-v1', 'chatgpt-codex', hash, model, note, group])).digest('hex'); }
export function validatePhotoResults(value: unknown, ids: string[]): PhotoResult[] {
  if (!Array.isArray(value) || value.length !== ids.length || new Set(value.map(item => item?.id)).size !== ids.length || value.some(item => !ids.includes(item?.id) || typeof item.caption !== 'string' || item.caption.length > 500 || typeof item.description !== 'string' || item.description.length > 10000 || typeof item.uncertainty !== 'string' || item.uncertainty.length > 2000)) throw new Error('사진 분석 결과의 ID 또는 형식이 다릅니다.');
  return value.map(item => ({ id: item.id, caption: item.caption, description: item.description, uncertainty: item.uncertainty }));
}
export function photoAnalysisStore(store: ReturnType<typeof openStore>) {
  const db = store.db;
  db.exec('CREATE TABLE IF NOT EXISTS photo_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS photo_cache (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
  const jobs = (): PhotoAnalysisJob[] => db.prepare('SELECT body FROM photo_jobs ORDER BY rowid DESC').all().map(row => JSON.parse(String(row.body)));
  const get = (id: string): PhotoAnalysisJob => { const row = db.prepare('SELECT body FROM photo_jobs WHERE id=?').get(id); if (!row) throw new Error('사진 분석 작업이 없습니다.'); return JSON.parse(String(row.body)); };
  const put = (job: PhotoAnalysisJob) => db.prepare('INSERT OR REPLACE INTO photo_jobs VALUES (?,?)').run(job.id, JSON.stringify(job));
  return { jobs, get, put,
    async enqueue(id: string, model: string, ids: unknown) {
      if (!Array.isArray(ids) || !ids.length || ids.length > maxRequestImages || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('분석할 사진을 중복 없이 1~10장 선택하세요.');
      const draft = store.draft(id); if (draft.schemaVersion !== 2) throw new Error('블록 원고로 먼저 저장하세요.');
      const connection = aiStore(store).connection(); if (connection.state !== 'connected' || !connection.models.some(item => item.id === model && item.images)) throw new Error('사진을 지원하는 연결 모델을 선택하세요.');
      const active = jobs().find(job => job.draftId === id && ['queued', 'running'].includes(job.state)); if (active) return active;
      const selected = imageBlocks(draft).filter(block => ids.includes(block.imageId)); if (selected.length !== ids.length) throw new Error('선택 사진이 원고에 없습니다.');
      if (selected.some(block => block.locked)) throw new Error('잠근 사진은 분석 적용 대상에서 제외하거나 먼저 잠금을 해제하세요.');
      const photos: PhotoInput[] = [];
      for (const block of selected) { const hash = createHash('sha256').update(await readFile(assetPath(block.imageId, store.root))).digest('hex'); photos.push({ id: block.imageId, blockId: block.id, hash, note: block.note, group: block.group, key: photoCacheKey(hash, model, block.note, block.group) }); }
      if (store.draft(id).version !== draft.version) throw new Error('사진 분석 준비 중 원고가 수정되었습니다.');
      const pending = jobs().find(job => job.draftId === id && ['queued', 'running'].includes(job.state)); if (pending) return pending;
      const results: PhotoResult[] = [];
      for (const photo of photos) { const cached = db.prepare('SELECT body FROM photo_cache WHERE id=?').get(photo.key); if (cached) results.push(...validatePhotoResults([{ ...JSON.parse(String(cached.body)), id: photo.id }], [photo.id])); }
      const job: PhotoAnalysisJob = { id: randomUUID(), draftId: id, version: draft.version, provider: 'chatgpt-codex', model, photos, results, state: results.length === photos.length ? 'succeeded' : 'queued', cancel: false, cached: results.length, message: results.length === photos.length ? '기존 분석 재사용 · 새 AI 요청 없음' : '사진 분석 대기', createdAt: new Date().toISOString() }; put(job); return job;
    },
    cancel(id: string) { const job = get(id); if (!['queued', 'running'].includes(job.state)) throw new Error('진행 중인 분석만 취소할 수 있습니다.'); put({ ...job, cancel: true, state: job.state === 'queued' ? 'cancelled' : job.state, message: '사진 분석 취소 요청' }); },
    finish(id: string, values: PhotoResult[], usage?: AiJob['usage']) {
      const job = get(id); if (job.state !== 'running') return;
      if (job.cancel) { put({ ...job, state: 'cancelled', message: '취소됨 · 결과를 적용하지 않았습니다.', usage }); return; }
      const missing = job.photos.filter(photo => !job.results.some(result => result.id === photo.id)); const results = validatePhotoResults(values, missing.map(photo => photo.id));
      db.exec('BEGIN IMMEDIATE'); try {
        for (const result of results) db.prepare('INSERT OR REPLACE INTO photo_cache VALUES (?,?)').run(missing.find(photo => photo.id === result.id)!.key, JSON.stringify(result));
        put({ ...job, results: [...job.results, ...results], state: 'succeeded', message: '사진 분석 완료 · 검토 후 적용하세요.', usage }); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    apply(id: string) {
      const job = get(id); if (job.state !== 'succeeded' || job.appliedVersion) throw new Error('적용할 사진 분석 결과가 없습니다.');
      const draft = store.draft(job.draftId); if (draft.version !== job.version || draft.schemaVersion !== 2) throw new Error('분석 이후 원고가 수정되었습니다. 최신 원고에서 다시 요청하세요.');
      validatePhotoResults(job.results, job.photos.map(photo => photo.id));
      const saved = store.saveDraft(withBlocks(draft, draft.blocks!.map(block => { const result = block.type === 'image' ? job.results.find(result => result.id === block.imageId) : undefined; return block.type === 'image' && result ? { ...block, caption: result.caption, description: result.description } : block; })));
      put({ ...job, appliedVersion: saved.version }); return saved;
    },
    recover() { for (const job of jobs().filter(job => job.state === 'running')) put({ ...job, state: job.cancel ? 'cancelled' : 'failed', message: '실행기 중단 · 자동 재요청하지 않습니다.' }); },
  };
}
