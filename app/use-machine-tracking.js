import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeTracking, startTracking, TRACKING_KEY, updateTracking } from '../lib/machine-tracking.mjs';

function notificationPermission() {
  return window.isSecureContext && typeof window.Notification?.requestPermission === 'function'
    ? Notification.permission : 'unavailable';
}

function withTrackingLock(action) {
  if (navigator.locks) void navigator.locks.request(TRACKING_KEY, action).catch(action);
  else action();
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
    window.addEventListener('storage', syncStorage);
    window.addEventListener('focus', syncPermission);
    return () => {
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('focus', syncPermission);
    };
  }, [load, sync]);

  async function enableNotifications() {
    if (notificationPermission() !== 'default') return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission('unavailable');
    }
  }

  function trackMachine(snapshot, machine) {
    const record = startTracking(snapshot, machine);
    if (!record) return;
    void enableNotifications();
    withTrackingLock(() => save(record));
  }

  const hasActiveTracking = useCallback(() => current.current !== null, []);

  const observeSnapshot = useCallback(snapshot => {
    if (!hasActiveTracking()) return;
    withTrackingLock(() => {
      // Read the latest record inside the lock to avoid duplicate alerts from other tabs.
      const previous = load();
      const next = updateTracking(previous, snapshot);
      if (next === previous) return;
      if (next?.phase !== 'ready') {
        save(next);
        return;
      }
      save(null);
      setCompletion(next);
      if (notificationPermission() === 'granted') void showReadyNotification(next);
    });
  }, [hasActiveTracking, load, save]);

  return { tracking, completion, permission, storageUnavailable, trackMachine,
    stopTracking: () => withTrackingLock(() => save(null)),
    dismissCompletion: () => setCompletion(null), enableNotifications, hasActiveTracking, observeSnapshot };
}
