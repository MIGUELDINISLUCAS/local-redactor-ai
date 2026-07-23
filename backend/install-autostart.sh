#!/usr/bin/env bash
# Install the backend as a background service that starts at login and restarts
# itself if it ever stops (macOS launchd). Run by setup.sh automatically; also
# safe to run on its own to repair the service.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"            # the backend folder
PLIST="$HOME/Library/LaunchAgents/com.localredactor.backend.plist"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "✗ Node.js not found. Install it from https://nodejs.org, then run setup again." >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.local-redactor"

# NOTE: launchd starts with a bare environment — it does not read your shell
# profile. We bake in the absolute node path (LRA_NODE) and prepend its folder to
# PATH so nvm/homebrew installs keep working after a reboot.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localredactor.backend</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$DIR/scripts/run-backend.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$HOME/.local-redactor/backend.log</string>
  <key>StandardErrorPath</key><string>$HOME/.local-redactor/backend.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LRA_NODE</key><string>$NODE_BIN</string>
    <key>PATH</key><string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "✅ Background service installed — the backend now starts at login and"
echo "   restarts itself if it ever stops. Logs: ~/.local-redactor/backend.log"
echo
echo "   To turn it off later:"
echo "     launchctl unload \"$PLIST\" && rm \"$PLIST\""
