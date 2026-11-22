// Synthetic UI fixtures only. Never enabled in production.
export function demoStatus() {
  const stamp = Date.now();
  const machines = [
    { id: 'demo-w2', name: 'WASHER 2', type: 'washer', state: 'available', label: 'Available', cycleActive: false, elapsedMinutes: null },
    { id: 'demo-w4', name: 'WASHER 4', type: 'washer', state: 'busy', label: 'In use', cycleActive: true, elapsedMinutes: 18 },
    { id: 'demo-d1', name: 'DRYER 1', type: 'dryer', state: 'available', label: 'Available', cycleActive: false, elapsedMinutes: null },
    { id: 'demo-d3', name: 'DRYER 3', type: 'dryer', state: 'available', label: 'Available', cycleActive: false, elapsedMinutes: null },
  ];
  return {
    room: { id: 'demo', name: 'Victoria Point 4' }, timezone: 'Europe/London',
    checkedAt: new Date(stamp).toISOString(), validUntil: new Date(stamp + 90000).toISOString(),
    opening: { open: true, today: ['00:00–23:59'] },
    checks: { hours: true, scheduled: true, instant: true },
    machines, available: 3, total: 4, partial: false, demo: true,
  };
}
