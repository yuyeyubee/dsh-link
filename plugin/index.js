/**
 * DSH Link — Host half.
 *
 * One relay connection per DSH installation. It serves a small, explicit RPC
 * surface over the user's own relay (`protocol/PROTOCOL.md`), so another DSH
 * install or the Android app can:
 *
 * - list/open/read/drive this Host's DSH Sessions,
 * - receive committed Session events as compact chat records,
 * - transcribe a WAV recording with this Host's local speech-to-text plugin.
 *
 * The same instance also calls other Hosts, which powers the local agent tools
 * (`link_*`) and the Web UI's remote workspace panel. Token lives in the DSH
 * credential store; the rest of the pairing lives in
 * `$DSH_HOME/dsh-link/config.json` (mode 0600).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join, sep } from 'node:path'

/** Loader row identity of this plugin. */
export const name = 'dsh-link'

/** Services this plugin cannot work without. */
export const inject = ['tools', 'systemPrompt', 'credentials']

/** Version reported to peers and the Web UI. */
const VERSION = '1.1.1'
/** On-disk config document version. */
const CONFIG_VERSION = 1
/** Same-origin API route used by the Client half. */
const ROUTE_PATH = '/api/dsh-link'
/** Same-origin NDJSON stream route used by the Client half. */
const STREAM_PATH = '/api/dsh-link/stream'
/** Credential-record key holding the space token. */
const CREDENTIAL_KEY = 'dsh-link/token'
/** Pairing-code prefix. */
const PAIRING_PREFIX = 'dshlink1.'
/** Largest accepted audio payload (decoded bytes). */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024
/** Default relay RPC timeout. */
const RPC_TIMEOUT_MS = 30_000
/** Speech RPC timeout: first use may load the local model. */
const SPEECH_TIMEOUT_MS = 180_000
/** Session follow snapshot size. */
const FOLLOW_MAX_MESSAGES = 30
/** Text caps that keep relay frames bounded. */
const MAX_TEXT = 8 * 1024
const MAX_ARGS = 4 * 1024
const MAX_TOOL_TEXT = 2 * 1024
const MAX_REASONING = 4 * 1024
/** How many recent remote Sessions are mirrored into one device workspace. */
const MAX_MIRROR_SESSIONS = 10
/** Mirror mapping format; v2 groups remote projects as separate workspaces. */
const MIRROR_STORE_VERSION = 2
/** How often peers are re-listed while connected, in milliseconds. */
const MIRROR_SYNC_INTERVAL_MS = 60_000
/** Reconnect backoff bounds, in milliseconds. */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

const RELAY_STATES = new Set(['unconfigured', 'connecting', 'connected', 'offline'])
const SPEECH_READY_PHASES = new Set(['ready', 'standby'])
const PROVIDER_LANGUAGES = new Set(['auto', 'zh', 'en', 'yue', 'ja', 'ko'])

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Resolve the harness home the same way other Harness services do. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.length > 0) return configured
  return join(homedir(), '.dsh')
}

/** Absolute path of the plugin's own directory. */
function dataDir() {
  return join(dshHome(), 'dsh-link')
}

/** Absolute path of the durable non-secret config document. */
function configFile() {
  return join(dataDir(), 'config.json')
}

/** Absolute path of the one-shot pairing import file. */
function pairingImportFile() {
  return join(dataDir(), 'pairing.txt')
}

/** Human-readable message of an arbitrary thrown value. */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/** Clamp a string and append an ellipsis when it was cut. */
function truncate(value, max) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（已截断 ${text.length - max} 字符）`
}

/** Sleep for a bounded number of milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The local device's default name. */
function defaultDeviceName() {
  const value = hostname().trim()
  return value.length > 0 ? value.slice(0, 60) : 'DSH Host'
}

/** Mint a device identity that stays stable across restarts. */
function newDeviceId() {
  return `dev_${randomBytes(8).toString('hex')}`
}

/** A structured, user-facing failure carried back over the relay. */
export class LinkError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LinkError'
    this.code = code
  }
}

/** Normalize an arbitrary failure into the protocol's error envelope. */
export function toProtocolError(error) {
  if (error instanceof LinkError) return { code: error.code, message: error.message }
  if (error !== null && typeof error === 'object') {
    if (typeof error.code === 'string' && typeof error.message === 'string') {
      return { code: error.code, message: error.message }
    }
  }
  return { code: 'internal', message: errorMessage(error) }
}

/** Validate and canonicalize a relay URL. */
function normalizeRelayUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LinkError('bad-request', '中转地址不能为空')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new LinkError('bad-request', '中转地址不是合法 URL')
  }
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
    throw new LinkError('bad-request', '中转地址必须以 wss:// 或 ws:// 开头')
  }
  const base = `${url.protocol}//${url.host}`
  return url.pathname === '/' ? base : `${base}${url.pathname}`
}

/** Validate a space token (64 lowercase hex characters). */
function normalizeToken(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.trim())) {
    throw new LinkError('bad-request', '配对码里的 token 无效')
  }
  return value.trim().toLowerCase()
}

/** Encode a pairing code from a relay URL and token. */
export function encodePairingCode(relayUrl, token) {
  const payload = { v: 1, u: normalizeRelayUrl(relayUrl), t: normalizeToken(token) }
  return PAIRING_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/** Decode and validate a pairing code. */
export function parsePairingCode(input) {
  if (typeof input !== 'string') throw new LinkError('bad-request', '配对码必须是字符串')
  const code = input.trim()
  if (!code.startsWith(PAIRING_PREFIX)) {
    throw new LinkError('bad-request', '配对码格式不对（应以 dshlink1. 开头）')
  }
  const encoded = code.slice(PAIRING_PREFIX.length).replace(/\s+/gu, '')
  let payload
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new LinkError('bad-request', '配对码内容无法解析，请重新复制')
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LinkError('bad-request', '配对码内容无效')
  }
  if (payload.v !== 1) {
    throw new LinkError('bad-request', `配对码版本 ${String(payload.v)} 不受支持，请升级插件`)
  }
  return { relayUrl: normalizeRelayUrl(payload.u), token: normalizeToken(payload.t) }
}

/* -------------------------------------------------------------------------- */
/* Session event → compact chat records                                       */
/* -------------------------------------------------------------------------- */

/** Join the text blocks of one Message. */
function textOfMessage(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** Join the reasoning blocks of one Message. */
function reasoningOfMessage(message) {
  if (message === null || typeof message !== 'object') return ''
  const content = Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'reasoning' && typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** Join the text blocks of a list of user messages for mirror forwarding. */
function extractUserMessageText(messages) {
  if (!Array.isArray(messages)) return ''
  const parts = []
  for (const message of messages) {
    const text = textOfMessage(message)
    if (text.length > 0) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

/** Map one DSH wire event to a protocol ChatRecord, or undefined when ignored. */
export function mapWireEvent(wire) {
  if (wire === null || typeof wire !== 'object') return undefined
  const type = typeof wire.type === 'string' ? wire.type : ''
  const seq = Number.isFinite(wire.seq) ? wire.seq : -1
  const time = Number.isFinite(wire.time) ? wire.time : Date.now()
  const data = wire.data !== null && typeof wire.data === 'object' ? wire.data : {}
  switch (type) {
    case 'user/message': {
      const sourceKind = data.source !== null && typeof data.source === 'object' ? data.source.kind : undefined
      if (typeof sourceKind === 'string' && sourceKind !== 'user') return undefined
      const text = textOfMessage(data)
      if (text.length === 0) return undefined
      return { kind: 'user', seq, time, text: truncate(text, MAX_TEXT) }
    }
    case 'assistant/message': {
      const message = data.message
      const text = textOfMessage(message)
      const reasoning = reasoningOfMessage(message)
      if (text.length === 0 && reasoning.length === 0) return undefined
      const record = {
        kind: 'assistant',
        seq,
        time,
        turn: Number.isFinite(data.turn) ? data.turn : 0,
        step: Number.isFinite(data.step) ? data.step : 0,
        text: truncate(text, MAX_TEXT),
      }
      if (reasoning.length > 0) record.reasoning = truncate(reasoning, MAX_REASONING)
      return record
    }
    case 'tool/call': {
      const callId = typeof data.callId === 'string' ? data.callId : ''
      const toolName = typeof data.name === 'string' ? data.name : 'tool'
      const args = typeof data.arguments === 'string' ? data.arguments : ''
      return {
        kind: 'tool-call',
        seq,
        time,
        turn: Number.isFinite(data.turn) ? data.turn : 0,
        step: Number.isFinite(data.step) ? data.step : 0,
        callId,
        name: toolName,
        args: truncate(args, MAX_ARGS),
      }
    }
    case 'tool/result': {
      const message = data.message
      const text = textOfMessage(message)
      const error = data.error
      const callId = typeof message?.toolCallId === 'string' ? message.toolCallId : ''
      const isError = message?.isError === true || (error !== null && typeof error === 'object')
      const fallback = error !== null && typeof error === 'object'
        ? `${String(error.name ?? 'tool error')}: ${String(error.reason ?? error.code ?? '')}`.trim()
        : ''
      const body = text.length > 0 ? text : fallback
      if (body.length === 0 && !isError) return undefined
      return {
        kind: 'tool-result',
        seq,
        time,
        turn: Number.isFinite(data.turn) ? data.turn : 0,
        step: Number.isFinite(data.step) ? data.step : 0,
        callId,
        name: typeof message?.toolName === 'string' ? message.toolName : '',
        isError,
        text: truncate(body, MAX_TOOL_TEXT),
      }
    }
    case 'turn/start': {
      return { kind: 'turn-start', seq, time, turn: Number.isFinite(data.turn) ? data.turn : 0 }
    }
    case 'turn/end': {
      const reason = data.reason !== null && typeof data.reason === 'object' && typeof data.reason.kind === 'string'
        ? data.reason.kind
        : 'unknown'
      return { kind: 'turn-end', seq, time, turn: Number.isFinite(data.turn) ? data.turn : 0, reason }
    }
    default:
      return undefined
  }
}

/** Extract the latest title event from a raw record list, if present. */
function titleOfRecords(records) {
  let title = ''
  for (const record of records) {
    const event = record?.event
    if (event?.type === 'session/title' && typeof event.data?.title === 'string') title = event.data.title
  }
  return title
}

/** Map one SessionSummary from the Host API. */
export function mapSessionSummary(item) {
  if (item === null || typeof item !== 'object') return undefined
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId : ''
  if (sessionId.length === 0) return undefined
  const projections = item.projections?.values
  let title = ''
  if (projections !== null && typeof projections === 'object') {
    for (const key of ['title', 'sessionTitle', 'name']) {
      if (typeof projections[key] === 'string' && projections[key].trim().length > 0) {
        title = projections[key].trim()
        break
      }
    }
  }
  const projectionValues = item.projections?.values !== null && typeof item.projections?.values === 'object' ? item.projections.values : {}
  const modelSelection = projectionValues.modelSelection?.next ?? projectionValues.modelSelection?.lastUsed ?? null
  return {
    sessionId,
    title: truncate(title, 200),
    cwd: typeof item.cwd === 'string' ? item.cwd : null,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
    running: item.running === true,
    active: item.active === true,
    agentAvailable: item.agentAvailable !== false,
    blank: item.blank === true,
    parentSessionId: typeof item.parentSessionId === 'string' ? item.parentSessionId : null,
    modelSelection: modelSelection !== null && typeof modelSelection === 'object' ? modelSelection : null,
    agentPreset: typeof projectionValues.agentPreset === 'string' ? projectionValues.agentPreset : null,
  }
}

/** Map one passive Session state. */
export function mapSessionState(state) {
  const queue = Array.isArray(state?.queue) ? state.queue : []
  const pending = Array.isArray(state?.pendingInput) ? state.pendingInput : []
  return {
    active: state?.active === true,
    running: state?.running === true,
    queueCount: queue.length,
    pendingInput: pending.filter((value) => typeof value === 'string'),
  }
}

/** Validate the canonical 16 kHz mono PCM16 WAV the speech providers accept. */
export function inspectWav(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 46) {
    throw new LinkError('bad-request', '录音数据不是完整的 WAV 文件')
  }
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length))
  const u16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8)
  const u32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  const canonical = ascii(0, 4) === 'RIFF'
    && ascii(8, 4) === 'WAVE'
    && ascii(12, 4) === 'fmt '
    && u32(16) === 16
    && u16(20) === 1
    && u16(22) === 1
    && u32(24) === 16000
    && u32(28) === 32000
    && u16(32) === 2
    && u16(34) === 16
    && ascii(36, 4) === 'data'
    && u32(4) === bytes.byteLength - 8
    && u32(40) === bytes.byteLength - 44
    && (bytes.byteLength - 44) % 2 === 0
  if (!canonical) {
    throw new LinkError('bad-request', '语音必须是 16 kHz / 单声道 / 16-bit PCM 的标准 WAV（44 字节头，data 紧接其后）')
  }
  return { channels: 1, sampleRate: 16000, bits: 16, bytes: bytes.byteLength }
}

/* -------------------------------------------------------------------------- */
/* Relay client                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One reconnecting WebSocket to the relay. It owns request correlation,
 * subscription routing and presence; business methods live on LinkHost.
 */
class RelayClient {
  constructor(options) {
    this.url = options.url
    this.token = options.token
    this.device = options.device
    this.role = options.role ?? 'host'
    this.logger = options.logger
    this.onPeers = options.onPeers
    this.onState = options.onState
    this.onCall = options.onCall
    this.onUnsub = options.onUnsub
    this.socket = undefined
    this.state = 'connecting'
    this.lastError = null
    this.peers = []
    this.pending = new Map()
    this.subs = new Map()
    this.seq = 0
    this.stopped = true
    this.retry = 0
    this.retryTimer = undefined
  }

  /** Start connecting; safe to call again after stop(). */
  start() {
    if (typeof WebSocket === 'undefined') {
      this.state = 'offline'
      this.lastError = '当前 DSH 运行环境不支持 WebSocket（需要 Node 22+）'
      this.onState?.(this.state)
      return
    }
    this.stopped = false
    this.onState?.('connecting')
    this.connect()
  }

  /** Stop reconnecting and close the socket. */
  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    const socket = this.socket
    this.socket = undefined
    if (socket !== undefined) {
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
    this.failEverything(new LinkError('offline', '中转连接已断开'))
    this.state = 'offline'
    this.peers = []
    this.onPeers?.([])
    this.onState?.(this.state)
  }

  /** Update credentials and reconnect. */
  reconfigure({ url, token, device }) {
    this.stop()
    this.url = url
    this.token = token
    this.device = device
    this.retry = 0
    this.lastError = null
    this.start()
  }

  /** Open one socket attempt. */
  connect() {
    if (this.stopped) return
    this.setState('connecting')
    let socket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      this.lastError = errorMessage(error)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.send({
        t: 'hello',
        v: 1,
        role: this.role,
        token: this.token,
        device: this.device,
      })
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      if (typeof event.data !== 'string') return
      let frame
      try {
        frame = JSON.parse(event.data)
      } catch {
        return
      }
      this.receive(frame)
    })
    socket.addEventListener('error', () => {
      if (this.socket !== socket) return
      this.lastError = '无法连接中转服务器（网络或证书错误）'
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.peers = []
      this.onPeers?.([])
      this.failEverything(new LinkError('offline', this.lastError ?? '中转连接已断开'))
      this.setState('connecting')
      this.scheduleReconnect()
    })
  }

  /** Dispatch one relay frame. */
  receive(frame) {
    if (frame === null || typeof frame !== 'object') return
    switch (frame.t) {
      case 'welcome': {
        this.retry = 0
        this.lastError = null
        this.peers = Array.isArray(frame.peers) ? frame.peers.filter(isPeer) : []
        this.onPeers?.(this.peers)
        this.setState('connected')
        return
      }
      case 'presence': {
        this.peers = Array.isArray(frame.peers) ? frame.peers.filter(isPeer) : []
        this.onPeers?.(this.peers)
        return
      }
      case 'reply': {
        const pending = this.pending.get(frame.id)
        if (pending !== undefined) {
          this.pending.delete(frame.id)
          clearTimeout(pending.timer)
          if (frame.ok === true) pending.resolve(frame.result)
          else pending.reject(new LinkError(frame.error?.code ?? 'internal', frame.error?.message ?? '远程调用失败'))
          return
        }
        const sub = this.subs.get(frame.id)
        if (sub !== undefined && frame.ok === false) {
          this.subs.delete(frame.id)
          sub.onError?.(new LinkError(frame.error?.code ?? 'internal', frame.error?.message ?? '订阅失败'))
        }
        return
      }
      case 'event': {
        const sub = this.subs.get(frame.id)
        sub?.onEvent?.(frame.data)
        return
      }
      case 'end': {
        const sub = this.subs.get(frame.id)
        if (sub !== undefined) {
          this.subs.delete(frame.id)
          sub.onEnd?.()
        }
        return
      }
      case 'call': {
        this.onCall?.(frame.rid, frame.from, frame.method, frame.params)
        return
      }
      case 'unsub': {
        this.onUnsub?.(frame.rid)
        return
      }
      case 'error': {
        this.lastError = typeof frame.message === 'string' ? frame.message : '中转服务器拒绝了连接'
        this.log?.('warn', `relay error: ${frame.code ?? 'unknown'} ${this.lastError}`)
        if (frame.code === 'auth-failed' || frame.code === 'version' || frame.code === 'bad-hello') {
          try {
            this.socket?.close()
          } catch {
            // ignored
          }
        }
        return
      }
      default:
        return
    }
  }

  /** Send one JSON frame; a closed socket is a no-op. */
  send(frame) {
    const socket = this.socket
    if (socket === undefined || socket.readyState !== 1) return false
    try {
      socket.send(JSON.stringify(frame))
      return true
    } catch {
      return false
    }
  }

  /** Make one request/response call to a peer. */
  call(to, method, params, timeoutMs = RPC_TIMEOUT_MS) {
    if (this.state !== 'connected') {
      return Promise.reject(new LinkError('offline', '中转未连接'))
    }
    const id = `c${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LinkError('timeout', `调用 ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      if (!this.send({ t: 'call', id, to, method, params })) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new LinkError('offline', '中转未连接'))
      }
    })
  }

  /** Open one stream subscription to a peer. */
  subscribe(to, method, params, handlers) {
    if (this.state !== 'connected') {
      handlers.onError?.(new LinkError('offline', '中转未连接'))
      return { cancel() {} }
    }
    const id = `s${++this.seq}`
    this.subs.set(id, handlers)
    if (!this.send({ t: 'sub', id, to, method, params })) {
      this.subs.delete(id)
      handlers.onError?.(new LinkError('offline', '中转未连接'))
    }
    return {
      cancel: () => {
        if (this.subs.delete(id)) this.send({ t: 'unsub', id })
      },
    }
  }

  /** Close every pending call and stream with one failure. */
  failEverything(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.reject(error)
    }
    for (const [id, sub] of this.subs) {
      this.subs.delete(id)
      sub.onError?.(error)
    }
  }

  /** Publish a state change once. */
  setState(state) {
    if (!RELAY_STATES.has(state) || this.state === state) return
    this.state = state
    this.onState?.(state)
  }

  /** Schedule one reconnect attempt with capped exponential backoff. */
  scheduleReconnect() {
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.retry)
    this.retry = Math.min(this.retry + 1, 10)
    const delay = Math.round(base * (0.8 + Math.random() * 0.4))
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  /** Internal logger that never receives secrets. */
  log(level, message) {
    try {
      this.logger?.log?.(level, message)
    } catch {
      // logging must never break the link
    }
  }
}

/** Whether one peer row has the shape the UI can render. */
function isPeer(value) {
  return value !== null && typeof value === 'object'
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
}

/* -------------------------------------------------------------------------- */
/* Host implementation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The live Host: config/token ownership, relay lifecycle, RPC handlers, and the
 * shared operations behind both the agent tools and the local HTTP API.
 */
class LinkHost {
  constructor(ctx) {
    this.ctx = ctx
    this.config = undefined
    this.token = undefined
    this.relay = undefined
    this.state = 'unconfigured'
    this.peers = []
    this.localStreams = new Map()
    this.speechWarmed = false
    this.mirrors = { version: 1, devices: {} }
    this.mirrorWatches = new Map()
    this.mirrorStreamStats = new Map()
    this.mirrorTimer = undefined
    this.peerStateTimer = undefined
    this.archiveTimer = undefined
    this.mirrorSyncTimer = undefined
    this.mirrorSyncing = false
    this.peerStateSyncing = false
    this.archiveSyncing = false
    this.mirrorArchiveStates = new Map()
    this.mirrorModelStates = new Map()
    this.lastArchiveError = null
  }

  /** Resolve a host service without failing when the composition lacks it. */
  service(key) {
    try {
      return this.ctx.get(key)
    } catch {
      return undefined
    }
  }

  /** Log without secrets. */
  log(level, message) {
    try {
      const logger = this.ctx.logger
      if (logger !== undefined && typeof logger[level] === 'function') logger[level](message)
    } catch {
      // ignore logging failures
    }
  }

  /** Read the durable non-secret config, or undefined when absent/invalid. */
  readConfig() {
    try {
      const raw = readFileSync(configFile(), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return undefined
      if (typeof parsed.deviceId !== 'string' || parsed.deviceId.length === 0) return undefined
      const config = {
        version: CONFIG_VERSION,
        deviceId: parsed.deviceId,
        deviceName: typeof parsed.deviceName === 'string' && parsed.deviceName.trim().length > 0
          ? parsed.deviceName.trim().slice(0, 60)
          : defaultDeviceName(),
        relayUrl: typeof parsed.relayUrl === 'string' ? parsed.relayUrl : '',
        language: typeof parsed.language === 'string' ? parsed.language : '',
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      }
      return config
    } catch {
      return undefined
    }
  }

  /** Atomically persist the non-secret config with mode 0600. */
  writeConfig(config) {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
    const payload = JSON.stringify({ ...config, version: CONFIG_VERSION }, null, 2)
    const target = configFile()
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, payload, { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
  }

  /** Remove the config document. */
  removeConfig() {
    rmSync(configFile(), { force: true })
  }

  /** Read the space token from the credential store. */
  async readToken() {
    try {
      const record = await this.ctx.credentials.readRecord(CREDENTIAL_KEY)
      if (record === undefined || record.kind !== 'api-key') return undefined
      return typeof record.key === 'string' && record.key.length > 0 ? record.key : undefined
    } catch {
      return undefined
    }
  }

  /** Replace the space token in the credential store. */
  async writeToken(token) {
    await this.ctx.credentials.modifyRecord(CREDENTIAL_KEY, async () => ({ kind: 'api-key', key: token }))
  }

  /** Delete the stored space token. */
  async deleteToken() {
    try {
      await this.ctx.credentials.deleteRecord(CREDENTIAL_KEY)
    } catch {
      // absent is fine
    }
  }

  /** Whether both halves of the pairing are present. */
  isConfigured() {
    return this.config !== undefined && this.config.relayUrl.length > 0 && typeof this.token === 'string'
  }

  /** Load state and connect when configured. */
  async start() {
    this.config = this.readConfig()
    this.token = await this.readToken()
    this.mirrors = this.readMirrorStore()
    await this.migrateMirrors()
    await this.repairMirrorSessions()
    await this.importPairingFile()
    if (this.isConfigured()) this.connectRelay()
    else this.setState('unconfigured')
    this.startMirrorTimer()
    this.startPeerStateTimer()
    this.startArchiveTimer()
  }

  /** Import `~/.dsh/dsh-link/pairing.txt` once, then delete it. */
  async importPairingFile() {
    const file = pairingImportFile()
    if (!existsSync(file)) return
    try {
      const text = readFileSync(file, 'utf8').trim()
      const pairing = parsePairingCode(text)
      const base = this.config ?? {
        version: CONFIG_VERSION,
        deviceId: newDeviceId(),
        deviceName: defaultDeviceName(),
        relayUrl: '',
        language: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const next = {
        ...base,
        relayUrl: pairing.relayUrl,
        updatedAt: new Date().toISOString(),
      }
      this.writeConfig(next)
      await this.writeToken(pairing.token)
      this.config = next
      this.token = pairing.token
      rmSync(file, { force: true })
      this.log('info', 'dsh-link: imported pairing file')
    } catch (error) {
      this.log('warn', `dsh-link: pairing import failed: ${errorMessage(error)}`)
    }
  }

  /** Open the relay with current credentials. */
  connectRelay() {
    this.closeRelay()
    if (!this.isConfigured()) {
      this.setState('unconfigured')
      return
    }
    const relay = new RelayClient({
      url: this.config.relayUrl,
      token: this.token,
      device: {
        id: this.config.deviceId,
        name: this.config.deviceName,
        platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      },
      logger: { log: (level, message) => this.log(level, message) },
      onPeers: (peers) => {
        this.peers = peers
        if (this.relay?.state === 'connected') this.scheduleMirrorSync()
      },
      onState: (state) => {
        this.setState(state)
        if (state === 'connected') this.scheduleMirrorSync()
      },
      onCall: (rid, from, method, params) => {
        void this.handleIncomingCall(rid, from, method, params)
      },
      onUnsub: (rid) => {
        const stream = this.localStreams.get(rid)
        if (stream !== undefined) {
          this.localStreams.delete(rid)
          stream.abort()
        }
      },
    })
    this.relay = relay
    relay.start()
  }

  /** Close the relay without clearing credentials. */
  closeRelay() {
    if (this.relay !== undefined) {
      this.relay.stop()
      this.relay = undefined
    }
    for (const stream of this.localStreams.values()) stream.abort()
    this.localStreams.clear()
  }

  /** Stop everything; the plugin effect's cleanup uses this. */
  stop() {
    clearInterval(this.mirrorTimer)
    clearInterval(this.peerStateTimer)
    clearInterval(this.archiveTimer)
    clearTimeout(this.mirrorSyncTimer)
    this.mirrorTimer = undefined
    this.mirrorSyncTimer = undefined
    for (const localId of [...this.mirrorWatches.keys()]) this.unwatchMirror(localId)
    this.closeRelay()
  }

  /** Publish one connection state. */
  setState(state) {
    this.state = state
  }

  /** Find a peer by exact id or case-insensitive name/substring. */
  resolvePeer(ref) {
    if (typeof ref !== 'string' || ref.trim().length === 0) {
      throw new LinkError('bad-request', '缺少远程设备 id 或名称')
    }
    const value = ref.trim()
    const peers = this.peers
    const exact = peers.find((peer) => peer.id === value)
    if (exact !== undefined) return exact
    const byName = peers.find((peer) => String(peer.name ?? '').toLowerCase() === value.toLowerCase())
    if (byName !== undefined) return byName
    const prefix = peers.find((peer) => peer.id.startsWith(value) || String(peer.name ?? '').toLowerCase().includes(value.toLowerCase()))
    if (prefix !== undefined) return prefix
    throw new LinkError('offline', `找不到在线设备「${ref}」`)
  }

  /** Call one remote Host method. */
  remoteCall(deviceRef, method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    const peer = this.resolvePeer(deviceRef)
    if (this.relay === undefined || this.relay.state !== 'connected') {
      throw new LinkError('offline', '中转未连接')
    }
    return this.relay.call(peer.id, method, params, timeoutMs)
  }

  /** Subscribe to one remote Host stream. */
  remoteSubscribe(deviceRef, method, params, handlers) {
    const peer = this.resolvePeer(deviceRef)
    if (this.relay === undefined) {
      handlers.onError?.(new LinkError('offline', '中转未连接'))
      return { cancel() {} }
    }
    return this.relay.subscribe(peer.id, method, params, handlers)
  }

  /** Build the status payload shared by the UI and diagnostics. */
  async status() {
    let pairingCode = ''
    if (this.isConfigured()) {
      try {
        pairingCode = encodePairingCode(this.config.relayUrl, this.token)
      } catch {
        pairingCode = ''
      }
    }
    return {
      configured: this.isConfigured(),
      pairingCode,
      device: this.config === undefined
        ? null
        : { id: this.config.deviceId, name: this.config.deviceName, platform: process.platform },
      connection: {
        state: this.isConfigured() ? this.state : 'unconfigured',
        relayUrl: this.config?.relayUrl ?? null,
        lastError: this.relay?.lastError ?? null,
      },
      peers: this.peers.map((peer) => ({
        id: peer.id,
        name: peer.name,
        platform: peer.platform ?? 'unknown',
        since: peer.since ?? null,
      })),
      speech: this.speechStatus(),
      mirrors: this.mirrorList(),
      version: VERSION,
    }
  }

  /** Flat mirror mapping for the Client decorations and settings diagnostics. */
  mirrorList() {
    const items = []
    for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
      for (const [remoteSessionId, entry] of Object.entries(device.sessions ?? {})) {
        items.push({
          localSessionId: entry.localId,
          deviceId,
          deviceName: device.name,
          remoteSessionId,
          title: entry.title ?? '',
        })
      }
    }
    return items
  }

  /** Save a pairing code from the settings page. */
  async savePairing(pairingCode, deviceName) {
    const pairing = parsePairingCode(pairingCode)
    const base = this.config ?? {
      version: CONFIG_VERSION,
      deviceId: newDeviceId(),
      deviceName: defaultDeviceName(),
      relayUrl: '',
      language: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const next = {
      ...base,
      relayUrl: pairing.relayUrl,
      deviceName: typeof deviceName === 'string' && deviceName.trim().length > 0
        ? deviceName.trim().slice(0, 60)
        : base.deviceName,
      updatedAt: new Date().toISOString(),
    }
    this.writeConfig(next)
    await this.writeToken(pairing.token)
    this.config = next
    this.token = pairing.token
    this.connectRelay()
    return this.status()
  }

  /** Forget the pairing and close the relay. */
  async forget() {
    this.closeRelay()
    await this.deleteToken()
    this.removeConfig()
    this.config = undefined
    this.token = undefined
    this.peers = []
    this.setState('unconfigured')
    return this.status()
  }

  /* ----------------------------- local methods ---------------------------- */

  /** Require the Session controller service. */
  requireSessions() {
    const service = this.service('sessionController')
    if (service === undefined) throw new LinkError('unavailable', '本机 DSH 未加载会话服务')
    return service
  }

  /** Map one raw history record list, restoring tool names on results. */
  mapRecords(records) {
    const output = []
    const toolNames = new Map()
    for (const record of Array.isArray(records) ? records : []) {
      const event = record?.event ?? record
      const mapped = mapWireEvent(event)
      if (mapped === undefined) continue
      if (mapped.kind === 'tool-call' && mapped.callId.length > 0) toolNames.set(mapped.callId, mapped.name)
      if (mapped.kind === 'tool-result' && mapped.name.length === 0 && toolNames.has(mapped.callId)) {
        mapped.name = toolNames.get(mapped.callId)
      }
      output.push(mapped)
    }
    return output
  }

  /** Read one session's passive state. */
  async sessionState(sessionId, signal) {
    const state = await this.requireSessions().state({ sessionId }, signal)
    return mapSessionState(state)
  }

  /** Local `device.info`. */
  async deviceInfo() {
    const workspaces = this.workspaceItems()
    return {
      deviceId: this.config?.deviceId ?? '',
      name: this.config?.deviceName ?? defaultDeviceName(),
      platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      version: VERSION,
      dshVersion: '0.2.2-rc.1',
      time: Date.now(),
      workspaceDefault: this.remoteWorkspaceItems()[0]?.path ?? null,
      capabilities: ['sessions', 'speech'],
      speech: this.speechStatus(),
      workspaceCount: workspaces.length,
    }
  }

  /** Local workspace service rows. */
  workspaces() {
    try {
      const registry = this.service('workspaceRegistry')
      if (registry === undefined) return []
      const list = registry.list()
      return (Array.isArray(list) ? list : [])
        .filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string')
        .map((item) => ({
          workspaceId: item.id,
          title: typeof item.title === 'string' ? item.title : item.path ?? item.id,
          path: typeof item.path === 'string' ? item.path : '',
        }))
    } catch {
      return []
    }
  }

  /** Workspace list result. */
  workspaceItems() {
    return this.workspaces()
  }

  /** Fold log-backed titles for sessions whose summary carried none. */
  async titlesFor(sessionIds) {
    const output = new Map()
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) return output
    const query = this.service('sessionQuery')
    if (query === undefined || typeof query.readTitleSnapshots !== 'function') return output
    try {
      const rows = await query.readTitleSnapshots(sessionIds, AbortSignal.timeout(15_000))
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.status !== 'fulfilled') continue
        const title = row.value?.title?.title
        if (typeof title === 'string' && title.trim().length > 0) output.set(row.sessionId, truncate(title.trim(), 200))
      }
    } catch {
      // titles are cosmetic; the list still renders without them
    }
    return output
  }

  /** Map a session list, filling missing titles from the log-backed folder. */
  async sessionList() {
    const service = this.requireSessions()
    const result = await service.list({}, AbortSignal.timeout(20_000))
    const items = Array.isArray(result?.items) ? result.items : []
    const mapped = items
      .map(mapSessionSummary)
      .filter((item) => item !== undefined)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 100)
    const missing = mapped.filter((item) => item.title.length === 0).map((item) => item.sessionId)
    if (missing.length > 0) {
      const titles = await this.titlesFor(missing)
      for (const item of mapped) {
        if (item.title.length === 0 && titles.has(item.sessionId)) item.title = titles.get(item.sessionId)
      }
    }
    return mapped
  }

  /** Read a session page plus state. */
  async sessionHistory(sessionId, maxMessages = 60, signal) {
    this.requireSessionId(sessionId)
    const service = this.requireSessions()
    const budget = clampInt(maxMessages, 1, 200, 60)
    const page = await service.events({
      address: { kind: 'session', sessionId },
      maxMessages: budget,
    }, signal ?? AbortSignal.timeout(20_000))
    const records = this.mapRecords(page?.records).slice(-budget)
    const state = await this.sessionState(sessionId, signal).catch(() => mapSessionState(undefined))
    let title = titleOfRecords(page?.records)
    if (title.length === 0) {
      const titles = await this.titlesFor([sessionId])
      title = titles.get(sessionId) ?? ''
    }
    return {
      records,
      cursor: Number.isFinite(page?.cursor) ? page.cursor : records.length > 0 ? records[records.length - 1].seq : -1,
      hasMore: page?.hasMore === true,
      state,
      title,
    }
  }

  /** Validate a session id string. */
  requireSessionId(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new LinkError('bad-request', '缺少 sessionId')
    }
    return value.trim()
  }

  /** Create a session. */
  async sessionCreate(params) {
    const service = this.requireSessions()
    const request = {}
    if (typeof params?.workspaceId === 'string' && params.workspaceId.length > 0) request.workspaceId = params.workspaceId
    if (typeof params?.cwd === 'string' && params.cwd.length > 0) request.cwd = params.cwd
    if (typeof params?.agentPreset === 'string' && params.agentPreset.length > 0) request.agentPreset = params.agentPreset
    const result = await service.create(request)
    if (typeof result?.sessionId !== 'string') throw new LinkError('internal', '创建会话失败')
    return { sessionId: result.sessionId }
  }

  /** Admit one prompt. */
  async sessionPrompt(params, signal) {
    const sessionId = this.requireSessionId(params?.sessionId)
    const text = typeof params?.text === 'string' ? params.text : ''
    if (text.trim().length === 0) throw new LinkError('bad-request', '消息内容不能为空')
    const mode = params?.mode === 'steer' ? 'steer' : 'queue'
    await this.requireSessions().prompt({
      requestId: randomUUID(),
      sessionId,
      mode,
      content: [{ type: 'text', text: text.slice(0, 200_000) }],
    }, signal ?? AbortSignal.timeout(RPC_TIMEOUT_MS))
    return { accepted: true }
  }

  /** Cancel an active turn. */
  async sessionCancel(params) {
    const sessionId = this.requireSessionId(params?.sessionId)
    await this.requireSessions().cancel({ sessionId })
    return { accepted: true }
  }

  /** Rename a session. */
  async sessionRename(params) {
    const sessionId = this.requireSessionId(params?.sessionId)
    const title = typeof params?.title === 'string' ? params.title.trim() : ''
    if (title.length === 0) throw new LinkError('bad-request', '标题不能为空')
    const result = await this.requireSessions().rename({ sessionId, title: title.slice(0, 200) })
    return { title: typeof result?.title === 'string' ? result.title : title }
  }

  /** Async iterator for one followed session. */
  async *followSession(sessionId, signal) {
    const service = this.requireSessions()
    const request = {
      address: { kind: 'session', sessionId },
      activate: false,
      assistantStream: true,
      maxMessages: FOLLOW_MAX_MESSAGES,
      turnWindow: { minMessages: 12, minTurns: 2 },
    }
    let snapshotSent = false
    let lastStateAt = 0
    const toolNames = new Map()
    const foldedTitles = await this.titlesFor([sessionId])
    const foldedTitle = foldedTitles.get(sessionId) ?? ''
    yield { t: 'ready', sessionId, title: foldedTitle }
    const stream = service.follow(request, signal)
    for await (const frame of stream) {
      if (frame === null || typeof frame !== 'object') continue
      if (frame.type === 'snapshot') {
        const records = this.mapRecords(frame.records).slice(-FOLLOW_MAX_MESSAGES)
        const state = await this.sessionState(sessionId, signal).catch(() => mapSessionState(undefined))
        lastStateAt = Date.now()
        let title = titleOfRecords(frame.records)
        if (title.length === 0 && frame.projections !== null && typeof frame.projections === 'object') {
          const value = frame.projections.values?.title
          if (typeof value === 'string' && value.trim().length > 0) title = value.trim()
        }
        if (title.length === 0) title = foldedTitle
        yield {
          t: 'snapshot',
          records,
          cursor: Number.isFinite(frame.cursor) ? frame.cursor : -1,
          state,
          ...(frame.assistantStream !== null && typeof frame.assistantStream === 'object' ? { assistantStream: frame.assistantStream } : {}),
        }
        if (title.length > 0) yield { t: 'title', title }
        snapshotSent = true
        continue
      }
      if (frame.type === 'assistant-stream') {
        yield { t: 'assistant-stream', frame: frame.frame }
        continue
      }
      if (frame.type !== 'event') continue
      const record = mapWireEvent(frame.event)
      if (record !== undefined) {
        if (record.kind === 'tool-call' && record.callId.length > 0) toolNames.set(record.callId, record.name)
        if (record.kind === 'tool-result' && record.name.length === 0 && toolNames.has(record.callId)) {
          record.name = toolNames.get(record.callId)
        }
        yield { t: 'record', record }
      }
      const terminal = record !== undefined && (record.kind === 'turn-start' || record.kind === 'turn-end' || record.kind === 'tool-result')
      if (!snapshotSent || terminal || Date.now() - lastStateAt >= 10_000) {
        const state = await this.sessionState(sessionId, signal).catch(() => mapSessionState(undefined))
        lastStateAt = Date.now()
        yield { t: 'state', state }
      }
    }
  }

  /** Ask the local speech provider to load its model in the background. */
  warmSpeech() {
    if (this.speechWarmed) return
    this.speechWarmed = true
    try {
      const service = this.service('speechToText')
      if (service === undefined) return
      const snapshot = service.snapshot()
      const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : []
      if (providers.length === 0) return
      const selected = providers.find((provider) => provider.id === snapshot?.selection?.providerId) ?? providers[0]
      if (!SPEECH_READY_PHASES.has(selected?.preparation?.phase)) service.prepare(selected.id)
    } catch {
      // warm-up is best-effort; the real transcribe path still reports errors
    }
  }

  /** Speech provider snapshot for device.info/status. */
  speechStatus() {
    try {
      this.warmSpeech()
      const service = this.service('speechToText')
      if (service === undefined) return { available: false, phase: 'unavailable', providers: [], language: '' }
      const snapshot = service.snapshot()
      const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : []
      const selectedId = snapshot?.selection?.providerId
      const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0]
      return {
        available: providers.length > 0,
        phase: typeof selected?.preparation?.phase === 'string' ? selected.preparation.phase : 'unknown',
        providers: providers.map((provider) => ({
          id: String(provider.id),
          name: typeof provider.name === 'string' ? provider.name : String(provider.id),
          languages: Array.isArray(provider.languages) ? provider.languages.filter((item) => typeof item === 'string') : [],
        })),
        language: typeof snapshot?.selection?.language === 'string' ? snapshot.selection.language : '',
      }
    } catch (error) {
      return { available: false, phase: 'error', providers: [], language: '', message: errorMessage(error) }
    }
  }

  /** Ensure the selected local speech provider is ready. */
  async ensureSpeechReady(signal) {
    const service = this.service('speechToText')
    if (service === undefined) throw new LinkError('unavailable', '本机没有加载语音识别服务')
    const snapshot = service.snapshot()
    const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : []
    if (providers.length === 0) throw new LinkError('unavailable', '本机没有可用的语音识别插件')
    let selected = providers.find((provider) => provider.id === snapshot?.selection?.providerId) ?? providers[0]
    const phase = selected?.preparation?.phase
    if (SPEECH_READY_PHASES.has(phase)) return { service, provider: selected, selection: snapshot.selection }
    try {
      service.prepare(selected.id)
    } catch (error) {
      // another caller may own preparation already
      this.log('warn', `dsh-link: speech prepare: ${errorMessage(error)}`)
    }
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await sleep(300)
      if (signal?.aborted === true) throw new LinkError('bad-request', '语音识别已取消')
      const current = service.snapshot()
      const providersNow = Array.isArray(current?.providers) ? current.providers : []
      selected = providersNow.find((provider) => provider.id === selected.id) ?? providersNow[0]
      const currentPhase = selected?.preparation?.phase
      if (SPEECH_READY_PHASES.has(currentPhase)) {
        return { service, provider: selected, selection: current.selection }
      }
      if (currentPhase === 'failed' || currentPhase === 'cancelled') {
        throw new LinkError('unavailable', `语音模型准备失败：${selected?.preparation?.message ?? currentPhase}`)
      }
    }
    throw new LinkError('timeout', '语音模型准备超时（120 秒）')
  }

  /** Transcribe one WAV recording with the local DSH speech plugin. */
  async speechTranscribe(params, signal) {
    let base64 = typeof params?.audioBase64 === 'string' ? params.audioBase64 : ''
    if (base64.length === 0) throw new LinkError('bad-request', '缺少 audioBase64')
    const comma = base64.indexOf(',')
    if (base64.startsWith('data:') && comma >= 0) base64 = base64.slice(comma + 1)
    let audio
    try {
      audio = Buffer.from(base64, 'base64')
    } catch {
      throw new LinkError('bad-request', 'audioBase64 不是合法的 base64')
    }
    if (audio.byteLength > MAX_AUDIO_BYTES) throw new LinkError('bad-request', '录音超过 4 MiB，请缩短录音')
    inspectWav(audio)
    const ready = await this.ensureSpeechReady(signal)
    const requested = typeof params?.language === 'string' && params.language.trim().length > 0
      ? params.language.trim()
      : ready.selection?.language
    const language = PROVIDER_LANGUAGES.has(requested) ? requested : 'auto'
    const spec = ready.service.resolve({
      audio: new Uint8Array(audio),
      providerId: ready.provider.id,
      language,
    })
    const transcript = await ready.service.transcribe(spec, signal ?? AbortSignal.timeout(120_000))
    return {
      text: typeof transcript?.text === 'string' ? transcript.text : '',
      audioSeconds: Number.isFinite(transcript?.audioSeconds) ? transcript.audioSeconds : 0,
      inferenceSeconds: Number.isFinite(transcript?.inferenceSeconds) ? transcript.inferenceSeconds : 0,
      provider: String(ready.provider.id),
    }
  }

  /* ----------------------------- native mirrors --------------------------- */

  /** Absolute path of the mirror mapping document. */
  mirrorStoreFile() {
    return join(dataDir(), 'mirrors.json')
  }

  /** Directory that owns one remote device's mirrored Sessions. */
  mirrorDirFor(deviceId) {
    return join(dataDir(), 'mirrors', String(deviceId).replace(/[^A-Za-z0-9_.-]/gu, '_'))
  }

  /** Whether a path is inside this plugin's mirror workspaces. */
  isMirrorPath(value) {
    const root = join(dataDir(), 'mirrors')
    return typeof value === 'string' && (value === root || value.startsWith(`${root}${sep}`))
  }

  /** Workspace rows that another Host may see (mirror groups stay local). */
  remoteWorkspaceItems() {
    return this.workspaceItems().filter((item) => !this.isMirrorPath(item.path))
  }

  /** Session rows that another Host may see (mirror Sessions stay local). */
  async remoteSessionList() {
    return (await this.sessionList()).filter((item) => !this.isMirrorPath(item.cwd))
  }

  /** Stable local Session id for one remote Session. */
  localMirrorId(deviceId, remoteSessionId) {
    return `session-dshlink-${createHash('sha1').update(`${deviceId}:${remoteSessionId}`).digest('hex').slice(0, 16)}`
  }

  /** Read the durable mirror mapping; malformed files become empty. */
  readMirrorStore() {
    try {
      const parsed = JSON.parse(readFileSync(this.mirrorStoreFile(), 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || typeof parsed.devices !== 'object' || parsed.devices === null) {
        return { version: MIRROR_STORE_VERSION, devices: {} }
      }
      return { version: Number.isFinite(parsed.version) ? parsed.version : 1, devices: parsed.devices }
    } catch {
      return { version: MIRROR_STORE_VERSION, devices: {} }
    }
  }

  /** Upgrade the v1 device-level mirror layout to v2 project-level workspaces. */
  async migrateMirrors() {
    if ((this.mirrors.version ?? 1) >= MIRROR_STORE_VERSION) return
    const registry = this.service('workspaceRegistry')
    for (const device of Object.values(this.mirrors.devices ?? {})) {
      for (const entry of Object.values(device.sessions ?? {})) {
        if (registry !== undefined && typeof entry.localId === 'string') {
          try {
            await registry.archiveSession(entry.localId, { stopActivity: true })
          } catch {
            // already archived or gone
          }
        }
      }
      if (registry !== undefined && typeof device.workspaceId === 'string') {
        try {
          await registry.delete(device.workspaceId)
        } catch {
          // already gone
        }
      }
      device.workspaces = {}
      device.sessions = {}
      delete device.workspaceId
      delete device.workspacePath
    }
    this.mirrors.version = MIRROR_STORE_VERSION
    this.saveMirrorStore()
    this.log('info', 'dsh-link: upgraded mirror layout to per-project workspaces')
  }

  /** Atomically persist the mirror mapping with mode 0600. */
  saveMirrorStore() {
    try {
      mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
      const target = this.mirrorStoreFile()
      const temporary = `${target}.${process.pid}.tmp`
      writeFileSync(temporary, JSON.stringify(this.mirrors, null, 2), { mode: 0o600 })
      chmodSync(temporary, 0o600)
      renameSync(temporary, target)
    } catch (error) {
      this.log('warn', `dsh-link: mirror store write failed: ${errorMessage(error)}`)
    }
  }

  /** Find the device and entry that own one local mirror Session. */
  mirrorForLocal(localSessionId) {
    for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
      for (const [remoteSessionId, entry] of Object.entries(device.sessions ?? {})) {
        if (entry?.localId === localSessionId) return { deviceId, device, remoteSessionId, entry }
      }
    }
    return undefined
  }

  /** Find one remote Session's mirror entry. */
  mirrorForRemote(deviceId, remoteSessionId) {
    const device = this.mirrors.devices?.[deviceId]
    const entry = device?.sessions?.[remoteSessionId]
    if (device === undefined || entry === undefined) return undefined
    return { deviceId, device, remoteSessionId, entry }
  }

  /** Defer one peer mirror sync shortly; coalesces presence bursts. */
  scheduleMirrorSync() {
    if (this.mirrorSyncTimer !== undefined) return
    this.mirrorSyncTimer = setTimeout(() => {
      this.mirrorSyncTimer = undefined
      void this.syncMirrors()
    }, 2_000)
    this.mirrorSyncTimer.unref?.()
  }

  /** Re-list peers periodically while the relay is connected. */
  startMirrorTimer() {
    clearInterval(this.mirrorTimer)
    this.mirrorTimer = setInterval(() => {
      if (this.relay?.state === 'connected') this.scheduleMirrorSync()
    }, MIRROR_SYNC_INTERVAL_MS)
    this.mirrorTimer.unref?.()
  }

  /** Reattach known mirrors and archive local Sessions stranded in mirror dirs. */
  async repairMirrorSessions() {
    const registry = this.service('workspaceRegistry')
    if (registry === undefined) return
    for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
      for (const [remoteSessionId, entry] of Object.entries(device.sessions ?? {})) {
        if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') continue
        if (typeof entry.workspaceId !== 'string') continue
        const mapping = device.workspaces?.[entry.workspaceId]
        if (typeof mapping?.localWorkspaceId !== 'string') continue
        const workspace = registry.get(mapping.localWorkspaceId)
        if (workspace !== undefined) await workspace.attachSession(entry.localId).catch(() => {})
      }
    }
    const root = join(dataDir(), 'mirrors')
    let list
    try {
      list = await this.sessionList()
    } catch {
      return
    }
    for (const item of Array.isArray(list) ? list : []) {
      if (item === null || typeof item !== 'object' || typeof item.sessionId !== 'string' || typeof item.cwd !== 'string') continue
      if (!item.cwd.startsWith(`${root}${sep}`)) continue
      if (this.mirrorForLocal(item.sessionId) !== undefined) continue
      await registry.archiveSession(item.sessionId, { stopActivity: true }).catch(() => {})
    }
  }

  /** Hide projected Workspaces of peers that are no longer online. */
  async pruneOfflinePeerWorkspaces() {
    const online = new Set(this.peers.map((peer) => peer.id))
    const registry = this.service('workspaceRegistry')
    let changed = false
    for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
      if (online.has(deviceId)) continue
      // Keep the Session mapping: it owns the local mirror id and the last
      // archive direction. Dropping it made every reconnect mint a fresh,
      // unarchived copy of every remote Session, so archived rows came back.
      for (const entry of Object.values(device.sessions ?? {})) {
        if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') continue
        entry.offlineHidden = true
        if (registry !== undefined) {
          try {
            await registry.archiveSession(entry.localId, { stopActivity: true })
          } catch {
            // already archived or gone
          }
        }
      }
      const mappings = Object.values(device.workspaces ?? {})
      for (const mapping of mappings) {
        const workspaceId = mapping?.localWorkspaceId
        if (typeof workspaceId !== 'string' || workspaceId.length === 0) continue
        if (registry !== undefined) {
          try {
            await registry.delete(workspaceId)
          } catch {
            // already gone
          }
        }
      }
      device.workspaces = {}
      changed = true
    }
    if (changed) this.saveMirrorStore()
  }

  /** Fast archive-only poll, independent of model synchronization. */
  startArchiveTimer() {
    clearInterval(this.archiveTimer)
    this.archiveTimer = setInterval(() => {
      if (this.relay?.state === 'connected') void this.syncPeerArchives()
    }, 3_000)
    this.archiveTimer.unref?.()
  }

  /** Push or pull archive changes for every online mirror. */
  async syncPeerArchives() {
    if (this.archiveSyncing || this.relay === undefined || this.relay.state !== 'connected') return
    if (this.service('workspaceController') === undefined) return
    this.archiveSyncing = true
    try {
      const local = await this.workspaceSnapshot().catch(() => null)
      const localSet = new Set(Array.isArray(local?.archivedSessionIds) ? local.archivedSessionIds : [])
      for (const peer of [...this.peers]) {
        const device = this.mirrors.devices?.[peer.id]
        if (device === undefined) continue
        let remoteSet
        try {
          const snapshot = await this.remoteCall(peer.id, 'workspace.snapshot', {}, 10_000)
          remoteSet = new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : [])
        } catch (error) {
          this.lastArchiveError = `snapshot ${peer.id}: ${errorMessage(error)}`
          continue
        }
        for (const [remoteId, entry] of Object.entries(device.sessions ?? {})) {
          await this.syncOneMirrorArchive(peer, remoteId, entry, localSet, remoteSet)
        }
      }
    } finally {
      this.archiveSyncing = false
    }
  }

  /** Apply one mirror's persisted archive direction. A real user change wins. */
  async syncOneMirrorArchive(peer, remoteId, entry, localArchived, remoteArchived) {
    if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') return
    if (typeof localArchived?.has !== 'function' || typeof remoteArchived?.has !== 'function') return
    // Hidden because the peer is offline: the plugin archived it, not the user.
    if (entry.offlineHidden === true) return
    const localId = entry.localId
    const localNow = localArchived.has(localId)
    const remoteNow = remoteArchived.has(remoteId)
    const previousLocal = typeof entry.archiveLocal === 'boolean' ? entry.archiveLocal : undefined
    const previousRemote = typeof entry.archiveRemote === 'boolean' ? entry.archiveRemote : undefined
    const known = previousLocal !== undefined && previousRemote !== undefined
    let next
    if (!known) {
      // Archiving is an explicit intent, so an archived side wins on first sight.
      const archived = localNow || remoteNow
      next = { local: archived, remote: archived }
    } else {
      const localChanged = localNow !== previousLocal
      const remoteChanged = remoteNow !== previousRemote
      if (localChanged && !remoteChanged) next = { local: localNow, remote: localNow }
      else if (remoteChanged && !localChanged) next = { local: remoteNow, remote: remoteNow }
      else if (localChanged && remoteChanged) next = { local: localNow, remote: localNow }
      else next = { local: localNow, remote: remoteNow }
    }
    try {
      if (next.local !== localNow) await this.applyMirrorArchive(localId, next.local)
      if (next.remote !== remoteNow) await this.remoteCall(peer.id, next.remote ? 'session.archive' : 'session.unarchive', { sessionId: remoteId }, 15_000)
      if (entry.archiveLocal !== next.local || entry.archiveRemote !== next.remote) {
        entry.archiveLocal = next.local
        entry.archiveRemote = next.remote
        this.mirrorArchiveStates.set(localId, next)
        this.saveMirrorStore()
      }
    } catch (error) {
      this.lastArchiveError = `sync ${remoteId}: ${errorMessage(error)}`
      this.log('warn', `dsh-link: mirror archive sync ${remoteId}: ${errorMessage(error)}`)
    }
  }

  /** Poll archive/model state for online mirrors. */
  startPeerStateTimer() {
    clearInterval(this.peerStateTimer)
    this.peerStateTimer = setInterval(() => {
      if (this.relay?.state === 'connected') void this.syncPeerState()
    }, 5_000)
    this.peerStateTimer.unref?.()
  }

  /** Mirror the recent Sessions of every online peer. */
  async syncMirrors() {
    if (this.mirrorSyncing || this.relay === undefined || this.relay.state !== 'connected') return
    this.mirrorSyncing = true
    try {
      for (const peer of [...this.peers]) {
        try {
          await this.syncPeerMirrors(peer)
        } catch (error) {
          this.log('warn', `dsh-link: mirror sync ${peer.name ?? peer.id}: ${errorMessage(error)}`)
        }
      }
      await this.pruneOfflinePeerWorkspaces()
      this.saveMirrorStore()
    } finally {
      this.mirrorSyncing = false
    }
  }

  /** Rename one mirror when the remote title changed. */
  async renameMirror(session, entry, title) {
    const next = typeof title === 'string' ? title.trim() : ''
    if (next.length === 0) return
    const service = this.service('sessionTitle')
    if (service === undefined) return
    let current = entry.title
    try {
      current = service.get(session)?.title ?? current
    } catch {
      // fall back to the stored title
    }
    if (next === current) {
      entry.title = next
      return
    }
    try {
      await service.rename(session, next)
      entry.title = next
    } catch {
      // a cold or disposed session cannot be renamed now
    }
  }

  /** Append newly committed remote history to one live mirror Session. */
  async syncMirrorHistory(peer, entry, remoteSessionId) {
    const session = this.service('sessions')?.get(entry.localId)
    if (session === undefined) return
    const history = await this.remoteCall(peer.id, 'session.history', {
      sessionId: remoteSessionId,
      maxMessages: 60,
    }, 30_000)
    const records = (Array.isArray(history?.records) ? history.records : [])
      .filter((record) => record !== null && typeof record === 'object' && Number.isFinite(record.seq) && record.seq > (entry.remoteSeq ?? -1))
    if (records.length > 0) {
      const appended = this.appendMirrorRecords(entry, records)
      if (appended.length > 0) {
        entry.remoteSeq = appended[appended.length - 1].seq
        this.saveMirrorStore()
      }
    }
    if (typeof history?.title === 'string' && history.title.length > 0) {
      await this.renameMirror(session, entry, history.title)
    }
  }

  /** Highest local Turn number already committed to one mirror Session. */
  mirrorLastTurn(session) {
    let last = 0
    for (const event of session.snapshotEvents()) {
      if (event.type === 'turn/start' && Number.isFinite(event.data?.turn)) last = Math.max(last, event.data.turn)
    }
    return last
  }

  /** Lazily create the remote→local Turn/Step cursor of one mirror entry. */
  mirrorCursor(entry) {
    if (entry.mirrorCursor === null || typeof entry.mirrorCursor !== 'object') entry.mirrorCursor = {}
    const cursor = entry.mirrorCursor
    if (!Number.isFinite(cursor.localTurn)) cursor.localTurn = 0
    if (!Number.isFinite(cursor.localStep)) cursor.localStep = 0
    if (typeof cursor.turnOpen !== 'boolean') cursor.turnOpen = false
    if (typeof cursor.stepOpen !== 'boolean') cursor.stepOpen = false
    return cursor
  }

  /** Close the open local Step of one mirror cursor. */
  closeMirrorStep(session, cursor) {
    if (cursor.stepOpen !== true) return
    session.append('step/end', { turn: cursor.localTurn, step: cursor.localStep })
    cursor.stepOpen = false
  }

  /** Close the open local Turn of one mirror cursor. */
  closeMirrorTurn(session, cursor, reason = 'completed') {
    this.closeMirrorStep(session, cursor)
    if (cursor.turnOpen !== true) return
    session.append('turn/end', { turn: cursor.localTurn, reason: { kind: reason } })
    cursor.turnOpen = false
  }

  /** Open the next local Turn that represents one remote Turn. */
  openMirrorTurn(session, cursor, remoteTurn) {
    this.closeMirrorTurn(session, cursor)
    cursor.localTurn = this.mirrorLastTurn(session) + 1
    cursor.remoteTurn = Number.isFinite(remoteTurn) ? remoteTurn : cursor.remoteTurn
    cursor.localStep = 0
    cursor.remoteStep = undefined
    session.append('turn/start', { turn: cursor.localTurn })
    cursor.turnOpen = true
  }

  /** Translate remote turn/step coordinates to open local boundaries. */
  ensureMirrorStep(session, cursor, remoteTurn, remoteStep) {
    const turn = Number.isFinite(remoteTurn) ? remoteTurn : cursor.remoteTurn
    if (cursor.turnOpen !== true || cursor.remoteTurn !== turn) this.openMirrorTurn(session, cursor, turn)
    if (!Number.isFinite(remoteStep)) return { turn: cursor.localTurn, step: cursor.localStep }
    if (cursor.stepOpen !== true || cursor.remoteStep !== remoteStep) {
      this.closeMirrorStep(session, cursor)
      cursor.localStep += 1
      cursor.remoteStep = remoteStep
      session.append('step/start', { turn: cursor.localTurn, step: cursor.localStep })
      cursor.stepOpen = true
    }
    return { turn: cursor.localTurn, step: cursor.localStep }
  }

  /** Append compact protocol records to one local mirror Session. */
  appendMirrorRecords(entry, records) {
    const session = this.service('sessions')?.get(entry.localId)
    if (session === undefined) return []
    const cursor = this.mirrorCursor(entry)
    const pending = Array.isArray(entry.pendingUserTexts) ? entry.pendingUserTexts : []
    if (entry.toolCallSeqs === null || typeof entry.toolCallSeqs !== 'object') entry.toolCallSeqs = {}
    const appended = []
    for (const record of records) {
      try {
        if (record.kind === 'user') {
          const text = typeof record.text === 'string' ? record.text : ''
          const pendingIndex = pending.findIndex((item) => item === text)
          if (pendingIndex >= 0) {
            pending.splice(pendingIndex, 1)
            appended.push(record)
            continue
          }
          if (cursor.turnOpen !== true) this.openMirrorTurn(session, cursor, cursor.remoteTurn)
          session.append('user/message', {
            id: randomUUID(),
            role: 'user',
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }, { surfaceOp: 'append' })
          appended.push(record)
          continue
        }
        if (record.kind === 'turn-start') {
          const remoteTurn = Number.isFinite(record.turn) ? record.turn : cursor.remoteTurn
          if (cursor.turnOpen !== true || cursor.remoteTurn !== remoteTurn) this.openMirrorTurn(session, cursor, remoteTurn)
          appended.push(record)
          continue
        }
        if (record.kind === 'turn-end') {
          const reason = record.reason === 'completed' ? 'completed' : record.reason === 'aborted' ? 'aborted' : record.reason === 'error' ? 'error' : 'completed'
          this.closeMirrorTurn(session, cursor, reason)
          appended.push(record)
          continue
        }
        // Older Hosts omit turn/step on message and tool records; keep one
        // inferred Step per Turn so these still render as native tool cards.
        const remoteTurn = Number.isFinite(record.turn) ? record.turn : cursor.remoteTurn
        const remoteStep = Number.isFinite(record.step) ? record.step : (cursor.remoteStep ?? 1)
        const coordinates = this.ensureMirrorStep(session, cursor, remoteTurn, remoteStep)
        if (record.kind === 'assistant') {
          const content = []
          if (typeof record.reasoning === 'string' && record.reasoning.length > 0) content.push({ type: 'reasoning', text: record.reasoning })
          if (typeof record.text === 'string' && record.text.length > 0) content.push({ type: 'text', text: record.text })
          if (content.length === 0) content.push({ type: 'text', text: '（远程助手没有返回可显示内容）' })
          const committed = session.append('assistant/message', {
            turn: coordinates.turn,
            step: coordinates.step,
            message: {
              id: randomUUID(),
              role: 'assistant',
              content,
              source: { kind: 'model', provider: 'dsh-link', model: 'remote' },
            },
            stream: [],
          }, { surfaceOp: 'append' })
          entry.lastCommittedAssistant = {
            seq: Number.isFinite(committed?.seq) ? committed.seq : undefined,
            turn: coordinates.turn,
            step: coordinates.step,
          }
        } else if (record.kind === 'tool-call') {
          const call = session.append('tool/call', {
            turn: coordinates.turn,
            step: coordinates.step,
            callId: record.callId,
            name: record.name || 'tool',
            arguments: record.args || '{}',
          })
          if (record.callId.length > 0 && Number.isFinite(call?.seq)) {
            entry.toolCallSeqs[record.callId] = call.seq
            const callIds = Object.keys(entry.toolCallSeqs)
            if (callIds.length > 400) for (const old of callIds.slice(0, callIds.length - 400)) delete entry.toolCallSeqs[old]
          }
        } else if (record.kind === 'tool-result') {
          const callSeq = record.callId.length > 0 ? entry.toolCallSeqs[record.callId] : undefined
          const message = {
            id: randomUUID(),
            role: 'tool',
            source: { kind: 'tool', callId: record.callId },
            toolCallId: record.callId,
            content: [{ type: 'text', text: typeof record.text === 'string' ? record.text : '' }],
          }
          if (record.isError === true) message.isError = true
          session.append('tool/result', {
            turn: coordinates.turn,
            step: coordinates.step,
            message,
          }, {
            surfaceOp: 'append',
            ...(Number.isFinite(callSeq) ? { sourceEventSeqs: [callSeq] } : {}),
          })
        } else {
          session.append('assistant/message', {
            turn: coordinates.turn,
            step: coordinates.step,
            message: {
              id: randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: `⚠️ 远程错误：${record.message || ''}` }],
              source: { kind: 'model', provider: 'dsh-link', model: 'remote' },
            },
            stream: [],
          }, { surfaceOp: 'append' })
        }
        appended.push(record)
      } catch (error) {
        this.log('warn', `dsh-link: mirror append ${entry.localId}: ${errorMessage(error)}`)
        break
      }
    }
    entry.pendingUserTexts = pending
    return appended
  }

  /** Lazily create the live assistant-stream state of one mirror entry. */
  mirrorStream(entry) {
    if (entry.mirrorStream === null || typeof entry.mirrorStream !== 'object') {
      entry.mirrorStream = { revision: 0, attemptId: undefined, started: false, turn: 0, step: 0 }
    }
    const stream = entry.mirrorStream
    if (!Number.isFinite(stream.revision)) stream.revision = 0
    if (typeof stream.started !== 'boolean') stream.started = false
    if (!Number.isFinite(stream.turn)) stream.turn = 0
    if (!Number.isFinite(stream.step)) stream.step = 0
    return stream
  }

  /**
   * Publish one transient assistant frame to this Host's UI. The frame is
   * process-local presentation data: it is never appended to the Session log,
   * exactly like a local Agent's own live chunks.
   */
  emitMirrorAssistantFrame(entry, session, frame) {
    this.noteMirrorStreamFrame(entry, frame)
    if (typeof this.ctx?.emit !== 'function') return
    try {
      this.ctx.emit('agent/assistant-stream', { agent: { id: session.id, session }, frame })
    } catch (error) {
      this.log('warn', `dsh-link: mirror stream ${entry.localId}: ${errorMessage(error)}`)
    }
  }

  /** Record one received stream frame for diagnostics without touching the log. */
  noteMirrorStreamFrame(entry, frame) {
    const stats = this.mirrorStreamStats.get(entry.localId) ?? { frames: 0, chunks: 0, lastAt: 0, lastType: '', attemptId: '' }
    stats.frames += 1
    if (frame.type === 'chunk') stats.chunks += 1
    stats.lastAt = Date.now()
    stats.lastType = String(frame.type)
    stats.attemptId = typeof frame.attemptId === 'string' ? frame.attemptId : ''
    this.mirrorStreamStats.set(entry.localId, stats)
  }

  /** Begin one live assistant attempt on the local mirror Session. */
  publishMirrorAssistantStart(entry, session, attempt) {
    const stream = this.mirrorStream(entry)
    const cursor = this.mirrorCursor(entry)
    const coordinates = this.ensureMirrorStep(session, cursor, attempt.turn, attempt.step)
    stream.attemptId = typeof attempt.attemptId === 'string' ? attempt.attemptId : undefined
    stream.started = true
    stream.turn = coordinates.turn
    stream.step = coordinates.step
    stream.revision += 1
    this.emitMirrorAssistantFrame(entry, session, {
      type: 'start',
      attemptId: stream.attemptId,
      revision: stream.revision,
      turn: coordinates.turn,
      step: coordinates.step,
    })
    this.saveMirrorStore()
  }

  /** Publish one transient chunk of the active mirror attempt. */
  publishMirrorAssistantChunk(entry, session, frame) {
    const stream = this.mirrorStream(entry)
    if (stream.started !== true || stream.attemptId !== frame.attemptId) return
    stream.revision += 1
    this.emitMirrorAssistantFrame(entry, session, {
      type: 'chunk',
      attemptId: frame.attemptId,
      revision: stream.revision,
      index: frame.index,
      time: frame.time,
      chunk: frame.chunk,
    })
  }

  /** Settle the active mirror attempt against its durable local message. */
  publishMirrorAssistantEnd(entry, session, frame) {
    const stream = this.mirrorStream(entry)
    if (stream.attemptId !== frame.attemptId) return
    let outcome = frame.outcome
    if (outcome !== null && typeof outcome === 'object' && outcome.kind === 'committed') {
      const committed = entry.lastCommittedAssistant
      const matches = committed !== null && typeof committed === 'object'
        && Number.isFinite(committed.seq)
        && committed.turn === stream.turn
        && committed.step === stream.step
      outcome = outcome.eventType === 'assistant/message' && matches
        ? { kind: 'committed', eventType: 'assistant/message', seq: committed.seq }
        : { kind: 'abandoned' }
    }
    stream.revision += 1
    this.emitMirrorAssistantFrame(entry, session, {
      type: 'end',
      attemptId: frame.attemptId,
      revision: stream.revision,
      index: frame.index,
      outcome,
    })
    stream.started = false
    stream.attemptId = undefined
    this.saveMirrorStore()
  }

  /** Replay the opening assistant-stream baseline of one remote follow. */
  publishMirrorAssistantBaseline(entry, session, baseline) {
    if (baseline === null || typeof baseline !== 'object') return
    const stream = this.mirrorStream(entry)
    stream.started = false
    stream.attemptId = undefined
    const attempt = baseline.activeAttempt
    if (attempt === null || typeof attempt !== 'object') return
    this.publishMirrorAssistantStart(entry, session, attempt)
    const members = Array.isArray(attempt.stream) ? attempt.stream : []
    const limit = Number.isFinite(attempt.nextIndex) ? Math.min(attempt.nextIndex, members.length) : members.length
    for (let index = 0; index < limit; index += 1) {
      const member = members[index]
      if (member === null || typeof member !== 'object') continue
      this.publishMirrorAssistantChunk(entry, session, {
        attemptId: attempt.attemptId,
        index,
        time: member.time,
        chunk: member.chunk,
      })
    }
  }

  /** Subscribe to one remote Session while its native mirror is open. */
  watchMirror(localSessionId) {
    const found = this.mirrorForLocal(localSessionId)
    if (found === undefined) return { watching: false }
    this.unwatchMirror(localSessionId)
    const { deviceId, device, remoteSessionId, entry } = found
    void this.syncMirrorHistory({ id: deviceId, name: device.name }, entry, remoteSessionId).catch(() => {})
    let subscription
    try {
      subscription = this.remoteSubscribe(deviceId, 'session.follow', { sessionId: remoteSessionId }, {
        onEvent: (data) => {
          if (data === null || typeof data !== 'object') return
          if (data.t === 'snapshot') {
            const incoming = (Array.isArray(data.records) ? data.records : [])
              .filter((record) => record !== null && typeof record === 'object' && Number.isFinite(record.seq) && record.seq > (entry.remoteSeq ?? -1))
            const appended = this.appendMirrorRecords(entry, incoming)
            if (appended.length > 0) {
              entry.remoteSeq = appended[appended.length - 1].seq
              this.saveMirrorStore()
            }
            const session = this.service('sessions')?.get(localSessionId)
            if (session !== undefined) this.publishMirrorAssistantBaseline(entry, session, data.assistantStream)
          } else if (data.t === 'record' && data.record !== null && typeof data.record === 'object') {
            if (Number.isFinite(data.record.seq) && data.record.seq > (entry.remoteSeq ?? -1)) {
              const appended = this.appendMirrorRecords(entry, [data.record])
              if (appended.length > 0) {
                entry.remoteSeq = appended[appended.length - 1].seq
                this.saveMirrorStore()
              }
            }
          } else if (data.t === 'assistant-stream' && data.frame !== null && typeof data.frame === 'object') {
            const session = this.service('sessions')?.get(localSessionId)
            if (session === undefined) return
            if (data.frame.type === 'start') this.publishMirrorAssistantStart(entry, session, data.frame)
            else if (data.frame.type === 'chunk') this.publishMirrorAssistantChunk(entry, session, data.frame)
            else if (data.frame.type === 'end') this.publishMirrorAssistantEnd(entry, session, data.frame)
          } else if (data.t === 'title' && typeof data.title === 'string' && data.title.length > 0) {
            const session = this.service('sessions')?.get(localSessionId)
            if (session !== undefined) void this.renameMirror(session, entry, data.title)
          } else if (data.t === 'error') {
            this.log('warn', `dsh-link: mirror stream error: ${data.message ?? data.code ?? 'unknown'}`)
          }
        },
        onError: (error) => {
          this.log('warn', `dsh-link: mirror watch ${localSessionId}: ${errorMessage(error)}`)
        },
        onEnd: () => {},
      })
    } catch (error) {
      this.log('warn', `dsh-link: mirror watch ${localSessionId}: ${errorMessage(error)}`)
      return { watching: false }
    }
    this.mirrorWatches.set(localSessionId, subscription)
    return { watching: true, deviceId, deviceName: device.name, remoteSessionId }
  }

  /** Stop watching one mirror. */
  unwatchMirror(localSessionId) {
    const subscription = this.mirrorWatches.get(localSessionId)
    if (subscription === undefined) return
    this.mirrorWatches.delete(localSessionId)
    try {
      subscription.cancel()
    } catch {
      // already closed
    }
  }

  /** Forward a native mirror prompt to the remote Host. */
  async forwardMirrorPrompt(localSessionId, text, selection) {
    const found = this.mirrorForLocal(localSessionId)
    if (found === undefined) throw new LinkError('not-found', '这不是远程镜像会话')
    const clean = typeof text === 'string' ? text.trim() : ''
    if (clean.length === 0) return
    found.entry.pendingUserTexts = Array.isArray(found.entry.pendingUserTexts) ? found.entry.pendingUserTexts : []
    found.entry.pendingUserTexts.push(clean)
    this.watchMirror(localSessionId)
    // The peer-state loop only runs every few seconds; apply a just-changed
    // thinking level (or model) before the turn starts so this prompt cannot
    // run with the previous remote selection.
    await this.pushMirrorPromptSelection(localSessionId, selection)
    await this.remoteCall(found.deviceId, 'session.prompt', { sessionId: found.remoteSessionId, text: clean }, 30_000)
  }

  /** Append one durable local user message for a forwarded mirror prompt. */
  appendMirrorUserText(entry, text) {
    const session = this.service('sessions')?.get(entry.localId)
    if (session === undefined || typeof text !== 'string' || text.trim().length === 0) return
    const events = session.snapshotEvents()
    let turnOpen = false
    let turn = 0
    for (const event of events) {
      if (event.type === 'turn/start') {
        turnOpen = true
        turn = Number.isFinite(event.data?.turn) ? event.data.turn : turn + 1
      } else if (event.type === 'turn/end') {
        turnOpen = false
      }
    }
    if (!turnOpen) {
      turn += 1
      session.append('turn/start', { turn })
    }
    session.append('user/message', {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
  }

  /** Reject a local model step for a mirror and forward its prompt instead. */
  handleMirrorPreStep(payload) {
    const localSessionId = payload?.agent?.id
    const found = this.mirrorForLocal(localSessionId)
    const text = extractUserMessageText(payload?.messages)
    if (found !== undefined) {
      if (text.length > 0) {
        if (found.entry.lastForwardedTurn !== payload.turn) {
          found.entry.lastForwardedTurn = payload.turn
          this.appendMirrorUserText(found.entry, text)
          void this.forwardMirrorPrompt(localSessionId, text, payload.modelSelection).catch((error) => {
            this.log('warn', `dsh-link: mirror forward failed: ${errorMessage(error)}`)
          })
        }
      }
      return { kind: 'reject' }
    }
    // Native "new Session" inside a mirrored project creates an ordinary local
    // Session. It must not run locally: bind it to a fresh remote Session first.
    const session = this.service('sessions')?.get(localSessionId)
    const cwd = session?.header?.cwd ?? session?.cwd ?? ''
    if (!this.isMirrorPath(cwd)) return undefined
    if (text.length > 0) {
      void this.provisionUnmappedMirror(localSessionId, cwd, text, payload.turn).catch((error) => {
        this.log('warn', `dsh-link: mirror bind failed: ${errorMessage(error)}`)
      })
    }
    return { kind: 'reject' }
  }

  /** Bind a local Session created inside a mirror Workspace to a new remote Session. */
  async provisionUnmappedMirror(localSessionId, cwd, text, turn) {
    const root = join(dataDir(), 'mirrors')
    if (!cwd.startsWith(`${root}${sep}`)) throw new LinkError('not-found', '不是远程工作区会话')
    const parts = cwd.slice(root.length + 1).split(sep)
    const deviceId = parts[0]
    const directory = parts[1] ?? ''
    const remoteWorkspaceId = directory.startsWith('ws-') ? directory.slice(3) : ''
    const peer = this.resolvePeer(deviceId)
    const created = await this.remoteCall(peer.id, 'session.create', remoteWorkspaceId.length > 0 ? { workspaceId: remoteWorkspaceId } : {}, 30_000)
    const remoteSessionId = created !== null && typeof created === 'object' && typeof created.sessionId === 'string' ? created.sessionId : ''
    if (remoteSessionId.length === 0) throw new LinkError('internal', '远程会话创建失败')
    const session = this.service('sessions')?.get(localSessionId)
    const titleService = this.service('sessionTitle')
    const title = titleService !== undefined ? (titleService.get(session)?.title ?? '') : ''
    const device = this.mirrors.devices[deviceId] ?? { name: peer.name ?? deviceId, workspaces: {}, sessions: {} }
    device.name = peer.name ?? device.name ?? deviceId
    device.workspaces = device.workspaces ?? {}
    device.sessions = device.sessions ?? {}
    const entry = {
      localId: localSessionId,
      title,
      remoteSeq: -1,
      updatedAt: Date.now(),
      createdAt: new Date().toISOString(),
      workspaceId: remoteWorkspaceId,
      lastForwardedTurn: turn,
    }
    device.sessions[remoteSessionId] = entry
    this.mirrors.devices[deviceId] = device
    this.saveMirrorStore()
    try {
      const mapping = device.workspaces?.[remoteWorkspaceId]
      const registry = this.service('workspaceRegistry')
      const workspace = registry !== undefined && typeof mapping?.localWorkspaceId === 'string' ? registry.get(mapping.localWorkspaceId) : undefined
      if (workspace !== undefined) await workspace.attachSession(localSessionId)
    } catch {
      // grouping is cosmetic; the mirror mapping still routes prompts
    }
    // A Session created locally inside a mirrored project keeps the model and
    // thinking level the user sees in the composer; apply them to the fresh
    // remote Session before the first prompt.
    try {
      const summaries = await this.sessionList()
      const localSelection = this.selectionOfSummary(summaries.find((item) => item.sessionId === localSessionId))
      if (localSelection !== null) {
        await this.pushMirrorModel(peer.id, remoteSessionId, localSessionId, localSelection)
      }
    } catch (error) {
      this.log('warn', `dsh-link: mirror model initial push ${remoteSessionId}: ${errorMessage(error)}`)
    }
    if (typeof text === 'string' && text.trim().length > 0) {
      await this.remoteCall(peer.id, 'session.prompt', { sessionId: remoteSessionId, text }, 30_000)
      // The local transcript already contains this user message. Skip the
      // matching remote user record so the watch only appends the remote reply.
      try {
        const history = await this.remoteCall(peer.id, 'session.history', { sessionId: remoteSessionId, maxMessages: 20 }, 20_000)
        const records = Array.isArray(history?.records) ? history.records : []
        let userSeq = -1
        for (const record of records) {
          if (record?.kind === 'user' && typeof record.text === 'string' && record.text.trim() === text.trim()) userSeq = Number.isFinite(record.seq) ? record.seq : userSeq
        }
        if (userSeq >= 0) entry.remoteSeq = userSeq
      } catch {
        // the live watch will still stream the reply
      }
      this.saveMirrorStore()
      this.watchMirror(localSessionId)
    }
    return { localSessionId, remoteSessionId }
  }

  /** Ensure one local Workspace exists for a mirror directory. */
  async ensureMirrorWorkspaceAt(directory, title) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const registry = this.service('workspaceRegistry')
    if (registry === undefined) return undefined
    let workspace
    try {
      workspace = await registry.resolveByPath(directory)
    } catch {
      workspace = undefined
    }
    const clean = typeof title === 'string' && title.length > 0 ? title.slice(0, 120) : '[远程]'
    if (workspace === undefined) {
      workspace = await registry.create(directory, clean)
    } else if (workspace.title !== clean) {
      try {
        await workspace.setTitle(clean)
      } catch {
        // a title refresh is cosmetic
      }
    }
    return workspace
  }

  /** Local workspace directory for one remote Project. */
  mirrorWorkspaceDir(deviceId, remoteWorkspaceId) {
    return join(this.mirrorDirFor(deviceId), `ws-${String(remoteWorkspaceId).replace(/[^A-Za-z0-9_.-]/gu, '_')}`)
  }

  /** Find the remote Workspace that owns a Session cwd. */
  remoteWorkspaceOf(session, workspaces) {
    const cwd = typeof session?.cwd === 'string' ? session.cwd : ''
    if (cwd.length > 0) {
      let best
      for (const workspace of workspaces) {
        if (typeof workspace.path !== 'string' || workspace.path.length === 0) continue
        if (cwd === workspace.path || cwd.startsWith(`${workspace.path}${sep}`)) {
          if (best === undefined || workspace.path.length > best.path.length) best = workspace
        }
      }
      if (best !== undefined) return best
    }
    return undefined
  }

  /** Ensure the local Workspace projection of one remote Project. */
  async ensureRemoteProjectWorkspace(peer, name, device, remoteWorkspace) {
    const directory = remoteWorkspace === undefined
      ? join(this.mirrorDirFor(peer.id), '_other')
      : this.mirrorWorkspaceDir(peer.id, remoteWorkspace.workspaceId)
    const suffix = remoteWorkspace === undefined ? '其他' : (remoteWorkspace.title || remoteWorkspace.path || '项目')
    const shortName = (name.length > 20 ? name.slice(-14) : name).replace(/\.local$/iu, '')
    const title = `[远程] ${suffix} · ${shortName}`
    const workspace = await this.ensureMirrorWorkspaceAt(directory, title)
    if (workspace === undefined) return undefined
    const key = remoteWorkspace === undefined ? '' : remoteWorkspace.workspaceId
    device.workspaces[key] = {
      localWorkspaceId: workspace.id,
      localPath: directory,
      title: suffix,
      remotePath: remoteWorkspace?.path ?? '',
      remoteWorkspaceId: key,
    }
    return { workspace, key, directory }
  }

  /** Mirror one peer's recent ordinary Sessions, grouped by its Projects. */
  async syncPeerMirrors(peer) {
    const info = await this.remoteCall(peer.id, 'device.info', {}, 15_000).catch(() => undefined)
    const name = typeof info?.name === 'string' && info.name.length > 0 ? info.name : (peer.name ?? peer.id)
    const list = await this.remoteCall(peer.id, 'session.list', {}, 20_000)
    const items = (Array.isArray(list?.items) ? list.items : [])
      .filter((item) => item !== null && typeof item === 'object' && typeof item.sessionId === 'string' && item.parentSessionId == null && item.blank !== true)
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    const selected = items.filter((item, index) => index < MAX_MIRROR_SESSIONS || item.running === true)
    const device = this.mirrors.devices[peer.id] ?? { name, workspaces: {}, sessions: {} }
    device.name = name
    device.workspaces = device.workspaces ?? {}
    device.sessions = device.sessions ?? {}
    delete device.workspaceId
    delete device.workspacePath
    this.mirrors.devices[peer.id] = device
    if (selected.length === 0) return

    let remoteWorkspaces = []
    try {
      const workspaceList = await this.remoteCall(peer.id, 'workspace.list', {}, 20_000)
      remoteWorkspaces = (Array.isArray(workspaceList?.items) ? workspaceList.items : [])
        .filter((item) => item !== null && typeof item === 'object' && typeof item.workspaceId === 'string')
    } catch {
      remoteWorkspaces = []
    }
    const localByRemote = new Map()
    for (const remoteWorkspace of remoteWorkspaces) {
      const ensured = await this.ensureRemoteProjectWorkspace(peer, name, device, remoteWorkspace)
      if (ensured !== undefined) localByRemote.set(remoteWorkspace.workspaceId, ensured)
    }
    let fallback
    const ensureFallback = async () => {
      if (fallback !== undefined) return fallback
      fallback = await this.ensureRemoteProjectWorkspace(peer, name, device, undefined)
      return fallback
    }

    let localSummaries
    try {
      localSummaries = await this.sessionList()
    } catch {
      localSummaries = []
    }
    const localIds = new Set(localSummaries.map((item) => item.sessionId))
    let remoteArchived
    const loadRemoteArchived = async () => {
      if (remoteArchived !== undefined) return remoteArchived
      try {
        const snapshot = await this.remoteCall(peer.id, 'workspace.snapshot', {}, 15_000)
        remoteArchived = new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : [])
      } catch {
        remoteArchived = new Set()
      }
      return remoteArchived
    }
    for (const item of selected) {
      const remoteSessionId = item.sessionId
      const remoteWorkspace = this.remoteWorkspaceOf(item, remoteWorkspaces)
      let target
      if (remoteWorkspace === undefined) {
        target = await ensureFallback()
      } else {
        target = localByRemote.get(remoteWorkspace.workspaceId)
        if (target === undefined) target = await this.ensureRemoteProjectWorkspace(peer, name, device, remoteWorkspace)
        if (target === undefined) target = await ensureFallback()
      }
      if (target === undefined) continue
      let entry = device.sessions[remoteSessionId]
      if (entry === undefined) {
        let localId = this.localMirrorId(peer.id, remoteSessionId)
        if (localIds.has(localId)) localId = `${localId}-${Date.now().toString(36)}`
        entry = {
          localId,
          title: typeof item.title === 'string' ? item.title : '',
          remoteSeq: -1,
          updatedAt: item.updatedAt ?? 0,
          createdAt: new Date().toISOString(),
          workspaceId: target.key,
        }
        device.sessions[remoteSessionId] = entry
        // A new mirror adopts the remote archive state immediately, so an
        // archived remote Session never flashes into the local workspace.
        entry.archiveLocal = (await loadRemoteArchived()).has(remoteSessionId)
        entry.archiveRemote = entry.archiveLocal
      }
      entry.workspaceId = target.key
      entry.updatedAt = item.updatedAt ?? entry.updatedAt ?? 0
      const local = this.service('sessions')?.get(entry.localId)
      if (local === undefined && !localIds.has(entry.localId)) {
        try {
          const created = await this.requireSessions().create({ workspaceId: target.workspace.id, sessionId: entry.localId })
          entry.remoteSeq = -1
          await target.workspace.attachSession(created.sessionId).catch(() => {})
          if (entry.archiveLocal === true) await this.applyMirrorArchive(entry.localId, true).catch(() => {})
          // A fresh mirror starts from the remote Session's model and thinking
          // level, so the native composer shows what the remote will use.
          const remoteSelection = this.normalizeModelSelection(item.modelSelection)
          if (remoteSelection !== null) {
            await this.applyMirrorModel(entry.localId, remoteSelection).catch(() => {})
            this.mirrorModelStates.set(entry.localId, { local: remoteSelection, remote: remoteSelection })
          }
        } catch (error) {
          this.log('warn', `dsh-link: mirror create ${remoteSessionId}: ${errorMessage(error)}`)
          continue
        }
      } else {
        // Never touch the archive state of a known mirror here: only a peer
        // that went offline is restored when it comes back.
        if (entry.offlineHidden === true) {
          if (entry.archiveLocal !== true) await this.applyMirrorArchive(entry.localId, false).catch(() => {})
          delete entry.offlineHidden
        }
        await target.workspace.attachSession(entry.localId).catch(() => {})
      }
      const live = this.service('sessions')?.get(entry.localId)
      if (live !== undefined) {
        await this.renameMirror(live, entry, typeof item.title === 'string' ? item.title : '')
        await this.syncMirrorHistory(peer, entry, remoteSessionId)
      }
    }
  }

  /** Normalize one model selection: a flat selection or the projection wire view. */
  normalizeModelSelection(value) {
    if (value === null || typeof value !== 'object') return null
    // The core projection wire view is `{ lastUsed, next }`. `next` is the
    // choice the next request will use, so it is the state to synchronize:
    // `lastUsed` lags behind right after the user changes model or effort.
    const used = value.next !== undefined || value.lastUsed !== undefined
      ? (value.next ?? value.lastUsed)
      : value
    if (used === null || typeof used !== 'object') return null
    if (typeof used.provider !== 'string' || used.provider.length === 0) return null
    if (typeof used.model !== 'string' || used.model.length === 0) return null
    const reasoningEffort = typeof used.reasoningEffort === 'string' ? used.reasoningEffort : ''
    return { provider: used.provider, model: used.model, ...(reasoningEffort !== '' ? { reasoningEffort } : {}) }
  }

  /** Read the model selection of one Session summary (mapped or raw core shape). */
  selectionOfSummary(summary) {
    if (summary === null || typeof summary !== 'object') return null
    // Session lists pass through mapSessionSummary, which already flattens the
    // projection into `modelSelection`. Raw core summaries keep the wire view
    // under `projections`.
    const mapped = this.normalizeModelSelection(summary.modelSelection)
    if (mapped !== null) return mapped
    const projections = summary.projections?.values ?? summary.projections
    if (projections === null || typeof projections !== 'object') return null
    return this.normalizeModelSelection(projections.modelSelection)
  }

  /** Whether one selection projection equals another. */
  sameModelSelection(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
  }

  /** Apply one local archive state to the local mirror Session. */
  async applyMirrorArchive(localId, archived) {
    const registry = this.service('workspaceRegistry')
    if (registry === undefined) return
    if (archived) await registry.archiveSession(localId, { stopActivity: true })
    else await registry.unarchiveSession(localId)
  }

  /** Apply one model selection to a local mirror Session. */
  async applyMirrorModel(localId, selection) {
    const controller = this.service('sessionController')
    if (controller === undefined || typeof controller.selectModel !== 'function') return false
    await controller.selectModel({
      sessionId: localId,
      provider: selection.provider,
      model: selection.model,
      ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== '' ? { reasoningEffort: selection.reasoningEffort } : {}),
    })
    return true
  }

  /** Push one mirror selection to the remote Host and record the applied state. */
  async pushMirrorModel(peerId, remoteId, localId, selection) {
    // The remote Host adapts this selection to its Session controller's flat
    // request shape. Keep `selection` on the wire: the client protocol and the
    // model settings panel both use it.
    const result = await this.remoteCall(peerId, 'session.selectModel', { sessionId: remoteId, selection }, 20_000)
    const applied = this.normalizeModelSelection(result?.selected) ?? selection
    if (typeof localId === 'string' && localId.length > 0) {
      this.mirrorModelStates.set(localId, { local: applied, remote: applied })
    }
    return applied
  }

  /** Push a locally changed mirror selection before forwarding its prompt. */
  async pushMirrorPromptSelection(localSessionId, selection) {
    const found = this.mirrorForLocal(localSessionId)
    if (found === undefined) return false
    const current = this.normalizeModelSelection(selection)
    if (current === null) return false
    const previous = this.mirrorModelStates.get(localSessionId)
    // The 5s peer-state loop settles unknown or conflicting state. Here only a
    // clear local change wins, so forwarding a prompt never clobbers a remote
    // choice that has not been pulled down yet.
    if (previous === undefined) return false
    if (this.sameModelSelection(current, previous.local)) return false
    if (!this.sameModelSelection(previous.local, previous.remote)) return false
    try {
      await this.pushMirrorModel(found.deviceId, found.remoteSessionId, localSessionId, current)
      return true
    } catch (error) {
      this.log('warn', `dsh-link: mirror model push before prompt ${found.remoteSessionId}: ${errorMessage(error)}`)
      return false
    }
  }

  /** Keep mirror model state aligned with the online remote Host. */
  async syncPeerState() {
    if (this.peerStateSyncing || this.relay === undefined || this.relay.state !== 'connected') return
    this.peerStateSyncing = true
    try {
      // Archive direction is owned by syncPeerArchives; this loop owns models.
      const localList = await this.sessionList().catch(() => [])
      const localById = new Map((Array.isArray(localList) ? localList : []).map((item) => [item.sessionId, item]))
      for (const peer of [...this.peers]) {
        const device = this.mirrors.devices?.[peer.id]
        if (device === undefined) continue
        const entries = Object.entries(device.sessions ?? {})
        if (entries.length === 0) continue
        let remoteById = new Map()
        try {
          const list = await this.remoteCall(peer.id, 'session.list', {}, 15_000)
          remoteById = new Map((Array.isArray(list?.items) ? list.items : []).filter((item) => item !== null && typeof item === 'object' && typeof item.sessionId === 'string').map((item) => [item.sessionId, item]))
        } catch {
          remoteById = new Map()
        }
        for (const [remoteId, entry] of entries) {
          if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') continue
          const localId = entry.localId
          const localSummary = localById.get(localId)
          const remoteSummary = remoteById.get(remoteId)
          if (localSummary === undefined || remoteSummary === undefined) continue
          const localSelection = this.selectionOfSummary(localSummary)
          const remoteSelection = this.selectionOfSummary(remoteSummary)
          if (localSelection === null && remoteSelection === null) continue
          const previous = this.mirrorModelStates.get(localId)
          if (previous === undefined) {
            if (remoteSelection !== null && !this.sameModelSelection(localSelection, remoteSelection)) {
              try {
                if (await this.applyMirrorModel(localId, remoteSelection)) this.mirrorModelStates.set(localId, { local: remoteSelection, remote: remoteSelection })
              } catch (error) {
                this.log('warn', `dsh-link: mirror model initial ${localId}: ${errorMessage(error)}`)
              }
            } else {
              this.mirrorModelStates.set(localId, { local: localSelection, remote: remoteSelection })
            }
          } else {
            const localChanged = !this.sameModelSelection(localSelection, previous.local)
            const remoteChanged = !this.sameModelSelection(remoteSelection, previous.remote)
            if (localChanged && !remoteChanged && localSelection !== null) {
              try {
                await this.pushMirrorModel(peer.id, remoteId, localId, localSelection)
              } catch (error) {
                this.log('warn', `dsh-link: mirror model push ${remoteId}: ${errorMessage(error)}`)
              }
            } else if (remoteChanged && !localChanged && remoteSelection !== null) {
              try {
                if (await this.applyMirrorModel(localId, remoteSelection)) this.mirrorModelStates.set(localId, { local: remoteSelection, remote: remoteSelection })
              } catch (error) {
                this.log('warn', `dsh-link: mirror model pull ${localId}: ${errorMessage(error)}`)
              }
            } else if (localChanged && remoteChanged && !this.sameModelSelection(localSelection, remoteSelection)) {
              if (remoteSelection !== null) {
                try {
                  if (await this.applyMirrorModel(localId, remoteSelection)) this.mirrorModelStates.set(localId, { local: remoteSelection, remote: remoteSelection })
                } catch (error) {
                  this.log('warn', `dsh-link: mirror model conflict ${localId}: ${errorMessage(error)}`)
                }
              }
            } else {
              this.mirrorModelStates.set(localId, { local: localSelection, remote: remoteSelection })
            }
          }
        }
      }
    } finally {
      this.peerStateSyncing = false
    }
  }

  /** Ensure one specific remote Session has a local mirror (on demand for older rows). */
  async ensureMirrorSession(deviceRef, remoteSessionId) {
    const peer = this.resolvePeer(deviceRef)
    const remoteId = this.requireSessionId(remoteSessionId)
    const existing = this.mirrorForRemote(peer.id, remoteId)
    if (existing !== undefined) {
      const local = this.service('sessions')?.get(existing.entry.localId)
      const summaries = await this.sessionList().catch(() => [])
      if (local !== undefined || summaries.some((item) => item.sessionId === existing.entry.localId)) {
        return { localSessionId: existing.entry.localId, workspaceId: existing.entry.workspaceId ?? '', title: existing.entry.title ?? '' }
      }
    }
    await this.syncPeerMirrors(peer)
    const after = this.mirrorForRemote(peer.id, remoteId)
    if (after !== undefined) {
      return { localSessionId: after.entry.localId, workspaceId: after.entry.workspaceId ?? '', title: after.entry.title ?? '' }
    }
    throw new LinkError('not-found', `远程会话 ${remoteId} 不在最近镜像范围内`)
  }

  /** Rebuild one mirror Session so its history uses native tool events. */
  async rebuildMirrorSession(deviceId, device, remoteSessionId, entry) {
    if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') return false
    const registry = this.service('workspaceRegistry')
    const sessions = this.requireSessions()
    const mapping = device.workspaces?.[entry.workspaceId]
    const workspace = registry !== undefined && typeof mapping?.localWorkspaceId === 'string'
      ? registry.get(mapping.localWorkspaceId)
      : undefined
    if (workspace === undefined) return false
    const base = this.localMirrorId(deviceId, remoteSessionId)
    const nextLocalId = `${base}-${Date.now().toString(36)}`
    const oldLocalId = entry.localId
    try {
      await sessions.create({ workspaceId: workspace.id, sessionId: nextLocalId })
    } catch (error) {
      this.log('warn', `dsh-link: mirror rebuild ${remoteSessionId}: ${errorMessage(error)}`)
      return false
    }
    if (registry !== undefined) {
      await registry.archiveSession(oldLocalId, { stopActivity: true }).catch(() => {})
      await registry.archiveSession(nextLocalId, { stopActivity: true }).catch(() => {})
      if (entry.archiveLocal !== true) await registry.unarchiveSession(nextLocalId).catch(() => {})
    }
    await workspace.attachSession(nextLocalId).catch(() => {})
    entry.localId = nextLocalId
    entry.remoteSeq = -1
    entry.pendingUserTexts = []
    entry.mirrorCursor = undefined
    entry.toolCallSeqs = undefined
    entry.lastCommittedAssistant = undefined
    entry.mirrorStream = undefined
    await this.syncMirrorHistory({ id: deviceId, name: device.name ?? deviceId }, entry, remoteSessionId)
    this.saveMirrorStore()
    return true
  }

  /** Rebuild every mirrored Session of one device (or all devices). */
  async rebuildMirrorSessions(deviceRef) {
    const peerId = typeof deviceRef === 'string' && deviceRef.trim().length > 0
      ? this.resolvePeer(deviceRef).id
      : undefined
    let rebuilt = 0
    for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
      if (peerId !== undefined && deviceId !== peerId) continue
      for (const [remoteSessionId, entry] of Object.entries(device.sessions ?? {})) {
        if (await this.rebuildMirrorSession(deviceId, device, remoteSessionId, entry)) rebuilt += 1
      }
    }
    this.saveMirrorStore()
    return { rebuilt, device: peerId ?? 'all' }
  }

  /** Read the Workspace baseline (workspaces, archive set, pins). */
  async workspaceSnapshot() {
    const controller = this.service('workspaceController')
    if (controller === undefined) {
      return {
        items: this.workspaceItems().map((item) => ({
          workspaceId: item.workspaceId,
          path: item.path,
          title: item.title,
          sessionIds: [],
        })),
        archivedSessionIds: [],
        pinnedSessionIds: [],
      }
    }
    const abort = new AbortController()
    try {
      for await (const frame of controller.follow(abort.signal)) {
        abort.abort()
        if (frame?.type === 'baseline') return frame.value
      }
    } catch {
      // fall through to the static projection
    }
    return {
      items: this.workspaceItems().map((item) => ({
        workspaceId: item.workspaceId,
        path: item.path,
        title: item.title,
        sessionIds: [],
      })),
      archivedSessionIds: [],
      pinnedSessionIds: [],
    }
  }

  /** Group session rows by their owning workspace path (longest prefix wins). */
  groupSessionsByWorkspace(workspaces, sessions) {
    const groups = new Map(workspaces.map((workspace) => [workspace.workspaceId, { workspace, rows: [] }]))
    const orphans = []
    for (const session of sessions) {
      const cwd = typeof session.cwd === 'string' ? session.cwd : ''
      let best
      for (const workspace of workspaces) {
        if (typeof workspace.path !== 'string' || workspace.path.length === 0) continue
        if (cwd === workspace.path || cwd.startsWith(`${workspace.path}${sep}`)) {
          if (best === undefined || workspace.path.length > best.path.length) best = workspace
        }
      }
      if (best === undefined) orphans.push(session)
      else groups.get(best.workspaceId).rows.push(session)
    }
    return { groups, orphans }
  }

  /** Local Workspaces and Sessions for the workspace tab page. */
  async localTree() {
    const snapshot = await this.workspaceSnapshot()
    const registry = this.service('workspaceRegistry')
    const raw = registry !== undefined ? registry.list() : []
    const workspaces = raw
      .filter((workspace) => !this.isMirrorPath(workspace.path))
      .map((workspace) => ({
        workspaceId: workspace.id,
        title: workspace.title,
        path: workspace.path,
      }))
    const sessions = (await this.remoteSessionList()).filter((item) => item.parentSessionId == null)
    const { groups, orphans } = this.groupSessionsByWorkspace(workspaces, sessions)
    return {
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        sessions: groups.get(workspace.workspaceId).rows,
      })),
      orphanSessions: orphans,
      archivedSessionIds: Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : [],
      pinnedSessionIds: Array.isArray(snapshot.pinnedSessionIds) ? snapshot.pinnedSessionIds : [],
    }
  }

  /** Remote Workspaces and Sessions for one device tab. */
  async remoteTree(deviceRef) {
    const peer = this.resolvePeer(deviceRef)
    const [workspaceList, list] = await Promise.all([
      this.remoteCall(peer.id, 'workspace.list', {}, 20_000),
      this.remoteCall(peer.id, 'session.list', {}, 20_000),
    ])
    let snapshot = { archivedSessionIds: [], pinnedSessionIds: [] }
    try {
      const value = await this.remoteCall(peer.id, 'workspace.snapshot', {}, 20_000)
      snapshot = { archivedSessionIds: Array.isArray(value?.archivedSessionIds) ? value.archivedSessionIds : [], pinnedSessionIds: Array.isArray(value?.pinnedSessionIds) ? value.pinnedSessionIds : [] }
    } catch {
      // Older Host versions expose only workspace.list.
    }
    const workspaces = (Array.isArray(workspaceList?.items) ? workspaceList.items : [])
      .filter((workspace) => workspace !== null && typeof workspace === 'object' && typeof workspace.workspaceId === 'string')
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        title: workspace.title,
        path: workspace.path,
        localWorkspaceId: this.mirrors.devices?.[peer.id]?.workspaces?.[workspace.workspaceId]?.localWorkspaceId ?? '',
      }))
    const sessions = (Array.isArray(list?.items) ? list.items : [])
      .filter((item) => item !== null && typeof item === 'object' && item.sessionId && item.parentSessionId == null)
      .map((row) => ({
        ...row,
        localSessionId: this.mirrorForRemote(peer.id, row.sessionId)?.entry.localId ?? '',
      }))
    const { groups, orphans } = this.groupSessionsByWorkspace(workspaces, sessions)
    return {
      deviceId: peer.id,
      deviceName: peer.name,
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        sessions: groups.get(workspace.workspaceId).rows.map((row) => ({
          ...row,
          workspaceId: workspace.workspaceId,
        })),
      })),
      orphanSessions: orphans,
      archivedSessionIds: snapshot.archivedSessionIds,
      pinnedSessionIds: snapshot.pinnedSessionIds,
    }
  }

  /** Require the Workspace controller service. */
  requireWorkspaceController() {
    const service = this.service('workspaceController')
    if (service === undefined) throw new LinkError('unavailable', '本机未加载工作区控制器')
    return service
  }

  /** Workspace baseline for remote tree consumers. */
  async workspaceSnapshotView() {
    return await this.workspaceSnapshot()
  }

  /** Read one Session's title, preset, model selection and state. */
  async sessionInfo(sessionId) {
    const id = this.requireSessionId(sessionId)
    const sessions = this.requireSessions()
    let summary
    try {
      const list = await sessions.list({}, AbortSignal.timeout(15_000))
      summary = (Array.isArray(list?.items) ? list.items : []).find((item) => item?.sessionId === id)
    } catch {
      summary = undefined
    }
    const live = this.service('sessions')?.get(id)
    const projections = summary?.projections?.values ?? {}
    const presetService = this.service('agentPresets')
    let agentPreset = typeof projections.agentPreset === 'string' ? projections.agentPreset : null
    if (live !== undefined && presetService !== undefined) {
      try {
        agentPreset = presetService.presetForSession(live) ?? agentPreset
      } catch {
        // keep the projection fallback
      }
    }
    const modelSelection = this.normalizeModelSelection(projections.modelSelection)
    let state = null
    try {
      state = await this.sessionState(id, AbortSignal.timeout(10_000))
    } catch {
      state = null
    }
    return {
      sessionId: id,
      title: typeof projections.title === 'string' ? projections.title : (summary?.title ?? ''),
      cwd: summary?.cwd ?? null,
      agentAvailable: summary?.agentAvailable !== false,
      agentPreset,
      modelSelection,
      state,
    }
  }

  /** List agent presets for remote settings selectors. */
  async agentPresetList() {
    const service = this.service('agentPresets')
    if (service === undefined) return { presets: [] }
    if (typeof service.remoteExportList === 'function') {
      return await service.remoteExportList()
    }
    const list = await service.list()
    return {
      presets: (Array.isArray(list) ? list : []).map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        isDefault: preset.isDefault === true || preset.default === true,
        ...(typeof preset.broken === 'string' ? { broken: preset.broken } : {}),
      })),
    }
  }

  /** Select an Agent preset for one Session. */
  async sessionSelectPreset(sessionId, agentPreset) {
    const id = this.requireSessionId(sessionId)
    if (typeof agentPreset !== 'string' || agentPreset.length === 0) throw new LinkError('bad-request', '缺少 agentPreset')
    const service = this.service('agentPresets')
    if (service === undefined) throw new LinkError('unavailable', '本机未加载 Agent 预设')
    const resolved = await this.requireSessions().resolveAgent(id)
    if (resolved === null || typeof resolved !== 'object' || resolved.agent === undefined) {
      throw new LinkError('not-found', '无法恢复该会话的 Agent')
    }
    const selected = await service.select(resolved.agent, agentPreset)
    return { agentPreset: selected }
  }

  /** Execute one local method for a remote caller. */
  async invokeLocal(method, params, signal) {
    switch (method) {
      case 'ping':
        return { pong: true, time: Date.now() }
      case 'device.info':
        return await this.deviceInfo()
      case 'workspace.list':
        return { items: this.remoteWorkspaceItems() }
      case 'session.list':
        return { items: await this.remoteSessionList() }
      case 'session.create':
        return await this.sessionCreate(params)
      case 'session.prompt':
        return await this.sessionPrompt(params, signal)
      case 'session.cancel':
        return await this.sessionCancel(params)
      case 'session.rename':
        return await this.sessionRename(params)
      case 'session.state': {
        const sessionId = this.requireSessionId(params?.sessionId)
        return await this.sessionState(sessionId, signal)
      }
      case 'session.history': {
        const sessionId = this.requireSessionId(params?.sessionId)
        return await this.sessionHistory(sessionId, params?.maxMessages, signal)
      }
      case 'workspace.snapshot':
        return await this.workspaceSnapshotView()
      case 'workspace.rename': {
        const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
        const title = typeof params?.title === 'string' ? params.title.trim() : ''
        if (workspaceId.length === 0 || title.length === 0) throw new LinkError('bad-request', '缺少 workspaceId 或 title')
        const value = await this.requireWorkspaceController().rename({ workspaceId, title: title.slice(0, 120) })
        return { workspace: value?.workspace ?? value }
      }
      case 'workspace.delete': {
        const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
        if (workspaceId.length === 0) throw new LinkError('bad-request', '缺少 workspaceId')
        return await this.requireWorkspaceController().delete({ workspaceId })
      }
      case 'session.archive': {
        const sessionId = this.requireSessionId(params?.sessionId)
        await this.requireWorkspaceController().archiveSession({ sessionId, stopActivity: true })
        return { accepted: true }
      }
      case 'session.unarchive': {
        const sessionId = this.requireSessionId(params?.sessionId)
        await this.requireWorkspaceController().unarchiveSession({ sessionId })
        return { accepted: true }
      }
      case 'session.pin': {
        const sessionId = this.requireSessionId(params?.sessionId)
        await this.requireWorkspaceController().pinSession({ sessionId })
        return { accepted: true }
      }
      case 'session.unpin': {
        const sessionId = this.requireSessionId(params?.sessionId)
        await this.requireWorkspaceController().unpinSession({ sessionId })
        return { accepted: true }
      }
      case 'session.info':
        return await this.sessionInfo(params?.sessionId)
      case 'agent.presets':
        return await this.agentPresetList()
      case 'session.selectPreset':
        return await this.sessionSelectPreset(params?.sessionId, params?.agentPreset)
      case 'model.catalog':
        return await this.requireSessions().modelCatalog()
      case 'session.selectModel': {
        const sessionId = this.requireSessionId(params?.sessionId)
        const selection = params?.selection
        if (selection === null || typeof selection !== 'object') throw new LinkError('bad-request', '缺少 selection')
        // The DSH session controller takes a flat request. Flattening here keeps
        // the relay contract (`{ sessionId, selection }`) stable for old and new
        // peers while still applying both the model and the thinking level.
        const provider = typeof selection.provider === 'string' ? selection.provider.trim() : ''
        const model = typeof selection.model === 'string' ? selection.model.trim() : ''
        if (provider.length === 0 || model.length === 0) throw new LinkError('bad-request', '缺少 provider 或 model')
        const request = {
          sessionId,
          provider,
          model,
          ...(typeof selection.reasoningEffort === 'string' && selection.reasoningEffort.length > 0 ? { reasoningEffort: selection.reasoningEffort } : {}),
        }
        return await this.requireSessions().selectModel(request, signal ?? AbortSignal.timeout(RPC_TIMEOUT_MS))
      }
      case 'speech.status':
        return this.speechStatus()
      case 'speech.transcribe':
        return await this.speechTranscribe(params, signal)
      default:
        throw new LinkError('bad-request', `未知方法 ${method}`)
    }
  }

  /** Serve one incoming call, replying with the protocol envelope. */
  async handleIncomingCall(rid, from, method, params) {
    const relay = this.relay
    if (relay === undefined) return
    if (method === 'session.follow') {
      await this.handleFollowCall(relay, rid, params)
      return
    }
    try {
      const timeoutMs = method === 'speech.transcribe' ? SPEECH_TIMEOUT_MS : RPC_TIMEOUT_MS
      const result = await this.invokeLocal(method, params, AbortSignal.timeout(timeoutMs))
      relay.send({ t: 'reply', rid, ok: true, result: result ?? null })
    } catch (error) {
      relay.send({ t: 'reply', rid, ok: false, error: toProtocolError(error) })
    }
  }

  /** Serve one `session.follow` streaming call. */
  async handleFollowCall(relay, rid, params) {
    let sessionId
    try {
      sessionId = this.requireSessionId(params?.sessionId)
    } catch (error) {
      relay.send({ t: 'reply', rid, ok: false, error: toProtocolError(error) })
      return
    }
    const abort = new AbortController()
    this.localStreams.set(rid, abort)
    relay.send({ t: 'reply', rid, ok: true, result: { stream: true } })
    try {
      for await (const frame of this.followSession(sessionId, abort.signal)) {
        if (abort.signal.aborted) break
        relay.send({ t: 'event', rid, data: frame })
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        relay.send({ t: 'event', rid, data: { t: 'error', ...toProtocolError(error) } })
      }
    } finally {
      this.localStreams.delete(rid)
      if (!abort.signal.aborted) relay.send({ t: 'end', rid })
    }
  }

  /** Read a WAV/audio file from disk for the debug/agent helper. */
  readAudioFile(path) {
    if (typeof path !== 'string' || path.length === 0) throw new LinkError('bad-request', '缺少音频文件路径')
    const bytes = readFileSync(path)
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw new LinkError('bad-request', '音频文件超过 4 MiB')
    inspectWav(bytes)
    return bytes
  }

  /** Debug view used by the `link_debug` tool and local verification. */
  async debugInfo(what, extra) {
    const sessions = this.service('sessionController')
    switch (what) {
      case 'archive-state': {
        const local = await this.workspaceSnapshot().catch(() => null)
        const localSet = new Set(Array.isArray(local?.archivedSessionIds) ? local.archivedSessionIds : [])
        const items = []
        for (const peer of [...this.peers]) {
          const device = this.mirrors.devices?.[peer.id]
          if (device === undefined) continue
          let remoteSet = new Set()
          let remoteError = null
          try {
            const snapshot = await this.remoteCall(peer.id, 'workspace.snapshot', {}, 15_000)
            remoteSet = new Set(Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : [])
          } catch (error) {
            remoteError = errorMessage(error)
          }
          for (const [remoteId, entry] of Object.entries(device.sessions ?? {})) {
            if (entry === null || typeof entry !== 'object' || typeof entry.localId !== 'string') continue
            items.push({
              deviceId: peer.id,
              remoteId,
              localId: entry.localId,
              title: entry.title ?? '',
              localArchived: localSet.has(entry.localId),
              remoteArchived: remoteSet.has(remoteId),
              state: this.mirrorArchiveStates.get(entry.localId) ?? null,
            })
          }
          if (remoteError !== null) items.push({ deviceId: peer.id, error: remoteError })
        }
        return { lastArchiveError: this.lastArchiveError, items }
      }
      case 'archive-probe': {
        const peer = this.resolvePeer(extra?.device)
        try {
          await this.remoteCall(peer.id, 'session.archive', { sessionId: '__dshlink_probe__' }, 15_000)
          return { device: peer.id, ok: true }
        } catch (error) {
          return { device: peer.id, ok: false, error: errorMessage(error) }
        }
      }
      case 'config':
        return {
          config: this.config === undefined ? null : { ...this.config, relayUrl: this.config.relayUrl },
          tokenConfigured: typeof this.token === 'string',
          relayState: this.relay?.state ?? null,
          peers: this.peers,
        }
      case 'sessions':
        return { raw: sessions === undefined ? null : await sessions.list({}, AbortSignal.timeout(15_000)) }
      case 'titles': {
        if (sessions === undefined) return { items: [] }
        const list = await sessions.list({}, AbortSignal.timeout(15_000))
        const items = Array.isArray(list?.items) ? list.items : []
        return {
          items: items.slice(0, 20).map((item) => ({
            sessionId: item.sessionId,
            title: item.projections?.values?.title ?? null,
            cwd: item.cwd ?? null,
          })),
        }
      }
      case 'raw': {
        if (sessions === undefined) return { records: [] }
        const sessionId = this.requireSessionId(extra?.sessionId)
        const page = await sessions.events({
          address: { kind: 'session', sessionId },
          maxMessages: 6,
          ...(Number.isFinite(extra?.beforeSeq) ? { beforeSeq: extra.beforeSeq } : {}),
        }, AbortSignal.timeout(15_000))
        const raw = (Array.isArray(page?.records) ? page.records : []).slice(-4).map((record) => {
          const event = record?.event ?? {}
          return {
            type: event.type,
            seq: event.seq,
            data: truncate(typeof event.data === 'string' ? event.data : JSON.stringify(event.data ?? null), 7000),
          }
        })
        return { cursor: page?.cursor ?? -1, records: raw }
      }
      case 'workspaces':
        return { items: this.workspaceItems() }
      case 'list':
        return { items: await this.sessionList() }
      case 'state': {
        const sessionId = this.requireSessionId(extra?.sessionId)
        return await this.sessionState(sessionId, AbortSignal.timeout(10_000))
      }
      case 'follow': {
        const sessionId = this.requireSessionId(extra?.sessionId)
        const frames = []
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), 2_500)
        try {
          for await (const frame of this.followSession(sessionId, abort.signal)) {
            frames.push(frame)
            if (frames.length >= 8) break
          }
        } catch {
          // a timeout simply ends the sample
        } finally {
          clearTimeout(timer)
        }
        return { frames }
      }
      case 'mirror-probe': {
        const peer = this.resolvePeer(extra?.device)
        const remoteSessionId = this.requireSessionId(extra?.sessionId)
        const mirrorDir = join(dataDir(), 'mirrors', peer.id)
        mkdirSync(mirrorDir, { recursive: true, mode: 0o700 })
        const registry = this.service('workspaceRegistry')
        if (registry === undefined) throw new LinkError('unavailable', '本机缺少 workspaceRegistry')
        const workspace = await registry.create(mirrorDir, `📡 远程 · ${peer.name}`)
        const mirrorId = `session-dshlink-${createHash('sha1').update(`${peer.id}:${remoteSessionId}`).digest('hex').slice(0, 16)}`
        const controller = this.requireSessions()
        const created = await controller.create({ workspaceId: workspace.id, sessionId: mirrorId })
        const session = this.service('sessions')?.get(created.sessionId)
        if (session === undefined) throw new LinkError('internal', '镜像会话未进入本机会话仓库')
        const turn = 1
        const userId = randomUUID()
        const assistantId = randomUUID()
        session.append('turn/start', { turn })
        session.append('user/message', {
          id: userId,
          role: 'user',
          content: [{ type: 'text', text: '这是从远程 DSH 镜像过来的用户消息。' }],
          source: { kind: 'user' },
        }, { surfaceOp: 'append' })
        session.append('assistant/message', {
          turn,
          step: 1,
          message: {
            id: assistantId,
            role: 'assistant',
            content: [{ type: 'text', text: `这是来自 ${peer.name} 的镜像助手消息。` }],
            source: { kind: 'model', provider: 'dsh-link', model: 'remote' },
          },
          stream: [],
        }, { surfaceOp: 'append' })
        session.append('turn/end', { turn, reason: { kind: 'completed' } })
        await workspace.attachSession(created.sessionId)
        const titleService = this.service('sessionTitle')
        if (titleService !== undefined) {
          try {
            await titleService.rename(session, extra?.title ?? '远程镜像测试会话')
          } catch (error) {
            this.log('warn', `dsh-link: mirror title failed: ${errorMessage(error)}`)
          }
        }
        return {
          mirrorId: created.sessionId,
          workspaceId: workspace.id,
          workspacePath: mirrorDir,
          workspaceSessionIds: workspace.sessionIds,
          appends: session.seq,
        }
      }
      case 'types': {
        const query = this.service('sessionQuery')
        if (query === undefined) throw new LinkError('unavailable', '本机缺少 sessionQuery')
        const sessionId = this.requireSessionId(extra?.sessionId)
        const events = await query.listEvents(sessionId)
        return { events: (Array.isArray(events) ? events : []).slice(-40).map((event) => ({ seq: event.seq, type: event.type })) }
      }
      case 'mirror-cleanup': {
        const registry = this.service('workspaceRegistry')
        const archived = []
        const workspaces = []
        for (const [deviceId, device] of Object.entries(this.mirrors.devices ?? {})) {
          for (const entry of Object.values(device.sessions ?? {})) {
            if (registry !== undefined && typeof entry.localId === 'string') {
              try {
                await registry.archiveSession(entry.localId, { stopActivity: true })
                archived.push(entry.localId)
              } catch {
                // already archived or gone
              }
            }
          }
          for (const mapping of Object.values(device.workspaces ?? {})) {
            if (registry !== undefined && typeof mapping?.localWorkspaceId === 'string') {
              try {
                await registry.delete(mapping.localWorkspaceId)
                workspaces.push(mapping.localWorkspaceId)
              } catch {
                // already gone
              }
            }
          }
          try {
            rmSync(this.mirrorDirFor(deviceId), { recursive: true, force: true })
          } catch {
            // best effort
          }
        }
        this.mirrors = { version: 1, devices: {} }
        this.saveMirrorStore()
        return { archived, workspaces }
      }
      case 'tree':
        return await this.localTree()
      case 'remote-tree': {
        const peer = this.resolvePeer(extra?.device)
        return await this.remoteTree(peer.id)
      }
      case 'ensure-mirror': {
        const peer = this.resolvePeer(extra?.device)
        return await this.ensureMirrorSession(peer.id, extra?.sessionId)
      }
      case 'session-info':
        return await this.sessionInfo(extra?.sessionId)
      case 'models':
        return await this.requireSessions().modelCatalog()
      case 'presets':
        return await this.agentPresetList()
      case 'workspace-snapshot':
        return await this.workspaceSnapshot()
      case 'mirror-list': {
        const list = await this.sessionList()
        return { items: list.filter((item) => typeof item.cwd === 'string' && item.cwd.includes(`${join(dataDir(), 'mirrors')}`)) }
      }
      case 'rebuild-mirrors':
        return await this.rebuildMirrorSessions(extra?.device)
      case 'watch': {
        const sessionId = this.requireSessionId(extra?.sessionId)
        return this.watchMirror(sessionId)
      }
      case 'unwatch': {
        const sessionId = this.requireSessionId(extra?.sessionId)
        this.unwatchMirror(sessionId)
        return { watching: false }
      }
      case 'streams': {
        return {
          items: [...this.mirrorStreamStats.entries()].map(([localId, stats]) => ({ localId, ...stats })),
          mirrors: this.mirrorList().map((item) => ({
            localSessionId: item.localSessionId,
            remoteSessionId: item.remoteSessionId,
            stream: item.localSessionId === undefined ? null : this.mirrorStreamStats.get(item.localSessionId) ?? null,
          })),
        }
      }
      case 'speech-test': {
        const sampleRate = 16000
        const seconds = 0.6
        const samples = Math.floor(sampleRate * seconds)
        const wav = Buffer.alloc(44 + samples * 2)
        wav.write('RIFF', 0)
        wav.writeUInt32LE(36 + samples * 2, 4)
        wav.write('WAVE', 8)
        wav.write('fmt ', 12)
        wav.writeUInt32LE(16, 16)
        wav.writeUInt16LE(1, 20)
        wav.writeUInt16LE(1, 22)
        wav.writeUInt32LE(sampleRate, 24)
        wav.writeUInt32LE(sampleRate * 2, 28)
        wav.writeUInt16LE(2, 32)
        wav.writeUInt16LE(16, 34)
        wav.write('data', 36)
        wav.writeUInt32LE(samples * 2, 40)
        return await this.speechTranscribe({ audioBase64: wav.toString('base64'), language: 'zh' }, AbortSignal.timeout(130_000))
      }
      case 'speech':
        return this.speechStatus()
      case 'events': {
        const sessionId = this.requireSessionId(extra?.sessionId)
        return await this.sessionHistory(sessionId, 8)
      }
      default:
        return { ok: true, hint: 'what: config | sessions | titles | workspaces | speech | streams | events(sessionId)' }
    }
  }
}

/** Clamp an integer argument. */
function clampInt(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/* -------------------------------------------------------------------------- */
/* Agent tools                                                                */
/* -------------------------------------------------------------------------- */

/** Format a peer list for a tool result. */
function formatPeers(host) {
  if (host.peers.length === 0) return '没有其他在线设备。请确认另一台电脑已打开 DSH 并启用 DSH Link。'
  return host.peers.map((peer) => `- ${peer.name} (${peer.id}, ${peer.platform ?? 'unknown'})`).join('\n')
}

/** Resolve a device argument or explain what is online. */
function requireDevice(host, ref) {
  try {
    return host.resolvePeer(ref)
  } catch (error) {
    throw new LinkError('offline', `${errorMessage(error)}\n在线设备：\n${formatPeers(host)}`)
  }
}

/** Build one registry-ready tool definition. */
function makeTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
    },
    async execute(args, exec) {
      return await spec.execute(args ?? {}, exec)
    },
  }
}

/** All tools this plugin registers. */
function toolDefinitions(host) {
  return [
    makeTool({
      name: 'link_status',
      description: 'Show this DSH Link device, relay connection state, and the other online DSH computers in the link space.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        const status = await host.status()
        const lines = [
          `DSH Link ${status.version}`,
          `device: ${status.device?.name ?? '(unpaired)'} (${status.device?.id ?? '-'})`,
          `connection: ${status.connection.state}${status.connection.relayUrl ? ` — ${status.connection.relayUrl}` : ''}`,
        ]
        if (status.connection.lastError) lines.push(`last error: ${status.connection.lastError}`)
        lines.push('', 'online devices:', formatPeers(host))
        if (!status.configured) lines.push('', '尚未配对：请在 DSH 设置 → 跨设备 中粘贴配对码。')
        return lines.join('\n')
      },
    }),
    makeTool({
      name: 'link_devices',
      description: 'List the other computers currently online in this DSH Link space.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      async execute() {
        return `online devices:\n${formatPeers(host)}`
      },
    }),
    makeTool({
      name: 'link_sessions',
      description: 'List the Sessions on one remote DSH computer. `device` accepts the peer id or its display name.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Peer id or device name.' },
        },
        required: ['device'],
        additionalProperties: false,
      },
      async execute(args) {
        const peer = requireDevice(host, args.device)
        const result = await host.remoteCall(peer.id, 'session.list', {})
        const items = Array.isArray(result?.items) ? result.items : []
        if (items.length === 0) return `${peer.name} 上没有会话。`
        return items.map((item) => {
          const title = item.title.length > 0 ? item.title : '(untitled)'
          return `- ${item.sessionId}  ${title}${item.running ? '  [running]' : ''}${item.cwd ? `  cwd=${item.cwd}` : ''}`
        }).join('\n')
      },
    }),
    makeTool({
      name: 'link_read',
      description: 'Read the latest messages of one remote Session as plain text.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Peer id or device name.' },
          session_id: { type: 'string', description: 'Remote Session id.' },
          max_messages: { type: 'number', description: 'How many raw messages to request (default 30).' },
        },
        required: ['device', 'session_id'],
        additionalProperties: false,
      },
      async execute(args) {
        const peer = requireDevice(host, args.device)
        const result = await host.remoteCall(peer.id, 'session.history', {
          sessionId: args.session_id,
          maxMessages: clampInt(args.max_messages, 1, 200, 30),
        })
        const records = Array.isArray(result?.records) ? result.records : []
        if (records.length === 0) return `${peer.name} / ${args.session_id}：没有可读记录。`
        const lines = records.map((record) => {
          if (record.kind === 'user') return `[user] ${record.text}`
          if (record.kind === 'assistant') return `[assistant] ${record.text}`
          if (record.kind === 'tool-call') return `[tool:${record.name}] ${record.args}`
          if (record.kind === 'tool-result') return `[tool-result${record.isError ? ':error' : ''}] ${record.text}`
          if (record.kind === 'turn-end') return `[turn ${record.turn} end: ${record.reason}]`
          if (record.kind === 'error') return `[error] ${record.message}`
          return ''
        }).filter((line) => line.length > 0)
        return lines.join('\n\n')
      },
    }),
    makeTool({
      name: 'link_create',
      description: 'Create a new DSH Session on one remote computer and return its Session id.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Peer id or device name.' },
          cwd: { type: 'string', description: 'Optional absolute directory on the remote computer.' },
        },
        required: ['device'],
        additionalProperties: false,
      },
      async execute(args) {
        const peer = requireDevice(host, args.device)
        const result = await host.remoteCall(peer.id, 'session.create', {
          ...(typeof args.cwd === 'string' && args.cwd.length > 0 ? { cwd: args.cwd } : {}),
        })
        return `${peer.name} 上已创建会话：${result.sessionId}`
      },
    }),
    makeTool({
      name: 'link_prompt',
      description: 'Send a prompt to one remote DSH Session, wait for it to finish, and return the newest assistant output. Use link_sessions/link_create first to pick a Session.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Peer id or device name.' },
          session_id: { type: 'string', description: 'Remote Session id.' },
          text: { type: 'string', description: 'Prompt text.' },
          wait_seconds: { type: 'number', description: 'How long to wait for the turn (default 120, max 600).' },
        },
        required: ['device', 'session_id', 'text'],
        additionalProperties: false,
      },
      async execute(args, exec) {
        const peer = requireDevice(host, args.device)
        const before = await host.remoteCall(peer.id, 'session.history', {
          sessionId: args.session_id,
          maxMessages: 2,
        })
        const beforeSeq = Number.isFinite(before?.cursor) ? before.cursor : -1
        await host.remoteCall(peer.id, 'session.prompt', { sessionId: args.session_id, text: args.text })
        const timeoutMs = clampInt(args.wait_seconds, 5, 600, 120) * 1000
        const deadline = Date.now() + timeoutMs
        let sawRunning = false
        let lastAssistant = ''
        while (Date.now() < deadline) {
          if (exec?.signal?.aborted === true) throw new LinkError('bad-request', '已取消等待')
          await sleep(900)
          const history = await host.remoteCall(peer.id, 'session.history', {
            sessionId: args.session_id,
            maxMessages: 40,
          })
          const records = Array.isArray(history?.records) ? history.records : []
          const fresh = records.filter((record) => Number.isFinite(record.seq) && record.seq > beforeSeq)
          const assistant = fresh.filter((record) => record.kind === 'assistant')
          if (assistant.length > 0) lastAssistant = assistant[assistant.length - 1].text
          if (history?.state?.running === true) sawRunning = true
          if (sawRunning && history?.state?.running === false) break
          if (!sawRunning && fresh.some((record) => record.kind === 'assistant') && history?.state?.running === false) break
        }
        if (lastAssistant.length === 0) {
          return `已发送到 ${peer.name} / ${args.session_id}，但等待窗口内没有收到助手回复（会话可能仍在运行）。`
        }
        return `来自 ${peer.name} / ${args.session_id} 的回复：\n\n${lastAssistant}`
      },
    }),
    makeTool({
      name: 'link_cancel',
      description: 'Stop the active turn of one remote DSH Session.',
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: 'Peer id or device name.' },
          session_id: { type: 'string', description: 'Remote Session id.' },
        },
        required: ['device', 'session_id'],
        additionalProperties: false,
      },
      async execute(args) {
        const peer = requireDevice(host, args.device)
        await host.remoteCall(peer.id, 'session.cancel', { sessionId: args.session_id })
        return `已请求停止 ${peer.name} / ${args.session_id} 的当前回合。`
      },
    }),
    makeTool({
      name: 'link_debug',
      description: 'Diagnostics for DSH Link: raw Session list, title projections, workspaces, speech providers, or config. Use when the remote workspace looks empty or titles are missing.',
      parameters: {
        type: 'object',
        properties: {
          what: { type: 'string', enum: ['config', 'sessions', 'titles', 'workspaces', 'speech', 'events', 'raw', 'list', 'state', 'follow', 'speech-test', 'mirror-probe', 'mirror-list', 'mirror-cleanup', 'types', 'tree', 'remote-tree', 'ensure-mirror', 'workspace-snapshot', 'models', 'presets', 'session-info', 'archive-state', 'archive-probe', 'streams', 'rebuild-mirrors', 'watch', 'unwatch'] },
          session_id: { type: 'string', description: 'Required when what is events/raw/state/follow.' },
          before_seq: { type: 'number', description: 'Optional raw-event page cursor.' },
          device: { type: 'string', description: 'Target peer for mirror-probe.' },
          title: { type: 'string', description: 'Mirror title for mirror-probe.' },
        },
        required: ['what'],
        additionalProperties: false,
      },
      async execute(args) {
        const value = await host.debugInfo(args.what, { sessionId: args.session_id, beforeSeq: args.before_seq, device: args.device, title: args.title })
        return JSON.stringify(value, null, 2)
      },
    }),
  ]
}

/* -------------------------------------------------------------------------- */
/* HTTP API for the Client half                                               */
/* -------------------------------------------------------------------------- */

/** JSON response with no caching. */
function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** Parse a JSON body defensively. */
async function readJsonBody(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** Serve one operation of the local UI API. */
async function handleApiRoute(request, host) {
  if (request.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method not allowed' })
  const body = await readJsonBody(request)
  if (body === null || typeof body !== 'object') return jsonResponse(400, { ok: false, error: 'expected a JSON body' })
  try {
    switch (body.op) {
      case 'status':
        return jsonResponse(200, { ok: true, status: await host.status() })
      case 'save': {
        if (typeof body.pairingCode !== 'string') return jsonResponse(400, { ok: false, error: '缺少配对码' })
        return jsonResponse(200, { ok: true, status: await host.savePairing(body.pairingCode, body.deviceName) })
      }
      case 'forget':
        return jsonResponse(200, { ok: true, status: await host.forget() })
      case 'sessions': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.list', {})
        return jsonResponse(200, { ok: true, items: Array.isArray(result?.items) ? result.items : [] })
      }
      case 'workspaces': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'workspace.list', {})
        return jsonResponse(200, { ok: true, items: Array.isArray(result?.items) ? result.items : [] })
      }
      case 'history': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.history', {
          sessionId: body.sessionId,
          maxMessages: clampInt(body.maxMessages, 1, 200, 60),
        })
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'send': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.prompt', {
          sessionId: body.sessionId,
          text: body.text,
          mode: body.mode === 'steer' ? 'steer' : 'queue',
        })
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'cancel': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.cancel', { sessionId: body.sessionId })
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'create': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.create', {
          ...(typeof body.workspaceId === 'string' && body.workspaceId.length > 0 ? { workspaceId: body.workspaceId } : {}),
          ...(typeof body.cwd === 'string' && body.cwd.length > 0 ? { cwd: body.cwd } : {}),
        })
        const mirror = await host.ensureMirrorSession(peer.id, result.sessionId).catch(() => undefined)
        return jsonResponse(200, { ok: true, ...result, localSessionId: mirror?.localSessionId ?? '' })
      }
      case 'tree': {
        const tree = typeof body.deviceId === 'string' && body.deviceId.length > 0
          ? await host.remoteTree(body.deviceId)
          : await host.localTree()
        return jsonResponse(200, { ok: true, tree })
      }
      case 'ensureMirror': {
        const peer = requireDevice(host, body.deviceId)
        const mirror = await host.ensureMirrorSession(peer.id, body.sessionId)
        return jsonResponse(200, { ok: true, ...mirror })
      }
      case 'archive': {
        if (typeof body.sessionId !== 'string') return jsonResponse(400, { ok: false, error: '缺少 sessionId' })
        const archived = body.archived !== false
        if (typeof body.deviceId === 'string' && body.deviceId.length > 0) {
          const peer = requireDevice(host, body.deviceId)
          await host.remoteCall(peer.id, archived ? 'session.archive' : 'session.unarchive', { sessionId: body.sessionId })
          const mirror = host.mirrorForRemote(peer.id, body.sessionId)
          const registry = host.service('workspaceRegistry')
          if (mirror !== undefined && registry !== undefined) {
            if (archived) await registry.archiveSession(mirror.entry.localId, { stopActivity: true }).catch(() => {})
            else await registry.unarchiveSession(mirror.entry.localId).catch(() => {})
          }
          return jsonResponse(200, { ok: true })
        }
        const registry = host.service('workspaceRegistry')
        if (registry === undefined) return jsonResponse(400, { ok: false, error: '本机缺少 workspaceRegistry' })
        if (archived) await registry.archiveSession(body.sessionId, { stopActivity: true })
        else await registry.unarchiveSession(body.sessionId)
        return jsonResponse(200, { ok: true })
      }
      case 'renameWorkspace': {
        if (typeof body.deviceId !== 'string' || typeof body.workspaceId !== 'string' || typeof body.title !== 'string') {
          return jsonResponse(400, { ok: false, error: '缺少 deviceId/workspaceId/title' })
        }
        const peer = requireDevice(host, body.deviceId)
        const title = body.title.trim()
        if (title.length === 0) return jsonResponse(400, { ok: false, error: '标题不能为空' })
        await host.remoteCall(peer.id, 'workspace.rename', { workspaceId: body.workspaceId, title })
        const mapping = host.mirrors.devices?.[peer.id]?.workspaces?.[body.workspaceId]
        if (mapping !== undefined) {
          mapping.title = title
          const registry = host.service('workspaceRegistry')
          const workspace = registry?.get(mapping.localWorkspaceId)
          if (workspace !== undefined) {
            const deviceName = host.mirrors.devices[peer.id].name
            const shortName = (deviceName.length > 20 ? deviceName.slice(-14) : deviceName).replace(/\.local$/iu, '')
            await workspace.setTitle(`[远程] ${title} · ${shortName}`).catch(() => {})
          }
          host.saveMirrorStore()
        }
        return jsonResponse(200, { ok: true, title })
      }
      case 'models': {
        const peer = requireDevice(host, body.deviceId)
        const catalog = await host.remoteCall(peer.id, 'model.catalog', {})
        return jsonResponse(200, { ok: true, catalog })
      }
      case 'selectModel': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.selectModel', {
          sessionId: body.sessionId,
          selection: body.selection,
        })
        // Keep the open native mirror aligned so the next forwarded prompt does
        // not push the old selection back over this explicit remote change.
        const applied = host.normalizeModelSelection(result?.selected) ?? host.normalizeModelSelection(body.selection)
        const mirror = host.mirrorForRemote(peer.id, body.sessionId)
        if (mirror !== undefined && applied !== null) {
          try {
            if (await host.applyMirrorModel(mirror.entry.localId, applied)) {
              host.mirrorModelStates.set(mirror.entry.localId, { local: applied, remote: applied })
            }
          } catch (error) {
            host.log('warn', `dsh-link: mirror model settings push ${mirror.entry.localId}: ${errorMessage(error)}`)
          }
        }
        return jsonResponse(200, { ok: true, result })
      }
      case 'rename': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.rename', {
          sessionId: body.sessionId,
          title: body.title,
        })
        const mirror = host.mirrorForRemote(peer.id, body.sessionId)
        if (mirror !== undefined) {
          mirror.entry.title = typeof result?.title === 'string' ? result.title : body.title
          const local = host.service('sessions')?.get(mirror.entry.localId)
          if (local !== undefined) await host.renameMirror(local, mirror.entry, mirror.entry.title)
          host.saveMirrorStore()
        }
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'sessionInfo': {
        if (typeof body.sessionId !== 'string') return jsonResponse(400, { ok: false, error: '缺少 sessionId' })
        if (typeof body.deviceId === 'string' && body.deviceId.length > 0) {
          const peer = requireDevice(host, body.deviceId)
          return jsonResponse(200, { ok: true, session: await host.remoteCall(peer.id, 'session.info', { sessionId: body.sessionId }) })
        }
        return jsonResponse(200, { ok: true, session: await host.sessionInfo(body.sessionId) })
      }
      case 'presets': {
        if (typeof body.deviceId === 'string' && body.deviceId.length > 0) {
          const peer = requireDevice(host, body.deviceId)
          return jsonResponse(200, { ok: true, roster: await host.remoteCall(peer.id, 'agent.presets', {}) })
        }
        return jsonResponse(200, { ok: true, roster: await host.agentPresetList() })
      }
      case 'selectPreset': {
        if (typeof body.deviceId !== 'string' || typeof body.sessionId !== 'string' || typeof body.agentPreset !== 'string') {
          return jsonResponse(400, { ok: false, error: '缺少 deviceId/sessionId/agentPreset' })
        }
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.selectPreset', { sessionId: body.sessionId, agentPreset: body.agentPreset })
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'localRenameSession': {
        if (typeof body.sessionId !== 'string' || typeof body.title !== 'string') return jsonResponse(400, { ok: false, error: '缺少 sessionId/title' })
        const result = await host.requireSessions().rename({ sessionId: body.sessionId, title: body.title.trim().slice(0, 200) })
        return jsonResponse(200, { ok: true, title: typeof result?.title === 'string' ? result.title : body.title })
      }
      case 'localRenameWorkspace': {
        if (typeof body.workspaceId !== 'string' || typeof body.title !== 'string') return jsonResponse(400, { ok: false, error: '缺少 workspaceId/title' })
        const registry = host.service('workspaceRegistry')
        const workspace = registry?.get(body.workspaceId)
        if (workspace === undefined) return jsonResponse(404, { ok: false, error: '工作区不存在' })
        await workspace.setTitle(body.title.trim().slice(0, 120))
        return jsonResponse(200, { ok: true, title: body.title })
      }
      case 'localModels':
        return jsonResponse(200, { ok: true, catalog: await host.requireSessions().modelCatalog() })
      case 'mirrors':
        return jsonResponse(200, { ok: true, items: host.mirrorList() })
      case 'watch': {
        if (typeof body.sessionId !== 'string') return jsonResponse(400, { ok: false, error: '缺少 sessionId' })
        return jsonResponse(200, { ok: true, ...host.watchMirror(body.sessionId) })
      }
      case 'unwatch': {
        if (typeof body.sessionId !== 'string') return jsonResponse(400, { ok: false, error: '缺少 sessionId' })
        host.unwatchMirror(body.sessionId)
        return jsonResponse(200, { ok: true })
      }
      case 'sync':
        await host.syncMirrors()
        return jsonResponse(200, { ok: true, items: host.mirrorList() })
      case 'transcribe': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'speech.transcribe', {
          audioBase64: body.audioBase64,
          language: body.language,
        }, SPEECH_TIMEOUT_MS)
        return jsonResponse(200, { ok: true, ...result })
      }
      default:
        return jsonResponse(400, { ok: false, error: `unknown op ${String(body.op)}` })
    }
  } catch (error) {
    const protocolError = toProtocolError(error)
    return jsonResponse(400, { ok: false, error: protocolError.message, code: protocolError.code })
  }
}

/** Serve one NDJSON follow stream for the local UI. */
async function handleStreamRoute(request, host) {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const body = await readJsonBody(request)
  if (body === null || typeof body !== 'object' || typeof body.deviceId !== 'string' || typeof body.sessionId !== 'string') {
    return jsonResponse(400, { ok: false, error: 'expected deviceId and sessionId' })
  }
  const encoder = new TextEncoder()
  let subscription
  let closed = false
  const stream = new ReadableStream({
    start(controller) {
      const write = (value) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
        } catch {
          closed = true
        }
      }
      const finish = () => {
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      request.signal.addEventListener('abort', () => {
        subscription?.cancel()
        finish()
      })
      try {
        const peer = host.resolvePeer(body.deviceId)
        subscription = host.remoteSubscribe(peer.id, 'session.follow', { sessionId: body.sessionId }, {
          onEvent: (data) => {
            if (data !== null && typeof data === 'object') write({ type: data.t ?? 'frame', ...data })
          },
          onError: (error) => {
            const protocolError = toProtocolError(error)
            write({ type: 'error', code: protocolError.code, message: protocolError.message })
            finish()
          },
          onEnd: () => {
            write({ type: 'end' })
            finish()
          },
        })
        write({ type: 'opened', deviceId: peer.id, sessionId: body.sessionId })
      } catch (error) {
        const protocolError = toProtocolError(error)
        write({ type: 'error', code: protocolError.code, message: protocolError.message })
        finish()
      }
    },
    cancel() {
      subscription?.cancel()
      closed = true
    },
  })
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}

/* -------------------------------------------------------------------------- */
/* Plugin entry                                                               */
/* -------------------------------------------------------------------------- */

/** Register the Host half: relay lifecycle, prompt section, tools, and API. */
export function apply(ctx) {
  const host = new LinkHost(ctx)

  ctx.effect(() => {
    let disposed = false
    host.start().catch((error) => {
      if (!disposed) host.log('warn', `dsh-link: start failed: ${errorMessage(error)}`)
    })
    return () => {
      disposed = true
      host.stop()
    }
  }, 'dsh-link: relay lifecycle')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'dsh-link:peers',
    order: 810,
    interpolate: false,
    text: () => {
      try {
        if (host.peers.length === 0) return ''
        const lines = host.peers.map((peer) => `- ${peer.name} (${peer.id}, ${peer.platform ?? 'unknown'})`)
        return [
          '## DSH Link remote computers',
          'These computers run DSH and are online through your relay. Use link_sessions / link_read / link_prompt / link_create / link_cancel to inspect and drive their Sessions when the user asks you to operate another computer.',
          ...lines,
        ].join('\n')
      } catch {
        return ''
      }
    },
  }), 'dsh-link: system prompt section')

  ctx.effect(() => {
    const disposers = toolDefinitions(host).map((definition) => ctx.tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-link: tools')

  // Native mirror Sessions must never run their local model. Reject the step
  // before a request is built and forward the admitted prompt to the remote
  // Host instead; the live watch mirrors the remote reply back into the log.
  ctx.effect(() => ctx.on('agent/pre-step', (payload, next) => {
    const decision = host.handleMirrorPreStep(payload)
    return decision === undefined ? next() : decision
  }), 'dsh-link: mirror prompt gate')

  // A native New Session created inside a mirrored project would otherwise be
  // an ordinary local Session. Bind it to a blank remote Session immediately so
  // its first prompt goes through the mirror gate.
  ctx.effect(() => ctx.on('session/created', (session) => {
    const cwd = session?.header?.cwd ?? ''
    if (!host.isMirrorPath(cwd)) return
    if (host.mirrorForLocal(session.id) !== undefined) return
    void host.provisionUnmappedMirror(session.id, cwd, '', 0).catch((error) => {
      host.log('warn', `dsh-link: bind mirror workspace session: ${errorMessage(error)}`)
    })
  }), 'dsh-link: bind mirror workspace sessions')

  // Optional Web carrier: headless compositions keep the tools but have no UI
  // route to serve.
  ctx.inject(['connection'], (child) => {
    child.effect(() => child.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleApiRoute(request, host),
    }), 'dsh-link: status api')
    child.effect(() => child.connection.fetch.register({
      path: STREAM_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleStreamRoute(request, host),
    }), 'dsh-link: session stream')
  })
}

/** Test-only handles; the Loader ignores extra named exports. */
export const __testing = { LinkHost, RelayClient, handleApiRoute, handleStreamRoute }
