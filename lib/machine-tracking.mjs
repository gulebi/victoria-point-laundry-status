export const TRACKING_KEY = 'victoria-point:machine-tracking';

export function decodeTracking(value) {
  try {
    const record = JSON.parse(value);
    if (record && typeof record.roomId === 'string' && typeof record.machineId === 'string' &&
        typeof record.name === 'string' && ['waiting', 'running'].includes(record.phase) &&
        Number.isSafeInteger(record.createdAt) && Number.isSafeInteger(record.checkedAt)) return record;
  } catch {
    // A damaged local record can be replaced by a new selection.
  }
  return null;
}

function freshTimestamp(snapshot, now) {
  const checkedAt = Date.parse(snapshot?.checkedAt);
  const validUntil = Date.parse(snapshot?.validUntil);
  return Number.isFinite(checkedAt) && validUntil > checkedAt && now <= validUntil ? checkedAt : null;
}

export function startTracking(snapshot, machine, now = Date.now()) {
  const checkedAt = freshTimestamp(snapshot, now);
  if (checkedAt === null || !snapshot.room?.id || !['available', 'busy'].includes(machine.state)) return null;
  const running = machine.state === 'busy' && machine.cycleActive === true;
  return {
    roomId: snapshot.room.id,
    machineId: machine.id,
    name: machine.name,
    phase: running ? 'running' : 'waiting',
    cycleId: running ? machine.cycleId ?? null : null,
    checkedAt,
    createdAt: now,
  };
}

export function updateTracking(record, snapshot, now = Date.now()) {
  if (!record || record.phase === 'ready' || record.roomId !== snapshot?.room?.id) return record;
  const checkedAt = freshTimestamp(snapshot, now);
  if (checkedAt === null || checkedAt <= record.checkedAt) return record;
  const machine = snapshot.machines.find(row => row.id === record.machineId);
  const running = machine?.state === 'busy' && machine.cycleActive === true;
  const cycleId = machine?.cycleId ?? null;
  if (record.phase === 'waiting' && running) return { ...record, phase: 'running', cycleId, checkedAt };
  if (record.phase === 'running') {
    // A new payment after a missed poll is no longer the selected run.
    if (record.cycleId && cycleId && record.cycleId !== cycleId) return null;
    if (machine?.state === 'available') return { ...record, phase: 'ready', checkedAt };
    if (running && !record.cycleId && cycleId) return { ...record, cycleId, checkedAt };
  }
  return record;
}
