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

# Detect existing xmpp plugin (any origin: path, archive, npm)
if "$OPENCLAW_BIN" plugins info xmpp --json >/dev/null 2>&1; then
  echo "[xmpp] Detected existing xmpp plugin installation; uninstalling old version..."
  # This will:
  # - remove plugins.entries["xmpp"] from openclaw.json
  # - remove plugins.installs["xmpp"] and related metadata
  # - delete the installed plugin directory under the extensions state dir
  # - clean allowlist/load-path/slot if needed
  "$OPENCLAW_BIN" plugins uninstall xmpp --force || true
else
  echo "[xmpp] No existing xmpp plugin found in plugin registry; skipping uninstall step."
fi

echo "[xmpp] Installing latest @openclaw/xmpp plugin via npm spec..."
"$OPENCLAW_BIN" plugins install @openclaw/xmpp

echo "[xmpp] Done. Restart the OpenClaw gateway to load the updated XMPP plugin."

