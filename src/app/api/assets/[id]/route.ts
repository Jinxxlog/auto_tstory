import { readFile } from 'node:fs/promises';
import { assetPath, thumbnail } from '../../../../lib/assets';
import { checkRequest } from '../../../../lib/security';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { checkRequest(request); } catch { return new Response(null, { status: 403 }); }
  try { const { id } = await context.params; const thumb = new URL(request.url).searchParams.get('size') === 'thumb'; return new Response(thumb ? await thumbnail(id) : await readFile(assetPath(id)), { headers: { 'Content-Type': thumb ? 'image/webp' : 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' } }); }
  catch { return new Response(null, { status: 404 }); }
}
