#!/usr/bin/env node
/**
 * DSH Link development probe: connect as a relay client, call one Host method,
 * print the JSON result. Useful to verify a real DSH install without the UI.
 *
 *   node tools/probe-client.mjs --pairing-file ~/.dsh/dsh-link/pairing.txt \
 *     --device dev_xxx --method device.info
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
  console.error('usage: --pairing-file <file> | --url <wss-url> --token <token> [--device <id>] [--method <name>] [--params <json>]')
  process.exit(2)
}
const pairing = args['pairing-file']
  ? decodePairing(readFileSync(args['pairing-file'], 'utf8'))
  : { url: args.url, token: args.token }
const method = args.method ?? 'device.info'
const params = args.params ? JSON.parse(args.params) : {}
const stream = args.stream === 'true'
const streamSeconds = Math.max(1, Math.min(30, Number(args.seconds ?? 5)))
const clientId = `cli_${Math.random().toString(16).slice(2, 10)}`

const socket = new WebSocket(pairing.url)
const pending = new Map()
let seq = 0
let target = args.device

function send(frame) {
  socket.send(JSON.stringify(frame))
}

function call(device, methodName, callParams) {
  return new Promise((resolve, reject) => {
    const id = `c${++seq}`
    pending.set(id, { resolve, reject })
    send({ t: 'call', id, to: device, method: methodName, params: callParams })
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error('timeout'))
    }, 60_000)
  })
}

socket.addEventListener('open', () => {
  send({
    t: 'hello',
    v: 1,
    role: 'client',
    token: pairing.token,
    device: { id: clientId, name: 'probe', platform: 'web' },
  })
})

socket.addEventListener('message', (event) => {
  const frame = JSON.parse(String(event.data))
  if (frame.t === 'welcome') {
    console.log('welcome peers:', JSON.stringify(frame.peers))
    const peer = target ?? frame.peers[0]?.id
    if (!peer) {
      console.error('no online host')
      process.exit(1)
    }
    if (stream) {
      const id = `s${++seq}`
      const frames = []
      send({ t: 'sub', id, to: peer, method, params })
      const timer = setTimeout(() => {
        send({ t: 'unsub', id })
        console.log(JSON.stringify({ frames }, null, 2))
        socket.close()
        process.exit(0)
      }, streamSeconds * 1000)
      pending.set(id, {
        resolve: (result) => {
          console.error('subscribed:', JSON.stringify(result))
        },
        reject: (error) => {
          clearTimeout(timer)
          console.error('subscribe failed:', error.message)
          process.exit(1)
        },
      })
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data))
        if (frame.t === 'event' && frame.id === id) {
          const data = frame.data
          if (data !== null && typeof data === 'object') {
            frames.push({
              t: data.t,
              ...(data.title !== undefined ? { title: data.title } : {}),
              ...(Array.isArray(data.records) ? { records: data.records.length } : {}),
              ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
              ...(data.record ? { kind: data.record.kind, seq: data.record.seq } : {}),
              ...(data.state ? { running: data.state.running } : {}),
              ...(data.code ? { code: data.code } : {}),
            })
          }
        }
        if (frame.t === 'reply' && frame.id === id) {
          const entry = pending.get(id)
          if (entry !== undefined) {
            pending.delete(id)
            if (frame.ok) entry.resolve(frame.result)
            else entry.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`))
          }
        }
        if (frame.t === 'end' && frame.id === id) {
          clearTimeout(timer)
          console.log(JSON.stringify({ frames }, null, 2))
          socket.close()
          process.exit(0)
        }
      })
      return
    }
    call(peer, method, params)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2))
        socket.close()
        process.exit(0)
      })
      .catch((error) => {
        console.error('call failed:', error.message)
        process.exit(1)
      })
  } else if (frame.t === 'reply') {
    const entry = pending.get(frame.id)
    if (entry === undefined) return
    pending.delete(frame.id)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(`${frame.error?.code}: ${frame.error?.message}`))
  } else if (frame.t === 'presence') {
    console.error('presence:', JSON.stringify(frame.peers))
    if (target === undefined && frame.peers[0] !== undefined) target = frame.peers[0].id
  } else if (frame.t === 'error') {
    console.error('relay error:', frame.code, frame.message)
    process.exit(1)
  }
})

socket.addEventListener('error', () => {
  console.error('websocket error')
  process.exit(1)
})
