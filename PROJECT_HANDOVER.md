# Project handover

Victoria Point 4 Laundry is a React dashboard backed by a Next.js App Router endpoint. It reads availability for one configured room. Development includes an offline demo and tests with synthetic data.

## Request flow

| Path | Responsibility |
| --- | --- |
| `app/page.jsx` | Responsive dashboard, filters, manual refresh and status polling. |
| `app/api/status/route.js` | Dynamic Node.js endpoint at `/api/status`. Returns a sanitised snapshot or a safe error. |
| `lib/server.mjs`, `lib/status-cache.mjs` | Server-only environment configuration and a shared 30-second cache per instance. |
| `lib/circuitgo.mjs` | Scoped Firebase reads, token refresh, booking interpretation and machine states. |
| `lib/machine-tracking.mjs`, `app/use-machine-tracking.js` | Local tracking state, one-cycle detection and notification permission. |
| `app/api/notification-watches/`, `lib/notification-watches.mjs` | Redis-backed alerts for one cycle and an authenticated QStash poll handler. |
| `public/laundry-notifications.js` | Receives Web Push notifications and opens or focuses the dashboard on click. |
| `lib/demo.mjs`, `test/` | Synthetic demo status, tests for timing, bookings, authentication, caching and tracking. |

The server reads the configured location, its scheduled bookings and active instant bookings. Status uses maintenance, subscription, opening hours in `Europe/London`, connection holds and machine timers. Failed booking reads leave unconfirmed availability. The browser checks roughly once a minute while visible or tracking a cycle. It treats data as stale after 90 seconds or a failed refresh.

## Timing

`last_used` is an estimated release timestamp. Equipment feedback can correct it. When a machine is running and the timestamp of its latest payment is valid, `elapsedMinutes` counts full minutes since that payment. This is an approximation of run time. The API sends a derived cycle ID for comparing payments while the machine is running or available.

## Personal machine alerts

Selecting an available machine waits for a fresh snapshot that shows a cycle starting. A connection hold alone does not count as a start. The choice is stored in the current browser's `localStorage` and shared across tabs. Once Circuit Go reports the tracked cycle's machine available, the dashboard removes the active record before showing the alert. The completion message lasts until dismissal, a new selection or reload.

A different cycle ID indicates a different payment. If that payment appears before an available snapshot for the tracked cycle, the dashboard drops the old selection silently. If an upstream payment timestamp is missing, the dashboard relies on transitions from running to available. Browser locks serialise tracking changes across tabs when supported.

If the server confirms a background registration, the browser leaves OS delivery to the service worker and the server checks for completion. Each endpoint has one active watch. Redis records expire after six hours, QStash calls are authenticated, and an atomic lock prevents concurrent polls. A short delivery retry window retains one notification tag across attempts. Without a background registration, the page continues offering tab-based alerts when permission is granted.

## Authentication

The server uses a configured existing account and keeps its Firebase session in memory. It refreshes the ID token before expiry and, after an expired-token response, can retry a read once. An explicit permission denial surfaces as an error. The phone-verification check in the official app and Firebase token refresh are separate mechanisms.

See [README.md](README.md) for local setup and deployment variables.
