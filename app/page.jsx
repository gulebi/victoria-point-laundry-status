'use client';

import { useEffect, useRef, useState } from 'react';
import { InfoCircleIcon, RefreshIcon, TumbleDryIcon, WashMachineIcon } from './icons';
import { useMachineTracking } from './use-machine-tracking';

function timeLabel(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function machineDetail(machine, stale) {
  if (stale) return `Last reported as ${machine.label.toLowerCase()}`;
  if (machine.state !== 'busy' || !Number.isSafeInteger(machine.elapsedMinutes)) return null;
  if (machine.elapsedMinutes === 0) return 'Running for under 1 min';
  return `Running for about ${machine.elapsedMinutes} min`;
}

function MachineCard({ machine, stale, selected, onTrack }) {
  const ready = machine.state === 'available' && !stale;
  const busy = machine.state === 'busy' && !stale;
  const kind = { washer: 'Washer', dryer: 'Dryer', other: 'Machine' }[machine.type];
  const detail = machineDetail(machine, stale);
  return <article className={`machine ${ready ? 'ready' : busy ? 'busy' : 'neutral'}${selected ? ' tracked' : ''}`}>
    <div className="machine-top"><span className="machine-name">{machine.name}</span><span className="kind">{kind}</span></div>
    <div className="machine-art">
      {machine.type === 'dryer' ? <TumbleDryIcon/> : <WashMachineIcon/>}
      <span className="art-floor"/>
    </div>
    <div className="machine-bottom">
      <div className="machine-state"><span className="dot"/>{stale ? 'Status out of date' : machine.label}</div>
      {detail && <span className="machine-detail">{detail}</span>}
      {onTrack && (ready || busy) && <button
        className="tracking-button"
        aria-label={`Track ${machine.name} as my machine`}
        onClick={() => onTrack(machine)}
      >This is my machine</button>}
    </div>
  </article>;
}

function TrackingPanel({ tracking, permission, storageUnavailable, canEnablePush, alertError, enableNotifications, stopTracking, dismissCompletion }) {
  const ready = tracking.phase === 'ready';
  const canEnable = !tracking.watchId && (permission === 'default' || (permission === 'granted' && canEnablePush));
  let notificationHint = 'Enable notifications for a system alert.';
  if (permission === 'denied' || permission === 'unavailable') notificationHint = 'System alerts are unavailable. Updates appear here.';
  else if (tracking.watchId) notificationHint = 'You can close this tab. We’ll notify you when this cycle finishes.';
  else if (permission === 'granted') notificationHint = canEnablePush
    ? 'Enable background alerts to get notified with the tab closed.'
    : 'Alerts currently work while the dashboard is running.';
  return <aside className={`tracking-panel${ready ? ' tracking-ready' : ''}`} aria-label="Your machine">
    <div role="status">
      <strong>{ready ? `${tracking.name} was reported free` : `Tracking ${tracking.name}`}</strong>
      {ready
        ? <p>Circuit Go reported it available at {timeLabel(tracking.checkedAt)}. You can collect your laundry.</p>
        : <>
          <p>{tracking.phase === 'waiting' ? 'Waiting for Circuit Go to show it in use.' : 'Watching for the next available status.'}</p>
          <p>{notificationHint}</p>
        </>}
      {storageUnavailable && <p>Browser storage is unavailable. The selection will reset if you reload this tab.</p>}
      {alertError && <p role="alert">{alertError}</p>}
    </div>
    <div className="tracking-actions">
      {!ready && canEnable && <button className="tracking-button" onClick={enableNotifications}>{canEnablePush ? 'Enable background alerts' : 'Enable notifications'}</button>}
      <button className="tracking-button" onClick={ready ? dismissCompletion : stopTracking}>{ready ? 'Dismiss' : 'Stop tracking'}</button>
    </div>
  </aside>;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(0);
  const [filter, setFilter] = useState('all');
  const refreshRef = useRef(null);
  const tracker = useMachineTracking();
  const { needsBrowserPolling, observeSnapshot } = tracker;

  useEffect(() => {
    let stopped = false, pending = false, timer, failures = 0, controller;
    function schedule() {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(update, Math.min(300000, 60000 * 2 ** failures));
    }
    async function update() {
      if (stopped || pending) return;
      if (document.hidden && !needsBrowserPolling()) { schedule(); return; }
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      setLoading(true);
      try {
        const response = await fetch('/api/status', { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error?.message || 'Could not fetch machine statuses.');
        if (!Array.isArray(result?.machines) || !Number.isFinite(Date.parse(result.validUntil))) throw new Error('Could not read machine statuses.');
        if (!stopped) {
          setData(result);
          setError('');
          failures = 0;
          observeSnapshot(result);
        }
      } catch (failure) {
        if (!stopped) {
          failures = Math.min(3, failures + 1);
          if (failure.name === 'AbortError') setError('The status request timed out. Retrying automatically.');
          else if (failure.name === 'Error') setError(failure.message);
          else setError('Could not load machine statuses. Retrying automatically.');
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (!stopped) { setLoading(false); setClock(Date.now()); schedule(); }
      }
    }
    const visible = () => { if (!document.hidden) update(); };
    refreshRef.current = update;
    document.addEventListener('visibilitychange', visible);
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    update();
    return () => { stopped = true; clearTimeout(timer); clearInterval(ticker); controller?.abort(); document.removeEventListener('visibilitychange', visible); refreshRef.current = null; };
  }, [needsBrowserPolling, observeSnapshot]);

  const stale = Boolean(error || (data && clock > Date.parse(data.validUntil)));
  const good = data && !stale;
  const machines = data?.machines.filter(machine => filter === 'all' || machine.type === filter);
  const refreshLabel = loading ? 'Refreshing' : 'Refresh';
  const { tracking, completion } = tracker;
  const track = tracking ? null : machine => tracker.trackMachine(data, machine);

  return <main>
    <header className="site-header">
      <a className="brand" href="/" aria-label="Laundry dashboard home">
        <span className="brand-mark"><WashMachineIcon size={25} strokeWidth={1.75}/></span>
        <span>Laundry<span className="brand-sub">VICTORIA POINT</span></span>
      </a>
    </header>

    <section className="intro"><h1>Victoria Point <span>4</span></h1></section>

    {data?.demo && <div className="notice demo"><strong>Demo mode.</strong> This page shows sample data.</div>}
    {error && <div className="notice error" role="alert"><strong>Update failed</strong><span>{error}</span></div>}

    <section className={`overview ${good ? '' : 'overview-muted'}`} aria-live="polite">
      <div className="overview-main"><span className="live-caption"><span className="dot"/>{good ? 'AVAILABILITY' : loading && !data ? 'LOADING' : 'AWAITING UPDATE'}</span>
        <div className="overview-line"><span className="big-number">{good ? data.available : '—'}</span><div><h2>{good ? data.available === 1 ? 'machine available' : 'machines available' : 'Checking availability'}</h2>{good && <p>{`out of ${data.total} in this laundry`}</p>}</div></div>
      </div>
      <div className="overview-side"><span className={`hours-badge ${good && data.opening.open ? '' : 'muted-badge'}`}><span className="dot"/>{good ? data.opening.open ? 'Laundry open' : data.opening.open === false ? 'Laundry closed' : 'Opening hours unknown' : 'Awaiting opening status'}</span>{good && data.opening.today.length > 0 && <p>{data.opening.today.join(', ')}</p>}</div>
    </section>

    <section className="machines-section" aria-label="Machines">
      {(tracking || completion) && <TrackingPanel {...tracker} tracking={tracking || completion}/>}
      <div className="section-toolbar"><div className="filters" role="group" aria-label="Machine type">{[['all', 'All machines'], ['washer', 'Washers'], ['dryer', 'Dryers']].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={filter === value ? 'selected' : ''}>{label}</button>)}</div><button className="refresh-button" onClick={() => refreshRef.current?.()} disabled={loading} aria-label={refreshLabel}><RefreshIcon spinning={loading}/><span>{refreshLabel}</span></button></div>
      <div className="machine-grid">{machines ? machines.map(machine => <MachineCard
        key={machine.id}
        machine={machine}
        stale={stale}
        selected={tracking?.roomId === data.room?.id && tracking?.machineId === machine.id}
        onTrack={track}
      />) : [1, 2, 3, 4].map(value => <div className="machine skeleton" aria-hidden="true" key={value}><div/><div/><div/></div>)}</div>
      {machines?.length === 0 && <p className="empty">{data.total ? 'No machines match this filter.' : 'Circuit Go returned no machines.'}</p>}
      <div className="update-line"><span><span className={`tiny-dot ${good ? 'fresh' : ''}`}/>{data ? `Last checked at ${timeLabel(data.checkedAt)} (London)` : 'Waiting for Circuit Go'}</span><span>{good ? 'Refreshes every minute' : 'Retries automatically'}</span></div>
      {good && data.partial && <div className="notice partial">Some machine statuses could not be confirmed.</div>}
    </section>

    <footer>
      <div className="footer-note">
        <InfoCircleIcon/>
        <p>Run time is estimated from the last payment. An available machine may still contain laundry.</p>
      </div>
      <div className="footer-bottom"><span>VICTORIA POINT 4</span><span>Not affiliated with Circuit Go</span></div>
    </footer>
  </main>;
}
