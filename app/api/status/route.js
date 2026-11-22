import { getStatus } from '../../../lib/server.mjs';
import { CircuitError } from '../../../lib/circuitgo.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET() {
  try {
    return Response.json(await getStatus(), { headers });
  } catch (error) {
    const safe = error instanceof CircuitError ? error : new CircuitError('UPSTREAM');
    return Response.json({
      error: { code: safe.code, message: safe.message },
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: { ...headers, 'Retry-After': '60' } });
  }
}
