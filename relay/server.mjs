#!/usr/bin/env node
/**
 * DSH Link relay — protocol v1.
 *
 * Public TLS WebSocket endpoint that keeps an in-memory device directory for
 * one space token and forwards call/sub/reply/event/end frames between
 * devices. Business methods (session.*, speech.*, …) are never parsed here.
 *
 * Contract: ../protocol/PROTOCOL.md §2. This file must not invent frames or
 * fields; anything not covered by the contract is kept internal.
 *
 * Environment:
 *   DSHLINK_HOST         bind address            (default 0.0.0.0)
 *   DSHLINK_PORT         bind port               (default 8443)
 *   DSHLINK_CERT         TLS fullchain PEM       (default LE live path)
 *   DSHLINK_KEY          TLS private key PEM     (default LE live path)
 *   DSHLINK_TOKEN_FILE   space token file        (default /opt/dsh-link/token)
 *
 * Log fields follow §7: connection metadata, device id/name, frame kind,
 * method name and latency only. `params` / `result` bodies and the token are
 * never logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';

const PROTOCOL_VERSION = 1;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // §2.6 single frame limit
const HELLO_TIMEOUT_MS = 10_000; // unauthenticated socket lifetime
const PING_INTERVAL_MS = 25_000; // §2.5
const CALL_TIMEOUT_MS = 30_000; // §2.3 orphan call cleanup
// Speech recognition may need to load the local model on first use; give that
// one method a longer relay-side window (the caller still owns its own timeout).
const SPEECH_CALL_TIMEOUT_MS = 180_000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
const MAX_NAME_LENGTH = 128;
const MAX_ID_LENGTH = 128;

const certDomain = process.env.DSHLINK_DOMAIN || 'relay.example.com';
const config = {
  host: process.env.DSHLINK_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.DSHLINK_PORT || '8443', 10),
  certFile:
    process.env.DSHLINK_CERT ||
    `/etc/letsencrypt/live/${certDomain}/fullchain.pem`,
  keyFile:
    process.env.DSHLINK_KEY ||
    `/etc/letsencrypt/live/${certDomain}/privkey.pem`,
  tokenFile: process.env.DSHLINK_TOKEN_FILE || '/opt/dsh-link/token',
};

/** All sockets that have not closed yet (authenticated or not). */
const clients = new Set();
/** device.id -> connection (only authenticated devices). */
const devices = new Map();
/** rid -> pending call/subscription entry. */
const pendingByRid = new Map();
/** Monotonic rid counter (unique for the lifetime of this process). */
let ridSeq = 0;

let tokenDigest = null;
let heartbeatTimer = null;
let httpsServer = null;
let wss = null;

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

function log(event, fields = {}) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  try {
    process.stdout.write(JSON.stringify(line) + '\n');
  } catch {
    /* journald unavailable; never throw from logging */
  }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function tokenMatches(presented) {
  if (typeof presented !== 'string' || tokenDigest === null) return false;
  const candidate = digest(presented);
  return candidate.length === tokenDigest.length && timingSafeEqual(candidate, tokenDigest);
}

// ---------------------------------------------------------------------------
// frame plumbing
// ---------------------------------------------------------------------------

function send(conn, frame) {
  if (!conn || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
  try {
    conn.ws.send(JSON.stringify(frame));
    return true;
  } catch (err) {
    log('send_failed', { id: conn.id ?? null, error: err?.code || err?.name });
    return false;
  }
}

function sendError(conn, code, message) {
  send(conn, { t: 'error', code, message });
}

/** Post-hello protocol violation: reply with an error frame, keep the socket. */
function protoError(conn, code, message) {
  log('frame_rejected', { id: conn.id ?? null, code });
  sendError(conn, code, message);
}

/** Pre-hello rejection: send `error` then close (§2.1). */
function rejectHandshake(conn, code, message) {
  if (conn.rejected) return;
  conn.rejected = true;
  log('hello_rejected', { remote: conn.remote ?? null, code });
  const payload = JSON.stringify({ t: 'error', code, message });
  try {
    conn.ws.send(payload, () => {
      try {
        conn.ws.close(4000, code);
      } catch {
        /* already gone */
      }
    });
  } catch {
    try {
      conn.ws.terminate();
    } catch {
      /* already gone */
    }
  }
}

/** A connected device as other devices see it (hosts only, §2.2 / lead ruling). */
function publicPeer(conn) {
  return {
    id: conn.id,
    name: conn.name,
    platform: conn.platform,
    since: conn.since,
  };
}

/** Peers list for one viewer: other online hosts, never clients, never self. */
function peersFor(selfId) {
  const out = [];
  for (const device of devices.values()) {
    if (device.role === 'host' && device.id !== selfId) out.push(publicPeer(device));
  }
  return out;
}

/**
 * Push presence to every authenticated connection. Only host directory changes
 * call this; client churn must not produce host-side presence churn.
 */
function broadcastPresence(except = null) {
  for (const device of devices.values()) {
    if (device === except) continue;
    send(device, { t: 'presence', peers: peersFor(device.id) });
  }
}

// ---------------------------------------------------------------------------
// hello / identity
// ---------------------------------------------------------------------------

function validName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name) return null;
  return name.slice(0, MAX_NAME_LENGTH);
}

function resolveIdentity(conn, msg) {
  const role = msg.role;
  const rawDevice = msg.device;
  let device = null;

  if (rawDevice !== undefined && rawDevice !== null) {
    if (typeof rawDevice !== 'object' || Array.isArray(rawDevice)) {
      return { error: { code: 'bad-hello', message: 'device must be an object' } };
    }
    device = rawDevice;
  }

  if (role === 'host' && device === null) {
    return { error: { code: 'bad-hello', message: 'host hello requires device' } };
  }

  let id;
  if (device && device.id !== undefined) {
    if (
      typeof device.id !== 'string' ||
      device.id.length < 3 ||
      device.id.length > 64 ||
      !DEVICE_ID_RE.test(device.id)
    ) {
      return {
        error: {
          code: 'bad-hello',
          message: 'device.id must be a 3-64 char string of [A-Za-z0-9_-]',
        },
      };
    }
    id = device.id;
  } else if (role === 'client') {
    id = 'cli_' + randomBytes(8).toString('hex'); // §2.1 relay-assigned
  } else {
    return { error: { code: 'bad-hello', message: 'host hello requires device.id' } };
  }

  const defaultName = role === 'host' ? 'DSH Host' : 'DSH Client';
  const name = validName(device?.name) ?? defaultName;
  let platform = typeof device?.platform === 'string' && device.platform ? device.platform : null;
  if (platform === null) platform = role === 'host' ? 'unknown' : 'android';
  if (platform.length > 32) platform = platform.slice(0, 32);

  return { id, name, platform };
}

/**
 * Register a connection in the device directory. A second connection using the
 * same device.id and role replaces the older socket (reconnect race); a role
 * mismatch is rejected so a client cannot kick a host.
 */
function claimDevice(conn, role, id) {
  const existing = devices.get(id);
  if (existing && existing !== conn && existing.ws.readyState === WebSocket.OPEN) {
    if (existing.role !== role) {
      return {
        error: {
          code: 'bad-hello',
          message: `device id is already online as ${existing.role}`,
        },
      };
    }
    log('device_replaced', { id, role });
    devices.delete(id);
    try {
      existing.ws.close(4001, 'replaced by newer connection');
    } catch {
      /* already gone */
    }
  }
  devices.set(id, conn);
  return { replaced: Boolean(existing) };
}

function onHello(conn, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.t !== 'hello') {
    rejectHandshake(conn, 'bad-hello', 'first frame must be hello');
    return;
  }
  if (msg.v !== PROTOCOL_VERSION) {
    rejectHandshake(
      conn,
      'version',
      `unsupported protocol version (relay speaks v${PROTOCOL_VERSION})`,
    );
    return;
  }
  if (msg.role !== 'host' && msg.role !== 'client') {
    rejectHandshake(conn, 'bad-hello', 'role must be "host" or "client"');
    return;
  }
  if (!tokenMatches(msg.token)) {
    rejectHandshake(conn, 'auth-failed', 'invalid token');
    return;
  }

  const identity = resolveIdentity(conn, msg);
  if (identity.error) {
    rejectHandshake(conn, identity.error.code, identity.error.message);
    return;
  }

  conn.id = identity.id;
  conn.name = identity.name;
  conn.platform = identity.platform;
  conn.role = msg.role;
  conn.authed = true;
  conn.since = Date.now();
  if (conn.helloDeadline) {
    clearTimeout(conn.helloDeadline);
    conn.helloDeadline = null;
  }

  const claim = claimDevice(conn, conn.role, conn.id);
  if (claim.error) {
    conn.id = null;
    conn.role = null;
    conn.authed = false;
    rejectHandshake(conn, claim.error.code, claim.error.message);
    return;
  }

  send(conn, {
    t: 'welcome',
    v: PROTOCOL_VERSION,
    self: { id: conn.id, name: conn.name },
    peers: peersFor(conn.id),
  });

  // §2.2: a just-connected client gets one presence after welcome. Hosts get
  // presence only when the host directory changes.
  if (conn.role === 'client') {
    send(conn, { t: 'presence', peers: peersFor(conn.id) });
  } else {
    broadcastPresence(conn);
  }

  log('hello', {
    id: conn.id,
    role: conn.role,
    platform: conn.platform,
    name: conn.name,
    replaced: claim.replaced,
  });
}

// ---------------------------------------------------------------------------
// calls / subscriptions
// ---------------------------------------------------------------------------

function finishEntry(entry) {
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (pendingByRid.get(entry.rid) === entry) pendingByRid.delete(entry.rid);
  if (entry.caller.outgoing.get(entry.id) === entry) entry.caller.outgoing.delete(entry.id);
}

function offlineReply(conn, id, reason = 'target device is offline') {
  send(conn, { t: 'reply', id, ok: false, error: { code: 'offline', message: reason } });
}

function onCall(conn, msg, kind) {
  if (typeof msg.id !== 'string' || msg.id.length === 0 || msg.id.length > MAX_ID_LENGTH) {
    protoError(conn, 'bad-request', 'id must be a non-empty string (max 128)');
    return;
  }
  if (conn.outgoing.has(msg.id)) {
    protoError(conn, 'bad-request', `duplicate id "${msg.id}"`);
    return;
  }
  if (typeof msg.to !== 'string' || msg.to.length === 0) {
    protoError(conn, 'bad-request', 'to must be a non-empty device id');
    return;
  }
  if (typeof msg.method !== 'string' || msg.method.length === 0) {
    protoError(conn, 'bad-request', 'method must be a non-empty string');
    return;
  }

  const target = devices.get(msg.to);
  if (!target) {
    offlineReply(conn, msg.id);
    log('call_offline', {
      id: conn.id,
      to: msg.to,
      method: msg.method,
      kind,
    });
    return;
  }

  const rid = 'r' + ++ridSeq;
  const entry = {
    rid,
    kind, // 'call' | 'sub'
    id: msg.id,
    method: msg.method,
    caller: conn,
    target,
    createdAt: Date.now(),
    timer: null,
    acked: false,
  };

  const timeoutMs = msg.method === 'speech.transcribe' ? SPEECH_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS;
  entry.timer = setTimeout(() => {
    if (pendingByRid.get(rid) !== entry) return;
    // Subscriptions already acknowledged are long-lived and never time out;
    // this timer is cleared when the stream ack arrives.
    if (kind === 'sub' && entry.target.ws.readyState === WebSocket.OPEN) {
      send(entry.target, { t: 'unsub', rid });
    }
    finishEntry(entry);
    send(entry.caller, {
      t: 'reply',
      id: entry.id,
      ok: false,
      error: { code: 'timeout', message: `relay call timeout (${Math.round(timeoutMs / 1000)}s)` },
    });
    log('call_timeout', {
      rid,
      kind,
      from: entry.caller.id,
      to: entry.target.id,
      method: entry.method,
      ms: Date.now() - entry.createdAt,
    });
  }, timeoutMs);

  conn.outgoing.set(msg.id, entry);
  pendingByRid.set(rid, entry);

  const forwarded = send(target, {
    t: 'call',
    rid,
    from: { id: conn.id, name: conn.name },
    method: msg.method,
    params: msg.params ?? {},
  });

  if (!forwarded) {
    finishEntry(entry);
    offlineReply(conn, msg.id);
    log('call_offline', { id: conn.id, to: msg.to, method: msg.method, kind, reason: 'send-failed' });
    return;
  }

  log('call_forward', {
    rid,
    kind,
    from: conn.id,
    to: target.id,
    method: msg.method,
  });
}

function normalizeError(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      code: typeof raw.code === 'string' ? raw.code : 'internal',
      message: typeof raw.message === 'string' ? raw.message : '',
    };
  }
  return { code: 'internal', message: 'relay received malformed error' };
}

function onReply(conn, msg) {
  if (typeof msg.rid !== 'string' || msg.rid.length === 0) {
    protoError(conn, 'bad-request', 'reply.rid must be a non-empty string');
    return;
  }
  const entry = pendingByRid.get(msg.rid);
  if (!entry) {
    // §2.3: late replies after the 30s cleanup are discarded.
    log('reply_dropped', { rid: msg.rid, reason: 'unknown-or-late' });
    return;
  }
  if (entry.target !== conn) {
    log('reply_dropped', { rid: msg.rid, reason: 'wrong-device' });
    return;
  }
  if (entry.acked) {
    log('reply_dropped', { rid: msg.rid, reason: 'reply-after-stream-ack' });
    return;
  }

  const ok = msg.ok === true;
  const forward = { t: 'reply', id: entry.id, ok };
  if (ok) {
    forward.result =
      Object.prototype.hasOwnProperty.call(msg, 'result') ? msg.result : {};
  } else {
    forward.error = normalizeError(msg.error);
  }

  send(entry.caller, forward);
  const latencyMs = Date.now() - entry.createdAt;
  const streaming =
    ok &&
    entry.kind === 'sub' &&
    msg.result &&
    typeof msg.result === 'object' &&
    msg.result.stream === true;

  if (streaming) {
    entry.acked = true;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    log('reply_forward', {
      rid: msg.rid,
      kind: entry.kind,
      ok,
      stream: true,
      ms: latencyMs,
    });
  } else {
    finishEntry(entry);
    log('reply_forward', {
      rid: msg.rid,
      kind: entry.kind,
      ok,
      code: ok ? null : forward.error.code,
      ms: latencyMs,
    });
  }
}

function onEvent(conn, msg) {
  if (typeof msg.rid !== 'string') {
    protoError(conn, 'bad-request', 'event.rid must be a non-empty string');
    return;
  }
  const entry = pendingByRid.get(msg.rid);
  if (!entry || entry.target !== conn || entry.kind !== 'sub') {
    log('event_dropped', { rid: msg.rid, reason: 'unknown-rid' });
    return;
  }
  if (!entry.acked) {
    // §2.4 requires reply {stream:true} before events; drop out-of-order noise.
    log('event_dropped', { rid: msg.rid, reason: 'stream-not-acked' });
    return;
  }
  send(entry.caller, { t: 'event', id: entry.id, data: msg.data });
}

function onEnd(conn, msg) {
  if (typeof msg.rid !== 'string') {
    protoError(conn, 'bad-request', 'end.rid must be a non-empty string');
    return;
  }
  const entry = pendingByRid.get(msg.rid);
  if (!entry || entry.target !== conn || entry.kind !== 'sub') {
    log('end_dropped', { rid: msg.rid, reason: 'unknown-rid' });
    return;
  }
  send(entry.caller, { t: 'end', id: entry.id });
  finishEntry(entry);
  log('end_forward', { rid: msg.rid, kind: entry.kind });
}

function onUnsub(conn, msg) {
  if (typeof msg.id !== 'string' || msg.id.length === 0) {
    protoError(conn, 'bad-request', 'unsub.id must be a non-empty string');
    return;
  }
  const entry = conn.outgoing.get(msg.id);
  if (!entry) {
    protoError(conn, 'bad-request', `unknown id "${msg.id}"`);
    return;
  }
  if (entry.target.ws.readyState === WebSocket.OPEN) {
    send(entry.target, { t: 'unsub', rid: entry.rid });
  }
  send(conn, { t: 'end', id: entry.id }); // §2.4 relay answers end
  finishEntry(entry);
  log('unsub', { rid: entry.rid, id: entry.id, to: entry.target.id });
}

// ---------------------------------------------------------------------------
// message router
// ---------------------------------------------------------------------------

function onMessage(conn, data, isBinary) {
  if (conn.rejected) return;

  if (isBinary) {
    if (!conn.authed) rejectHandshake(conn, 'bad-hello', 'binary frames are not supported');
    else protoError(conn, 'bad-request', 'binary frames are not supported');
    return;
  }

  let msg;
  try {
    msg = JSON.parse(data.toString('utf8'));
  } catch {
    if (!conn.authed) rejectHandshake(conn, 'bad-hello', 'invalid JSON');
    else protoError(conn, 'bad-request', 'invalid JSON');
    return;
  }

  if (!conn.authed) {
    onHello(conn, msg);
    return;
  }

  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    protoError(conn, 'bad-request', 'frame must be a JSON object');
    return;
  }

  switch (msg.t) {
    case 'call':
      onCall(conn, msg, 'call');
      return;
    case 'sub':
      onCall(conn, msg, 'sub');
      return;
    case 'reply':
      onReply(conn, msg);
      return;
    case 'event':
      onEvent(conn, msg);
      return;
    case 'end':
      onEnd(conn, msg);
      return;
    case 'unsub':
      onUnsub(conn, msg);
      return;
    case 'hello':
      protoError(conn, 'bad-request', 'already authenticated');
      return;
    default:
      protoError(conn, 'bad-request', 'unknown frame type');
  }
}

// ---------------------------------------------------------------------------
// connection lifecycle
// ---------------------------------------------------------------------------

function onDisconnect(conn, code, reason) {
  if (conn.closed) return;
  conn.closed = true;

  if (conn.helloDeadline) {
    clearTimeout(conn.helloDeadline);
    conn.helloDeadline = null;
  }
  clients.delete(conn);

  let removedHost = false;
  if (conn.id && devices.get(conn.id) === conn) {
    devices.delete(conn.id);
    if (conn.role === 'host' && conn.authed) removedHost = true;
  }

  // This connection was a caller: tell every target to stop its subscription.
  for (const entry of [...conn.outgoing.values()]) {
    if (entry.target.ws.readyState === WebSocket.OPEN) {
      send(entry.target, { t: 'unsub', rid: entry.rid });
    }
    finishEntry(entry);
  }

  // This connection was a target: fail pending calls / end live subscriptions.
  for (const entry of [...pendingByRid.values()]) {
    if (entry.target !== conn) continue;
    if (entry.kind === 'sub') {
      send(entry.caller, { t: 'end', id: entry.id });
    } else {
      send(entry.caller, {
        t: 'reply',
        id: entry.id,
        ok: false,
        error: { code: 'offline', message: 'target device disconnected' },
      });
    }
    finishEntry(entry);
  }

  if (removedHost) broadcastPresence();

  log('disconnect', {
    id: conn.id ?? null,
    role: conn.role ?? null,
    code,
    reason: typeof reason === 'string' ? reason.slice(0, 64) : undefined,
    ms: Date.now() - conn.since,
    removedHost,
  });
}

function attachSocket(ws, req) {
  const conn = {
    ws,
    remote: req.socket?.remoteAddress ?? null,
    id: null,
    name: null,
    platform: null,
    role: null,
    authed: false,
    rejected: false,
    closed: false,
    since: Date.now(),
    missedPongs: 0,
    outgoing: new Map(),
    helloDeadline: null,
  };
  clients.add(conn);
  log('connect', { remote: conn.remote });

  conn.helloDeadline = setTimeout(() => {
    if (!conn.authed) rejectHandshake(conn, 'bad-hello', 'hello timeout');
  }, HELLO_TIMEOUT_MS);

  ws.on('pong', () => {
    conn.missedPongs = 0;
  });

  ws.on('message', (data, isBinary) => {
    try {
      onMessage(conn, data, isBinary);
    } catch (err) {
      // A single bad frame must never take down the relay.
      log('frame_error', { id: conn.id ?? null, error: err?.name ?? 'Error' });
    }
  });

  ws.on('error', (err) => {
    log('socket_error', { id: conn.id ?? null, error: err?.code || err?.name });
  });

  ws.on('close', (code, reasonBuf) => {
    const reason = Buffer.isBuffer(reasonBuf) ? reasonBuf.toString('utf8') : String(reasonBuf ?? '');
    try {
      onDisconnect(conn, code, reason);
    } catch (err) {
      log('disconnect_error', { id: conn.id ?? null, error: err?.name ?? 'Error' });
    }
  });
}

// ---------------------------------------------------------------------------
// heartbeat (§2.5)
// ---------------------------------------------------------------------------

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    for (const conn of clients) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      if (conn.missedPongs >= 1) {
        // No pong within one ping interval: drop the socket.
        log('heartbeat_timeout', { id: conn.id ?? null });
        try {
          conn.ws.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      conn.missedPongs += 1;
      try {
        conn.ws.ping();
      } catch {
        /* already gone */
      }
    }
  }, PING_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// startup / shutdown
// ---------------------------------------------------------------------------

function loadToken() {
  let raw;
  try {
    raw = readFileSync(config.tokenFile, 'utf8').trim();
  } catch (err) {
    log('fatal', {
      stage: 'token',
      error: err?.code || err?.name,
      file: config.tokenFile,
    });
    process.exit(1);
  }
  if (!raw) {
    log('fatal', { stage: 'token', error: 'token file is empty', file: config.tokenFile });
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    // The deploy script always writes 64 hex chars; do not print the value.
    log('warn', { stage: 'token', message: 'token is not 64 hex chars (accepted)' });
  }
  tokenDigest = digest(raw);
  log('token_loaded', { file: config.tokenFile });
}

function start() {
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    log('fatal', { stage: 'config', error: 'invalid port' });
    process.exit(1);
  }
  loadToken();

  let cert;
  let key;
  try {
    cert = readFileSync(config.certFile);
    key = readFileSync(config.keyFile);
  } catch (err) {
    log('fatal', {
      stage: 'tls',
      error: err?.code || err?.name,
      file: err?.path || undefined,
    });
    process.exit(1);
  }

  httpsServer = createHttpsServer(
    { cert, key, minVersion: 'TLSv1.2' },
    (req, res) => {
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('DSH Link relay: WebSocket upgrade required\n');
    },
  );

  wss = new WebSocketServer({
    server: httpsServer,
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false, // base64 audio frames; deflate would waste 2C2G CPU
  });
  wss.on('connection', attachSocket);
  wss.on('error', (err) => log('server_error', { error: err?.code || err?.name }));

  httpsServer.on('error', (err) => {
    log('fatal', { stage: 'listen', error: err?.code || err?.name });
    process.exit(1);
  });

  httpsServer.listen(config.port, config.host, () => {
    const addr = httpsServer.address();
    log('listening', {
      address: typeof addr === 'string' ? addr : addr?.address,
      port: typeof addr === 'object' ? addr?.port : config.port,
      protocol: PROTOCOL_VERSION,
      maxPayload: MAX_PAYLOAD_BYTES,
      pingIntervalMs: PING_INTERVAL_MS,
      callTimeoutMs: CALL_TIMEOUT_MS,
      speechCallTimeoutMs: SPEECH_CALL_TIMEOUT_MS,
    });
  });

  startHeartbeat();
}

function shutdown(signal) {
  log('shutdown', { signal });
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  for (const conn of [...clients]) {
    try {
      conn.ws.close(1001, 'relay shutting down');
    } catch {
      /* already gone */
    }
  }
  const done = () => process.exit(0);
  try {
    if (wss) wss.close();
    if (httpsServer) httpsServer.close(done);
    else done();
  } catch {
    done();
  }
  setTimeout(done, 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  log('fatal', { stage: 'uncaught', error: err?.name, message: err?.message });
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  log('fatal', {
    stage: 'unhandled-rejection',
    error: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : undefined,
  });
  process.exit(1);
});

start();
