import { openStore } from '../../../lib/store';
import { checkRequest } from '../../../lib/security';
import { renderMarkdown } from '../../../lib/content';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { checkRequest(request); } catch { return Response.json({ error: '로컬 웹앱에서 접근하세요.' }, { status: 403 }); }
  const store = openStore();
  try { return Response.json({ settings: store.settings(), drafts: store.drafts(), assets: store.assets(), jobs: store.jobs().map(job => ({ ...job, result: job.result || job.snapshot.postUrl || null })), workerOnline: store.workerOnline() }); } finally { store.db.close(); }
}
export async function POST(request: Request) {
  try { checkRequest(request, true); } catch { return Response.json({ error: '웹앱에서 다시 요청하세요.' }, { status: 403 }); }
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'JSON 요청이 필요합니다.' }, { status: 415 });
  // Bound actual bytes, including requests without Content-Length.
  let body = ''; const reader = request.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) return Response.json({ error: '빈 요청' }, { status: 400 });
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 600_000) { await reader.cancel(); return Response.json({ error: '원고가 너무 큽니다.' }, { status: 413 }); } chunks.push(chunk.value); }
  body = Buffer.concat(chunks).toString('utf8');
  const store = openStore();
  try {
    const input = JSON.parse(body);
    switch (input.action) {
      case 'save': return Response.json(store.saveDraft(input.draft));
      case 'preview': if (typeof input.markdown !== 'string' || input.markdown.length > 100000) throw new Error('본문 길이를 확인하세요.'); return Response.json({ html: renderMarkdown(input.markdown) });
      case 'settings': {
        if (store.jobs().some(job => ['queued','running','needs_login'].includes(job.state))) throw new Error('대기 작업을 완료하거나 취소한 뒤 블로그를 변경하세요.');
        if (typeof input.blog !== 'string') throw new Error('블로그 주소를 입력하세요.');
        return Response.json(store.setSettings({ blog: input.blog, categories: [], connection: '미확인' }));
      }
      case 'connect': return Response.json(store.enqueue('connect'));
      case 'publish': return Response.json(store.enqueue('publish', String(input.id)));
      case 'resume': return Response.json(store.resume(String(input.id)));
      case 'verify': return Response.json(store.verify(String(input.id)));
      case 'cancel': store.cancel(String(input.id)); return Response.json({ ok: true });
      default: throw new Error('지원하지 않는 요청입니다.');
    }
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : '요청 실패' }, { status: 400 }); }
  finally { store.db.close(); }
}
