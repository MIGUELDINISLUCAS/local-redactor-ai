#!/usr/bin/env bash
# Optional: install the "Thorough check" model (macOS / Linux).
#
# Thorough mode uses the eternisai Anonymizer 4B running locally via Ollama.
# It is OPTIONAL and self-installed. NOTE: this model is licensed CC-BY-NC-4.0
# (NON-COMMERCIAL) — fine for personal use; not licensed for commercial use.
# Local Redactor AI does not bundle or distribute it; this script downloads it
# from its own source for your own local, non-commercial use.
set -e
cd "$(dirname "$0")"

echo "🛡️  Local Redactor AI — install Thorough model (optional)"
echo

if ! command -v ollama >/dev/null 2>&1; then
  echo "✗ Ollama is not installed (it runs the local model)."
  echo "  1. Install Ollama:  https://ollama.com/download   (macOS: 'brew install ollama')"
  echo "  2. Then run this again."
  exit 1
fi

if ! ollama list >/dev/null 2>&1; then
  echo "• Starting Ollama…"
  (ollama serve >/dev/null 2>&1 &)
  sleep 3
fi

if ollama list | grep -q "anonymizer-4b-fast"; then
  echo "✓ Thorough model already installed. You can enable it in the extension popup."
  exit 0
fi

echo "• Downloading & building the Thorough model (~4GB, one time)…"
ollama create anonymizer-4b-fast -f ollama/anonymizer-4b-fast.hf.Modelfile

echo
echo "✅ Done. Turn on 'Thorough check' in the extension popup to use it."
