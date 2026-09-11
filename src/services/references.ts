import { load } from 'cheerio';
import { randomUUID } from 'node:crypto';
import type { openStore } from '../lib/store';
import type { Reference } from '../lib/material';

const officialHosts = new Set(['docs.python.org', 'developer.mozilla.org', 'dev.mysql.com', 'www.postgresql.org', 'docs.oracle.com', 'docs.kernel.org', 'learn.microsoft.com', 'docs.docker.com', 'doc.rust-lang.org', 'go.dev', 'nodejs.org']);
const problemHosts = new Set(['www.acmicpc.net', 'school.programmers.co.kr', 'atcoder.jp', 'codeforces.com']);
export function referenceUrl(value: string, fetchable = false) {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('출처 URL을 확인하세요.');
  let url: URL; try { url = new URL(value); } catch { throw new Error('HTTPS 출처 URL을 입력하세요.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || (fetchable && !officialHosts.has(url.hostname) && !problemHosts.has(url.hostname))) throw new Error('자동 가져오기를 지원하지 않는 주소입니다. 본문을 붙여넣어 주세요.');
  url.hash = ''; return url;
}
export function extractReference(html: string) {
  const $ = load(html); $('script,style,nav,header,footer,aside,form,button').remove();
  const article = $('#problem_description').length ? $('#problem_description').parent() : $('main,article,[role="main"],.document,.theme-doc-markdown').first();
  if (!article.length) throw new Error('본문 영역을 찾지 못했습니다. 본문을 붙여넣어 주세요.');
  article.find('br').replaceWith('\n'); article.find('p,li,h1,h2,h3,pre,tr,section').append('\n');
  const text = article.text().replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 80) throw new Error('본문을 가져오지 못했습니다. 본문을 붙여넣어 주세요.');
  if (text.length > 20000) throw new Error('자료가 너무 깁니다. 필요한 부분을 붙여넣어 주세요.');
  return { title: $('title').text().trim().slice(0, 300) || '참고 자료', text };
}
export async function fetchReference(raw: string): Promise<Omit<Reference, 'id'>> {
  let url = referenceUrl(raw, true); const signal = AbortSignal.timeout(15000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); const location = response.headers.get('location');
      if (!location) break;
      const next = referenceUrl(new URL(location, url).href, true);
      if (next.origin !== url.origin) throw new Error('다른 사이트로 이동하는 자료입니다. 본문을 붙여넣어 주세요.');
      url = next; continue;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('자료 접근에 실패했습니다. 본문을 붙여넣어 주세요.'); }
    const reader = response.body?.getReader(); if (!reader) break;
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('자료가 너무 큽니다. 본문을 붙여넣어 주세요.'); } chunks.push(item.value); }
    return { ...extractReference(Buffer.concat(chunks).toString('utf8')), url: url.href, method: 'fetched', official: officialHosts.has(url.hostname), checkedAt: new Date().toISOString() };
  }
  throw new Error('자료를 가져오지 못했습니다. 본문을 붙여넣어 주세요.');
}
export function referenceStore(store: ReturnType<typeof openStore>) {
  const db = store.db; db.exec('CREATE TABLE IF NOT EXISTS reference_sources (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
  const list = (): Reference[] => db.prepare('SELECT body FROM reference_sources ORDER BY rowid DESC').all().map(r => JSON.parse(String(r.body)));
  const get = (id: string): Reference => { const row = db.prepare('SELECT body FROM reference_sources WHERE id=?').get(id); if (!row) throw new Error('참고 자료를 찾을 수 없습니다.'); return JSON.parse(String(row.body)); };
  const put = (source: Omit<Reference, 'id'>) => { const value = { ...source, id: randomUUID() }; db.prepare('INSERT INTO reference_sources VALUES (?,?)').run(value.id, JSON.stringify(value)); return value; };
  return { list, get, async fetch(url: string) { return put(await fetchReference(url)); }, paste(input: { title: string; url: string; text: string }) {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300 || typeof input.text !== 'string' || input.text.trim().length < 80 || input.text.length > 20000 || typeof input.url !== 'string') throw new Error('자료 제목과 본문(80~20,000자)을 확인하세요.');
    return put({ title: input.title, text: input.text, url: input.url ? referenceUrl(input.url).href : '', method: 'pasted', official: false, checkedAt: new Date().toISOString() });
  } };
}
