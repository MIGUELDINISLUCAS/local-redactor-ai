# Local Redactor AI — getting started

Keep personal, confidential and sensitive data **off** ChatGPT / Claude. Local
Redactor holds your outgoing message, anonymises it on **your** machine, and only
the anonymised version is sent. Replies are restored to the real values locally.
Your original data and the mapping **never leave your device**.

There is no account and no telemetry. Message content is never transmitted
anywhere. The only time the app contacts a server is to activate or renew a
licence, which sends the licence key and an anonymous machine identifier.

---

## Install (once, about 3 minutes)

**1. The local engine** — download from
[localredactor.xyz](https://www.localredactor.xyz):

- **Mac (Apple Silicon):** the `.dmg`
- **Windows:** the `.exe` (SmartScreen may warn — *More info → Run anyway*)

It is a large download because the AI detection model is bundled, so everything
runs offline with nothing to fetch later. Once installed it sits quietly in the
menu bar / system tray and starts with your computer.

**2. The browser extension** — install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/local-redactor-ai-%E2%80%94-priva/dppllhhednkmbcchgldbbnaedfaidgpj)
(Chrome or Edge).

**3. Your licence** — click the extension icon, find **License**, paste your key
and press **Activate**. Either subscribe from that panel, or paste a promo key if
you were given one.

Activation ties the key to this computer. Changing machines is fine — activate
the same key there. A subscription renews itself; you never paste the key again.

---

## Using it

1. Go to **chatgpt.com** or **claude.ai**
2. Turn **Protect** on (the shield button near the message box)
3. Write your message and press Send

Your message is held. You will see what was detected, what will actually be
sent, and you can untick anything you would rather keep as-is. Press **Send
anonymised**. The reply comes back with your real details restored — only on
your screen.

**Documents:** use the 📎 button *in the extension*, not the provider's own
attach button. The extension extracts the text, anonymises it, and puts the safe
version in the message box. A file attached the provider's way is uploaded as
raw bytes that cannot be read or anonymised, so it is blocked.

---

## If something is not working

Check the extension popup:

- **"Engine not running"** — open the Local Redactor app, then reopen the popup.
  You can confirm it is up by visiting `http://localhost:3001/health`, which
  should show a short block of text starting `{"status":"ok"`.
- **"License required"** — paste your key, or subscribe from that panel.

Still stuck? In the popup, press **Copy diagnostic report** and send it over. It
describes versions and engine state only — none of your messages, rules or
personal data — and nothing is sent anywhere by pressing it.
