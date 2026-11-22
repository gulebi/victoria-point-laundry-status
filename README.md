# Victoria Point 4 Laundry

An independent, read-only dashboard for washer and dryer availability. It is not affiliated with Circuit Go. The React interface and server-side status endpoint run in the same Next.js app.

## Local demo

Requires Node.js 22 or later. In PowerShell, run the following and open [localhost:3000](http://localhost:3000).

```powershell
npm ci
$env:CIRCUITGO_DEMO = 'true'
npm run dev
```

The demo uses synthetic data. When switching to a configured account, use a fresh terminal or remove `Env:CIRCUITGO_DEMO` before restarting.

## Live configuration

Use the deployment environment settings or copy [.env.example](.env.example) to `.env.local`. The server reads one configured room through an existing account with access to it.

| Variable | Value |
| --- | --- |
| `CIRCUITGO_ROOM_ID` | Room identifier |
| `CIRCUITGO_FIREBASE_API_KEY` | Firebase client API key |
| `CIRCUITGO_PHONE` and `CIRCUITGO_PIN` | Existing account credentials |
| `CIRCUITGO_REFRESH_TOKEN` | Optional alternative to phone and PIN |
| `CIRCUITGO_APP_CHECK_TOKEN` | Optional service-issued token if required |

Supply values to the server. Keep them out of Git and avoid the `NEXT_PUBLIC_` prefix. The published dashboard displays availability to anyone who can reach it. Use deployment access controls if the dashboard itself is intended for a limited audience.

## Machine alerts

**This is my machine** tracks one cycle. Select a machine before or during use and allow notifications. The dashboard waits until Circuit Go reports an active cycle followed by availability, then clears the selection.

When background alerts are configured and the browser registers successfully, the server continues tracking after the tab closes. With tab-based alerts, the page checks availability while it runs.

### Enable background alerts in production

1. Connect an Upstash Redis database to the Vercel project. Set its write credentials as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The `KV_REST_API_URL` and `KV_REST_API_TOKEN` equivalents work as well.
2. Add `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` from your QStash account. Generate a VAPID key pair once with `npx web-push generate-vapid-keys --json` and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Use the production HTTPS site URL or a contact `mailto:` URI for the subject.
3. Deploy with the production variables. In QStash create a schedule with `*/2 * * * *` that sends a POST to `https://YOUR-PRODUCTION-DOMAIN/api/notification-watches/poll`. QStash signs the request automatically. Open `/api/notification-watches` after QStash's first successful call to confirm it returns a public key.
4. Select a machine and confirm the dashboard displays **You can close this tab**. The browser must support Web Push. On iOS and iPadOS, open the web app from the Home Screen.

The server keeps each selection for up to six hours. It removes it after successful delivery, cancellation or a change to a different cycle.

## Checks

```powershell
npm test
npm run build
```

See [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) for the status and notification flow.
