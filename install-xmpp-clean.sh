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

  # 1) Remove channel config first to avoid unknown channel id when plugin is absent
  "$OPENCLAW_BIN" config unset channels.xmpp || true

  # 2) Remove plugin entry so config no longer references xmpp plugin id
  "$OPENCLAW_BIN" config unset plugins.entries.xmpp || true

  # 3) Finally remove install record (after entries is gone) to keep config valid
  "$OPENCLAW_BIN" config unset plugins.installs.xmpp || true

  # Remove default extensions directory for xmpp plugin
  rm -rf "$HOME/.openclaw/extensions/xmpp" || true
else
  echo "[xmpp] No existing xmpp plugin found; skipping cleanup."
fi

ARCHIVE_URL="https://github.com/toughworm/Openclaw-XMPP-Plugin/archive/refs/heads/main.zip"
TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TMP_DIR/openclaw-xmpp-plugin-main.zip"

echo "[xmpp] Downloading xmpp plugin archive to: $ARCHIVE_PATH"
curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE_PATH"

echo "[xmpp] Installing xmpp plugin from local archive: $ARCHIVE_PATH"
"$OPENCLAW_BIN" plugins install "$ARCHIVE_PATH"

echo "[xmpp] Done. Restart the OpenClaw gateway to load the updated XMPP plugin."
