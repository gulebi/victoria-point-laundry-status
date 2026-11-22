import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeSelections, startTracking, trackingKey, TRACKING_KEY, updateTracking } from '../lib/machine-tracking.mjs';

let fallbackQueue = Promise.resolve();

function notificationPermission() {
  return window.isSecureContext && typeof window.Notification?.requestPermission === 'function'
    ? Notification.permission : 'unavailable';
}

function withTrackingLock(action) {
  if (navigator.locks) return navigator.locks.request(TRACKING_KEY, action);
  const result = fallbackQueue.then(action);
  fallbackQueue = result.catch(() => {});
  return result;
}

function requestWatch(method, body) {
  return fetch('/api/notification-watches', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function fetchPushKey(signal) {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return '';
  const response = await fetch('/api/notification-watches', { signal, cache: 'no-store' });
  const config = response.ok ? await response.json() : null;
  return config?.publicKey || '';
}

async function subscribeForPush(key) {
  const worker = await navigator.serviceWorker.register('/laundry-notifications.js');
  const active = worker.active ? worker : await navigator.serviceWorker.ready;
  const appKey = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  return await active.pushManager.getSubscription() ??
    active.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
}

async function showReadyNotification(tracking) {
  const title = `${tracking.name} is available`;
  const options = {
    body: 'Circuit Go reports your machine is free. You can collect your laundry.',
    icon: '/icon.svg',
    tag: `laundry-${tracking.machineId}-${tracking.createdAt}`,
  };
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/laundry-notifications.js');
      const active = registration.active ? registration : await navigator.serviceWorker.ready;
      await active.showNotification(title, options);
      return;
    } catch {
      // Try the desktop notification API if the service worker cannot show an alert.
    }
  }
  try {
    const alert = new Notification(title, options);
    alert.onclick = () => window.focus();
  } catch {
    // The completion message is already visible on the dashboard.
  }
}

export function useMachineTracking() {
  const [selections, setSelections] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [permission, setPermission] = useState('unavailable');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [pushKey, setPushKey] = useState('');
  const [alertError, setAlertError] = useState('');
  const current = useRef([]);
  const memoryOnly = useRef(false);
  const permissionRequest = useRef(null);

  const sync = useCallback(records => {
    current.current = records;
    setSelections(records);
    setCompletions(previous => previous.length
      ? previous.filter(item => !records.some(record => trackingKey(record) === trackingKey(item)))
      : previous);
  }, []);

  const load = useCallback(() => {
    if (!memoryOnly.current) {
      try {
        return decodeSelections(window.localStorage.getItem(TRACKING_KEY));
      } catch {
        memoryOnly.current = true;
        setStorageUnavailable(true);
      }
    }
    return current.current;
  }, []);

  const save = useCallback(records => {
    if (!memoryOnly.current) {
      try {
        if (records.length) window.localStorage.setItem(TRACKING_KEY, JSON.stringify(records));
        else window.localStorage.removeItem(TRACKING_KEY);
      } catch {
        memoryOnly.current = true;
        setStorageUnavailable(true);
      }
    }
    sync(records);
  }, [sync]);

  useEffect(() => {
    function syncStorage(event) {
      if (event.key === TRACKING_KEY || event.key === null) sync(load());
    }
    const syncPermission = () => setPermission(notificationPermission());
    sync(load());
    syncPermission();
    const controller = new AbortController();
    fetchPushKey(controller.signal).then(key => { if (key) setPushKey(key); }).catch(() => {});
    window.addEventListener('storage', syncStorage);
    window.addEventListener('focus', syncPermission);
    return () => {
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('focus', syncPermission);
      controller.abort();
    };
  }, [load, sync]);

  async function enableNotifications() {
    let granted = notificationPermission();
    try {
      if (granted === 'default') {
        if (!permissionRequest.current) {
          permissionRequest.current = Notification.requestPermission().finally(() => { permissionRequest.current = null; });
        }
        granted = await permissionRequest.current;
      }
      setPermission(granted);
    } catch {
      setPermission('unavailable');
      return;
    }
    if (granted !== 'granted') return;
    try {
      await withTrackingLock(async () => {
        const records = load();
        if (!records.some(record => !record.watchId)) return;
        const key = pushKey || await fetchPushKey();
        if (!key) return;
        setPushKey(key);
        const subscription = await subscribeForPush(key);
        const results = await Promise.allSettled(records.map(async record => {
          if (record.watchId) return record;
          const response = await requestWatch('POST', { machineId: record.machineId, subscription });
          if (!response.ok) throw new Error('Could not register background alert');
          const { watchId, expiresAt } = await response.json();
          if (typeof watchId !== 'string' || !Number.isFinite(expiresAt)) throw new Error('Invalid background alert');
          return { ...record, watchId, watchExpiresAt: expiresAt };
        }));
        save(results.map((result, index) => result.status === 'fulfilled' ? result.value : records[index]));
        setAlertError(results.some(result => result.status === 'rejected')
          ? 'Some background alerts could not be enabled. Try again.' : '');
      });
    } catch {
      setAlertError('Could not enable background alerts. Try again.');
    }
  }

  function trackMachine(snapshot, machine) {
    const record = startTracking(snapshot, machine);
    if (!record) return;
    setAlertError('');
    void withTrackingLock(() => {
      const records = load();
      if (!records.some(item => trackingKey(item) === trackingKey(record))) save([...records, record]);
    }).catch(() => setAlertError('Could not track this machine. Try again.'));
    void enableNotifications();
  }

  async function stopTracking(selection) {
    try {
      await withTrackingLock(async () => {
        const records = load();
        const selected = records.find(item => trackingKey(item) === trackingKey(selection) && item.createdAt === selection.createdAt);
        if (!selected) return;
        if (selected.watchId && selected.watchExpiresAt > Date.now()) {
          const response = await requestWatch('DELETE', { watchId: selected.watchId });
          if (!response.ok) throw new Error('Could not cancel background alerts');
        }
        save(records.filter(item => item !== selected));
        setAlertError('');
      });
    } catch {
      setAlertError('Could not stop background alerts. Try again.');
    }
  }

  const needsBrowserPolling = useCallback(() => current.current.some(record => !record.watchId), []);

  const observeSnapshot = useCallback(snapshot => {
    if (!current.current.length) return;
    void withTrackingLock(() => {
      // Consult the latest selections so another tab cannot deliver the same alert twice.
      const previous = load();
      const now = Date.now();
      const next = [];
      const completed = [];
      for (const record of previous) {
        if (record.watchId && record.watchExpiresAt <= now) continue;
        const updated = updateTracking(record, snapshot, now);
        if (updated?.phase === 'ready') completed.push(updated);
        else if (updated) next.push(updated);
      }
      if (next.length !== previous.length || next.some((record, index) => record !== previous[index])) save(next);
      if (completed.length) {
        setCompletions(recent => [...recent, ...completed]);
        if (notificationPermission() === 'granted') {
          for (const record of completed) if (!record.watchId) void showReadyNotification(record);
        }
      }
    }).catch(() => {});
  }, [load, save]);

  return { selections, completions, permission, storageUnavailable, trackMachine, stopTracking,
    canEnablePush: Boolean(pushKey), alertError,
    dismissCompletion: record => setCompletions(recent => recent.filter(item => item !== record)),
    enableNotifications, needsBrowserPolling, observeSnapshot };
}
