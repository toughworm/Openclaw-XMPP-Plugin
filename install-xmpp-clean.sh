#!/usr/bin/env bash
set -euo pipefail

echo "[xmpp] Starting clean install helper for OpenClaw XMPP plugin"

# Resolve OpenClaw CLI
if command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_BIN="$(command -v openclaw)"
elif [ -x "$HOME/.openclaw/bin/openclaw" ]; then
  OPENCLAW_BIN="$HOME/.openclaw/bin/openclaw"
else
  echo "[xmpp] ERROR: 'openclaw' CLI not found on PATH or under \$HOME/.openclaw/bin." >&2
  echo "[xmpp] Please install OpenClaw first, then re-run this script." >&2
  exit 1
fi

echo "[xmpp] Using OpenClaw CLI: $OPENCLAW_BIN"

# Detect existing xmpp plugin and perform manual cleanup
if "$OPENCLAW_BIN" plugins info xmpp --json >/dev/null 2>&1; then
  echo "[xmpp] Detected existing xmpp plugin; cleaning config and files..."

  # Remove config records for xmpp plugin (do not touch channels.xmpp)
  "$OPENCLAW_BIN" config unset plugins.entries.xmpp || true
  "$OPENCLAW_BIN" config unset plugins.installs.xmpp || true

  # Remove default extensions directory for xmpp plugin
  rm -rf "$HOME/.openclaw/extensions/xmpp" || true
else
  echo "[xmpp] No existing xmpp plugin found; skipping cleanup."
fi

ARCHIVE_URL="https://github.com/toughworm/Openclaw-XMPP-Plugin/archive/refs/heads/main.zip"
echo "[xmpp] Installing xmpp plugin from: $ARCHIVE_URL"
"$OPENCLAW_BIN" plugins install "$ARCHIVE_URL"

echo "[xmpp] Done. Restart the OpenClaw gateway to load the updated XMPP plugin."
