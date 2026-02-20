#!/usr/bin/env bash
set -euo pipefail

# Always run from $HOME to avoid deleting/using a non-existent cwd
cd "$HOME" || cd /

echo "[xmpp] Starting clean install helper for OpenClaw XMPP plugin"

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

CONFIG_PATH="$HOME/.openclaw/openclaw.json"
TMP_DIR="$(mktemp -d)"
ARCHIVE_URL="https://github.com/toughworm/Openclaw-XMPP-Plugin/archive/refs/heads/main.zip"
ARCHIVE_PATH="$TMP_DIR/openclaw-xmpp-plugin-main.zip"
BACKUP_PATH="$TMP_DIR/xmpp-channels-backup.json"

# Backup channels.xmpp and remove old xmpp entries directly from config (even if config is currently invalid)
if [ -f "$CONFIG_PATH" ]; then
  echo "[xmpp] Backing up channels.xmpp and cleaning old xmpp entries from config..."
  python3 - "$CONFIG_PATH" "$BACKUP_PATH" << 'PY'
import json, sys, os

config_path, backup_path = sys.argv[1], sys.argv[2]
try:
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception:
    # If config can't be read, do nothing; installer will fail later with a clear error
    sys.exit(0)

channels = data.get("channels") or {}
xmpp_cfg = channels.get("xmpp")
if xmpp_cfg is not None:
    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(xmpp_cfg, f)
    channels.pop("xmpp", None)
    data["channels"] = channels

plugins = data.get("plugins") or {}
entries = plugins.get("entries") or {}
if "xmpp" in entries:
    entries.pop("xmpp", None)
    plugins["entries"] = entries

installs = plugins.get("installs") or {}
if "xmpp" in installs:
    installs.pop("xmpp", None)
    plugins["installs"] = installs

data["plugins"] = plugins

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY
fi

echo "[xmpp] Cleaning old xmpp plugin files (if any)..."

# Remove default extensions directory for xmpp plugin
rm -rf "$HOME/.openclaw/extensions/xmpp" || true

echo "[xmpp] Downloading xmpp plugin archive to: $ARCHIVE_PATH"
curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE_PATH"

echo "[xmpp] Installing xmpp plugin from local archive: $ARCHIVE_PATH"
"$OPENCLAW_BIN" plugins install "$ARCHIVE_PATH"

# Restore channels.xmpp subtree if we backed it up earlier
if [ -f "$BACKUP_PATH" ] && [ -f "$CONFIG_PATH" ]; then
  echo "[xmpp] Restoring previous channels.xmpp configuration..."
  python3 - "$CONFIG_PATH" "$BACKUP_PATH" << 'PY'
import json, sys

config_path, backup_path = sys.argv[1], sys.argv[2]
try:
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    with open(backup_path, "r", encoding="utf-8") as f:
        xmpp_cfg = json.load(f)
except Exception:
    sys.exit(0)

channels = data.get("channels")
if channels is None:
    channels = {}
    data["channels"] = channels

channels["xmpp"] = xmpp_cfg

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY
fi

XMPP_DIR="$HOME/.openclaw/extensions/xmpp"
if [ -d "$XMPP_DIR" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "[xmpp] Installing npm dependencies in $XMPP_DIR..."
    cd "$XMPP_DIR"
    npm install \
      @xmpp/client@0.13.1 \
      @privacyresearch/libsignal-protocol-typescript@0.0.16 \
      ws@7.5.9 \
      zod@4.3.6 --save
  else
    echo "[xmpp] WARNING: npm not found; please run 'npm install --omit=dev' in $XMPP_DIR manually." >&2
  fi
fi

echo "[xmpp] Done. Restart the OpenClaw gateway to load the updated XMPP plugin."
