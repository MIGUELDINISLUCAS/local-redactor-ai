#!/usr/bin/env bash
# Launcher used by the LaunchAgent to run the Local Redactor backend at login,
# always from this (dev) repo's current source via tsx — no stale copy.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cd "$(dirname "$0")/../backend" || exit 1

# Make sure Ollama is up (the model engine). Harmless if it's already running
# (e.g. the Ollama.app) — the second serve just fails on the busy port.
if ! ollama list >/dev/null 2>&1; then
  ollama serve >/dev/null 2>&1 &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ollama list >/dev/null 2>&1 && break
    sleep 2
  done
fi

# Run the backend directly from TypeScript source (always current).
exec npm run dev
