import { openStore } from '../../../lib/store';
import { checkRequest } from '../../../lib/security';
import { importImage, maxImageBytes } from '../../../lib/assets';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try { checkRequest(request, true); } catch { return Response.json({ error: '웹앱에서 다시 요청하세요.' }, { status: 403 }); }
  const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  if (!reader) return Response.json({ error: '사진이 없습니다.' }, { status: 400 });
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > maxImageBytes + 65536) { await reader.cancel(); return Response.json({ error: '사진은 장당 10MB 이하입니다.' }, { status: 413 }); } chunks.push(chunk.value); }
  const store = openStore();
  try {
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers.get('content-type') || '' } }).formData();
    const file = form.get('file'); if (!(file instanceof File)) throw new Error('사진을 선택하세요.');
    const asset = await importImage(file, form.get('library') === 'true'); store.addAsset(asset); return Response.json(asset);
  } catch { return Response.json({ error: '사진을 가져오지 못했습니다. 10MB 이하 PNG·JPEG·WebP 파일인지 확인하세요.' }, { status: 400 }); }
  finally { store.db.close(); }
}
