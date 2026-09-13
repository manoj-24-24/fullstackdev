// Web Push delivery for notifications. When a user has granted notification
// permission in the browser, their service worker subscription is stored here;
// every notification insert fans out a real OS-level push so the app delivers
// even when it is closed. Fire-and-forget: push failures never fail the write.
import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';

let configured = false;

export function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.log('[push] VAPID keys not set — browser push disabled (in-app toasts still work).');
    return false;
  }
  webpush.setVapidDetails('mailto:' + (process.env.VAPID_CONTACT || 'admin@fullstackdev.app'), publicKey, privateKey);
  configured = true;
  console.log('[push] web push enabled');
  return true;
}

export function pushEnabled() {
  return configured;
}

export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

// POST /api/push/subscribe — store or refresh this device's subscription.
export async function subscribe(req, res) {
  if (!configured) return res.status(501).json({ data: null, error: { message: 'Push is not configured on this server.' } });
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ data: null, error: { message: 'Invalid push subscription.' } });
  }
  await pool.query(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)',
    [req.body.id || randomUUID(), req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  );
  return res.json({ data: { ok: true }, error: null });
}

// POST /api/push/unsubscribe — drop this device (e.g. on explicit opt-out).
export async function unsubscribe(req, res) {
  const endpoint = req.body?.endpoint;
  if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  return res.json({ data: { ok: true }, error: null });
}

// Fanout: deliver one notification to every subscribed device of its recipient.
// 404/410 responses mean the subscription expired — prune it.
export async function deliver(notification) {
  if (!configured || !pool || !notification?.user_id) return;
  try {
    const [rows] = await pool.query('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [notification.user_id]);
    await Promise.all(rows.map(async (row) => {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        await webpush.sendNotification(subscription, JSON.stringify({
          title: notification.title || 'FullstackDev',
          body: notification.message || '',
          url: '/notifications',
        }));
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [row.endpoint]).catch(() => {});
        }
      }
    }));
  } catch (err) {
    console.error('[push] delivery failed (write unaffected):', err?.message || err);
  }
}
