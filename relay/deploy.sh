#!/usr/bin/env bash
#
# Idempotent server-side deploy for the DSH Link relay.
#
# Run as root on the relay host, directly from a git clone (the script copies
# its own files into /opt/dsh-link) or from an already uploaded $APP_DIR:
#
#   cd dsh-link/relay && sudo ./deploy.sh
#   # custom domain:
#   cd dsh-link/relay && sudo DSHLINK_DOMAIN=relay.example.com ./deploy.sh
#
# The script:
#   1. installs npm dependencies (only `ws`) when missing;
#   2. creates the 64-hex space token on first run only (0600, never in git);
#   3. rewrites /opt/dsh-link/pairing.txt (0600) from the current token;
#   4. installs + enables + restarts the systemd unit (boot start);
#   5. installs a certbot deploy hook so renewals restart the relay.
#
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/dsh-link"
SERVICE="dsh-link-relay"
# Default the certificate domain to <public-ip>.sslip.io; override with
# DSHLINK_DOMAIN=your.domain (or DSHLINK_PUBLIC_URL=wss://...:port).
DOMAIN="${DSHLINK_DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  # sslip.io encodes IPv4 dots as dashes: 203.0.113.7 -> 203-0-113-7.sslip.io
  DOMAIN="$(printf '%s' "${IP:-127.0.0.1}" | tr '.' '-').sslip.io"
fi
PORT="${DSHLINK_PORT:-8443}"
PUBLIC_URL="${DSHLINK_PUBLIC_URL:-wss://${DOMAIN}:${PORT}}"

# Allow running straight from a git clone: copy the relay files into APP_DIR.
# The running copy is never the source checkout, so re-running is idempotent.
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  install -d -m 755 "$APP_DIR"
  for f in server.mjs package.json package-lock.json dsh-link-relay.service README.md deploy.sh; do
    if [ -f "$SRC_DIR/$f" ]; then
      install -m 644 "$SRC_DIR/$f" "$APP_DIR/$f"
    fi
  done
  chmod 755 "$APP_DIR/deploy.sh"
fi
TOKEN_FILE="${APP_DIR}/token"
PAIRING_FILE="${APP_DIR}/pairing.txt"
UNIT_FILE="${APP_DIR}/${SERVICE}.service"
UNIT_TARGET="/etc/systemd/system/${SERVICE}.service"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
HOOK_FILE="${HOOK_DIR}/restart-${SERVICE}.sh"

log() { printf '[deploy] %s\n' "$*"; }

if [ "$(id -u)" != "0" ]; then
  echo "[deploy] must run as root" >&2
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[deploy] node not found in PATH" >&2
  exit 1
fi

for required in "${APP_DIR}/server.mjs" "${APP_DIR}/package.json" "${UNIT_FILE}"; do
  if [ ! -f "$required" ]; then
    echo "[deploy] missing $required; upload the relay files first" >&2
    exit 1
  fi
done

if [ ! -f "${CERT_DIR}/fullchain.pem" ] || [ ! -f "${CERT_DIR}/privkey.pem" ]; then
  echo "[deploy] missing TLS certificate under ${CERT_DIR}" >&2
  exit 1
fi

install -d -m 755 "$APP_DIR"
cd "$APP_DIR"

# Keep uploaded source files world-readable but never writable by non-root;
# scp preserves the local (often 0600) modes, so normalize them here.
for f in server.mjs package.json dsh-link-relay.service README.md; do
  if [ -f "$APP_DIR/$f" ]; then chmod 644 "$APP_DIR/$f"; fi
done
if [ -f "$APP_DIR/deploy.sh" ]; then chmod 755 "$APP_DIR/deploy.sh"; fi

if [ ! -d "${APP_DIR}/node_modules/ws" ]; then
  log "installing dependencies (ws)"
  npm install --omit=dev --no-audit --no-fund --no-progress
fi

if [ ! -s "$TOKEN_FILE" ]; then
  log "generating space token"
  umask 077
  openssl rand -hex 32 > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

TOKEN="$(cat "$TOKEN_FILE")"
if ! printf '%s' "$TOKEN" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "[deploy] ${TOKEN_FILE} does not contain a 64 hex-char token; refusing to continue" >&2
  exit 1
fi

# §1 pairing code: dshlink1.<base64url({"v":1,"u":WSS_URL,"t":TOKEN})>
PAIRING_CODE="$("$NODE_BIN" -e '
  const [url, token] = process.argv.slice(1);
  const json = JSON.stringify({ v: 1, u: url, t: token });
  process.stdout.write("dshlink1." + Buffer.from(json, "utf8").toString("base64url"));
' "$PUBLIC_URL" "$TOKEN")"
umask 077
printf '%s\n' "$PAIRING_CODE" > "$PAIRING_FILE"
chmod 600 "$PAIRING_FILE"
unset TOKEN PAIRING_CODE
log "pairing code written to ${PAIRING_FILE} (0600)"

# Deployment-specific values stay outside the repo (systemd reads this file).
ENV_FILE="/etc/default/${SERVICE}"
umask 022
cat > "$ENV_FILE" <<EOF
# Written by ${APP_DIR}/deploy.sh
DSHLINK_DOMAIN=${DOMAIN}
DSHLINK_PORT=${PORT}
DSHLINK_CERT=${CERT_DIR}/fullchain.pem
DSHLINK_KEY=${CERT_DIR}/privkey.pem
EOF
chmod 644 "$ENV_FILE"
install -m 644 "$UNIT_FILE" "$UNIT_TARGET"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

install -d -m 755 "$HOOK_DIR"
cat > "$HOOK_FILE" <<EOF
#!/bin/sh
# Installed by ${APP_DIR}/deploy.sh (DSH Link relay).
# certbot runs deploy hooks after a successful renewal; reload TLS by restarting
# the relay so it picks up the new certificate files.
systemctl restart ${SERVICE}.service
EOF
chmod 755 "$HOOK_FILE"
log "certbot deploy hook installed: ${HOOK_FILE}"

# Wait for the unit to listen on the TLS port (max ~10s).
for _ in $(seq 1 20); do
  if systemctl is-active --quiet "$SERVICE"; then
    if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ":${PORT} "; then
      log "relay active and listening on :${PORT} (public ${PUBLIC_URL})"
      exit 0
    fi
  fi
  sleep 0.5
done

echo "[deploy] relay did not become active on :${PORT}" >&2
systemctl --no-pager --full status "$SERVICE" >&2 || true
echo "[deploy] see: journalctl -u ${SERVICE} -n 50 --no-pager" >&2
exit 1
