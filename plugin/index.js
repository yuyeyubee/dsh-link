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
import { randomBytes, randomUUID } from 'node:crypto'
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
import { join } from 'node:path'

/** Loader row identity of this plugin. */
export const name = 'dsh-link'

/** Services this plugin cannot work without. */
export const inject = ['tools', 'systemPrompt', 'credentials']

/** Version reported to peers and the Web UI. */
const VERSION = '1.0.0'
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
      const record = { kind: 'assistant', seq, time, text: truncate(text, MAX_TEXT) }
      if (reasoning.length > 0) record.reasoning = truncate(reasoning, MAX_REASONING)
      return record
    }
    case 'tool/call': {
      const callId = typeof data.callId === 'string' ? data.callId : ''
      const toolName = typeof data.name === 'string' ? data.name : 'tool'
      const args = typeof data.arguments === 'string' ? data.arguments : ''
      return { kind: 'tool-call', seq, time, callId, name: toolName, args: truncate(args, MAX_ARGS) }
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
    await this.importPairingFile()
    if (this.isConfigured()) this.connectRelay()
    else this.setState('unconfigured')
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
      },
      onState: (state) => {
        this.setState(state)
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
      version: VERSION,
    }
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
      workspaceDefault: this.workspaces()[0]?.path ?? null,
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
        yield { t: 'snapshot', records, cursor: Number.isFinite(frame.cursor) ? frame.cursor : -1, state }
        if (title.length > 0) yield { t: 'title', title }
        snapshotSent = true
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

  /* ------------------------------ RPC routing ----------------------------- */

  /** Execute one local method for a remote caller. */
  async invokeLocal(method, params, signal) {
    switch (method) {
      case 'ping':
        return { pong: true, time: Date.now() }
      case 'device.info':
        return await this.deviceInfo()
      case 'workspace.list':
        return { items: this.workspaceItems() }
      case 'session.list':
        return { items: await this.sessionList() }
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
        return { ok: true, hint: 'what: config | sessions | titles | workspaces | speech | events(sessionId)' }
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
          what: { type: 'string', enum: ['config', 'sessions', 'titles', 'workspaces', 'speech', 'events', 'raw', 'list', 'state', 'follow', 'speech-test'] },
          session_id: { type: 'string', description: 'Required when what is events/raw/state/follow.' },
          before_seq: { type: 'number', description: 'Optional raw-event page cursor.' },
        },
        required: ['what'],
        additionalProperties: false,
      },
      async execute(args) {
        const value = await host.debugInfo(args.what, { sessionId: args.session_id, beforeSeq: args.before_seq })
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
        return jsonResponse(200, { ok: true, ...result })
      }
      case 'rename': {
        const peer = requireDevice(host, body.deviceId)
        const result = await host.remoteCall(peer.id, 'session.rename', {
          sessionId: body.sessionId,
          title: body.title,
        })
        return jsonResponse(200, { ok: true, ...result })
      }
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
