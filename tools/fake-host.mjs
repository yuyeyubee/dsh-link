#!/usr/bin/env node
/**
 * DSH Link fake host for development and end-to-end plumbing tests.
 *
 * It speaks the same relay protocol as the DSH plugin, but its Sessions are
 * canned. Use it to exercise the Web UI / Android app / agent tools before the
 * second physical computer is available.
 *
 *   node tools/fake-host.mjs --pairing-file ~/.dsh/dsh-link/pairing.txt \
 *     --name "出差笔记本" --id dev_fake_laptop
 */
import { readFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    const name = key.slice(2)
    const value = argv[index + 1] !== undefined && !argv[index + 1].startsWith('--') ? argv[++index] : 'true'
    args[name] = value
  }
  return args
}

function decodePairing(code) {
  const text = code.trim()
  if (!text.startsWith('dshlink1.')) throw new Error('not a dshlink1 pairing code')
  const payload = JSON.parse(Buffer.from(text.slice('dshlink1.'.length), 'base64url').toString('utf8'))
  if (payload.v !== 1) throw new Error(`unsupported pairing v${payload.v}`)
  return { url: payload.u, token: payload.t }
}

const args = parseArgs(process.argv.slice(2))
if (!args['pairing-file'] && (!args.url || !args.token)) {
  console.error('usage: --pairing-file <file> | --url <wss-url> --token <token> [--name <name>] [--id <device-id>]')
  process.exit(2)
}
const pairing = args['pairing-file']
  ? decodePairing(readFileSync(args['pairing-file'], 'utf8'))
  : { url: args.url, token: args.token }
const name = args.name ?? '模拟电脑（fake host）'
const deviceId = args.id ?? 'dev_fake_laptop'

const sessions = [
  {
    sessionId: 'session-fake-1',
    title: '演示：修复构建失败',
    cwd: '/Users/you/project',
    updatedAt: Date.now() - 60_000,
    running: false,
    agentAvailable: true,
    blank: false,
    parentSessionId: null,
    records: [
      { kind: 'user', seq: 1, time: Date.now() - 600_000, text: '帮我看看构建为什么失败' },
      { kind: 'assistant', seq: 2, time: Date.now() - 590_000, text: '我先看一下构建日志。' },
      { kind: 'tool-call', seq: 3, time: Date.now() - 580_000, callId: 'c1', name: 'bash', args: '{"command":"npm run build"}' },
      { kind: 'tool-result', seq: 4, time: Date.now() - 570_000, callId: 'c1', name: 'bash', isError: false, text: 'build failed: missing dependency' },
      { kind: 'turn-end', seq: 5, time: Date.now() - 560_000, turn: 1, reason: 'completed' },
      { kind: 'assistant', seq: 6, time: Date.now() - 550_000, text: '缺少依赖，已补上并重新安装。' },
    ],
  },
]
const subscriptions = new Map()
let seqCounter = 100

const socket = new WebSocket(pairing.url)
const pending = new Map()

function send(frame) {
  socket.send(JSON.stringify(frame))
}

socket.addEventListener('open', () => {
  send({
    t: 'hello',
    v: 1,
    role: 'host',
    token: pairing.token,
    device: { id: deviceId, name, platform: 'linux' },
  })
})

function addRecord(session, record) {
  session.records.push(record)
  session.updatedAt = Date.now()
  for (const [rid, sub] of subscriptions) {
    if (sub.sessionId !== session.sessionId) continue
    send({ t: 'event', rid, data: { t: 'record', record } })
    send({ t: 'event', rid, data: { t: 'state', state: stateOf(session) } })
  }
}

function stateOf(session) {
  return { active: false, running: session.running, queueCount: 0, pendingInput: [] }
}

function summaryOf(session) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    running: session.running,
    active: false,
    agentAvailable: true,
    blank: session.records.length === 0,
    parentSessionId: null,
  }
}

const devices = {
  async 'device.info'() {
    return {
      deviceId, name, platform: 'linux', version: '1.0.0', dshVersion: '0.2.2-rc.1',
      time: Date.now(), workspaceDefault: '/Users/you/project',
      capabilities: ['sessions', 'speech'],
      speech: { available: true, phase: 'ready', providers: [{ id: 'sensevoice-local', name: 'SenseVoiceSmall', languages: ['auto', 'zh', 'en'] }], language: 'zh' },
    }
  },
  async 'workspace.list'() {
    return { items: [{ workspaceId: 'ws-fake-1', title: 'project', path: '/Users/you/project' }] }
  },
  async 'session.list'() {
    return { items: sessions.map(summaryOf) }
  },
  async 'session.create'() {
    const session = {
      sessionId: `session-fake-${sessions.length + 1}`,
      title: '新的模拟会话',
      cwd: '/Users/you/project',
      updatedAt: Date.now(),
      running: false,
      agentAvailable: true,
      blank: true,
      parentSessionId: null,
      records: [],
    }
    sessions.unshift(session)
    return { sessionId: session.sessionId }
  },
  async 'session.history'(params) {
    const session = sessions.find((item) => item.sessionId === params.sessionId)
    if (!session) throw { code: 'not-found', message: 'no such session' }
    return {
      records: session.records.slice(-60),
      cursor: session.records.length > 0 ? session.records[session.records.length - 1].seq : -1,
      hasMore: false,
      state: stateOf(session),
      title: session.title,
    }
  },
  async 'session.state'(params) {
    const session = sessions.find((item) => item.sessionId === params.sessionId)
    if (!session) throw { code: 'not-found', message: 'no such session' }
    return stateOf(session)
  },
  async 'session.prompt'(params) {
    const session = sessions.find((item) => item.sessionId === params.sessionId)
    if (!session) throw { code: 'not-found', message: 'no such session' }
    const seq = ++seqCounter
    addRecord(session, { kind: 'user', seq, time: Date.now(), text: params.text })
    session.running = true
    setTimeout(() => {
      session.running = false
      addRecord(session, {
        kind: 'assistant',
        seq: ++seqCounter,
        time: Date.now(),
        text: `模拟回复：收到「${String(params.text).slice(0, 80)}」。这是来自 ${name} 的演示响应。`,
      })
      addRecord(session, { kind: 'turn-end', seq: ++seqCounter, time: Date.now(), turn: 2, reason: 'completed' })
    }, 1200)
    return { accepted: true }
  },
  async 'session.cancel'() {
    return { accepted: true }
  },
  async 'session.rename'(params) {
    const session = sessions.find((item) => item.sessionId === params.sessionId)
    if (!session) throw { code: 'not-found', message: 'no such session' }
    session.title = params.title
    return { title: params.title }
  },
  async 'speech.status'() {
    return { available: true, phase: 'ready', providers: [{ id: 'sensevoice-local', name: 'SenseVoiceSmall', languages: ['auto', 'zh', 'en'] }], language: 'zh' }
  },
  async 'speech.transcribe'() {
    return { text: '这是模拟语音识别结果，可编辑后发送。', audioSeconds: 2.4, inferenceSeconds: 0.3, provider: 'sensevoice-local' }
  },
}

function startFollow(rid, params) {
  const session = sessions.find((item) => item.sessionId === params.sessionId)
  if (!session) {
    send({ t: 'reply', rid, ok: false, error: { code: 'not-found', message: 'no such session' } })
    return
  }
  send({ t: 'reply', rid, ok: true, result: { stream: true } })
  subscriptions.set(rid, { sessionId: params.sessionId })
  send({ t: 'event', rid, data: { t: 'ready', sessionId: session.sessionId, title: session.title } })
  send({ t: 'event', rid, data: { t: 'snapshot', records: session.records.slice(-60), cursor: session.records.at(-1)?.seq ?? -1, state: stateOf(session) } })
  send({ t: 'event', rid, data: { t: 'state', state: stateOf(session) } })
}

socket.addEventListener('message', (event) => {
  const frame = JSON.parse(String(event.data))
  if (frame.t === 'welcome') {
    console.log(`[fake-host] connected as ${deviceId} (${name}); peers:`, JSON.stringify(frame.peers))
    return
  }
  if (frame.t === 'presence') {
    console.log('[fake-host] presence:', JSON.stringify(frame.peers))
    return
  }
  if (frame.t === 'call') {
    const { rid, method, params } = frame
    if (method === 'session.follow') {
      startFollow(rid, params)
      return
    }
    const handler = devices[method]
    if (handler === undefined) {
      send({ t: 'reply', rid, ok: false, error: { code: 'bad-request', message: `unknown method ${method}` } })
      return
    }
    Promise.resolve(handler(params)).then(
      (result) => send({ t: 'reply', rid, ok: true, result }),
      (error) => send({ t: 'reply', rid, ok: false, error: { code: error?.code ?? 'internal', message: error?.message ?? String(error) } }),
    )
    return
  }
  if (frame.t === 'unsub') {
    subscriptions.delete(frame.rid)
    send({ t: 'end', rid: frame.rid })
  }
})
