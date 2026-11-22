import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircuitClient, summarizeAvailability, CircuitError } from '../lib/circuitgo.mjs';
import { createStatusCache } from '../lib/status-cache.mjs';

const NOW = Math.floor(Date.parse('2026-10-24T13:20:00Z') / 1000);
const ALL_DAY = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, { slot: { start: '0000', end: '2359' } }]));
function room(overrides = {}) {
  return {
    opening_schedule: structuredClone(ALL_DAY),
    devices: { machine: {
      name: 'WASHER 2', product_type: 'WASHER', config: 'PROGRAM_PICKER',
      last_used: NOW - 60, ac_detect_mode: 3, subscribed: true, maintenance: false,
      machine_programs: { a: { name: 'Synthetic' } }, ...overrides,
    } },
    booking_settings: { product_type_specific: { washer: { pre_reservation_time_limit: 30, post_reservation_time_limit: 15, warning_time: 180 } } },
  };
}
const summarize = (r = room(), bookings = null, instant = [], timestamp = NOW, checks) => summarizeAvailability(r, bookings, instant, timestamp, 'own-user', checks);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const authResponse = { idToken: 'test-token', localId: 'own-user', refreshToken: 'test-refresh', expiresIn: '3600' };
function fakeService({ failBookings = false, failInstant = false, permission = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (String(url).includes('signInWithPassword')) return json(authResponse);
    if (String(url).includes('securetoken.googleapis.com')) return json({ id_token: 'refreshed-token', user_id: 'own-user', refresh_token: 'rotated-refresh', expires_in: '3600' });
    if (permission) return json({ error: 'Permission denied' }, 403);
    if (String(url).includes('/locations/')) return json(room());
    if (String(url).includes('/bookings/')) return failBookings ? json({ error: 'Permission denied' }, 403) : json(null);
    if (String(url).includes(':runQuery')) return failInstant ? json({ error: { message: 'Permission denied' } }, 403) : json([{ readTime: '2026-10-24T13:20:00Z' }]);
    throw new Error('Unexpected endpoint');
  };
  return { requests, fetchImpl };
}
const deployment = { roomId: 'test-laundry', apiKey: 'test-firebase-key' };
const credentials = { ...deployment, phone: '+447700900000', pin: '0123' }; // Synthetic offline credentials.

test('expired AC timer + complete reads becomes available per app logic', () => {
  const status = summarize();
  assert.equal(status.machines[0].state, 'available');
  assert.equal(status.available, 1);
  assert.equal(status.partial, false);
});
test('elapsed run time counts up from payment independently of the release estimate', () => {
  const lastPayment = NOW - 12 * 60 - 59;
  const r = room({ last_used: NOW + 132 * 60, last_payment_timestamp: lastPayment });
  const machine = summarize(r).machines[0];
  assert.equal(machine.state, 'busy');
  assert.equal(machine.cycleActive, true);
  assert.equal(machine.label, 'In use');
  assert.equal(machine.elapsedMinutes, 12);
  assert.equal(summarize(r, null, [], NOW + 1).machines[0].elapsedMinutes, 13);
  r.devices.machine.last_used += 45 * 60;
  assert.equal(summarize(r).machines[0].elapsedMinutes, 12);
  assert.ok(!('last_payment_timestamp' in machine));
});
test('paid run marker stays stable through release and changes with a different payment', () => {
  const last_payment_timestamp = NOW - 60;
  const busy = summarize(room({ last_used: NOW + 60, last_payment_timestamp })).machines[0];
  const free = summarize(room({ last_payment_timestamp })).machines[0];
  const paidAgain = summarize(room({ last_payment_timestamp: NOW })).machines[0];
  assert.ok(busy.cycleId);
  assert.equal(free.cycleId, busy.cycleId);
  assert.notEqual(paidAgain.cycleId, busy.cycleId);
});
test('recent payments show zero elapsed minutes until the first full minute', () => {
  const status = summarize(room({ last_used: NOW + 100, last_payment_timestamp: NOW - 59 }));
  assert.equal(status.machines[0].elapsedMinutes, 0);
});
test('missing, malformed or future payment time leaves only the busy status', () => {
  for (const payment of [undefined, 0, -1, String(NOW), NOW - 0.5, NOW + 1, NOW * 1000]) {
    const status = summarize(room({ last_used: NOW + 100, last_payment_timestamp: payment }));
    assert.equal(status.machines[0].state, 'busy');
    assert.equal(status.machines[0].elapsedMinutes, null);
  }
});
test('expired timers and higher-priority statuses suppress elapsed run time', () => {
  const lastPayment = NOW - 720;
  assert.equal(summarize(room({ last_payment_timestamp: lastPayment })).machines[0].elapsedMinutes, null);
  for (const overrides of [
    { maintenance: true },
    { subscribed: false },
    { machine_status: { status: 'connected', uid: 'other', expire_at: NOW + 60 } },
  ]) {
    const status = summarize(room({ last_used: NOW + 100, last_payment_timestamp: lastPayment, ...overrides }));
    assert.equal(status.machines[0].elapsedMinutes, null);
  }
});
test('coin feedback alone cannot be inferred from expired timer', () => {
  assert.equal(summarize(room({ coin_feedback_enabled: true })).machines[0].state, 'unknown');
});
test('maintenance and no-program precedence', () => {
  assert.equal(summarize(room({ maintenance: true, last_used: NOW + 500 })).machines[0].state, 'maintenance');
  assert.equal(summarize(room({ machine_programs: null })).machines[0].state, 'inactive');
});
test('another user connection is held; own connection is not held', () => {
  const held = summarize(room({ machine_status: { status: 'connected', uid: 'someone', expire_at: NOW + 60 } })).machines[0];
  assert.equal(held.state, 'busy');
  assert.equal(held.cycleActive, false);
  assert.equal(summarize(room({ machine_status: { status: 'connected', uid: 'own-user', expire_at: NOW + 60 } })).machines[0].state, 'available');
});
test('expired connection has no effect', () => {
  assert.equal(summarize(room({ machine_status: { status: 'connected', uid: 'someone', expire_at: NOW - 1 } })).available, 1);
});
test('London timezone is used independently of execution host', () => {
  const r = room();
  r.opening_schedule.sat.slot = { start: '1400', end: '1430' };
  assert.equal(summarize(r).opening.open, true); // 13:20 UTC = 14:20 BST.
  r.opening_schedule.sat.slot.end = '1405';
  assert.equal(summarize(r).machines[0].state, 'closed');
});
test('winter GMT, missing day and inclusive minute boundaries', () => {
  const r = room();
  r.opening_schedule.mon.slot = { start: '1400', end: '1405' };
  const stamp = Date.parse('2026-10-26T14:05:59Z') / 1000;
  assert.equal(summarize(r, null, [], stamp).opening.open, true);
  delete r.opening_schedule.mon;
  assert.equal(summarize(r, null, [], stamp).opening.open, false);
});
test('unknown schedule, timer or unsupported config is never free', () => {
  const r = room(); delete r.opening_schedule;
  assert.equal(summarize(r).machines[0].state, 'unknown');
  assert.equal(summarize(room({ last_used: '123' })).machines[0].state, 'unknown');
  assert.equal(summarize(room({ config: 'INCREMENT_PICKER' })).machines[0].state, 'unknown');
});
test('an instant booking blocks only its machine', () => {
  const result = summarize(room(), null, [{ device_id: 'machine', expire_at: NOW + 60 }]);
  assert.equal(result.machines[0].state, 'reserved');
  assert.equal(summarize(room(), null, [{ device_id: 'other', expire_at: NOW + 60 }]).available, 1);
});
test('scheduled pre/start/post windows and warning match conservative app states', () => {
  const booking = { device_id: 'machine', start: NOW + 20 * 60, end: NOW + 3600, timezone_id: 'Europe/London', user_uid: 'other-private-uid' };
  assert.equal(summarize(room(), { a: booking }).machines[0].state, 'reserved');
  booking.start = NOW + 60 * 60;
  assert.equal(summarize(room(), { a: booking }).machines[0].state, 'reserved_soon');
  booking.start = NOW - 16 * 60;
  assert.equal(summarize(room(), { a: booking }).machines[0].state, 'available');
});
test('failed reservation reads produce unknown, never empty-success', () => {
  assert.equal(summarize(room(), undefined, [], NOW, { scheduled: false, instant: true }).available, 0);
  assert.equal(summarize(room(), null, undefined, NOW, { scheduled: true, instant: false }).partial, true);
});
test('allowlist prevents raw account/device/booking secrets escaping', () => {
  const result = summarize(room({ password: 'secret-pass', uid: 'secret-owner', last_user: 'secret-last-user', machine_status: { uid: 'secret-connection-user' } }));
  assert.doesNotMatch(JSON.stringify(result), /secret-/);
});
test('ordinary login uses existing account only and Firestore is authenticated', async () => {
  const fake = fakeService();
  const client = createCircuitClient(credentials, { fetchImpl: fake.fetchImpl, now: () => NOW * 1000 });
  const status = await client.readStatus();
  assert.equal(status.available, 1);
  assert.equal(status.room.id, deployment.roomId);
  const login = fake.requests[0];
  assert.equal(new URL(login.url).searchParams.get('key'), deployment.apiKey);
  assert.equal(JSON.parse(login.body).email, '+447700900000@airwallet.net');
  assert.equal(JSON.parse(login.body).password, '000123');
  const query = fake.requests.find(request => request.url.includes(':runQuery'));
  assert.equal(query.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(query.body).structuredQuery.where.compositeFilter.filters[0].fieldFilter.value.stringValue, deployment.roomId);
  assert.doesNotMatch(JSON.stringify(JSON.parse(query.body)), /user_uid/);
  assert.ok(fake.requests.every(request => !/signUp|sendVerification|accounts:update/.test(request.url)));
});
test('normal refresh token rotates automatically before ID token expiration', async () => {
  const fake = fakeService(); let clock = NOW * 1000;
  const client = createCircuitClient(credentials, { fetchImpl: fake.fetchImpl, now: () => clock });
  await client.readStatus(); clock += 3590 * 1000;
  await client.readStatus();
  assert.equal(fake.requests.filter(request => request.url.includes('signInWithPassword')).length, 1);
  const refresh = fake.requests.filter(request => request.url.includes('securetoken.googleapis.com'));
  assert.equal(refresh.length, 1);
  assert.equal(new URL(refresh[0].url).searchParams.get('key'), deployment.apiKey);
  assert.equal(new URLSearchParams(refresh[0].body).get('grant_type'), 'refresh_token');
  assert.ok(fake.requests.some(request => request.headers.Authorization === 'Bearer refreshed-token'));
});
test('concurrent reads share one login', async () => {
  const fake = fakeService();
  const client = createCircuitClient(credentials, { fetchImpl: fake.fetchImpl, now: () => NOW * 1000 });
  await Promise.all([client.readStatus(), client.readStatus(), client.readStatus()]);
  assert.equal(fake.requests.filter(request => request.url.includes('signInWithPassword')).length, 1);
});
test('permission denial stays denied with no endless relogin', async () => {
  const fake = fakeService({ permission: true });
  const client = createCircuitClient(credentials, { fetchImpl: fake.fetchImpl, now: () => NOW * 1000 });
  await assert.rejects(client.readStatus(), error => error.code === 'ACCESS_DENIED');
  assert.equal(fake.requests.filter(request => request.url.includes('signInWithPassword')).length, 1);
  assert.equal(fake.requests.filter(request => request.url.includes('securetoken.googleapis.com')).length, 0);
});
test('partial read failure does not become available', async () => {
  for (const flag of ['failBookings', 'failInstant']) {
    const fake = fakeService({ [flag]: true });
    const client = createCircuitClient(credentials, { fetchImpl: fake.fetchImpl, now: () => NOW * 1000 });
    const result = await client.readStatus();
    assert.equal(result.partial, true); assert.equal(result.available, 0);
  }
});
test('errors suppress upstream secrets and raw URLs', async () => {
  const client = createCircuitClient(credentials, {
    now: () => NOW * 1000,
    fetchImpl: async () => json({ error: { message: 'private +447700900000 password=0123 token=abc' } }, 400),
  });
  await assert.rejects(client.readStatus(), error => {
    assert.ok(error instanceof CircuitError);
    assert.doesNotMatch(JSON.stringify(error), /447700|0123|token=abc|https:/);
    return true;
  });
});
test('missing or malformed configuration fails before networking', async () => {
  for (const config of [{ ...credentials, roomId: 'rooms/other' }, { ...credentials, apiKey: '' }, {}]) {
    assert.throws(() => createCircuitClient(config), error => error.code === 'CONFIGURATION');
  }
  const client = createCircuitClient(deployment, { fetchImpl: () => { throw new Error('network should not be called'); } });
  await assert.rejects(client.readStatus(), error => error.code === 'CONFIGURATION');
});
test('cache coalesces requests, expires, and never serves stale success on failure', async () => {
  let clock = 1000, calls = 0, broken = false;
  const cache = createStatusCache(async () => {
    calls++; if (broken) throw new CircuitError('NETWORK');
    return { checkedAt: clock };
  }, () => clock);
  await Promise.all([cache(), cache(), cache()]); assert.equal(calls, 1);
  clock += 29999; await cache(); assert.equal(calls, 1);
  clock += 2; broken = true;
  await assert.rejects(cache(), error => error.code === 'NETWORK');
  await assert.rejects(cache(), error => error.code === 'NETWORK'); assert.equal(calls, 2);
  clock += 30001; broken = false; await cache(); assert.equal(calls, 3);
});
