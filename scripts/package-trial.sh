#!/usr/bin/env bash
# Assemble a slim, ready-to-send trial package (extension + local backend only)
# and zip it. Excludes node_modules, build output, the desktop app, the frontend,
# and dev-only files. Re-runnable.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

NAME="Local-Redactor-AI"
STAGE="$ROOT/build/$NAME"
ZIP="$ROOT/dist/${NAME}-trial.zip"

echo "• Cleaning staging…"
rm -rf "$ROOT/build" "$ZIP"
mkdir -p "$STAGE/backend/ollama" "$STAGE/extension" "$ROOT/dist"

echo "• Copying the guide…"
cp "$ROOT/SHARING.md" "$STAGE/README.md"          # first thing they'll open

echo "• Copying the extension…"
cp -R "$ROOT/extension/." "$STAGE/extension/"

echo "• Copying the backend (source + setup only)…"
cp -R "$ROOT/backend/src" "$STAGE/backend/src"
cp "$ROOT/backend/package.json" "$ROOT/backend/package-lock.json" "$ROOT/backend/tsconfig.json" "$STAGE/backend/"
cp "$ROOT/backend/setup.sh" "$ROOT/backend/setup.command" "$ROOT/backend/setup.ps1" "$ROOT/backend/setup.bat" "$STAGE/backend/"
cp "$ROOT/backend/install-autostart.command" "$ROOT/backend/install-autostart.sh" "$ROOT/backend/install-autostart.bat" "$STAGE/backend/"
cp "$ROOT/backend/install-thorough-model.command" "$ROOT/backend/install-thorough-model.sh" "$STAGE/backend/"  # optional, self-serve thorough model
mkdir -p "$STAGE/backend/scripts"
# fetch-gliner-model: setup downloads the detection model
# run-backend:        what the always-on background service executes
# copy-assets:        part of `npm run build` — without it dist/ misses gliner.mjs
cp "$ROOT/backend/scripts/fetch-gliner-model.sh" "$ROOT/backend/scripts/run-backend.sh" "$ROOT/backend/scripts/copy-assets.mjs" "$STAGE/backend/scripts/"
chmod +x "$STAGE/backend/setup.sh" "$STAGE/backend/setup.command" "$STAGE/backend/install-autostart.command" "$STAGE/backend/install-autostart.sh" "$STAGE/backend/install-thorough-model.command" "$STAGE/backend/install-thorough-model.sh" "$STAGE/backend/scripts/fetch-gliner-model.sh" "$STAGE/backend/scripts/run-backend.sh"

echo "• Copying model definitions (auto-download variants only)…"
cp "$ROOT/backend/ollama/README.md" "$STAGE/backend/ollama/"
cp "$ROOT/backend/ollama/anonymizer-4b-fast.hf.Modelfile" "$STAGE/backend/ollama/"
cp "$ROOT/backend/ollama/anonymizer-fast.Modelfile" "$STAGE/backend/ollama/"   # 1.7B fallback (also HF-pull)
# NOTE: the local-path 4B Modelfile is intentionally excluded (won't work elsewhere).

echo "• Stripping any stray dev files…"
find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true
rm -rf "$STAGE/backend/src/core/tests"          # tests aren't needed to run

echo "• Zipping…"
( cd "$ROOT/build" && zip -rqX "$ZIP" "$NAME" )

SIZE="$(du -sh "$ZIP" | cut -f1)"
echo
echo "✅ Built $ZIP ($SIZE)"
echo "   Send that single file. Recipients follow the README inside."
