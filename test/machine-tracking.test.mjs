import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSelections, decodeTracking, startTracking, updateTracking } from '../lib/machine-tracking.mjs';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const free = { id: 'washer-4', name: 'WASHER 4', state: 'available', cycleActive: false, cycleId: 'first-run' };
const running = { ...free, state: 'busy', cycleActive: true };
const hold = { ...free, state: 'busy' };
const snapshot = (machine, checkedAt = NOW, roomId = 'laundry') => ({
  room: { id: roomId },
  checkedAt: new Date(checkedAt).toISOString(),
  validUntil: new Date(checkedAt + 90000).toISOString(),
  machines: [machine],
});

test('the browser can restore an older single selection or several independent machines', () => {
  const washing = startTracking(snapshot(running), running, NOW);
  const dryer = { ...free, id: 'dryer-1', name: 'DRYER 1' };
  const drying = startTracking(snapshot(dryer), dryer, NOW);
  assert.deepEqual(decodeSelections(JSON.stringify(washing)), [washing]);
  assert.deepEqual(decodeSelections(JSON.stringify([washing, drying, washing, null, { phase: 'waiting' }])), [washing, drying]);
  assert.deepEqual(decodeSelections('{'), []);
});

test('a fresh run is saved locally and completes once when the same machine becomes free', () => {
  const record = startTracking(snapshot(running), running, NOW);
  assert.equal(record.phase, 'running');
  const restored = decodeTracking(JSON.stringify(record));
  const next = snapshot(free, NOW + 60000);
  const completed = updateTracking(restored, next, NOW + 60000);
  assert.equal(completed.phase, 'ready');
  assert.equal(completed.checkedAt, NOW + 60000);
  assert.equal(updateTracking(completed, next, NOW + 61000), completed);
  assert.equal(decodeTracking(JSON.stringify(completed)), null);
});

test('selecting early waits until Circuit Go sees a cycle before reporting availability', () => {
  const waiting = startTracking(snapshot(free), free, NOW);
  assert.equal(waiting.phase, 'waiting');
  assert.equal(updateTracking(waiting, snapshot(free, NOW + 60000), NOW + 60000), waiting);
  assert.equal(updateTracking(waiting, snapshot(hold, NOW + 60000), NOW + 60000), waiting);
  const active = updateTracking(waiting, snapshot(running, NOW + 60000), NOW + 60000);
  assert.equal(active.phase, 'running');
  assert.equal(active.cycleId, running.cycleId);
  assert.equal(updateTracking(active, snapshot(free, NOW + 120000), NOW + 120000).phase, 'ready');
});

test('a new payment clears tracking quietly when the selected run was missed', () => {
  const record = startTracking(snapshot(running), running, NOW);
  for (const state of [running, free]) {
    const otherRun = snapshot({ ...state, cycleId: 'second-run' }, NOW + 120000);
    assert.equal(updateTracking(record, otherRun, NOW + 120000), null);
  }
});

test('a pre-upgrade selection can learn a cycle ID from a later busy snapshot', () => {
  const legacy = startTracking(snapshot(running), { ...running, cycleId: undefined }, NOW);
  const record = decodeTracking(JSON.stringify(legacy));
  const updated = updateTracking(record, snapshot(running, NOW + 60000), NOW + 60000);
  assert.equal(updated.phase, 'running');
  assert.equal(updated.cycleId, running.cycleId);
});

test('selecting during a connection hold waits for cycle evidence', () => {
  const waiting = startTracking(snapshot(hold), hold, NOW);
  assert.equal(waiting.phase, 'waiting');
  assert.equal(updateTracking(waiting, snapshot(free, NOW + 60000), NOW + 60000), waiting);
});

test('stale, cached, out-of-order, and unrelated snapshots cannot complete a cycle', () => {
  const record = startTracking(snapshot(running), running, NOW);
  assert.equal(updateTracking(record, snapshot(free, NOW - 1000), NOW), record);
  assert.equal(updateTracking(record, snapshot(free, NOW), NOW), record);
  for (const other of [
    snapshot(free, NOW + 1000),
    snapshot({ ...free, id: 'another-machine' }, NOW + 120000),
    snapshot(free, NOW + 120000, 'another-laundry'),
  ]) {
    assert.equal(updateTracking(record, other, NOW + 120000), record);
  }
});

test('unknown, reserved, closed and maintenance states leave an active selection intact', () => {
  const record = startTracking(snapshot(running), running, NOW);
  for (const state of ['unknown', 'reserved', 'reserved_soon', 'closed', 'maintenance', 'inactive']) {
    assert.equal(updateTracking(record, snapshot({ ...free, state }, NOW + 60000), NOW + 60000), record);
  }
});

test('invalid local data and stale selections are rejected', () => {
  for (const value of [null, '{broken', 'false', '{"phase":"running"}']) {
    assert.equal(decodeTracking(value), null);
  }
  assert.equal(startTracking(snapshot(running), running, NOW + 91000), null);
});
