// GET /api/claim?session_id=cs_… — the Stripe checkout success page.
//
// Configure the Stripe payment link / checkout to redirect here after payment
// ("Don't show confirmation page" → https://www.localredactor.xyz/api/claim?session_id={CHECKOUT_SESSION_ID}).
// The page verifies the session was paid and shows the buyer their license key.
//
// The key is DETERMINISTIC for a given session (issued_at is taken from the
// session's own created timestamp and Ed25519 signatures are deterministic),
// so reloading the page always shows the same key — no storage needed; Stripe
// is the database.
import { signPayload, emailHash, stripeGet } from './_lib.js';

function page(title: string, body: string, status = 200) {
  return {
    status,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Local Redactor AI</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 48px 20px; background: #fbfaff; color: #17152d; display: grid; place-items: start center; }
  .card { max-width: 560px; width: 100%; background: #fff; border: 1px solid #e9e5f2; border-radius: 16px; padding: 32px; box-shadow: 0 16px 40px rgba(77,49,189,.08); }
  h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -.03em; }
  p { color: #706c84; font-size: 14px; line-height: 1.6; }
  .key { margin: 18px 0; padding: 14px; background: #f5f2ff; border: 1px solid #e0d8f8; border-radius: 10px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; user-select: all; }
  button { padding: 11px 16px; border: 0; border-radius: 9px; background: #7352ef; color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
  ol { color: #706c84; font-size: 13px; line-height: 1.7; padding-left: 20px; }
  .err { color: #b3261e; }
</style></head><body><div class="card">${body}</div></body></html>`,
  };
}

export default async function handler(req: any, res: any) {
  try {
    const sessionId = String(req.query?.session_id || '');
    if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
      const p = page('Invalid link', `<h1 class="err">Invalid link</h1><p>This page is only reachable from a completed checkout. If you paid and landed here, contact the developer with your Stripe receipt.</p>`, 400);
      res.status(p.status).setHeader('Content-Type', 'text/html').send(p.html);
      return;
    }

    const session = await stripeGet(`checkout/sessions/${sessionId}`);
    if (session.payment_status !== 'paid') {
      const p = page('Payment not completed', `<h1 class="err">Payment not completed</h1><p>This checkout session has not been paid. If you believe this is wrong, contact the developer with your receipt.</p>`, 402);
      res.status(p.status).setHeader('Content-Type', 'text/html').send(p.html);
      return;
    }

    const email = session.customer_details?.email || 'unknown';
    // Subscription checkout → key carries the subscription id so activation can
    // check it is still active. One-time payment → perpetual.
    const payload =
      session.mode === 'subscription' && session.subscription
        ? {
            v: 2,
            type: 'subscription',
            email_hash: emailHash(email),
            issued_at: new Date(session.created * 1000).toISOString(),
            order_id: sessionId,
            sub: String(session.subscription),
          }
        : {
            v: 2,
            type: 'perpetual',
            email_hash: emailHash(email),
            issued_at: new Date(session.created * 1000).toISOString(),
            order_id: sessionId,
            expires_at: null,
          };

    const key = signPayload(payload);
    const p = page(
      'Your license key',
      `<h1>Thank you! Here is your license key</h1>
       <p>Keep this page's link (or the key below) somewhere safe — the link always shows the same key.</p>
       <div class="key" id="k">${key}</div>
       <button onclick="navigator.clipboard.writeText(document.getElementById('k').innerText).then(()=>{this.innerText='Copied ✓'})">Copy key</button>
       <ol>
         <li>Install the Local Redactor app and browser extension (<a href="https://www.localredactor.xyz">localredactor.xyz</a>)</li>
         <li>Open the extension popup on chatgpt.com or claude.ai</li>
         <li>Paste the key under <b>License</b> and press <b>Activate</b></li>
       </ol>
       <p>Activation links the key to your computer. Changing computers? Just activate again on the new one.</p>`
    );
    res.status(p.status).setHeader('Content-Type', 'text/html').send(p.html);
  } catch (e: any) {
    const p = page('Something went wrong', `<h1 class="err">Something went wrong</h1><p>${String(e?.message || e).replace(/[<>]/g, '')}</p><p>Contact the developer with your Stripe receipt and this message.</p>`, 500);
    res.status(p.status).setHeader('Content-Type', 'text/html').send(p.html);
  }
}
