import assert from 'node:assert/strict';
import test from 'node:test';
import { pollNotifications, trackingForMachine, validatePushSubscription } from '../lib/notification-watches.mjs';

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
