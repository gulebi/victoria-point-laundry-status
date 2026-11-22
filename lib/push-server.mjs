import 'server-only';
import webpush from 'web-push';
import { Receiver } from '@upstash/qstash';
import { createRedisCommand, createWatchStore } from './notification-watches.mjs';

export function backgroundNotifications(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const { QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env;
  if (!url || !token || !QSTASH_CURRENT_SIGNING_KEY || !QSTASH_NEXT_SIGNING_KEY ||
      !VAPID_SUBJECT || !/^[\w-]{87}$/.test(VAPID_PUBLIC_KEY ?? '') ||
      !/^[\w-]{43}$/.test(VAPID_PRIVATE_KEY ?? '')) return null;
  const receiver = new Receiver({ currentSigningKey: QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: QSTASH_NEXT_SIGNING_KEY });
  return {
    publicKey: VAPID_PUBLIC_KEY,
    store: createWatchStore(createRedisCommand(url, token)),
    authorize: (request, body) => receiver.verify({
      signature: request.headers.get('Upstash-Signature') ?? '',
      body,
      url: request.url,
    }),
    send: (subscription, notification) => webpush.sendNotification(subscription, JSON.stringify(notification), {
      vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
      TTL: 180,
      topic: notification.tag,
      timeout: 8000,
    }),
  };
}
