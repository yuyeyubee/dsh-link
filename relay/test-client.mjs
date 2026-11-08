#!/usr/bin/env node
/**
 * End-to-end test for the DSH Link relay (protocol v1).
 *
 * Covers: hello auth failure (wrong token / bad hello / version), welcome,
 * presence, offline call, host→host call, sub/event/end, unsub, duplicate id,
 * dropped late reply, target disconnect while a call/subscription is pending,
 * and (with --slow) the 30s relay timeout cleanup.
 *
 * Usage:
 *   node test-client.mjs                 # fast suite
 *   node test-client.mjs --slow          # also waits 30s for timeout cleanup
 *
 * Relay + token are read from a pairing code, never printed:
 *   DSHLINK_PAIRING_FILE  file containing the code
 *                         (default: ~/.dsh/dsh-link/pairing-code.txt, then pairing.txt)
 *   DSHLINK_PAIRING_CODE  the code itself
 *   or DSHLINK_RELAY_URL + DSHLINK_TOKEN
 *
 * Requires the `ws` package (npm install in this directory).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import WebSocket from 'ws';

const PAIRING_PREFIX = 'dshlink1.';
const SLOW = process.argv.includes('--slow');
// The plugin deletes ~/.dsh/dsh-link/pairing.txt after importing it, so the
// relay keeps a reference copy named pairing-code.txt (server copy stays
// authoritative). pairing.txt is still accepted for backwards compatibility.
const DEFAULT_PAIRING_FILES = [
  `${homedir()}/.dsh/dsh-link/pairing-code.txt`,
  `${homedir()}/.dsh/dsh-link/pairing.txt`,
];
const CONNECT_TIMEOUT_MS = 12_000;
const FRAME_TIMEOUT_MS = 8_000;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function loadConfig() {
  let code = process.env.DSHLINK_PAIRING_CODE || '';
  let source = 'DSHLINK_PAIRING_CODE';
  if (!code) {
    const explicit = process.env.DSHLINK_PAIRING_FILE;
    const candidates = explicit ? [explicit] : DEFAULT_PAIRING_FILES;
    const errors = [];
    for (const file of candidates) {
      try {
        const content = readFileSync(file, 'utf8').trim();
        if (!content) {
          errors.push(`${file}: 文件为空`);
          continue;
        }
        code = content;
        source = `file ${file}`;
        break;
      } catch (err) {
        errors.push(`${file}: ${err.code || err.message}`);
      }
    }
    if (!code) {
      if (process.env.DSHLINK_RELAY_URL && process.env.DSHLINK_TOKEN) {
        return {
          url: process.env.DSHLINK_RELAY_URL,
          token: process.env.DSHLINK_TOKEN,
          source: 'DSHLINK_RELAY_URL + DSHLINK_TOKEN',
        };
      }
      fail(`读取配对码失败（${errors.join('；')}）`);
    }
  }
  if (!code.startsWith(PAIRING_PREFIX)) fail('配对码无效：缺少 dshlink1. 前缀');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(code.slice(PAIRING_PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    fail('配对码无效：base64url/JSON 解码失败');
  }
  if (!payload || typeof payload !== 'object') fail('配对码无效：内容不是对象');
  if (payload.v !== 1) fail('配对码版本过新，请升级插件/App');
  if (typeof payload.u !== 'string' || !/^wss:\/\//.test(payload.u)) {
    fail('配对码无效：u 不是 wss:// URL');
  }
  if (typeof payload.t !== 'string' || payload.t.length < 16) {
    fail('配对码无效：缺少 token');
  }
  return { url: payload.u, token: payload.t, source };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} 不一致：期望 ${e}，实际 ${a}`);
}

function newDeviceId() {
  return `dev_${randomBytes(8).toString('hex')}`;
}

function hostHello(token, id, name, platform = 'macos') {
  return { t: 'hello', v: 1, role: 'host', token, device: { id, name, platform } };
}

class Peer {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.closeInfo = null;
    this.lastError = null;

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // relay speaks text frames only
      let frame;
      try {
        frame = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      this.#push(frame);
    });
    ws.on('error', (err) => {
      this.lastError = err;
    });
    ws.on('close', (code, reason) => {
      this.closed = true;
      const text = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason ?? '');
      this.closeInfo = { code, reason: text };
      this.#push({ t: '__closed', code, reason: text });
    });
  }

  #push(frame) {
    const idx = this.waiters.findIndex((waiter) => waiter.predicate(frame));
    if (idx >= 0) {
      const [waiter] = this.waiters.splice(idx, 1);
      waiter.resolve(frame);
      return;
    }
    this.queue.push(frame);
  }

  next(predicate, label, timeoutMs = FRAME_TIMEOUT_MS) {
    const queued = this.queue.findIndex(predicate);
    if (queued >= 0) return Promise.resolve(this.queue.splice(queued, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        const recent = JSON.stringify(this.queue.slice(-3));
        reject(new Error(`[${this.label}] 等待帧超时：${label}；未匹配帧=${recent}`));
      }, timeoutMs);
      const waiter = {
        predicate,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      };
      this.waiters.push(waiter);
    });
  }

  expect(type, label = type, timeoutMs) {
    return this.next((frame) => frame.t === type, label, timeoutMs);
  }

  expectNo(predicate, label, waitMs = 1_500) {
    if (this.queue.some(predicate)) {
      return Promise.reject(new Error(`[${this.label}] 出现了不该出现的帧：${label}`));
    }
    return new Promise((resolve, reject) => {
      let waiter = null;
      const remove = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        remove();
        resolve();
      }, waitMs);
      waiter = {
        predicate: (frame) => {
          if (!predicate(frame)) return false;
          remove();
          reject(new Error(`[${this.label}] 出现了不该出现的帧：${label}`));
          return true;
        },
        resolve: () => {},
      };
      this.waiters.push(waiter);
    });
  }

  send(frame) {
    if (this.ws.readyState !== WebSocket.OPEN) throw new Error(`[${this.label}] socket 已关闭`);
    this.ws.send(JSON.stringify(frame));
  }

  async close() {
    if (this.closed) return;
    try {
      this.ws.close(1000, 'test done');
    } catch {
      /* already gone */
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      this.ws.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function connect(url, hello, label) {
  const ws = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`[${label}] 连接超时`));
    }, CONNECT_TIMEOUT_MS);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(new Error(`[${label}] 连接失败：${err.message}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('open', onOpen);
      ws.off('error', onError);
    };
    ws.once('open', onOpen);
    ws.once('error', onError);
  });
  const peer = new Peer(ws, label);
  if (hello) peer.send(hello);
  return peer;
}

async function main() {
  const config = loadConfig();
  console.log(`relay: ${config.url}`);
  console.log(`pairing source: ${config.source} (token 不打印)`);
  console.log(`mode: ${SLOW ? 'full (+30s timeout check)' : 'fast'}`);

  const peers = [];
  const track = (peer) => {
    peers.push(peer);
    return peer;
  };
  const results = [];
  const step = async (name, fn) => {
    const started = Date.now();
    await fn();
    const ms = Date.now() - started;
    results.push({ name, ms });
    console.log(`PASS ${String(results.length).padStart(2, '0')} ${name} (${ms}ms)`);
  };

  const url = config.url;
  const token = config.token;
  const deviceA = newDeviceId();
  const deviceB = newDeviceId();

  try {
    await step('错误 token 被拒绝（auth-failed）', async () => {
      const badToken = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
      const peer = track(await connect(url, hostHello(badToken, newDeviceId(), 'bad-token'), 'bad-token'));
      const err = await peer.expect('error', 'error frame');
      assert(err.code === 'auth-failed', `期望 auth-failed，实际 ${err.code}`);
      const closed = await peer.expect('__closed', 'auth 失败后关闭');
      assert(typeof closed.code === 'number', '缺少 WebSocket close code');
    });

    await step('缺少 role 的 hello 被拒绝（bad-hello）', async () => {
      const peer = track(await connect(url, { t: 'hello', v: 1, token }, 'bad-hello'));
      const err = await peer.expect('error', 'error frame');
      assert(err.code === 'bad-hello', `期望 bad-hello，实际 ${err.code}`);
      await peer.expect('__closed', '关闭');
    });

    await step('协议版本不符被拒绝（version）', async () => {
      const hello = hostHello(token, newDeviceId(), 'v2-host');
      hello.v = 2;
      const peer = track(await connect(url, hello, 'bad-version'));
      const err = await peer.expect('error', 'error frame');
      assert(err.code === 'version', `期望 version，实际 ${err.code}`);
      await peer.expect('__closed', '关闭');
    });

    let hostA;
    let hostB;
    let client;

    await step('host A hello/welcome', async () => {
      hostA = track(await connect(url, hostHello(token, deviceA, 'relay-test-A'), 'A'));
      const welcome = await hostA.expect('welcome');
      assert(welcome.v === 1, `welcome.v 期望 1，实际 ${welcome.v}`);
      equal(welcome.self, { id: deviceA, name: 'relay-test-A' }, 'welcome.self');
      assert(Array.isArray(welcome.peers), 'welcome.peers 不是数组');
    });

    await step('host B 上线：welcome.peers + A 收到 presence', async () => {
      hostB = track(await connect(url, hostHello(token, deviceB, 'relay-test-B', 'windows'), 'B'));
      const welcome = await hostB.expect('welcome');
      assert(
        welcome.peers.some((peer) => peer.id === deviceA && peer.name === 'relay-test-A'),
        'B 的 welcome.peers 缺少 A',
      );
      const presence = await hostA.next(
        (frame) => frame.t === 'presence' && frame.peers.some((peer) => peer.id === deviceB),
        'A 收到 B 上线的 presence',
      );
      assert(
        presence.peers.every((peer) => peer.id !== deviceA),
        'presence.peers 不应包含自己',
      );
    });

    await step('client 上线：welcome.peers 为在线 host 且随后收到 presence', async () => {
      client = track(
        await connect(
          url,
          { t: 'hello', v: 1, role: 'client', token, device: { name: 'relay-test-C', platform: 'android' } },
          'C',
        ),
      );
      const welcome = await client.expect('welcome');
      client.deviceId = welcome.self.id;
      assert(/^cli_[0-9a-f]{16}$/.test(client.deviceId), `client 被分配的 id 不合法：${client.deviceId}`);
      const ids = welcome.peers.map((peer) => peer.id);
      assert(ids.includes(deviceA) && ids.includes(deviceB), 'client welcome.peers 缺少 A/B');
      const presence = await client.expect('presence');
      assert(
        presence.peers.some((peer) => peer.id === deviceA) &&
          presence.peers.some((peer) => peer.id === deviceB),
        'client 的 presence 缺少 A/B',
      );
    });

    await step('client → host call/reply（rid 改写与 id 还原）', async () => {
      client.send({ t: 'call', id: 'c1', to: deviceA, method: 'ping', params: { hello: 'world' } });
      const call = await hostA.expect('call');
      assert(typeof call.rid === 'string' && call.rid.length > 0, 'call 缺少 rid');
      equal(call.from, { id: client.deviceId, name: 'relay-test-C' }, 'call.from');
      assert(call.method === 'ping', 'method 不一致');
      equal(call.params, { hello: 'world' }, 'call.params');
      hostA.send({ t: 'reply', rid: call.rid, ok: true, result: { pong: true, time: 1762531200000 } });
      const reply = await client.next((frame) => frame.t === 'reply' && frame.id === 'c1', 'c1 的 reply');
      assert(reply.ok === true, 'reply.ok 应为 true');
      equal(reply.result, { pong: true, time: 1762531200000 }, 'reply.result');
    });

    await step('离线目标立即回 offline', async () => {
      client.send({ t: 'call', id: 'c2', to: 'dev_0000000000000000', method: 'ping', params: {} });
      const reply = await client.next((frame) => frame.t === 'reply' && frame.id === 'c2', 'c2 的 reply');
      assert(reply.ok === false, 'offline reply.ok 应为 false');
      assert(reply.error && reply.error.code === 'offline', `期望 offline，实际 ${reply.error?.code}`);
    });

    await step('host → host call/reply', async () => {
      hostA.send({ t: 'call', id: 'a1', to: deviceB, method: 'device.info', params: {} });
      const call = await hostB.expect('call');
      equal(call.from.id, deviceA, 'call.from.id');
      hostB.send({ t: 'reply', rid: call.rid, ok: true, result: { deviceId: deviceB } });
      const reply = await hostA.next((frame) => frame.t === 'reply' && frame.id === 'a1', 'a1 的 reply');
      assert(reply.ok === true, 'reply.ok 应为 true');
      equal(reply.result, { deviceId: deviceB }, 'reply.result');
    });

    let subRid = null;
    await step('sub → reply(stream)/event/end', async () => {
      client.send({
        t: 'sub',
        id: 's1',
        to: deviceA,
        method: 'session.follow',
        params: { sessionId: 'sess-1' },
      });
      const call = await hostA.expect('call');
      subRid = call.rid;
      assert(call.method === 'session.follow', 'sub 转发的 method 不一致');
      equal(call.params, { sessionId: 'sess-1' }, 'sub 转发的 params');
      hostA.send({ t: 'reply', rid: subRid, ok: true, result: { stream: true } });
      const ack = await client.next((frame) => frame.t === 'reply' && frame.id === 's1', 's1 的 stream ack');
      assert(ack.ok === true && ack.result?.stream === true, 's1 未收到 stream ack');
      hostA.send({ t: 'event', rid: subRid, data: { t: 'ready', sessionId: 'sess-1' } });
      const event = await client.next((frame) => frame.t === 'event' && frame.id === 's1', 's1 的 event');
      equal(event.data, { t: 'ready', sessionId: 'sess-1' }, 'event.data');
      hostA.send({ t: 'end', rid: subRid });
      await client.next((frame) => frame.t === 'end' && frame.id === 's1', 's1 的 end');
    });

    await step('unsub：target 收到 unsub，调用方收到 end', async () => {
      client.send({
        t: 'sub',
        id: 's2',
        to: deviceA,
        method: 'session.follow',
        params: { sessionId: 'sess-2' },
      });
      const call = await hostA.expect('call');
      hostA.send({ t: 'reply', rid: call.rid, ok: true, result: { stream: true } });
      await client.next((frame) => frame.t === 'reply' && frame.id === 's2', 's2 的 stream ack');
      client.send({ t: 'unsub', id: 's2' });
      const unsub = await hostA.next(
        (frame) => frame.t === 'unsub' && frame.rid === call.rid,
        'target 收到 unsub',
      );
      assert(unsub.rid === call.rid, 'unsub.rid 不一致');
      await client.next((frame) => frame.t === 'end' && frame.id === 's2', '调用方收到 end');
    });

    await step('同一连接重复 id 被拒绝但原调用仍可完成', async () => {
      client.send({ t: 'call', id: 'dup', to: deviceA, method: 'ping', params: {} });
      const call = await hostA.expect('call');
      client.send({ t: 'call', id: 'dup', to: deviceA, method: 'ping', params: {} });
      const err = await client.expect('error', 'duplicate id error');
      assert(err.code === 'bad-request', `期望 bad-request，实际 ${err.code}`);
      hostA.send({ t: 'reply', rid: call.rid, ok: true, result: {} });
      await client.next((frame) => frame.t === 'reply' && frame.id === 'dup', 'dup 的 reply');
    });

    await step('未知 rid 的迟到 reply 被丢弃（relay 不崩溃）', async () => {
      hostA.send({ t: 'reply', rid: 'r999999999', ok: true, result: { leaked: true } });
      client.send({ t: 'call', id: 'c3', to: deviceA, method: 'ping', params: {} });
      const call = await hostA.expect('call');
      hostA.send({ t: 'reply', rid: call.rid, ok: true, result: { still: 'alive' } });
      const reply = await client.next((frame) => frame.t === 'reply' && frame.id === 'c3', 'c3 的 reply');
      equal(reply.result, { still: 'alive' }, 'relay 在迟到 reply 后仍应正常转发');
    });

    await step('超过 8MiB 的帧被 1009 关闭（maxPayload）', async () => {
      const big = track(await connect(url, hostHello(token, newDeviceId(), 'relay-test-big'), 'big'));
      await big.expect('welcome');
      // 9 MiB > MAX_PAYLOAD_BYTES (8 MiB): the server must drop the socket.
      big.send({ t: 'ping', pad: 'x'.repeat(9 * 1024 * 1024) });
      const closed = await big.expect('__closed', '超限帧导致关闭', 15_000);
      assert(closed.code === 1009, `期望 close code 1009，实际 ${closed.code}`);
    });

    await step('目标在 call 过程中断开：调用方收到 offline', async () => {
      const deviceD = newDeviceId();
      const hostD = track(await connect(url, hostHello(token, deviceD, 'relay-test-D'), 'D'));
      await hostD.expect('welcome');
      client.send({ t: 'call', id: 'c4', to: deviceD, method: 'ping', params: {} });
      await hostD.expect('call');
      await hostD.close();
      const reply = await client.next((frame) => frame.t === 'reply' && frame.id === 'c4', 'c4 的 offline reply');
      assert(reply.ok === false && reply.error?.code === 'offline', '目标断开后应回 offline');
    });

    await step('目标在订阅过程中断开：调用方收到 end', async () => {
      const deviceE = newDeviceId();
      const hostE = track(await connect(url, hostHello(token, deviceE, 'relay-test-E'), 'E'));
      await hostE.expect('welcome');
      client.send({ t: 'sub', id: 's3', to: deviceE, method: 'session.follow', params: { sessionId: 'sess-3' } });
      const call = await hostE.expect('call');
      hostE.send({ t: 'reply', rid: call.rid, ok: true, result: { stream: true } });
      await client.next((frame) => frame.t === 'reply' && frame.id === 's3', 's3 的 stream ack');
      await hostE.close();
      await client.next((frame) => frame.t === 'end' && frame.id === 's3', '订阅目标断开后收到 end');
    });

    if (SLOW) {
      await step('30 秒孤儿调用清理：调用方收到 timeout', async () => {
        client.send({ t: 'call', id: 'timeout1', to: deviceA, method: 'ping', params: {} });
        await hostA.expect('call');
        // Never reply from hostA: the relay must clean the id after 30s.
        const reply = await client.next(
          (frame) => frame.t === 'reply' && frame.id === 'timeout1',
          'timeout1 的 relay timeout',
          35_000,
        );
        assert(reply.ok === false, 'timeout reply.ok 应为 false');
        assert(reply.error?.code === 'timeout', `期望 timeout，实际 ${reply.error?.code}`);
      });
    }

    await step('host B 下线：A/client 收到不含 B 的 presence', async () => {
      await hostB.close();
      await hostA.next(
        (frame) => frame.t === 'presence' && !frame.peers.some((peer) => peer.id === deviceB),
        'A 收到 B 下线的 presence',
      );
      await client.next(
        (frame) => frame.t === 'presence' && !frame.peers.some((peer) => peer.id === deviceB),
        'client 收到 B 下线的 presence',
      );
    });

    await step('client 上下线不触发 host 侧 presence', async () => {
      // Drain any presence frames still queued on A (from D/E/B churn).
      for (let i = 0; i < 10; i += 1) {
        try {
          await hostA.next((frame) => frame.t === 'presence', `drain-${i}`, 300);
        } catch {
          break;
        }
      }
      await client.close();
      await hostA.expectNo((frame) => frame.t === 'presence', 'client 断开不应触发 host presence', 1_500);
    });
  } finally {
    await Promise.all(peers.map((peer) => peer.close()));
  }

  const total = results.reduce((sum, item) => sum + item.ms, 0);
  console.log(`\n全部通过：${results.length} 项，合计 ${total}ms`);
}

main().catch((err) => {
  console.error(`FAIL ${err.message}`);
  process.exitCode = 1;
});
