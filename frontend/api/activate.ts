// POST /api/activate  { key, machineId } → { ok, license } | { ok:false, error }
//
// Exchanges a purchase key (from /api/claim or a promo key) for a MACHINE
// LICENSE bound to one machine id. The desktop backend calls this once at
// activation and again near expiry to refresh a subscription — the only
// network calls in the product, carrying only the key and an anonymous
// machine hash. Message content never goes anywhere.
//
// Subscription keys are re-checked against Stripe LIVE here, so a cancelled
// subscription stops refreshing (the current license simply runs out).
// Stripe is the only state — this endpoint stores nothing.
import { signPayload, verifyKey, stripeGet } from './_lib';

const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // renewal grace past period end

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' });
    return;
  }
  try {
    const { key, machineId } = req.body || {};
    if (typeof key !== 'string' || !key.trim()) {
      res.status(400).json({ ok: false, error: 'missing-key' });
      return;
    }
    if (typeof machineId !== 'string' || !/^[a-f0-9]{16,64}$/.test(machineId)) {
      res.status(400).json({ ok: false, error: 'missing-machine-id' });
      return;
    }

    const payload = verifyKey(key.trim());
    if (!payload) {
      res.status(400).json({ ok: false, error: 'invalid-key' });
      return;
    }
    if (payload.machine_id) {
      // Already a machine license — not exchangeable. (The backend only sends
      // purchase keys here; this guards against confusion, not attack.)
      res.status(400).json({ ok: false, error: 'not-a-purchase-key' });
      return;
    }

    let expiresAt: string | null;
    if (payload.type === 'subscription') {
      if (!payload.sub) {
        res.status(400).json({ ok: false, error: 'invalid-key' });
        return;
      }
      const sub = await stripeGet(`subscriptions/${payload.sub}`);
      if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
        res.status(403).json({ ok: false, error: 'subscription-inactive' });
        return;
      }
      const periodEnd = Number(sub.current_period_end || sub.items?.data?.[0]?.current_period_end || 0);
      if (!periodEnd) {
        res.status(502).json({ ok: false, error: 'stripe-shape' });
        return;
      }
      expiresAt = new Date(periodEnd * 1000 + GRACE_MS).toISOString();
    } else if (payload.type === 'extended-trial') {
      // Promo key: expiry travels in the key itself.
      if (!payload.expires_at || Date.parse(payload.expires_at) < Date.now()) {
        res.status(403).json({ ok: false, error: 'key-expired' });
        return;
      }
      expiresAt = payload.expires_at;
    } else if (payload.type === 'perpetual') {
      expiresAt = null;
    } else {
      res.status(400).json({ ok: false, error: 'invalid-key' });
      return;
    }

    const license = signPayload({
      v: 2,
      type: payload.type,
      email_hash: payload.email_hash,
      issued_at: new Date().toISOString(),
      expires_at: expiresAt,
      order_id: payload.order_id,
      ...(payload.sub ? { sub: payload.sub } : {}),
      machine_id: machineId,
    });

    console.log(`activation: type=${payload.type} order=${payload.order_id} machine=${machineId.slice(0, 8)}…`);
    res.status(200).json({ ok: true, license, expiresAt });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error('activate error:', msg);
    res.status(502).json({ ok: false, error: msg.includes('stripe') ? 'stripe-unreachable' : 'server-error' });
  }
}
