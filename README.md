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

**This is my machine** tracks one cycle in the browser. Select a machine before or during use. The dashboard waits to see an active cycle, then clears the selection and sends one alert when Circuit Go reports the machine available. Alerts require browser permission and an open, running tab.

## Checks

```powershell
npm test
npm run build
```

See [PROJECT_HANDOVER.md](PROJECT_HANDOVER.md) for the status and notification flow.
