export function machineDetail(machine, stale, now) {
  if (stale) return `Last reported as ${machine.label.toLowerCase()}`;
  if (machine.state === 'busy' && Number.isSafeInteger(machine.elapsedMinutes)) {
    return machine.elapsedMinutes === 0
      ? 'Running for under 1 min'
      : `Running for about ${machine.elapsedMinutes} min`;
  }
  if (machine.state !== 'available') return null;

  const { finishedAt } = machine;
  if (!Number.isSafeInteger(finishedAt) || finishedAt <= 0 || finishedAt > now) return 'Last finish time unavailable';
  const total = Math.floor((now - finishedAt) / 60000);
  if (total === 0) return 'Finished under 1 min ago';

  const days = Math.floor(total / 1440);
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  return `Finished about ${parts.join(' ')} ago`;
}
