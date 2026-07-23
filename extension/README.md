# Local Redactor AI — Browser Extension

Use the **real** ChatGPT / Claude web apps (with all their features — vision, code
interpreter, artifacts, memory, streaming) while keeping sensitive data off the
provider.

## How it works (v0.2 — intercept + review)

1. Turn on the floating **🛡️ Protect** toggle (bottom-right). It's **off by
   default** — when off, the site works completely normally.
2. With Protect **on**, type and send as usual. The extension **pauses the
   outgoing request** (the original has not left yet) and shows a **review**
   overlay with the anonymised version.
3. **Review / edit**, then click **Send anonymised →**. Only the anonymised text
   is sent. Cancel sends nothing.
4. The reply comes back with placeholders and is **restored to the real values
   locally** for display.

The placeholder mapping never leaves your machine. Detection runs through the
local Redactor backend (regex + local NER + your rules). Because Protect blocks
the raw send until you approve, **you can't accidentally send the original**.

### Documents (PDF / Word / text)

Click **📎 Doc**, pick a file. Its text is extracted **locally** and loaded into
the message box (Protect turns on automatically). Press **Send** and it goes
through the same review → "Send anonymised" flow as a normal message — only the
anonymised text reaches the provider. The original file is never uploaded.

## Requirements

- The **Local Redactor backend must be running** on `http://localhost:3001`
  (`npm run dev` in `/backend`, or the desktop app). If it's offline while
  Protect is on, sends are **blocked** (never sent in the clear).

## Install (developer mode)

1. Open `chrome://extensions` and enable **Developer mode** (top right).
2. **Load unpacked** → select this `extension/` folder.
3. After any code change: click **↻ reload** on the card **and refresh the
   ChatGPT/Claude tab**.

## How it's built

- `inject.js` (MAIN world, `document_start`): wraps `window.fetch`; on a
  Protect-on send it asks for review and rewrites the request body.
- `content.js` (isolated): the Protect toggle, the review overlay, the bridge to
  the page hook, and reply restoration.
- `background.js`: the only thing that talks to `localhost:3001` (anonymise +
  mappings); holds the running placeholder map per tab.

## Limitations (v1)

- Tied to ChatGPT/Claude's internal request format — if they change it, the
  interception needs updating (it fails **safe**: on any parse issue it sends the
  message unchanged only when Protect is off; when on and it can't process, the
  review overlay blocks the send).
- Built/tested against ChatGPT first; Claude support is best-effort.
