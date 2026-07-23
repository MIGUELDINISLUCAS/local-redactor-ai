# Local Redactor AI — Free 30-day Trial

Keep personal, confidential and sensitive data **off** ChatGPT / Claude. Local
Redactor holds your outgoing message, anonymises it on **your** machine, and only
the anonymised version is sent. Replies are restored to the real values locally.
Your original data and the mapping **never leave your device**.

Everything runs locally. There is no account, no cloud, no telemetry.

---

## What you need (once)

1. **Node.js** (LTS) — https://nodejs.org — free.

That's it. Everything runs on your device; nothing is sent anywhere.

(Optional: **Ollama** — only if you later want the extra "Thorough check" mode.
See *Optional: Thorough mode* below.)

## Setup (3 steps)

1. **Unzip** this folder somewhere permanent (e.g. your home folder).
2. **Start the engine:**
   - **macOS:** double-click **`backend/setup.command`**
     (first time: right-click → *Open* to get past the security prompt)
   - **Windows:** double-click **`backend/setup.bat`**

   The first run downloads the detection model (~1.8 GB, one time), then installs
   the engine as a **background service**. When it says *"All set"* you can close
   the window — the engine keeps running, starts again automatically every time
   you log in, and restarts itself if it ever stops. You only do this once.
3. **Load the extension in Chrome/Edge:**
   - Go to `chrome://extensions`, turn on **Developer mode** (top-right)
   - Click **Load unpacked** and select the **`extension`** folder
   - Pin it if you like

## Using it

1. Open **chatgpt.com** or **claude.ai**.
2. Turn on the floating **🛡️ Protect** toggle (bottom-right). Off = the site
   works normally.
3. Type and send as usual. Your message is **held for review**, anonymised, and
   only the anonymised version is sent when you click **Send anonymised →**.
4. The reply comes back with the real values restored, just for you.

Tip: in the review overlay you can highlight anything and **🛡️ Anonymise
selection**, and tick **remember as a rule** so it's caught automatically next
time.

---

## The background engine

Setup installs the engine as a background service, so there's nothing to launch
and no window to keep open. It starts at login and restarts itself if it stops.

- Logs: `~/.local-redactor/backend.log` (macOS)
- Repair it (or reinstall it after moving the folder): double-click
  **`backend/install-autostart.command`**
- Turn it off: `launchctl unload ~/Library/LaunchAgents/com.localredactor.backend.plist && rm ~/Library/LaunchAgents/com.localredactor.backend.plist`

## Optional: Thorough mode

The built-in fast engine handles everyday use. If you want an extra, heavier model
for maximum recall on very sensitive text, you can add **Thorough check**:

1. Install **Ollama** (free) — https://ollama.com/download (macOS: `brew install ollama`)
2. Double-click **`backend/install-thorough-model.command`** (Windows: run
   `backend/install-thorough-model.sh` steps) — downloads the model (~4 GB, one time).
3. Turn on **Thorough check** in the extension popup.

This model is optional and installed by you; it is **not** bundled with the app.
It carries a **non-commercial** licence, so it's for personal use. Until it's
installed, Thorough check simply falls back to the fast engine.

## Troubleshooting

**The extension says the engine isn't running.**
The engine runs as a background service that restarts itself, so this should be
rare and usually clears on its own within a second. If it persists:

1. **Repair the service** — double-click `backend/install-autostart.command`
   (macOS). Do this too if you *moved or renamed* the folder after setup, which
   breaks the saved path.
2. **You just reloaded the extension.** Refresh the ChatGPT/Claude tab (⌘R / Ctrl-R),
   then try again.
3. **Something else is using port 3001.** The setup window will say
   *"Port 3001 is already in use"*. Quit the other app (or just restart your
   computer) and run setup again. To find the culprit — macOS: `lsof -i :3001`;
   Windows: `netstat -ano | findstr :3001`.

**Setup won't finish / model download failed.**
The first run downloads ~1.8 GB (fast mode) and ~4 GB (thorough mode). On a slow or
interrupted connection this can fail — just run setup again; it resumes and skips
what's already there.

**macOS blocks `setup.command` ("unidentified developer").**
Right-click the file → **Open** → **Open** — you only need to do this the first time.

## License

- Free for **30 days** from first run.
- After that, the engine stops anonymising and (fail-safe) **blocks sends** rather
  than letting anything through unprotected.
- To keep using it, **buy a license** and paste the key into the extension popup
  (click the extension icon → License → paste → Activate).
- The license is verified **offline** — no account, no activation server.

## Please read (disclaimer)

This is **beta software provided as-is, with no warranty**. Automated redaction is
**best-effort** and can miss things — always **review the anonymised message in
the overlay before sending**, and don't rely on it as your only safeguard for
highly sensitive data. You are responsible for what you send. The author is not
liable for any data disclosed. It works by adapting to ChatGPT/Claude's current
behaviour; if they change, it may need an update.

**What it protects against:** accidentally sending personal data to ChatGPT or
Claude. It reviews and rewrites your message before it leaves your browser. It is
**not** a defence against ChatGPT or Claude themselves acting maliciously — their
page can already read what you type. Treat it as a careful assistant that catches
mistakes, not an impenetrable wall.
