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

function makeFakeSession(id) {
  const events = []
  let seq = 0
  return {
    id,
    events,
    get seq() {
      return seq
    },
    snapshotEvents() {
      return events
    },
    append(type, data, options) {
      const event = { type, seq: ++seq, time: seq, data, ...(options?.surfaceOp === undefined ? {} : { surfaceOp: options.surfaceOp }), ...(options?.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: options.sourceEventSeqs }) }
      events.push(event)
      return event
    },
  }
}

function makeServices() {
  const credentials = makeCredentialStore()
  const liveSessions = new Map()
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
    selectModelCalls: [],
    async selectModel(request) {
      this.selectModelCalls.push(request)
      if (request === null || typeof request !== 'object' || typeof request.provider !== 'string' || typeof request.model !== 'string') {
        throw new Error('session/model-unavailable: provider and model are required')
      }
      return {
        selected: {
          provider: request.provider,
          model: request.model,
          ...(typeof request.reasoningEffort === 'string' && request.reasoningEffort.length > 0 ? { reasoningEffort: request.reasoningEffort } : {}),
        },
      }
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
  return { credentials, sessionController, speechToText, workspaceRegistry, sessions: { get: (id) => liveSessions.get(id) }, liveSessions }
}

function makeContext(services) {
  const tools = new Map()
  const routes = new Map()
  const sections = []
  const emitted = []
  const ctx = {
    credentials: services.credentials,
    emit(name, payload) {
      emitted.push({ name, payload })
    },
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
    on(_event, _listener) {
      return () => {}
    },
    inject(_names, callback) {
      callback(ctx)
    },
    logger: { info() {}, warn() {} },
  }
  return { ctx, tools, routes, sections, emitted }
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
  const { ctx, emitted } = makeContext(services)
  const host = new LinkHost(ctx)
  host.emitted = emitted
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

test('mirror records append native tool events instead of folded text', () => {
  const services = makeServices()
  const host = makeHost(services)
  const session = makeFakeSession('session-mirror')
  services.liveSessions.set('session-mirror', session)
  const entry = { localId: 'session-mirror', remoteSeq: -1, pendingUserTexts: [] }
  const records = [
    { kind: 'turn-start', seq: 1, time: 1, turn: 1 },
    { kind: 'user', seq: 2, time: 2, text: '查一下' },
    { kind: 'assistant', seq: 3, time: 3, turn: 1, step: 1, text: '我先看看' },
    { kind: 'tool-call', seq: 4, time: 4, turn: 1, step: 1, callId: 'c1', name: 'bash', args: '{"command":"ls"}' },
    { kind: 'tool-result', seq: 5, time: 5, turn: 1, step: 1, callId: 'c1', name: 'bash', isError: false, text: 'a.txt' },
    { kind: 'turn-end', seq: 6, time: 6, turn: 1, reason: 'completed' },
  ]
  host.appendMirrorRecords(entry, records)
  assert.deepEqual(session.events.map((event) => event.type), [
    'turn/start', 'user/message', 'step/start', 'assistant/message',
    'tool/call', 'tool/result', 'step/end', 'turn/end',
  ])
  const call = session.events.find((event) => event.type === 'tool/call')
  assert.deepEqual(call.data, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' })
  const result = session.events.find((event) => event.type === 'tool/result')
  assert.equal(result.data.message.role, 'tool')
  assert.equal(result.data.message.source.callId, 'c1')
  assert.equal(result.data.message.toolCallId, 'c1')
  assert.deepEqual(result.data.message.content, [{ type: 'text', text: 'a.txt' }])
  assert.deepEqual(result.sourceEventSeqs, [call.seq])
  const assistant = session.events.find((event) => event.type === 'assistant/message')
  assert.equal(assistant.data.turn, 1)
  assert.equal(assistant.data.step, 1)
  assert.ok(!session.events.some((event) => event.type === 'assistant/message'
    && event.data.message.content.some((block) => block.type === 'text' && block.text.includes('远程工具调用'))))
})

test('mirror replays and settles live assistant frames', () => {
  const services = makeServices()
  const host = makeHost(services)
  const session = makeFakeSession('session-stream')
  services.liveSessions.set('session-stream', session)
  const entry = { localId: 'session-stream', remoteSeq: -1, pendingUserTexts: [] }
  host.publishMirrorAssistantBaseline(entry, session, {
    revision: 0,
    activeAttempt: {
      attemptId: 'attempt-1',
      turn: 2,
      step: 3,
      nextIndex: 2,
      stream: [
        { time: 1, chunk: { type: 'text-delta', text: '你' } },
        { time: 2, chunk: { type: 'text-delta', text: '好' } },
      ],
    },
  })
  const frames = host.emitted.map((item) => item.payload.frame)
  assert.deepEqual(frames.map((frame) => frame.type), ['start', 'chunk', 'chunk'])
  assert.deepEqual(frames.map((frame) => frame.revision), [1, 2, 3])
  assert.deepEqual(frames.map((frame) => frame.index), [undefined, 0, 1])
  assert.deepEqual(frames[0].turn, 1)
  assert.deepEqual(frames[0].step, 1)
  host.appendMirrorRecords(entry, [{ kind: 'assistant', seq: 9, time: 9, turn: 2, step: 3, text: '你好' }])
  const committedSeq = entry.lastCommittedAssistant.seq
  assert.ok(Number.isFinite(committedSeq))
  host.publishMirrorAssistantEnd(entry, session, {
    attemptId: 'attempt-1',
    index: 2,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq: 999 },
  })
  const end = host.emitted.at(-1).payload.frame
  assert.equal(end.type, 'end')
  assert.deepEqual(end.outcome, { kind: 'committed', eventType: 'assistant/message', seq: committedSeq })
})

test('follow opts into the assistant stream and forwards live frames', async () => {
  const services = makeServices()
  let request
  services.sessionController.follow = async function* (value) {
    request = value
    yield { type: 'snapshot', cursor: 0, records: [], projections: {}, assistantStream: { revision: 3 } }
    yield { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 4, index: 0, time: 1, chunk: { type: 'text-delta', text: '流' } } }
  }
  const host = makeHost(services)
  const frames = []
  for await (const frame of host.followSession('session-a', new AbortController().signal)) frames.push(frame)
  assert.equal(request.assistantStream, true)
  assert.deepEqual(frames.find((frame) => frame.t === 'snapshot').assistantStream, { revision: 3 })
  const streamed = frames.find((frame) => frame.t === 'assistant-stream')
  assert.equal(streamed.frame.index, 0)
  assert.equal(streamed.frame.chunk.text, '流')
})

test('streaming preference persists and gates transient mirror frames', async () => {
  const services = makeServices()
  const host = makeHost(services)
  assert.deepEqual((await host.status()).settings, { streaming: true })

  const off = await host.updateSettings({ streaming: false })
  assert.deepEqual(off.settings, { streaming: false })
  assert.equal(host.streamingEnabled(), false)
  const saved = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'dsh-link', 'config.json'), 'utf8'))
  assert.equal(saved.streaming, false)

  const session = makeFakeSession('session-quiet')
  services.liveSessions.set('session-quiet', session)
  const entry = { localId: 'session-quiet', remoteSeq: -1, pendingUserTexts: [] }
  host.publishMirrorAssistantBaseline(entry, session, {
    revision: 0,
    activeAttempt: { attemptId: 'attempt-off', turn: 1, step: 1, nextIndex: 1, stream: [{ time: 1, chunk: { type: 'text-delta', text: '隐' } }] },
  })
  assert.equal(host.emitted.length, 0)

  const response = await handleApiRoute(new Request('http://localhost/api/dsh-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'settings', streaming: true }),
  }), host)
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(payload.status.settings, { streaming: true })
  host.publishMirrorAssistantStart(entry, session, { attemptId: 'attempt-on', turn: 1, step: 1 })
  assert.equal(host.emitted.at(-1).payload.frame.type, 'start')
})

test('changing the streaming setting reopens open mirror watches', async () => {
  const host = makeHost(makeServices())
  let cancelled = 0
  const watched = []
  host.mirrorWatches.set('session-local', { cancel: () => { cancelled += 1 } })
  host.watchMirror = (sessionId) => {
    watched.push(sessionId)
    return { watching: true }
  }
  await host.updateSettings({ streaming: false })
  assert.equal(cancelled, 1)
  assert.deepEqual(watched, ['session-local'])
  await host.updateSettings({ streaming: false })
  assert.equal(cancelled, 1)
  assert.deepEqual(watched, ['session-local'])
})

test('follow without the assistant stream drops live frames and the baseline', async () => {
  const services = makeServices()
  let request
  services.sessionController.follow = async function* (value) {
    request = value
    yield { type: 'snapshot', cursor: 0, records: [], projections: {}, assistantStream: { revision: 3 } }
    yield { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 4, index: 0, time: 1, chunk: { type: 'text-delta', text: '流' } } }
  }
  const host = makeHost(services)
  const frames = []
  for await (const frame of host.followSession('session-a', new AbortController().signal, { assistantStream: false })) frames.push(frame)
  assert.equal(request.assistantStream, false)
  assert.equal(frames.find((frame) => frame.t === 'snapshot').assistantStream, undefined)
  assert.equal(frames.some((frame) => frame.t === 'assistant-stream'), false)
})

test('HTTP stream route strips live frames when streaming is off', async () => {
  const host = makeHost(makeServices())
  host.config = { ...host.config, streaming: false }
  host.remoteSubscribe = (_device, _method, params, handlers) => {
    assert.equal(params.assistantStream, false)
    setTimeout(() => {
      handlers.onEvent({ t: 'ready', sessionId: 'session-a' })
      handlers.onEvent({ t: 'snapshot', records: [], cursor: -1, state: { running: false }, assistantStream: { revision: 2 } })
      handlers.onEvent({ t: 'assistant-stream', frame: { type: 'chunk', attemptId: 'a', revision: 3, index: 0, time: 1, chunk: { type: 'text-delta', text: '隐' } } })
      handlers.onEnd()
    }, 0)
    return { cancel() {} }
  }
  const response = await handleStreamRoute(new Request('http://localhost/api/dsh-link/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'follow', deviceId: 'dev_peer', sessionId: 'session-a' }),
  }), host)
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.some((line) => line.type === 'assistant-stream'), false)
  assert.equal(lines.find((line) => line.type === 'snapshot').assistantStream, undefined)
})

function makeArchiveRegistry() {
  const archived = new Set()
  const deletedWorkspaces = []
  return {
    archived,
    deletedWorkspaces,
    async archiveSession(sessionId) {
      archived.add(sessionId)
    },
    async unarchiveSession(sessionId) {
      archived.delete(sessionId)
    },
    async delete(workspaceId) {
      deletedWorkspaces.push(workspaceId)
    },
    get() {
      return undefined
    },
  }
}

function makeWorkspaceController(archived) {
  return {
    async *follow() {
      yield {
        type: 'baseline',
        value: { items: [], archivedSessionIds: [...archived], pinnedSessionIds: [] },
      }
    },
  }
}

test('mirror sync never unarchives a known mirror Session', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  registry.archived.add('session-mirror')
  services.workspaceRegistry = registry
  services.sessionController.list = async () => ({ items: [{ sessionId: 'session-mirror', cwd: '/tmp/mirror', updatedAt: 1 }] })
  services.liveSessions.set('session-mirror', makeFakeSession('session-mirror'))
  const host = makeHost(services)
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {
          'ws-remote': { localWorkspaceId: 'ws-local', localPath: '/tmp/mirror', title: '项目', remotePath: '/home/p', remoteWorkspaceId: 'ws-remote' },
        },
        sessions: {
          'session-remote': { localId: 'session-mirror', title: '远程会话', remoteSeq: 0, updatedAt: 1, createdAt: '2026-01-01T00:00:00.000Z', workspaceId: 'ws-remote', archiveLocal: true, archiveRemote: true },
        },
      },
    },
  }
  host.remoteCall = async (_peerId, method) => {
    if (method === 'device.info') return { name: '出差笔记本' }
    if (method === 'session.list') return { items: [{ sessionId: 'session-remote', title: '远程会话', cwd: '/tmp/mirror', updatedAt: 2, blank: false, parentSessionId: null }] }
    if (method === 'workspace.list') return { items: [] }
    if (method === 'workspace.snapshot') return { archivedSessionIds: ['session-remote'] }
    return {}
  }
  host.ensureRemoteProjectWorkspace = async () => ({ workspace: { id: 'ws-local', attachSession: async () => {} }, key: '', directory: '/tmp/mirror' })
  host.syncMirrorHistory = async () => {}
  await host.syncPeerMirrors(host.peers[0])
  assert.equal(registry.archived.has('session-mirror'), true)
  const entry = host.mirrors.devices.dev_peer.sessions['session-remote']
  assert.equal(entry.offlineHidden, undefined)
  assert.equal(entry.archiveLocal, true)
})

test('offline prune keeps mirror ids and the remembered archive direction', async () => {  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  host.saveMirrorStore = () => {}
  host.peers = []
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: { 'ws-remote': { localWorkspaceId: 'ws-local', localPath: '/tmp/mirror' } },
        sessions: { 'session-remote': { localId: 'session-mirror', workspaceId: 'ws-remote', archiveLocal: false, archiveRemote: false } },
      },
    },
  }
  await host.pruneOfflinePeerWorkspaces()
  const device = host.mirrors.devices.dev_peer
  assert.equal(device.sessions['session-remote'].localId, 'session-mirror')
  assert.equal(device.sessions['session-remote'].offlineHidden, true)
  // The plugin's own archive is recorded as the observed local state, while the
  // user's direction stays unarchived so the reconnect can restore it.
  assert.equal(device.sessions['session-remote'].archiveLocal, true)
  assert.equal(device.sessions['session-remote'].archiveDesired, false)
  assert.equal(registry.archived.has('session-mirror'), true)
  assert.deepEqual(registry.deletedWorkspaces, ['ws-local'])
  assert.deepEqual(device.workspaces, {})
})

test('archive reconcile follows user changes and restores offline-hidden mirrors', async () => {  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  const calls = []
  host.saveMirrorStore = () => {}
  host.remoteCall = async (_peerId, method, params) => {
    calls.push(`${method}:${params.sessionId}`)
    return {}
  }
  const peer = host.peers[0]

  // Local user archived the mirror: push the archive to the remote.
  registry.archived.add('session-m')
  const entry = { localId: 'session-m', archiveLocal: false, archiveRemote: false }
  await host.syncOneMirrorArchive(peer, 'session-r', entry, new Set(['session-m']), new Set())
  assert.equal(registry.archived.has('session-m'), true)
  assert.deepEqual(calls, ['session.archive:session-r'])
  assert.equal(entry.archiveLocal, true)
  assert.equal(entry.archiveRemote, true)
  assert.equal(entry.archiveDesired, true)

  // A mirror hidden only because its peer is offline is restored, and the
  // unarchive still reaches the peer.
  calls.length = 0
  const hidden = { localId: 'session-x', offlineHidden: true, archiveLocal: true, archiveRemote: true, archiveDesired: true }
  await host.syncOneMirrorArchive(peer, 'session-rx', hidden, new Set(), new Set(['session-rx']))
  assert.deepEqual(calls, ['session.unarchive:session-rx'])
  assert.equal(registry.archived.has('session-x'), false)
  assert.equal(hidden.offlineHidden, undefined)
  assert.equal(hidden.restorePending, true)
  assert.equal(hidden.archiveDesired, false)
  assert.equal(hidden.archiveRemote, false)

  // Doing nothing keeps the remembered direction: a hidden row the user left
  // archived must not be unarchived by a reconnect.
  calls.length = 0
  const kept = { localId: 'session-k', offlineHidden: true, archiveLocal: true, archiveRemote: true, archiveDesired: true }
  registry.archived.add('session-k')
  await host.syncOneMirrorArchive(peer, 'session-rk', kept, new Set(['session-k']), new Set(['session-rk']))
  assert.deepEqual(calls, [])
  assert.equal(registry.archived.has('session-k'), true)
  assert.equal(kept.archiveDesired, true)
  assert.equal(kept.archiveLocal, true)
})

test('a timed-out archive baseline still pushes a pending user unarchive', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  services.workspaceController = makeWorkspaceController(registry.archived)
  const host = makeHost(services)
  host.relay = { state: 'connected' }
  host.saveMirrorStore = () => {}
  const calls = []
  host.remoteCall = async (_peerId, method, params) => {
    if (method === 'workspace.snapshot') throw new Error('调用 workspace.snapshot 超时')
    calls.push(`${method}:${params.sessionId}`)
    return {}
  }
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {},
        sessions: {
          'session-remote': { localId: 'session-mirror', workspaceId: 'ws-remote', archiveLocal: true, archiveRemote: true, archiveDesired: true },
        },
      },
    },
  }
  // The local row is unarchived: the user restored it just before the poll.
  await host.syncPeerArchives()
  assert.deepEqual(calls, ['session.unarchive:session-remote'])
  const entry = host.mirrors.devices.dev_peer.sessions['session-remote']
  assert.equal(entry.archiveDesired, false)
  assert.equal(entry.archiveLocal, false)
  assert.equal(entry.archiveRemote, false)
  assert.match(String(host.lastArchiveError), /workspace\.snapshot/)
})

test('a failed archive push is retried instead of read back as a remote change', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  host.saveMirrorStore = () => {}
  const calls = []
  let failures = 1
  host.remoteCall = async (_peerId, method, params) => {
    calls.push(`${method}:${params.sessionId}`)
    if (method === 'session.unarchive' && failures > 0) {
      failures -= 1
      throw new Error('调用 session.unarchive 超时')
    }
    return {}
  }
  const peer = host.peers[0]
  const entry = { localId: 'session-m', archiveLocal: true, archiveRemote: true, archiveDesired: true }
  const local = new Set()
  const remote = new Set(['session-r'])
  await host.syncOneMirrorArchive(peer, 'session-r', entry, local, remote)
  assert.equal(entry.archiveDesired, false)
  assert.equal(entry.archiveRemote, true)
  assert.equal(entry.archiveLocal, false)
  // The backoff only delays the next attempt; the direction is not lost, so the
  // next pass retries the push instead of "discovering" a remote change.
  entry.archiveRetryAfter = 0
  await host.syncOneMirrorArchive(peer, 'session-r', entry, local, remote)
  assert.equal(calls.filter((call) => call === 'session.unarchive:session-r').length, 2)
  assert.equal(entry.archiveRemote, false)
})

test('a vanished peer Session stops archive syncing instead of looping', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  host.saveMirrorStore = () => {}
  let attempts = 0
  host.remoteCall = async (_peerId, method) => {
    if (method === 'session.archive') {
      attempts += 1
      throw new Error("cannot archive session 'session-r': live sessions and session persistence hold no such session")
    }
    return {}
  }
  registry.archived.add('session-m')
  const entry = { localId: 'session-m', archiveLocal: false, archiveRemote: false, archiveDesired: false }
  await host.syncOneMirrorArchive(host.peers[0], 'session-r', entry, new Set(['session-m']), new Set())
  assert.equal(attempts, 1)
  // A gone peer Session cannot be archived; stop retrying this dead mapping.
  assert.equal(entry.archiveUnavailable, true)
  assert.equal(entry.archiveRetryAfter, undefined)
})

test('a legacy mirror without a recorded direction follows the local row', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  host.saveMirrorStore = () => {}
  const calls = []
  host.remoteCall = async (_peerId, method, params) => {
    calls.push(`${method}:${params.sessionId}`)
    return {}
  }
  const entry = { localId: 'session-legacy' }
  await host.syncOneMirrorArchive(host.peers[0], 'session-r', entry, new Set(), new Set(['session-r']))
  // The local row is what the user sees, so an archived remote Session must not
  // pull that row back into the archive set.
  assert.equal(registry.archived.has('session-legacy'), false)
  assert.deepEqual(calls, ['session.unarchive:session-r'])
  assert.equal(entry.archiveDesired, false)
})

test('duplicate local mirror rows do not fight over one archive direction', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  services.workspaceController = makeWorkspaceController(registry.archived)
  const host = makeHost(services)
  host.relay = { state: 'connected' }
  host.saveMirrorStore = () => {}
  const calls = []
  host.remoteCall = async (_peerId, method, params) => {
    if (method === 'workspace.snapshot') return { archivedSessionIds: ['session-r1'] }
    calls.push(`${method}:${params.sessionId}`)
    return {}
  }
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {},
        sessions: {
          'session-r1': { localId: 'session-shared', archiveLocal: true, archiveRemote: true, archiveDesired: true },
          'session-r2': { localId: 'session-shared', archiveLocal: false, archiveRemote: false, archiveDesired: false },
        },
      },
    },
  }
  await host.syncPeerArchives()
  // Only the first owner drives the shared row; the duplicate never pushes.
  assert.deepEqual(calls, ['session.unarchive:session-r1'])
  assert.equal(host.mirrors.devices.dev_peer.sessions['session-r2'].archiveDesired, false)
})

test('reconnect restores every mirror hidden while the peer was offline', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  const host = makeHost(services)
  host.saveMirrorStore = () => {}
  const attached = []
  registry.get = (workspaceId) => workspaceId === 'ws-local'
    ? { id: workspaceId, attachSession: async (sessionId) => { attached.push(sessionId) } }
    : undefined
  const sessions = []
  for (let index = 0; index < 14; index += 1) sessions.push({ remoteId: `session-r${index}`, localId: `session-m${index}` })
  const device = {
    name: '出差笔记本',
    workspaces: {
      'ws-remote': { localWorkspaceId: 'ws-local', localPath: '/tmp/mirror', title: '项目', remotePath: '/home/p', remoteWorkspaceId: 'ws-remote' },
    },
    sessions: {},
  }
  for (const session of sessions) {
    device.sessions[session.remoteId] = {
      localId: session.localId,
      title: '远程会话',
      remoteSeq: 0,
      updatedAt: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      workspaceId: 'ws-remote',
      archiveLocal: true,
      archiveRemote: true,
      archiveDesired: false,
      offlineHidden: true,
    }
    registry.archived.add(session.localId)
  }
  host.mirrors = { version: 2, devices: { dev_peer: device } }
  services.sessionController.list = async () => ({
    items: sessions.map((session, index) => ({
      sessionId: session.localId,
      cwd: '/tmp/mirror',
      updatedAt: 100 - index,
      blank: false,
      parentSessionId: null,
    })),
  })
  services.sessionController.create = async (request) => ({ sessionId: request.sessionId })
  host.remoteCall = async (_peerId, method) => {
    if (method === 'device.info') return { name: '出差笔记本' }
    if (method === 'session.list') {
      return {
        items: sessions.map((session, index) => ({
          sessionId: session.remoteId,
          title: '远程会话',
          cwd: '/home/p',
          updatedAt: 100 - index,
          blank: false,
          parentSessionId: null,
        })),
      }
    }
    if (method === 'workspace.list') return { items: [{ workspaceId: 'ws-remote', title: '项目', path: '/home/p' }] }
    if (method === 'workspace.snapshot') return { archivedSessionIds: [] }
    return {}
  }
  host.ensureRemoteProjectWorkspace = async () => ({
    workspace: { id: 'ws-local', attachSession: async (sessionId) => { attached.push(sessionId) } },
    key: 'ws-remote',
    directory: '/tmp/mirror',
  })
  host.syncMirrorHistory = async () => {}
  for (const session of sessions) services.liveSessions.set(session.localId, makeFakeSession(session.localId))
  await host.syncPeerMirrors(host.peers[0])
  // Only the ten most recent Sessions are mirrored/refreshed, but every hidden
  // row is restored and re-attached to its Workspace.
  assert.equal(new Set(attached).size, sessions.length)
  for (const session of sessions) {
    assert.equal(registry.archived.has(session.localId), false, `${session.localId} should be restored`)
    const entry = device.sessions[session.remoteId]
    assert.equal(entry.offlineHidden, undefined)
    assert.equal(entry.archiveLocal, false)
    assert.equal(entry.archiveDesired, false)
  }
})

test('a new mirror of an archived remote Session is archived immediately', async () => {
  const services = makeServices()
  const registry = makeArchiveRegistry()
  services.workspaceRegistry = registry
  services.sessionController.list = async () => ({ items: [] })
  services.sessionController.create = async (request) => ({ sessionId: request.sessionId })
  const host = makeHost(services)
  host.mirrors = { version: 2, devices: {} }
  host.remoteCall = async (_peerId, method) => {
    if (method === 'device.info') return { name: '出差笔记本' }
    if (method === 'session.list') return { items: [{ sessionId: 'session-remote', title: '远程会话', cwd: '/tmp/mirror', updatedAt: 2, blank: false, parentSessionId: null }] }
    if (method === 'workspace.list') return { items: [] }
    if (method === 'workspace.snapshot') return { archivedSessionIds: ['session-remote'] }
    return {}
  }
  const attached = []
  host.ensureRemoteProjectWorkspace = async () => ({
    workspace: { id: 'ws-local', attachSession: async (id) => attached.push(id) },
    key: '',
    directory: '/tmp/mirror',
  })
  host.syncMirrorHistory = async () => {}
  await host.syncPeerMirrors(host.peers[0])
  const entry = host.mirrors.devices.dev_peer.sessions['session-remote']
  assert.equal(entry.archiveLocal, true)
  assert.equal(entry.archiveRemote, true)
  assert.ok(registry.archived.has(entry.localId))
  assert.equal(entry.offlineHidden, undefined)
})

test('mirror keeps native tool events for older records without turn/step', () => {
  const services = makeServices()
  const host = makeHost(services)
  const session = makeFakeSession('session-legacy')
  services.liveSessions.set('session-legacy', session)
  const entry = { localId: 'session-legacy', remoteSeq: -1, pendingUserTexts: [] }
  host.appendMirrorRecords(entry, [
    { kind: 'turn-start', seq: 1, time: 1, turn: 1 },
    { kind: 'assistant', seq: 2, time: 2, text: '先跑一下' },
    { kind: 'tool-call', seq: 3, time: 3, callId: 'c9', name: 'bash', args: '{"command":"pwd"}' },
    { kind: 'tool-result', seq: 4, time: 4, callId: 'c9', name: 'bash', isError: false, text: '/tmp' },
    { kind: 'turn-end', seq: 5, time: 5, turn: 1, reason: 'completed' },
  ])
  assert.deepEqual(session.events.map((event) => event.type), [
    'turn/start', 'step/start', 'assistant/message', 'tool/call', 'tool/result', 'step/end', 'turn/end',
  ])
  assert.equal(session.events.find((event) => event.type === 'tool/call').data.step, 1)
})

test('remote selectModel forwards a flat provider/model/effort request', async () => {
  const services = makeServices()
  const host = makeHost(services)
  const result = await host.invokeLocal('session.selectModel', {
    sessionId: 'session-a',
    selection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
  assert.deepEqual(result, {
    selected: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
  assert.deepEqual(services.sessionController.selectModelCalls, [{
    sessionId: 'session-a',
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  }])
  await assert.rejects(
    host.invokeLocal('session.selectModel', { sessionId: 'session-a', selection: { provider: 'deepseek-account' } }),
    /provider/,
  )
})

test('model selection prefers the pending next choice over lastUsed', async () => {
  const services = makeServices()
  const host = makeHost(services)
  const summary = {
    sessionId: 'session-a',
    updatedAt: 2,
    projections: {
      values: {
        modelSelection: {
          lastUsed: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
          next: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
        },
      },
    },
  }
  assert.deepEqual(host.selectionOfSummary(summary), {
    provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high',
  })
  // Mapped summaries already carry a flat selection; both shapes must work.
  assert.deepEqual(
    host.selectionOfSummary({ sessionId: 'session-a', modelSelection: { provider: 'p', model: 'm', reasoningEffort: 'low' } }),
    { provider: 'p', model: 'm', reasoningEffort: 'low' },
  )
  services.sessionController.list = async () => ({ items: [summary] })
  const info = await host.sessionInfo('session-a')
  assert.deepEqual(info.modelSelection, {
    provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high',
  })
})

test('peer state sync pushes a changed thinking level to the remote Session', async () => {
  const services = makeServices()
  const host = makeHost(services)
  host.relay = { state: 'connected' }
  host.saveMirrorStore = () => {}
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {},
        sessions: {
          'session-remote': { localId: 'session-mirror', title: '远程会话', remoteSeq: 0, updatedAt: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        },
      },
    },
  }
  services.sessionController.list = async () => ({
    items: [{
      sessionId: 'session-mirror',
      updatedAt: 2,
      projections: {
        values: {
          modelSelection: {
            lastUsed: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
            next: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
          },
        },
      },
    }],
  })
  const pushes = []
  host.remoteCall = async (_peerId, method, params) => {
    if (method === 'session.list') {
      return {
        items: [{
          sessionId: 'session-remote',
          updatedAt: 2,
          projections: {
            values: {
              modelSelection: {
                lastUsed: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
                next: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
              },
            },
          },
        }],
      }
    }
    if (method === 'session.selectModel') {
      pushes.push(params)
      return { selected: params.selection }
    }
    return {}
  }
  const steady = { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' }
  host.mirrorModelStates.set('session-mirror', { local: steady, remote: steady })
  await host.syncPeerState()
  assert.deepEqual(pushes, [{
    sessionId: 'session-remote',
    selection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  }])
  assert.deepEqual(host.mirrorModelStates.get('session-mirror'), {
    local: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
    remote: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
})

test('a changed mirror thinking level is pushed before the prompt is forwarded', async () => {
  const services = makeServices()
  const host = makeHost(services)
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {},
        sessions: {
          'session-remote': { localId: 'session-mirror', title: '远程会话', remoteSeq: 0, updatedAt: 1, pendingUserTexts: [] },
        },
      },
    },
  }
  host.watchMirror = () => ({ watching: false })
  const calls = []
  host.remoteCall = async (_peerId, method, params) => {
    calls.push([method, params])
    return {}
  }
  host.mirrorModelStates.set('session-mirror', {
    local: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
    remote: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'max' },
  })
  await host.forwardMirrorPrompt('session-mirror', '继续', {
    provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high',
  })
  assert.deepEqual(calls.map(([method]) => method), ['session.selectModel', 'session.prompt'])
  assert.deepEqual(calls[0][1], {
    sessionId: 'session-remote',
    selection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
  assert.deepEqual(calls[1][1], { sessionId: 'session-remote', text: '继续' })
  assert.deepEqual(host.mirrors.devices.dev_peer.sessions['session-remote'].pendingUserTexts, ['继续'])

  // A prompt that did not change the local selection does not repeat the push.
  calls.length = 0
  await host.forwardMirrorPrompt('session-mirror', '再来', {
    provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high',
  })
  assert.deepEqual(calls.map(([method]) => method), ['session.prompt'])
})

test('remote settings gear keeps the local mirror model in step', async () => {
  const services = makeServices()
  const host = makeHost(services)
  host.mirrors = {
    version: 2,
    devices: {
      dev_peer: {
        name: '出差笔记本',
        workspaces: {},
        sessions: {
          'session-remote': { localId: 'session-mirror', title: '远程会话', remoteSeq: 0, updatedAt: 1 },
        },
      },
    },
  }
  host.remoteCall = async (_peerId, method, params) => {
    if (method === 'session.selectModel') {
      return {
        selected: {
          provider: params.selection.provider,
          model: params.selection.model,
          reasoningEffort: params.selection.reasoningEffort,
        },
      }
    }
    return {}
  }
  const response = await handleApiRoute(new Request('http://localhost/api/dsh-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      op: 'selectModel',
      deviceId: 'dev_peer',
      sessionId: 'session-remote',
      selection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
    }),
  }), host)
  assert.equal(response.status, 200)
  assert.deepEqual(services.sessionController.selectModelCalls, [{
    sessionId: 'session-mirror',
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  }])
  assert.deepEqual(host.mirrorModelStates.get('session-mirror'), {
    local: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
    remote: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  })
})
