import { createHash, randomBytes } from 'node:crypto';
import { startTracking, updateTracking } from './machine-tracking.mjs';

const PREFIX = 'laundry:notifications:v1';
const INDEX = `${PREFIX}:active`;
const HEARTBEAT = `${PREFIX}:heartbeat`;
const LOCK = `${PREFIX}:poll-lock`;
const WATCH_MS = 6 * 60 * 60 * 1000;
const MAX_WATCHES = 64;
const WATCH_ID = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/;
const HOSTS = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
  'wns.windows.com',
];

export function validatePushSubscription(value, now = Date.now()) {
  if (typeof value?.endpoint !== 'string' || value.endpoint.length > 2048) return null;
  let url;
  try { url = new URL(value.endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
  if (!HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
  const { p256dh, auth } = value.keys ?? {};
  if (typeof p256dh !== 'string' || !/^[\w-]{87}$/.test(p256dh) ||
      typeof auth !== 'string' || !/^[\w-]{22}$/.test(auth)) return null;
  if (Buffer.from(p256dh, 'base64url')[0] !== 4) return null;
  if (value.expirationTime != null && (!Number.isFinite(value.expirationTime) || value.expirationTime <= now)) return null;
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function createRedisCommand(url, token, fetcher = fetch) {
  return async (...args) => {
    const response = await fetcher(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Notification storage unavailable');
    const { result, error } = await response.json();
    if (error) throw new Error('Notification storage command failed');
    return result;
  };
}

const addWatch = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local legacy = redis.call('GET', KEYS[3])
  local replaceLegacy = false
  if legacy then
    local prior = cjson.decode(legacy).tracking
    replaceLegacy = prior.roomId == ARGV[8] and prior.machineId == ARGV[9]
  end
  if not replaceLegacy and not redis.call('ZSCORE', KEYS[1], ARGV[3]) and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[5]) then
    return 0
  end
  if replaceLegacy then
    redis.call('DEL', KEYS[3])
    redis.call('ZREM', KEYS[1], ARGV[7])
  end
  redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[6])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  return 1
`;

const changeWatch = `
  if redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
  if ARGV[3] == '' then
    redis.call('DEL', KEYS[2])
    redis.call('ZREM', KEYS[1], ARGV[1])
  else
    redis.call('SET', KEYS[2], ARGV[3], 'KEEPTTL')
  end
  return 1
`;

const renewPoll = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  redis.call('DEL', KEYS[1])
  return 1
`;

export function createWatchStore(command) {
  function replace(slot, before, after) {
    return command('EVAL', changeWatch, '2', INDEX, `${PREFIX}:watch:${slot}`, slot, before, after ?? '');
  }
  return {
    async ready() { return Boolean(await command('GET', HEARTBEAT)); },
    async start(subscription, tracking, now) {
      const legacySlot = createHash('sha256').update(subscription.endpoint).digest('base64url');
      const slot = createHash('sha256').update(JSON.stringify([subscription.endpoint, tracking.roomId, tracking.machineId])).digest('base64url');
      const watchId = `${slot}.${randomBytes(16).toString('base64url')}`;
      const expiresAt = now + WATCH_MS;
      const raw = JSON.stringify({ watchId, subscription, tracking, expiresAt });
      const ok = await command('EVAL', addWatch, '3', INDEX, `${PREFIX}:watch:${slot}`, `${PREFIX}:watch:${legacySlot}`,
        now, expiresAt, slot, raw, MAX_WATCHES, WATCH_MS, legacySlot, tracking.roomId, tracking.machineId);
      return ok ? { watchId, expiresAt } : null;
    },
    async stop(watchId) {
      const slot = WATCH_ID.exec(watchId ?? '')?.[1];
      if (!slot) return;
      const raw = await command('GET', `${PREFIX}:watch:${slot}`);
      if (raw && JSON.parse(raw).watchId === watchId) await replace(slot, raw, null);
    },
    async pending(now) {
      await command('ZREMRANGEBYSCORE', INDEX, '-inf', now);
      const slots = await command('ZRANGE', INDEX, '0', String(MAX_WATCHES - 1));
      if (slots.length === 0) return [];
      const values = await command('MGET', ...slots.map(slot => `${PREFIX}:watch:${slot}`));
      return slots.flatMap((slot, i) => values[i] ? [{ slot, raw: values[i], watch: JSON.parse(values[i]) }] : []);
    },
    replace,
    async poll(action) {
      const token = randomBytes(16).toString('base64url');
      if (!await command('SET', LOCK, token, 'NX', 'PX', '70000')) return { skipped: true };
      try {
        await command('SET', HEARTBEAT, '1', 'EX', '360');
        return await action();
      } finally {
        await command('EVAL', renewPoll, '1', LOCK, token);
      }
    },
  };
}

export function trackingForMachine(snapshot, id, now = Date.now()) {
  const machine = snapshot.machines.find(machine => machine.id === id);
  return !snapshot.demo && machine ? startTracking(snapshot, machine, now) : null;
}

export async function pollNotifications(store, getStatus, send, now = Date.now) {
  return store.poll(async () => {
    const entries = await store.pending(now());
    if (entries.length === 0) return { sent: 0 };
    const snapshot = entries.some(entry => entry.watch.tracking.phase !== 'ready') ? await getStatus() : null;
    const results = await Promise.allSettled(entries.map(async ({ slot, raw, watch }) => {
      if (watch.expiresAt <= now()) return false;
      const current = watch.tracking.phase === 'ready' ? watch.tracking : updateTracking(watch.tracking, snapshot, now());
      if (!current || (current.phase === 'ready' && now() - current.checkedAt > 10 * 60 * 1000)) {
        await store.replace(slot, raw, null);
        return false;
      }
      if (current !== watch.tracking) {
        const next = JSON.stringify({ ...watch, tracking: current });
        if (!await store.replace(slot, raw, next)) return false;
        raw = next;
      }
      if (current.phase !== 'ready') return false;
      // A no-op CAS also checks cancellation or replacement before retrying a send.
      if (!await store.replace(slot, raw, raw)) return false;
      const tag = createHash('sha256').update(watch.watchId).digest('base64url').slice(0, 24);
      try {
        await send(watch.subscription, { title: `${current.name} has finished`, tag });
      } catch (error) {
        if (![404, 410].includes(error?.statusCode)) throw new Error('Background notification delivery failed');
        await store.replace(slot, raw, null);
        return false;
      }
      await store.replace(slot, raw, null);
      return true;
    }));
    if (results.some(result => result.status === 'rejected')) throw new Error('Notification poll needs retry');
    return { sent: results.filter(result => result.value === true).length };
  });
}
