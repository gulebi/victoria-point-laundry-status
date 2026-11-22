// One request in flight per server instance; no stale-while-revalidate on errors.
export function createStatusCache(load, now = Date.now) {
  let snapshot, pending, failure;
  let storedAt = 0, retryAfter = 0;
  return async function getStatus() {
    if (snapshot && now() - storedAt < 30000) return snapshot;
    if (failure && now() < retryAfter) throw failure;
    if (!pending) pending = load().then(value => {
      snapshot = value; storedAt = now(); failure = undefined;
      return value;
    }).catch(error => {
      snapshot = undefined; failure = error; retryAfter = now() + 30000;
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
