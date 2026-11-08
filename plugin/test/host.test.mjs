/**
 * Host-half harness: exercises the real plugin module against mock DSH services.
 * This is a development test, not shipped runtime code.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-link-test-'))

const {
  apply,
  encodePairingCode,
  __testing: { LinkHost, handleApiRoute, handleStreamRoute },
} = await import('../index.js')

const TOKEN = 'ab'.repeat(32)
const PAIRING = encodePairingCode('wss://example.test:8443', TOKEN)

const rawEvents = [
  { type: 'session/title', seq: 1, time: 1, data: { title: '测试会话' } },
  { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '你好' }] } },
  { type: 'assistant/message', seq: 3, time: 3, data: { message: { content: [{ type: 'text', text: '你好！' }] } } },
  { type: 'tool/call', seq: 4, time: 4, data: { callId: 't1', name: 'bash', arguments: '{"command":"ls"}' } },
  { type: 'tool/result', seq: 5, time: 5, data: { message: { toolCallId: 't1', content: [{ type: 'text', text: 'ok' }] } } },
  { type: 'turn/end', seq: 6, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
]
const records = () => rawEvents.map((event) => ({ type: 'event', event }))

function makeCredentialStore() {
  const records = new Map()
  return {
    async readRecord(key) {
      return records.get(key)
    },
    async describeRecord(key) {
      return { configured: records.has(key) }
    },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key))
      records.set(key, next)
      return next
    },
    async deleteRecord(key) {
      records.delete(key)
    },
    entries: records,
  }
}

function makeWav(seconds = 0.3) {
  const sampleRate = 16000
  const samples = Math.floor(sampleRate * seconds)
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * 440 * Math.PI * 2) * 8000)
    buffer.writeInt16LE(value, 44 + index * 2)
  }
  return buffer
}

function makeServices() {
  const credentials = makeCredentialStore()
  const sessionController = {
    async list() {
      return {
        items: [
          {
            sessionId: 'session-a',
            updatedAt: 9,
            running: false,
            agentAvailable: true,
            blank: false,
            cwd: '/tmp/project',
            projections: { kind: 'cached', asOfSeq: 6, values: { title: '测试会话' } },
          },
        ],
      }
    },
    async events(_request, _signal) {
      return { records: records(), cursor: 6, hasMore: false }
    },
    async state() {
      return { active: false, running: false, queue: [], pendingInput: [] }
    },
    async *follow() {
      yield { type: 'snapshot', header: { id: 'session-a' }, cursor: 5, records: records().slice(0, 3), projections: {} }
      for (const record of records().slice(3)) yield { type: 'event', event: record.event }
    },
    async prompt(request) {
      this.lastPrompt = request
      return { accepted: true }
    },
    async cancel() {
      return { accepted: true }
    },
    async rename(request) {
      return { title: request.title }
    },
    async create(request) {
      this.lastCreate = request
      return { sessionId: 'session-new' }
    },
  }
  const speechToText = {
    snapshot() {
      return {
        providers: [
          {
            id: 'sensevoice-local',
            name: 'SenseVoiceSmall',
            languages: ['auto', 'zh', 'en'],
            preparation: { phase: 'standby' },
          },
        ],
        selection: { providerId: 'sensevoice-local', language: 'zh' },
      }
    },
    prepare() {},
    resolve(request) {
      return { ...request, provider: { id: 'sensevoice-local' } }
    },
    async transcribe(spec) {
      return { text: '识别结果', audioSeconds: spec.audio.byteLength / 32000, inferenceSeconds: 0.2 }
    },
  }
  const workspaceRegistry = {
    list() {
      return [{ id: 'ws-1', title: '项目', path: '/tmp/project' }]
    },
  }
  return { credentials, sessionController, speechToText, workspaceRegistry }
}

function makeContext(services) {
  const tools = new Map()
  const routes = new Map()
  const sections = []
  const ctx = {
    credentials: services.credentials,
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return () => routes.delete(route.path)
        },
      },
    },
    get(key) {
      return services[key]
    },
    effect(callback) {
      return callback()
    },
    inject(_names, callback) {
      callback(ctx)
    },
    logger: { info() {}, warn() {} },
  }
  return { ctx, tools, routes, sections }
}

test('apply registers tools, prompt section, and both API routes', () => {
  const services = makeServices()
  const { ctx, tools, routes, sections } = makeContext(services)
  apply(ctx)
  assert.equal(sections.length, 1)
  assert.equal(routes.size, 2)
  assert.deepEqual([...tools.keys()].sort(), [
    'link_cancel', 'link_create', 'link_debug', 'link_devices',
    'link_prompt', 'link_read', 'link_sessions', 'link_status',
  ])
})

function makeHost(services) {
  const { ctx } = makeContext(services)
  const host = new LinkHost(ctx)
  host.config = {
    version: 1,
    deviceId: 'dev_test',
    deviceName: '测试主机',
    relayUrl: 'wss://example.test:8443',
    language: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  host.token = TOKEN
  host.state = 'connected'
  host.peers = [{ id: 'dev_peer', name: '出差笔记本', platform: 'windows' }]
  return host
}

test('local methods map sessions, history, state, and workspaces', async () => {
  const services = makeServices()
  const host = makeHost(services)
  const info = await host.invokeLocal('device.info')
  assert.equal(info.deviceId, 'dev_test')
  assert.equal(info.speech.available, true)
  assert.equal(info.workspaceDefault, '/tmp/project')

  const list = await host.invokeLocal('session.list')
  assert.equal(list.items[0].title, '测试会话')
  assert.equal(list.items[0].cwd, '/tmp/project')

  const workspaces = await host.invokeLocal('workspace.list')
  assert.equal(workspaces.items[0].workspaceId, 'ws-1')

  const history = await host.invokeLocal('session.history', { sessionId: 'session-a' })
  assert.equal(history.cursor, 6)
  assert.equal(history.title, '测试会话')
  assert.deepEqual(history.records.map((record) => record.kind), ['user', 'assistant', 'tool-call', 'tool-result', 'turn-end'])
  assert.equal(history.records[0].text, '你好')

  const created = await host.invokeLocal('session.create', { cwd: '/tmp/project' })
  assert.equal(created.sessionId, 'session-new')
  const prompt = await host.invokeLocal('session.prompt', { sessionId: 'session-a', text: '继续' })
  assert.deepEqual(prompt, { accepted: true })
  assert.equal(services.sessionController.lastPrompt.content[0].text, '继续')

  const speech = await host.invokeLocal('speech.transcribe', {
    audioBase64: makeWav().toString('base64'),
    language: 'zh',
  })
  assert.equal(speech.text, '识别结果')
})

test('follow streams a snapshot, records, and state frames', async () => {
  const host = makeHost(makeServices())
  const frames = []
  for await (const frame of host.followSession('session-a', new AbortController().signal)) frames.push(frame)
  assert.equal(frames[0].t, 'ready')
  const snapshot = frames.find((frame) => frame.t === 'snapshot')
  assert.equal(snapshot.records.length, 2)
  assert.equal(snapshot.cursor, 5)
  const kinds = frames.filter((frame) => frame.t === 'record').map((frame) => frame.record.kind)
  assert.deepEqual(kinds, ['tool-call', 'tool-result', 'turn-end'])
  assert.ok(frames.some((frame) => frame.t === 'state'))
})

test('HTTP status/save/forget use the credential store and config file', async () => {
  const services = makeServices()
  const host = makeHost(services)
  const call = async (body) => {
    const response = await handleApiRoute(new Request('http://localhost/api/dsh-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), host)
    return { status: response.status, body: await response.json() }
  }
  const initial = await call({ op: 'status' })
  assert.equal(initial.status, 200)
  assert.equal(initial.body.status.configured, true)
  assert.equal(initial.body.status.peers.length, 1)

  const saved = await call({ op: 'save', pairingCode: PAIRING, deviceName: '新名字' })
  assert.equal(saved.body.status.device.name, '新名字')
  assert.equal(saved.body.status.device.id, 'dev_test')
  assert.ok(saved.body.status.pairingCode.startsWith('dshlink1.'))
  assert.ok(existsSync(join(process.env.DSH_HOME, 'dsh-link', 'config.json')))
  assert.ok(services.credentials.entries.has('dsh-link/token'))

  const forgotten = await call({ op: 'forget' })
  assert.equal(forgotten.body.status.configured, false)
  assert.equal(services.credentials.entries.has('dsh-link/token'), false)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'dsh-link', 'config.json')), false)
})

test('HTTP stream route forwards follow frames as NDJSON', async () => {
  const host = makeHost(makeServices())
  host.remoteSubscribe = (_device, _method, _params, handlers) => {
    setTimeout(async () => {
      handlers.onEvent({ t: 'ready', sessionId: 'session-a' })
      handlers.onEvent({ t: 'snapshot', records: [], cursor: -1, state: { running: false } })
      handlers.onEnd()
    }, 0)
    return { cancel() {} }
  }
  const response = await handleStreamRoute(new Request('http://localhost/api/dsh-link/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'follow', deviceId: 'dev_peer', sessionId: 'session-a' }),
  }), host)
  assert.equal(response.status, 200)
  const text = await response.text()
  const lines = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.ok(lines.some((line) => line.type === 'opened'))
  assert.ok(lines.some((line) => line.type === 'snapshot'))
  assert.ok(lines.some((line) => line.type === 'end'))
})

test('pairing import file is consumed once', async () => {
  const services = makeServices()
  const host = makeHost(services)
  host.config = undefined
  host.token = undefined
  writeFileSync(join(process.env.DSH_HOME, 'dsh-link', 'pairing.txt'), `${PAIRING}\n`, { mode: 0o600 })
  await host.importPairingFile()
  assert.equal(host.config.relayUrl, 'wss://example.test:8443')
  assert.equal(services.credentials.entries.get('dsh-link/token').key, TOKEN)
  assert.equal(existsSync(join(process.env.DSH_HOME, 'dsh-link', 'pairing.txt')), false)
  // 0600 on the config document
  const stat = readFileSync(join(process.env.DSH_HOME, 'dsh-link', 'config.json'), 'utf8')
  assert.ok(stat.includes('dev_'))
})

test('cleanup', () => {
  rmSync(process.env.DSH_HOME, { recursive: true, force: true })
})
