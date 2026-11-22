import { validatePushSubscription, trackingForMachine } from '../../../lib/notification-watches.mjs';
import { backgroundNotifications } from '../../../lib/push-server.mjs';
import { getStatus } from '../../../lib/server.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const headers = { 'Cache-Control': 'private, no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers });

async function readBody(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return null;
  if (Number(request.headers.get('content-length')) > 4096) return null;
  const text = await request.text();
  if (text.length > 4096) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function GET() {
  try {
    const config = backgroundNotifications();
    if (config && await config.store.ready()) return json({ publicKey: config.publicKey });
  } catch {
    // Foreground alerts remain available during a storage or scheduler outage.
  }
  return json({ publicKey: null });
}

export async function POST(request) {
  const body = await readBody(request);
  const subscription = validatePushSubscription(body?.subscription);
  if (!subscription || typeof body.machineId !== 'string' || body.machineId.length > 128) {
    return json({ error: 'Invalid notification request.' }, 400);
  }
  try {
    const config = backgroundNotifications();
    if (!config || !await config.store.ready()) return json({ error: 'Background alerts are unavailable.' }, 503);
    const tracking = trackingForMachine(await getStatus(), body.machineId);
    if (!tracking) return json({ error: 'Machine state has changed. Refresh and try again.' }, 409);
    const watch = await config.store.start(subscription, tracking, Date.now());
    return watch ? json(watch, 201) : json({ error: 'Too many active alerts.' }, 429);
  } catch {
    return json({ error: 'Could not start background alerts.' }, 503);
  }
}

export async function DELETE(request) {
  const body = await readBody(request);
  if (typeof body?.watchId !== 'string' || body.watchId.length > 66) {
    return json({ error: 'Invalid notification request.' }, 400);
  }
  try {
    const config = backgroundNotifications();
    if (!config) return json({ error: 'Background alerts are unavailable.' }, 503);
    await config.store.stop(body.watchId);
    return new Response(null, { status: 204, headers });
  } catch {
    return json({ error: 'Could not stop background alerts.' }, 503);
  }
}
