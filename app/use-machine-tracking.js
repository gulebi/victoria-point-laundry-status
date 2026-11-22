import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeTracking, startTracking, TRACKING_KEY, updateTracking } from '../lib/machine-tracking.mjs';

function notificationPermission() {
  return window.isSecureContext && typeof window.Notification?.requestPermission === 'function'
    ? Notification.permission : 'unavailable';
}

function withTrackingLock(action) {
  return navigator.locks ? navigator.locks.request(TRACKING_KEY, action) : Promise.resolve().then(action);
}

function requestWatch(method, body) {
  return fetch('/api/notification-watches', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
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
  const [tracking, setTracking] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [permission, setPermission] = useState('unavailable');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [pushKey, setPushKey] = useState('');
  const [alertError, setAlertError] = useState('');
  const current = useRef(null);
  const memoryOnly = useRef(false);

  const sync = useCallback(record => {
    current.current = record;
    setTracking(record);
    if (record) setCompletion(null);
  }, []);

  const load = useCallback(() => {
    if (!memoryOnly.current) {
      try {
        return decodeTracking(window.localStorage.getItem(TRACKING_KEY));
      } catch {
        memoryOnly.current = true;
        setStorageUnavailable(true);
      }
    }
    return current.current;
  }, []);

  const save = useCallback(record => {
    if (!memoryOnly.current) {
      try {
        if (record) window.localStorage.setItem(TRACKING_KEY, JSON.stringify(record));
        else window.localStorage.removeItem(TRACKING_KEY);
      } catch {
        memoryOnly.current = true;
        setStorageUnavailable(true);
      }
    }
    sync(record);
  }, [sync]);

  useEffect(() => {
    function syncStorage(event) {
      if (event.key === TRACKING_KEY || event.key === null) sync(load());
    }
    const syncPermission = () => setPermission(notificationPermission());
    sync(load());
    syncPermission();
    const controller = new AbortController();
    if ('PushManager' in window && 'serviceWorker' in navigator) {
      fetch('/api/notification-watches', { signal: controller.signal, cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(config => { if (config?.publicKey) setPushKey(config.publicKey); })
        .catch(() => {});
    }
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
      if (granted === 'default') granted = await Notification.requestPermission();
      setPermission(granted);
    } catch {
      setPermission('unavailable');
      return;
    }
    if (granted !== 'granted' || !pushKey) return;
    try {
      await withTrackingLock(async () => {
        const selected = load();
        if (!selected || selected.watchId) return;
        const subscription = await subscribeForPush(pushKey);
        const response = await requestWatch('POST', { machineId: selected.machineId, subscription });
        if (!response.ok) throw new Error('Could not register background alerts');
        const { watchId, expiresAt } = await response.json();
        if (typeof watchId !== 'string' || !Number.isFinite(expiresAt)) throw new Error('Invalid background alert');
        save({ ...selected, watchId, watchExpiresAt: expiresAt });
        setAlertError('');
      });
    } catch {
      setAlertError('Could not enable background alerts. Try again.');
    }
  }

  function trackMachine(snapshot, machine) {
    const record = startTracking(snapshot, machine);
    if (!record) return;
    setAlertError('');
    void withTrackingLock(() => save(record));
    void enableNotifications();
  }

  async function stopTracking() {
    try {
      await withTrackingLock(async () => {
        const selected = load();
        if (selected?.watchId && selected.watchExpiresAt > Date.now()) {
          const response = await requestWatch('DELETE', { watchId: selected.watchId });
          if (!response.ok) throw new Error('Could not cancel background alerts');
        }
        save(null);
        setAlertError('');
      });
    } catch {
      setAlertError('Could not stop background alerts. Try again.');
    }
  }

  const needsBrowserPolling = useCallback(() => current.current !== null && !current.current.watchId, []);

  const observeSnapshot = useCallback(snapshot => {
    if (!current.current) return;
    void withTrackingLock(() => {
      // Read the latest record inside the lock to avoid duplicate alerts from other tabs.
      const previous = load();
      if (previous?.watchId && previous.watchExpiresAt <= Date.now()) {
        save(null);
        return;
      }
      const next = updateTracking(previous, snapshot);
      if (next === previous) return;
      if (next?.phase !== 'ready') {
        save(next);
        return;
      }
      save(null);
      setCompletion(next);
      if (!previous.watchId && notificationPermission() === 'granted') void showReadyNotification(next);
    }).catch(() => {});
  }, [load, save]);

  return { tracking, completion, permission, storageUnavailable, trackMachine, stopTracking,
    canEnablePush: Boolean(pushKey), alertError, dismissCompletion: () => setCompletion(null),
    enableNotifications, needsBrowserPolling, observeSnapshot };
}
