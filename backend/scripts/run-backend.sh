#!/usr/bin/env bash
# Production entry point for the background service (launchd / login item).
#
# Deliberately NOT `npm run dev`: that's a file-watching dev server. This runs the
# compiled build directly, so the service starts fast and stays put.
set -e
cd "$(dirname "$0")/.."   # → the backend folder

# Optional per-machine config overrides (PORT, OLLAMA_BASE_URL, TRIAL_DAYS…).
# Lives OUTSIDE the app folder on purpose: it survives re-running setup (which
# regenerates the launchd plist) and app upgrades, and is never part of a release.
if [ -f "$HOME/.local-redactor/env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.local-redactor/env"
  set +a
fi

# The absolute node path is baked in at install time (LRA_NODE) because launchd
# does NOT inherit your shell's PATH — nvm/homebrew node would otherwise vanish.
NODE="${LRA_NODE:-$(command -v node)}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "✗ node not found (LRA_NODE='$LRA_NODE'). Re-run setup to repair." >&2
  exit 1
fi
NPM="$(dirname "$NODE")/npm"

# Self-heal: if the build is missing (first run, or an upgrade wiped it), build.
if [ ! -f dist/index.js ]; then
  echo "• dist/ missing — building…"
  "$NPM" run build || { echo "✗ build failed" >&2; exit 1; }
fi

exec "$NODE" dist/index.js
