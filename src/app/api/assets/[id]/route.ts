import { readFile } from 'node:fs/promises';
import { assetPath } from '../../../../lib/assets';
import { checkRequest } from '../../../../lib/security';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { checkRequest(request); } catch { return new Response(null, { status: 403 }); }
  try { const { id } = await context.params; return new Response(await readFile(assetPath(id)), { headers: { 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } }); }
  catch { return new Response(null, { status: 404 }); }
}
