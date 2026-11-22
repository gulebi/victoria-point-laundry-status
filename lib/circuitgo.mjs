import { createHash } from 'node:crypto';

// Read-only client for one server-configured laundry and an existing account.
const AUTH = 'https://identitytoolkit.googleapis.com/v1/';
const DATABASE = 'https://airwallet-685ff.firebaseio.com';
const FIRESTORE = 'https://firestore.googleapis.com/v1/projects/airwallet-685ff/databases/(default)/documents:runQuery';
const MAX_BYTES = 8 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) ? value : null;

const MESSAGES = {
  CONFIGURATION: 'The Circuit Go room, Firebase API key and account need server configuration.',
  AUTHENTICATION: 'Circuit Go rejected the sign-in. Check the account settings on the server.',
  ACCESS_DENIED: 'Circuit Go denied access to the laundry data.',
  NETWORK: 'Circuit Go could not be reached. Retrying automatically.',
  RATE_LIMIT: 'Circuit Go is limiting requests. Retrying later.',
  UPSTREAM: 'Circuit Go is temporarily unavailable.',
  FORMAT_CHANGED: 'Circuit Go returned an unexpected response. Availability could not be confirmed.',
};

export class CircuitError extends Error {
  constructor(code, status = 0, tokenExpired = false) {
    super(MESSAGES[code] || MESSAGES.UPSTREAM);
    this.name = 'CircuitError';
    this.code = code;
    this.status = status;
    this.tokenExpired = tokenExpired;
  }
}

function rejectFormat() { throw new CircuitError('FORMAT_CHANGED'); }

export function createCircuitClient(config, { fetchImpl = fetch, now = Date.now } = {}) {
  // Closure memory only. Never serialize this state or expose it to React props.
  let session = null;
  let savedRefresh = config.refreshToken?.trim() || '';
  let signingIn = null;
  const roomId = config.roomId?.trim() || '';
  const apiKey = config.apiKey?.trim() || '';
  if (!/^[\w-]+$/.test(roomId) || !/^[\w-]+$/.test(apiKey)) throw new CircuitError('CONFIGURATION');
  const appCheck = config.appCheck?.trim() || '';
  if (/[\x00-\x20\x7f]/.test(appCheck)) throw new CircuitError('CONFIGURATION');

  async function request(url, { body, form, token } = {}) {
    const headers = { Accept: 'application/json' };
    if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let response, value;
    try {
      response = await fetchImpl(url, {
        method: body || form ? 'POST' : 'GET', headers,
        body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
      });
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_BYTES) rejectFormat();
      // Bound the body before JSON parsing, including responses without Content-Length.
      const chunks = [];
      let size = 0;
      if (!response.body) rejectFormat();
      const stream = response.body.getReader();
      while (true) {
        const { done, value: chunk } = await stream.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > MAX_BYTES) { await stream.cancel(); rejectFormat(); }
        chunks.push(chunk);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof CircuitError) throw error;
      throw new CircuitError(response ? (response.ok ? 'FORMAT_CHANGED' : 'UPSTREAM') : 'NETWORK');
    }
    if (!response.ok || (object(value) && value.error)) {
      // Do not return upstream text, request URLs, account IDs or credentials.
      const detail = object(value?.error) ? value.error.message : value?.error;
      const expired = typeof detail === 'string' && /^(TOKEN_EXPIRED|INVALID_ID_TOKEN|Auth token is expired)/i.test(detail);
      if (response.status === 429) throw new CircuitError('RATE_LIMIT', response.status);
      if (response.status === 401 || expired) throw new CircuitError('AUTHENTICATION', response.status, true);
      if (response.status === 403 || /permission denied/i.test(typeof detail === 'string' ? detail : '')) {
        throw new CircuitError('ACCESS_DENIED', response.status);
      }
      const loginFailure = /^(INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|USER_DISABLED|INVALID_REFRESH_TOKEN|USER_NOT_FOUND|TOKEN_EXPIRED)/.test(typeof detail === 'string' ? detail : '');
      throw new CircuitError(loginFailure ? 'AUTHENTICATION' : 'UPSTREAM', response.status);
    }
    return value;
  }

  function acceptSession(value, refreshing) {
    const token = refreshing ? value?.id_token : value?.idToken;
    const uid = refreshing ? value?.user_id : value?.localId;
    const refresh = refreshing ? value?.refresh_token : value?.refreshToken;
    const seconds = Number(refreshing ? value?.expires_in : value?.expiresIn);
    if (typeof token !== 'string' || !token || typeof uid !== 'string' || !uid ||
        typeof refresh !== 'string' || !refresh || !Number.isFinite(seconds) || seconds <= 0) rejectFormat();
    // Refuse an unexpected identity change during a refresh.
    if (session && session.uid !== uid) throw new CircuitError('AUTHENTICATION');
    session = { token, uid, expiresAt: now() + seconds * 1000 };
    savedRefresh = refresh;
    return session;
  }

  async function signIn() {
    const phone = config.phone?.replace(/[ ()-]/g, '') || '';
    const pin = config.pin || '';
    if (!/^\+[1-9]\d{6,14}$/.test(phone) || !/^\d+$/.test(pin)) throw new CircuitError('CONFIGURATION');
    const value = await request(`${AUTH}accounts:signInWithPassword?key=${apiKey}`, {
      body: { email: `${phone}@airwallet.net`, password: `00${pin}`, returnSecureToken: true },
    });
    return acceptSession(value, false);
  }

  async function refreshOrSignIn() {
    if (savedRefresh) {
      try {
        return acceptSession(await request(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
          form: { grant_type: 'refresh_token', refresh_token: savedRefresh },
        }), true);
      } catch (error) {
        // Reauthentication is limited to the same existing account, once.
        if (!(error instanceof CircuitError) || error.code !== 'AUTHENTICATION' || !config.phone || !config.pin) throw error;
        savedRefresh = '';
      }
    }
    return signIn();
  }

  async function getSession(force = false) {
    if (!force && session && session.expiresAt > now() + 90000) return session;
    if (!signingIn) signingIn = refreshOrSignIn().finally(() => { signingIn = null; });
    return signingIn;
  }

  async function authorized(operation) {
    let current = await getSession();
    try { return await operation(current); }
    catch (error) {
      if (!(error instanceof CircuitError) || !error.tokenExpired) throw error;
      current = await getSession(true);
      return operation(current); // At most one retry, and never for a permission denial.
    }
  }

  function database(current, segments) {
    if (segments.some(segment => typeof segment !== 'string' || !segment || /[.$#\[\]/?\\\s]/.test(segment))) rejectFormat();
    const path = segments.map(segment => encodeURIComponent(segment)).join('/');
    return request(`${DATABASE}/${path}.json?${new URLSearchParams({ auth: current.token })}`);
  }

  async function instantBookings(current, timestamp) {
    const response = await request(FIRESTORE, { token: current.token, body: {
      structuredQuery: {
        select: { fields: ['device_id', 'expire_at', 'location_id'].map(fieldPath => ({ fieldPath })) },
        from: [{ collectionId: 'insta_book' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'location_id' }, op: 'EQUAL', value: { stringValue: roomId } } },
          { fieldFilter: { field: { fieldPath: 'expire_at' }, op: 'GREATER_THAN', value: { integerValue: String(timestamp) } } },
        ] } },
        limit: 101,
      },
    } });
    if (!Array.isArray(response)) rejectFormat();
    const bookings = [];
    for (const row of response) {
      if (!object(row)) rejectFormat();
      if (!row.document) { if (!row.readTime) rejectFormat(); continue; }
      const fields = row.document.fields;
      const id = fields?.device_id?.stringValue;
      const expires = Number(fields?.expire_at?.integerValue);
      if (typeof id !== 'string' || !Number.isSafeInteger(expires) || fields?.location_id?.stringValue !== roomId) rejectFormat();
      if (expires > timestamp) bookings.push({ device_id: id, expire_at: expires });
    }
    if (response.filter(row => row.document).length >= 101) rejectFormat();
    return bookings;
  }

  async function readStatus() {
    const current = await getSession();
    const started = Math.floor(now() / 1000);
    const [roomResult, bookingsResult, instantResult] = await Promise.allSettled([
      authorized(auth => database(auth, ['locations', roomId])),
      authorized(auth => database(auth, ['bookings', roomId])),
      authorized(auth => instantBookings(auth, started)),
    ]);
    if (roomResult.status === 'rejected') throw roomResult.reason;
    const checks = {
      scheduled: bookingsResult.status === 'fulfilled',
      instant: instantResult.status === 'fulfilled',
    };
    const result = summarizeAvailability(roomResult.value,
      checks.scheduled ? bookingsResult.value : undefined,
      checks.instant ? instantResult.value : undefined,
      Math.floor(now() / 1000), current.uid, checks);
    // Timestamp conservatively marks the start of this multi-source snapshot.
    return {
      ...result,
      room: { id: roomId, name: 'Victoria Point 4' },
      checkedAt: new Date(started * 1000).toISOString(),
      validUntil: new Date(started * 1000 + 90000).toISOString(),
    };
  }

  return { readStatus };
}

function wallTime(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second) / 1000;
}

function openingStatus(schedule, timestamp) {
  if (!object(schedule)) return { open: null, today: [] };
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' })
    .format(new Date(timestamp * 1000)).toLowerCase();
  const slots = schedule[weekday];
  if (slots === undefined || slots === null) return { open: false, today: [] };
  if (!object(slots)) return { open: null, today: [] };
  const minutes = Math.floor((wallTime(timestamp, 'Europe/London') % 86400) / 60);
  const today = [];
  let open = false;
  for (const slot of Object.values(slots)) {
    if (!object(slot) || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(slot.start) || !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(slot.end)) return { open: null, today: [] };
    const start = +slot.start.slice(0, 2) * 60 + +slot.start.slice(2);
    const end = +slot.end.slice(0, 2) * 60 + +slot.end.slice(2);
    // Cross-midnight formats have not been verified against this APK.
    if (start > end) return { open: null, today: [] };
    if (minutes >= start && minutes <= end) open = true;
    today.push(`${slot.start.slice(0, 2)}:${slot.start.slice(2)}–${slot.end.slice(0, 2)}:${slot.end.slice(2)}`);
  }
  return { open, today: today.sort() };
}

function scheduledState(id, device, bookings, settings, timestamp, uid) {
  if (bookings === null) return null;
  if (!object(bookings)) return ['unknown', 'Bookings could not be checked'];
  const rules = settings?.product_type_specific?.[String(device.product_type).toLowerCase()];
  const relevant = [];
  for (const booking of Object.values(bookings)) {
    if (!object(booking) || typeof booking.device_id !== 'string' || integer(booking.end) === null) return ['unknown', 'Unexpected booking data'];
    if (booking.device_id !== id || booking.end <= timestamp) continue;
    if (integer(booking.start) === null) return ['unknown', 'Unexpected booking data'];
    relevant.push(booking);
  }
  if (!relevant.length) return null;
  if (!object(rules)) return ['unknown', 'Booking settings unavailable'];
  const before = rules.pre_reservation_time_limit ?? 30;
  const after = rules.post_reservation_time_limit ?? 15;
  const warning = rules.warning_time ?? 180;
  if ([before, after, warning].some(value => integer(value) === null || value < 0)) return ['unknown', 'Unexpected booking settings'];
  const current = wallTime(timestamp, 'Europe/London');
  for (const booking of relevant.sort((a, b) => a.start - b.start)) {
    let start;
    try { start = wallTime(booking.start, booking.timezone_id || 'Europe/London'); }
    catch { return ['unknown', 'Unknown booking time zone']; }
    if (current > start + after * 60) continue;
    const mine = booking.user_uid === uid;
    if (current >= start - before * 60 && current <= start + after * 60) {
      return ['reserved', mine ? 'Your booking' : 'Booked'];
    }
    if (current > start - warning * 60 && current < start - before * 60) {
      return ['reserved_soon', mine ? 'Your booking starts soon' : 'Booking starts soon'];
    }
  }
  return null;
}

export function summarizeAvailability(room, bookings, instant, timestamp, uid, checks = { scheduled: true, instant: true }) {
  if (!object(room) || !object(room.devices)) rejectFormat();
  const hours = openingStatus(room.opening_schedule, timestamp);
  const rows = [];
  for (const [id, device] of Object.entries(room.devices)) {
    if (!object(device)) rejectFormat();
    const product = String(device.product_type).toLowerCase();
    const timer = integer(device.last_used);
    const lastPayment = integer(device.last_payment_timestamp);
    const paymentKnown = lastPayment !== null && lastPayment > 0 && lastPayment <= timestamp;
    const connection = device.machine_status;
    const hold = object(connection) && connection.status === 'connected' &&
      integer(connection.expire_at) !== null && connection.expire_at > timestamp && connection.uid !== uid;
    const coin = device.coin_feedback_enabled === true;
    let state;
    let cycleActive = false;
    let elapsedMinutes = null;
    if (device.maintenance === true) state = ['maintenance', 'Under maintenance'];
    else if (device.config === 'PROGRAM_PICKER' && (!object(device.machine_programs) || !Object.keys(device.machine_programs).length)) state = ['inactive', 'No programmes configured'];
    else if (device.subscribed === false) state = ['inactive', 'Inactive'];
    else if (hours.open === false) state = ['closed', 'Laundry closed'];
    else if (hold) state = ['busy', 'Connection in progress'];
    else if (timer !== null && timer > timestamp) {
      state = ['busy', 'In use'];
      cycleActive = true;
      // The Android client also uses payment time as a proxy for when use started.
      if (paymentKnown) elapsedMinutes = Math.floor((timestamp - lastPayment) / 60);
    }
    else if (coin) state = ['unknown', 'Awaiting a signal from the machine'];
    else if (timer === null || timer < 0) state = ['unknown', 'Machine timer unavailable'];
    else if (hours.open === null) state = ['unknown', 'Opening hours could not be checked'];
    else if (!checks.instant || !Array.isArray(instant)) state = ['unknown', 'Instant bookings could not be checked'];
    else if (instant.some(booking => booking.device_id === id && booking.expire_at > timestamp)) state = ['reserved', 'Temporarily booked'];
    else if (!checks.scheduled) state = ['unknown', 'Bookings could not be checked'];
    else state = scheduledState(id, device, bookings, room.booking_settings, timestamp, uid);
    // This release deliberately supports the verified PROGRAM_PICKER machines.
    if (!state && (device.config !== 'PROGRAM_PICKER' || !['washer', 'dryer'].includes(product))) state = ['unknown', 'Unsupported machine configuration'];
    if (!state) state = ['available', 'Available'];
    const cycleId = paymentKnown && (cycleActive || state[0] === 'available')
      ? createHash('sha256').update(`${id}:${lastPayment}`).digest('base64url')
      : null;
    // last_used marks the estimated release of the latest paid cycle.
    const finishedAt = state[0] === 'available' && paymentKnown && timer > lastPayment
      ? timer * 1000
      : null;
    rows.push({
      id, name: typeof device.name === 'string' ? device.name.slice(0, 80) : 'Machine',
      type: ['washer', 'dryer'].includes(product) ? product : 'other',
      state: state[0], label: state[1],
      cycleActive,
      cycleId,
      elapsedMinutes,
      finishedAt,
    });
  }
  rows.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'en', { numeric: true }));
  return {
    timezone: 'Europe/London',
    checks: { hours: hours.open !== null, scheduled: checks.scheduled, instant: checks.instant },
    opening: { open: hours.open, today: hours.today },
    machines: rows,
    available: rows.filter(row => row.state === 'available').length,
    total: rows.length,
    partial: hours.open === null || !checks.scheduled || !checks.instant || rows.some(row => row.state === 'unknown'),
    demo: false,
  };
}
