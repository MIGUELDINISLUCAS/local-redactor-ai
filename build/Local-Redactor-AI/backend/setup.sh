#!/usr/bin/env bash
# Local Redactor AI — one-shot setup (macOS / Linux).
# Installs dependencies, fetches the detection model, builds the app, and installs
# the backend as a BACKGROUND SERVICE that starts at login and restarts itself.
# When this finishes you can close the window — nothing needs to stay open.
set -e
cd "$(dirname "$0")"

echo "🛡️  Local Redactor AI — setup"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed."
  echo "  Install the LTS version from https://nodejs.org , then run this again."
  exit 1
fi

echo "• Installing dependencies…"
# Prefer `npm ci` — reproducible, installs exactly the shipped lockfile. Fall back
# to `npm install` if there's no lockfile or it's out of sync, so setup never
# hard-fails for a user.
if [ -f package-lock.json ]; then
  npm ci --silent || npm install --silent
else
  npm install --silent
fi

echo "• Building…"
npm run build --silent

# The detection engine is GLiNER — a token-level model running in-process (no
# Ollama, no external calls). Required. ~1.76GB, downloaded once.
if [ ! -f "models/gliner-pii-large/model.onnx" ]; then
  echo "• Downloading the detection model (~1.76GB, one time — go get a coffee)…"
  bash scripts/fetch-gliner-model.sh
else
  echo "• Detection model already installed."
fi

# Install (or repair) the always-on background service. This replaces the old
# "keep a terminal window open" flow.
echo "• Installing the background service…"
bash ./install-autostart.sh >/dev/null

# Confirm it actually came up before declaring success.
echo -n "• Waiting for the backend to start"
for i in $(seq 1 45); do
  if curl -fsS -m 2 http://localhost:3001/health >/dev/null 2>&1; then
    echo " — up."
    echo
    echo "✅ All set. The backend is running in the background and will start"
    echo "   automatically every time you log in. You can close this window."
    echo
    echo "   Next: load the extension in Chrome (see the README), then use"
    echo "   chatgpt.com or claude.ai as normal."
    echo
    echo "   Optional: 'Thorough check' mode uses an extra local model you install"
    echo "   yourself — double-click  install-thorough-model.command  to add it."
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo
echo "⚠ The backend didn't respond on :3001 within 45s."
echo "  Check the log for the reason: ~/.local-redactor/backend.log"
echo "  (If something else is using port 3001, quit it and run this again.)"
exit 1
