import { checkRequest } from '../../../lib/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { checkRequest(request); } catch { return new Response(null, { status: 403 }); }
  return Response.json({ app: 'auto-tstory', instance: process.env.TSTORY_INSTANCE_ID || null }, { headers: { 'Cache-Control': 'no-store' } });
}
