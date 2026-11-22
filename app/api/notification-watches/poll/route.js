import { pollNotifications } from '../../../../lib/notification-watches.mjs';
import { backgroundNotifications } from '../../../../lib/push-server.mjs';
import { getStatus } from '../../../../lib/server.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request) {
  const config = backgroundNotifications();
  if (!config) return new Response(null, { status: 503 });
  if (!request.headers.has('Upstash-Signature')) return new Response(null, { status: 401 });
  let allowed = false;
  try {
    const body = await request.text();
    if (body.length <= 1024) allowed = await config.authorize(request, body);
  } catch {
    return new Response(null, { status: 401 });
  }
  if (!allowed) return new Response(null, { status: 401 });
  try {
    return Response.json(await pollNotifications(config.store, getStatus, config.send));
  } catch {
    return new Response(null, { status: 503 });
  }
}
