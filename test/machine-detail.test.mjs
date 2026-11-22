import test from 'node:test';
import assert from 'node:assert/strict';
import { machineDetail } from '../lib/machine-detail.mjs';

const now = Date.parse('2026-11-22T22:30:00Z');
const free = { state: 'available', label: 'Available' };

test('finish details roll over from minutes to hours and days', () => {
  for (const [minutes, expected] of [
    [0, 'Finished under 1 min ago'],
    [15, 'Finished about 15 min ago'],
    [60, 'Finished about 1 hr ago'],
    [142, 'Finished about 2 hr 22 min ago'],
    [1582, 'Finished about 1 day 2 hr 22 min ago'],
    [2880, 'Finished about 2 days ago'],
  ]) {
    assert.equal(machineDetail({ ...free, finishedAt: now - minutes * 60000 }, false, now), expected);
  }
});

test('unknown, future or stale finish times do not show a duration', () => {
  assert.equal(machineDetail(free, false, now), 'Last finish time unavailable');
  assert.equal(machineDetail({ ...free, finishedAt: now + 1 }, false, now), 'Last finish time unavailable');
  assert.equal(machineDetail({ ...free, finishedAt: now - 60000 }, true, now), 'Last reported as available');
  assert.equal(machineDetail({ state: 'busy', elapsedMinutes: 20 }, false, now), 'Running for about 20 min');
  assert.equal(machineDetail({ state: 'reserved', finishedAt: now - 60000 }, false, now), null);
});
