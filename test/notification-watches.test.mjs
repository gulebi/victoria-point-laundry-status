import assert from 'node:assert/strict';
import test from 'node:test';
import { createWatchStore, pollNotifications, trackingForMachine, validatePushSubscription } from '../lib/notification-watches.mjs';

const START = Date.parse('2026-11-22T12:00:00Z');
const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString('base64url'), auth: Buffer.alloc(16).toString('base64url') };
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys };
const washer = (state, cycleId) => ({ id: 'washer', name: 'WASHER 2', state, cycleActive: state === 'busy', cycleId });
function snapshot(machine, at) {
  return { room: { id: 'laundry' }, checkedAt: new Date(at).toISOString(),
    validUntil: new Date(at + 90000).toISOString(), machines: [machine] };
}

function fixture(machine = washer('available', 'previous')) {
  let now = START;
  let status = snapshot(machine, now);
  let raw = JSON.stringify({ watchId: 'test-id', subscription, expiresAt: now + 3600000,
    tracking: trackingForMachine(status, 'washer', now) });
  const store = {
    async poll(action) { return action(); },
    async pending() { return raw ? [{ slot: 'slot', raw, watch: JSON.parse(raw) }] : []; },
    async replace(slot, previous, next) {
      if (slot !== 'slot' || raw !== previous) return 0;
      raw = next;
      return 1;
    },
  };
  return {
    current: () => raw && JSON.parse(raw).tracking,
    update: (machine) => { now += 120000; status = snapshot(machine, now); },
    poll: (send) => pollNotifications(store, async () => status, send, () => now),
  };
}

test('subscriptions accept browser push providers and reject arbitrary HTTPS targets', () => {
  for (const endpoint of [subscription.endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/test', 'https://web.push.apple.com/test']) {
    assert.equal(validatePushSubscription({ endpoint, keys }, START).endpoint, endpoint);
  }
  for (const endpoint of [
    'http://fcm.googleapis.com/test', 'https://fcm.googleapis.com.example.org/test',
    'https://fcm.googleapis.com@127.0.0.1/test', 'https://fcm.googleapis.com:8443/test',
    'https://169.254.169.254/metadata', 'https://example.org/redirect',
  ]) assert.equal(validatePushSubscription({ endpoint, keys }, START), null);
  assert.equal(validatePushSubscription({ ...subscription, expirationTime: START }, START), null);
  assert.equal(validatePushSubscription({ ...subscription, keys: { ...keys, auth: 'bad' } }, START), null);
});

test('the server tracks a full cycle and sends once without an open browser', async () => {
  const f = fixture();
  const messages = [];
  const send = async (destination, message) => { messages.push({ destination, message }); };
  assert.equal(f.current().phase, 'waiting');
  assert.equal((await f.poll(send)).sent, 0);
  f.update(washer('busy', 'my-cycle'));
  assert.equal((await f.poll(send)).sent, 0);
  assert.equal(f.current().cycleId, 'my-cycle');
  f.update(washer('available', 'my-cycle'));
  assert.equal((await f.poll(send)).sent, 1);
  assert.equal(f.current(), null);
  assert.equal(messages[0].destination.endpoint, subscription.endpoint);
  assert.equal(messages[0].message.title, 'WASHER 2 has finished');
  f.update(washer('busy', 'someone-else'));
  await f.poll(send);
  f.update(washer('available', 'someone-else'));
  await f.poll(send);
  assert.equal(messages.length, 1);
});

test('a new paid cycle cancels an unfinished watch without sending', async () => {
  const f = fixture(washer('busy', 'my-cycle'));
  f.update(washer('busy', 'someone-else'));
  assert.equal((await f.poll(() => assert.fail('Must not send'))).sent, 0);
  assert.equal(f.current(), null);
});

test('temporary delivery failures retry the completed cycle with the same tag', async () => {
  const f = fixture(washer('busy', 'my-cycle'));
  f.update(washer('available', 'my-cycle'));
  const tags = [];
  await assert.rejects(f.poll(async (_, message) => {
    tags.push(message.tag);
    throw new Error('Temporary delivery failure');
  }), /needs retry/);
  assert.equal(f.current().phase, 'ready');
  const retry = await f.poll(async (_, message) => tags.push(message.tag));
  assert.equal(retry.sent, 1);
  assert.equal(tags[0], tags[1]);
  assert.equal(f.current(), null);
});

test('expired push endpoints are removed from tracking', async () => {
  const f = fixture(washer('busy', 'my-cycle'));
  f.update(washer('available', 'my-cycle'));
  assert.equal((await f.poll(async () => { throw { statusCode: 410 }; })).sent, 0);
  assert.equal(f.current(), null);
});

test('one browser gets separate alerts as its washer and dryer finish', async () => {
  let now = START;
  const dryer = { ...washer('busy', 'dry-cycle'), id: 'dryer', name: 'DRYER 3' };
  const washing = washer('busy', 'wash-cycle');
  const status = (rows) => ({ ...snapshot(rows[0], now), machines: rows });
  const selections = status([washing, dryer]);
  const entries = new Map();
  const registrations = createWatchStore(async (command, _, numKeys, index, key, legacyKey, startedAt, expiresAt, slot, raw) => {
    assert.equal(command, 'EVAL');
    assert.equal(numKeys, '3');
    assert.ok(key.endsWith(`:${slot}`));
    assert.notEqual(key, legacyKey);
    entries.set(slot, raw);
    return 1;
  });
  await registrations.start(subscription, trackingForMachine(selections, 'washer', now), now);
  await registrations.start(subscription, trackingForMachine(selections, 'dryer', now), now);
  assert.equal(entries.size, 2);

  const store = {
    async poll(action) { return action(); },
    async pending() {
      return [...entries].map(([slot, raw]) => ({ slot, raw, watch: JSON.parse(raw) }));
    },
    async replace(slot, before, after) {
      if (entries.get(slot) !== before) return 0;
      if (after === null) entries.delete(slot);
      else entries.set(slot, after);
      return 1;
    },
  };
  const messages = [];
  const poll = (rows) => pollNotifications(store, async () => status(rows), async (destination, message) => {
    assert.equal(destination.endpoint, subscription.endpoint);
    messages.push(message);
  }, () => now);
  const washed = washer('available', 'wash-cycle');
  now += 120000;
  assert.equal((await poll([washed, dryer])).sent, 1);
  assert.equal(entries.size, 1);
  const dried = { ...dryer, state: 'available', cycleActive: false };
  now += 120000;
  assert.equal((await poll([washed, dried])).sent, 1);
  assert.equal(entries.size, 0);
  assert.deepEqual(messages.map(message => message.title), ['WASHER 2 has finished', 'DRYER 3 has finished']);
  assert.notEqual(messages[0].tag, messages[1].tag);
  assert.equal((await poll([washed, dried])).sent, 0);
});
