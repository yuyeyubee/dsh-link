import assert from 'node:assert/strict'
import test from 'node:test'
import {
  encodePairingCode,
  inspectWav,
  mapSessionState,
  mapSessionSummary,
  mapWireEvent,
  parsePairingCode,
  toProtocolError,
} from '../index.js'

const TOKEN = '0123456789abcdef'.repeat(4)

test('pairing code round-trips and rejects invalid input', () => {
  const code = encodePairingCode('wss://example.com:8443', TOKEN)
  assert.ok(code.startsWith('dshlink1.'))
  assert.deepEqual(parsePairingCode(code), { relayUrl: 'wss://example.com:8443', token: TOKEN })
  assert.throws(() => parsePairingCode('nope'), /dshlink1/)
  assert.throws(() => parsePairingCode('dshlink1.@@@'), /无法解析/)
  const wrongVersion = 'dshlink1.' + Buffer.from(JSON.stringify({ v: 2, u: 'wss://x:1', t: TOKEN })).toString('base64url')
  assert.throws(() => parsePairingCode(wrongVersion), /版本/)
  assert.throws(() => encodePairingCode('http://x', TOKEN), /wss|ws/)
})

test('session summary maps projections and defaults', () => {
  const summary = mapSessionSummary({
    sessionId: 'session-1',
    updatedAt: 123,
    running: true,
    agentAvailable: true,
    blank: false,
    cwd: '/tmp',
    projections: { kind: 'cached', asOfSeq: 5, values: { title: '重构登录页' } },
  })
  assert.equal(summary.title, '重构登录页')
  assert.equal(summary.cwd, '/tmp')
  assert.equal(summary.running, true)
  const bare = mapSessionSummary({ sessionId: 'session-2' })
  assert.equal(bare.title, '')
  assert.equal(bare.cwd, null)
  assert.equal(bare.agentAvailable, true)
})

test('wire events map to chat records', () => {
  assert.deepEqual(
    mapWireEvent({ type: 'user/message', seq: 1, time: 10, data: { content: [{ type: 'text', text: '你好' }] } }),
    { kind: 'user', seq: 1, time: 10, text: '你好' },
  )
  const assistant = mapWireEvent({
    type: 'assistant/message',
    seq: 2,
    time: 20,
    data: { message: { content: [{ type: 'text', text: '好的' }, { type: 'reasoning', text: '想一想' }] } },
  })
  assert.equal(assistant.kind, 'assistant')
  assert.equal(assistant.text, '好的')
  assert.equal(assistant.reasoning, '想一想')
  const call = mapWireEvent({ type: 'tool/call', seq: 3, time: 30, data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } })
  assert.equal(call.kind, 'tool-call')
  assert.equal(call.name, 'bash')
  const result = mapWireEvent({
    type: 'tool/result',
    seq: 4,
    time: 40,
    data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'a.txt' }] } },
  })
  assert.equal(result.kind, 'tool-result')
  assert.equal(result.isError, false)
  assert.equal(result.text, 'a.txt')
  assert.equal(mapWireEvent({ type: 'step/start', seq: 9, time: 1, data: {} }), undefined)
})

test('state and error mapping', () => {
  assert.deepEqual(
    mapSessionState({ active: true, running: true, queue: [{ id: 'm1' }], pendingInput: ['approval', 3] }),
    { active: true, running: true, queueCount: 1, pendingInput: ['approval'] },
  )
  assert.deepEqual(toProtocolError(new Error('boom')), { code: 'internal', message: 'boom' })
})

test('WAV validation accepts 16k mono PCM16 and rejects others', () => {
  const audio = new Uint8Array(44 + 320)
  const view = new DataView(audio.buffer)
  audio.set([0x52, 0x49, 0x46, 0x46], 0)
  audio.set([0x57, 0x41, 0x56, 0x45], 8)
  audio.set([0x66, 0x6d, 0x74, 0x20], 12)
  view.setUint32(4, audio.length - 8, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  audio.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, audio.length - 44, true)
  const info = inspectWav(audio)
  assert.equal(info.sampleRate, 16000)
  const stereo = audio.slice()
  new DataView(stereo.buffer).setUint16(22, 2, true)
  assert.throws(() => inspectWav(stereo), /16 kHz/)
  assert.throws(() => inspectWav(new Uint8Array(10)), /WAV/)
})
