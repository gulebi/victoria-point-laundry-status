function formatDuration(totalMinutes) {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  return parts.join(' ');
}

export function machineDetail(machine, stale, now) {
  if (stale) return `Last reported as ${machine.label.toLowerCase()}`;
  const { elapsedMinutes } = machine;
  if (machine.state === 'busy' && Number.isSafeInteger(elapsedMinutes) && elapsedMinutes >= 0) {
    return elapsedMinutes === 0
      ? 'Running for under 1 min'
      : `Running for about ${formatDuration(elapsedMinutes)}`;
  }
  if (machine.state !== 'available') return null;

  const { finishedAt } = machine;
  if (!Number.isSafeInteger(finishedAt) || finishedAt <= 0 || finishedAt > now) return 'Last finish time unavailable';
  const minutesSinceFinish = Math.floor((now - finishedAt) / 60000);
  return minutesSinceFinish === 0
    ? 'Finished under 1 min ago'
    : `Finished about ${formatDuration(minutesSinceFinish)} ago`;
}
