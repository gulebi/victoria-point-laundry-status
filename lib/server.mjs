import 'server-only';
import { createCircuitClient } from './circuitgo.mjs';
import { createStatusCache } from './status-cache.mjs';

let client;
export const getStatus = createStatusCache(async () => {
  if (process.env.NODE_ENV !== 'production' && process.env.CIRCUITGO_DEMO === 'true') {
    const { demoStatus } = await import('./demo.mjs');
    return demoStatus();
  }
  if (!client) client = createCircuitClient({
    phone: process.env.CIRCUITGO_PHONE,
    pin: process.env.CIRCUITGO_PIN,
    refreshToken: process.env.CIRCUITGO_REFRESH_TOKEN,
    appCheck: process.env.CIRCUITGO_APP_CHECK_TOKEN,
    roomId: process.env.CIRCUITGO_ROOM_ID,
    apiKey: process.env.CIRCUITGO_FIREBASE_API_KEY,
  });
  return client.readStatus();
});
