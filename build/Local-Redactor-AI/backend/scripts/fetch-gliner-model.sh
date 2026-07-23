#!/usr/bin/env bash
# Download the token-level GLiNER model used by "fast mode".
#
#   knowledgator/gliner-pii-large-v1.0  (Apache-2.0, DeBERTa-v3-large)
#   span_mode = token_level → catches full multi-line addresses (no width cap).
#
# The model (~1.76 GB fp32) is NOT bundled in the release zip. Run this once.
# Fetched over HTTPS from the Hugging Face hub and stored locally; at runtime the
# tokenizer loads from these local files (no network call).
#
# SUPPLY-CHAIN INTEGRITY (for a privacy product this matters):
#  - Pinned to an immutable commit REVISION, not the mutable `main` branch, so an
#    upstream change can't silently alter what we download.
#  - Every file is verified against a known SHA-256 below. A mismatch aborts and
#    deletes the file — we never run weights we can't vouch for.
set -euo pipefail

REPO="knowledgator/gliner-pii-large-v1.0"
# Immutable commit — update this AND the checksums together, never independently.
REV="f847f54fbc97ad6e78bfa20ed9c5e5d5c43327b9"
BASE="https://huggingface.co/${REPO}/resolve/${REV}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models/gliner-pii-large"

# Known-good SHA-256 for each file at the pinned revision.
SHA_model_onnx="308d687c1bf41676a59edee57957a9a67e400c2ef453957733ff42d1ba48c281"
SHA_gliner_config_json="0f85c68effd06bad4c3bd532d2094c1b83d3a765bfbaf1e702d8ee6c44083a97"
SHA_tokenizer_json="8ab96e6f4643bf269d56818f7f507c8ac1173adb28402704dfe7b7c1e6124ccf"
SHA_tokenizer_config_json="884542579ae0063aaf25a0a19f66838428f3070b1740dc30c8dea20d79b51365"
SHA_special_tokens_map_json="b2f1b2f15f29a6b6d9d6ea4eca1675d2c231a71477f151d48f79cc83a625ba21"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

# Verify $1 (path) against expected sha $2; on mismatch, delete and abort.
verify() {
  local path="$1" expected="$2" got
  got="$(sha256_of "$path")"
  if [ "$got" != "$expected" ]; then
    rm -f "$path"
    echo "✗ Checksum mismatch for $(basename "$path")." >&2
    echo "    expected $expected" >&2
    echo "    got      $got" >&2
    echo "  Refusing to use it. Re-run to retry; if it persists, the upstream file changed." >&2
    exit 1
  fi
}

mkdir -p "$DIR"
echo "→ Fetching ${REPO} @ ${REV:0:12} into ${DIR}"

# ONNX weights (large) — reuse only if present AND the checksum still matches.
if [ -f "$DIR/model.onnx" ] && [ "$(sha256_of "$DIR/model.onnx")" = "$SHA_model_onnx" ]; then
  echo "  ✓ model.onnx already present and verified"
else
  echo "  • model.onnx (~1.76 GB) …"
  curl -fL --progress-bar "${BASE}/onnx/model.onnx" -o "$DIR/model.onnx"
  verify "$DIR/model.onnx" "$SHA_model_onnx"
fi

# Tokenizer + config (small) — required for offline tokenization.
for f in gliner_config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  echo "  • $f"
  curl -fsSL "${BASE}/${f}" -o "$DIR/${f}"
  # Map filename → SHA_<name-with-dots-as-underscores> variable.
  var="SHA_$(echo "$f" | tr '.' '_')"
  verify "$DIR/${f}" "${!var}"
done

echo "✅ GLiNER model verified and ready. Fast mode will use it on next backend start."
