# DSH Link 协议规范（v1）

本文件是 DSH 插件（Host / Web UI）、Android App、Relay 服务端三方共同遵守的**唯一接口契约**。
实现任何一端前先读本文件；改动协议必须同步改本文件并升 `v`。

- 传输：WebSocket 文本帧，单帧 JSON（UTF-8）。
- 公网入口：`wss://<relay-host>:8443/`（TLS，Let's Encrypt 证书；见 `relay/README.md`）。
- 认证：所有设备共享一个 **space token**（64 位十六进制），在 `hello` 中提交。
- 设备角色：`host`（装了 DSH Link 插件的电脑）与 `client`（Android App，或只发起调用的 Host）。
  Host 既能被调用，也能主动调用其它 Host。

## 1. 配对码

用户只填一个字符串：

```
dshlink1.<base64url(JSON)>
```

JSON 原文（字段可按任意顺序，解码端忽略未知字段）：

```json
{ "v": 1, "u": "wss://<DOMAIN>:8443", "t": "<64 hex token>" }
```

- 前缀固定 `dshlink1.`；`.` 后是 JSON 的 base64url（无 `=` 填充）。
- 解码失败时提示「配对码无效」；`v !== 1` 提示「配对码版本过新，请升级插件/App」。
- 电脑端设置页与 Android 设置页都提供「显示本机配对码 / 粘贴配对码」。
- token 是唯一秘密，不得写进日志、不得显示在会话记录、不得提交到仓库。

## 2. Relay 帧

Relay 只做「同 token 空间内的在线设备名录 + 呼叫转发」，不解析业务方法。

### 2.1 握手

客户端 → relay：

```json
{ "t": "hello", "v": 1, "role": "host", "token": "<token>",
  "device": { "id": "dev_xxx", "name": "家里的 MacBook", "platform": "macos" } }
```

- `role`: `"host"` | `"client"`。
- `device`: host 必填；client 可省略（relay 分配 `cli_<随机>`）。
- `platform`: `macos` | `windows` | `linux` | `android` | `ios` | `web`。
- `device.id` 由本机生成并持久化（`dev_` + 16 hex），同一空间内应唯一。

Relay 校验 token 后回：

```json
{ "t": "welcome", "v": 1,
  "self": { "id": "dev_xxx", "name": "家里的 MacBook" },
  "peers": [ { "id": "dev_yyy", "name": "出差笔记本", "platform": "windows", "since": 1762531200000 } ] }
```

失败：`{ "t":"error", "code":"auth-failed"|"bad-hello"|"version", "message":"..." }` 后关闭。

### 2.2 在线状态

设备上下线时 relay 向空间内所有连接推送（`peers` 不含自己）：

```json
{ "t": "presence", "peers": [ ... ] }
```

刚连上的 client 也会收到一次 `presence`（在 `welcome` 之后）。

### 2.3 调用（RPC）

调用方 → relay：

```json
{ "t": "call", "id": "c1", "to": "dev_yyy", "method": "session.list", "params": {} }
```

relay 改写为全局唯一 `rid` 后转发：

```json
{ "t": "call", "rid": "r7", "from": { "id": "dev_xxx", "name": "..." },
  "method": "session.list", "params": {} }
```

被调方回：

```json
{ "t": "reply", "rid": "r7", "ok": true, "result": { } }
{ "t": "reply", "rid": "r7", "ok": false, "error": { "code": "not-found", "message": "..." } }
```

relay 转回调用方并还原 id：

```json
{ "t": "reply", "id": "c1", "ok": true, "result": { } }
```

- 目标不在线：relay 直接回 `{ "t":"reply", "id":"c1", "ok":false, "error":{"code":"offline","message":"..."} }`。
- 调用方超时：普通方法 30 秒，`speech.transcribe` 180 秒；超时后丢弃该 id 的迟到 reply。
- relay 的孤儿调用清理：普通方法 30 秒，`speech.transcribe` 180 秒（给首次加载本地语音模型留时间）。
- `method` 由被调方校验；未知方法回 `bad-request`。

### 2.4 订阅流（会话实时更新）

调用方 → relay：

```json
{ "t": "sub", "id": "s1", "to": "dev_yyy", "method": "session.follow",
  "params": { "sessionId": "..." } }
```

relay 以 `call` 转发（`rid`），被调方先回：

```json
{ "t": "reply", "rid": "r7", "ok": true, "result": { "stream": true } }
```

随后每帧：

```json
{ "t": "event", "rid": "r7", "data": { ... } }
```

结束：

```json
{ "t": "end", "rid": "r7" }
```

relay 向调用方转发时把 `rid` 换回 `id`，帧类型保持 `reply` / `event` / `end`。

取消（调用方 → relay）：

```json
{ "t": "unsub", "id": "s1" }
```

relay 向被调方发 `{ "t":"unsub", "rid":"r7" }`，被调方必须中止对应异步迭代并清理；relay 随后向调用方发 `end`。

同一连接上 `id` 必须唯一（同时存在的 call/sub）。relay 断开某连接时，向所有被调方发送对应 `unsub`。

### 2.5 保活与重连

- relay 每 25 秒发送 WebSocket ping，25 秒内无 pong 则关闭。
- 客户端断线后指数退避重连：1s、2s、4s … 上限 30s，加 ±20% 抖动；重连后重新 `hello`。
- 重连期间状态置 `connecting`；收到 `welcome` 置 `connected`。

### 2.6 限制

- 单帧上限 8 MiB（语音 base64 也走文本帧）。
- relay 不做持久化：消息只转发，不在线就失败。
- relay 只接受 `/` 路径（或任意路径均可，实现可忽略 path）。

## 3. Host 方法

所有 host 都实现下列方法；调用方（另一台 Host 或 Android）通过 relay 的 `call`/`sub` 使用。

### 3.1 通用

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `ping` | `{}` | `{ "pong": true, "time": 1762531200000 }` |
| `device.info` | `{}` | 见下 |

`device.info` 返回：

```json
{
  "deviceId": "dev_xxx", "name": "家里的 MacBook", "platform": "macos",
  "version": "1.0.0", "dshVersion": "0.2.2-rc.1", "time": 1762531200000,
  "workspaceDefault": "/Users/me/project",
  "capabilities": ["sessions", "speech"],
  "speech": { "available": true, "providers": ["sensevoice-local"], "language": "zh" }
}
```

### 3.2 工作区 / 会话

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `workspace.list` | `{}` | `{ "items": [ { "workspaceId", "title", "path" } ] }` |
| `session.list` | `{}` | `{ "items": [ SessionSummaryView ] }` |
| `session.create` | `{ "workspaceId"?, "cwd"?, "agentPreset"? }` | `{ "sessionId" }` |
| `session.prompt` | `{ "sessionId", "text", "mode"?: "queue"\|"steer" }` | `{ "accepted": true }` |
| `session.cancel` | `{ "sessionId" }` | `{ "accepted": true }` |
| `session.rename` | `{ "sessionId", "title" }` | `{ "title" }` |
| `session.state` | `{ "sessionId" }` | `SessionStateView` |
| `session.history` | `{ "sessionId", "maxMessages"? }` | `{ "records": [ChatRecord], "cursor": 123, "hasMore": false, "state": SessionStateView }` |
| `session.follow` (流) | `{ "sessionId" }` | 见 3.4 |

`SessionSummaryView`：

```json
{ "sessionId": "session-…", "title": "重构登录页", "cwd": "/Users/me/project",
  "updatedAt": 1762531200000, "running": false, "active": false,
  "agentAvailable": true, "blank": false, "parentSessionId": null }
```

- 按 `updatedAt` 降序，最多 100 条；`title` 缺失时返回 `""`，App/UI 自行显示回退名。
- `cwd` 可能缺失；`parentSessionId` 缺失为 `null`。

`SessionStateView`：

```json
{ "active": false, "running": false, "queueCount": 0,
  "pendingInput": ["approval"] }
```

### 3.3 历史映射（ChatRecord）

Host 把 DSH 会话事件映射为下表的记录；**只读**，不改变本地会话：

```json
{ "kind": "user",    "seq": 12, "time": 1762531200000, "text": "帮我看看构建" }
{ "kind": "assistant","seq": 15, "time": 1762531201000, "turn": 1, "step": 1, "text": "好的，我先…", "reasoning": "…" }
{ "kind": "tool-call","seq": 16, "time": 1762531202000, "turn": 1, "step": 1, "callId": "call_1", "name": "bash", "args": "{\"command\":\"ls\"}" }
{ "kind": "tool-result","seq": 17, "time": 1762531203000, "turn": 1, "step": 1, "callId": "call_1", "name": "bash", "isError": false, "text": "a.txt\nb.txt" }
{ "kind": "turn-start","seq": 10, "time": 1762531199000, "turn": 1 }
{ "kind": "turn-end", "seq": 20, "time": 1762531210000, "turn": 1, "reason": "completed" }
{ "kind": "error",    "seq": 21, "time": 1762531211000, "message": "…" }
```

规则：

- `user` 来自 `user/message` 的文本块；`assistant` 来自 `assistant/message` 的文本块，`reasoning` 为其 reasoning 块（可缺省）。
- `assistant` / `tool-call` / `tool-result` 携带源事件的 `turn`、`step`，接收端可据此把工具调用还原成原生工具卡片（而不是折叠成一段文本）。
- 富内容（图片/文件/工具块）不传输，只保留文本；`text` 截断到 16 KiB，`args` 截断到 4 KiB。
- 未知事件忽略；`turn-end.reason` 用 `TurnEndReason` 的 `kind` 字符串。
- 记录按 `seq` 升序返回。

### 3.4 `session.follow` 流帧

被调方确认订阅后按下表推送（`data` 字段内容）：

```json
{ "t": "ready", "sessionId": "…", "title": "…" }
{ "t": "snapshot", "records": [ChatRecord], "cursor": 123, "state": SessionStateView,
  "assistantStream": { "revision": 7, "activeAttempt": { "attemptId": "…", "turn": 1, "step": 2,
    "startedAfterSeq": 41, "nextIndex": 3, "stream": [ { "time": 1762531204000, "chunk": { … } } ] } } }
{ "t": "record", "record": ChatRecord }
{ "t": "assistant-stream", "frame": { "type": "start" | "chunk" | "end", … } }
{ "t": "state", "state": SessionStateView }
{ "t": "title", "title": "…" }
{ "t": "error", "code": "…", "message": "…" }
```

- `snapshot` 必发一次，取最近 ≤ 60 条记录（`cursor` 为最后一条记录的 `seq`，无记录为 `-1`）。
- `assistantStream` 是该会话当前未提交助手 attempt 的实时基线：`activeAttempt` 为空对象/缺省表示当前没有流式输出；`stream` 是已产生的 chunk 列表，`nextIndex` 是下一个 chunk 下标，`revision` 是进程内单调版本号。
- 之后每个提交事件按 3.3 映射后发 `record`；`turn-start`/`turn-end` 后补发一次 `state`。
- `assistant-stream` 帧是**瞬态呈现数据**，不进入会话日志，仅用于让订阅端边生成边显示。`frame` 复用 DSH 的 Assistant frame 形状：
  - `start`：`{ type, attemptId, revision, turn, step }`；
  - `chunk`：`{ type, attemptId, revision, index, time, chunk }`，`index` 从 0 密集递增，`chunk` 为模型增量块（如 `text-delta`、`reasoning-delta`、`tool-call-delta`）；
  - `end`：`{ type, attemptId, revision, index, outcome }`，`outcome.kind` 为 `committed`（带 `eventType` 和提交事件 `seq`）或 `abandoned`；接收端应等收到与本次 attempt 匹配的提交记录后再保留流式内容，否则丢弃瞬态内容、以日志为准。
- `revision` 在同一个连接/基线内必须严格 +1 递增；断线重连后以新 `snapshot.assistantStream.revision` 为准。
- 兼容性：以上字段和 `assistant-stream` 帧是 v1 的**增量扩展**，旧客户端应忽略未知帧/字段；旧 Host 不发送 `assistantStream` 时新客户端退回一次性显示。
- Host 每 10 秒兜底发一次 `state`（保活/状态纠正）；客户端可忽略重复。
- 订阅者主动 `unsub`、连接断开或 host 卸载时结束。

### 3.5 语音识别

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `speech.status` | `{}` | `{ "available": true, "phase": "ready", "providers": [ { "id", "name", "languages" } ], "language": "zh" }` |
| `speech.transcribe` | `{ "audioBase64", "language"? }` | `{ "text", "audioSeconds", "inferenceSeconds" }` |

- `audioBase64`：完整 **WAV** 文件，且必须是标准 16 kHz / 单声道 / 16-bit PCM 格式（44 字节头，`data` 块紧接 `fmt `；`RIFF` 长度与文件一致），解码后 ≤ 4 MiB。不满足时回 `bad-request`。
- Host 用本机 DSH 的 `speechToText` 服务识别（provider 由 DSH 设置决定，通常是 SenseVoice 本地模型）。
- 模型未就绪时 Host 会触发 prepare 并等待，最长 120 秒；超时回 `timeout`。
- 识别结果返回调用方（Android 显示在可编辑输入框中），**不**自动发送到会话。

## 4. 本机 HTTP API（插件 Web UI 用）

插件 Host 半在 DSH Web 服务器注册同源认证路由：

- `POST /api/dsh-link`：JSON body `{ "op": "...", ... }`，返回 JSON。
- `POST /api/dsh-link/stream`：JSON body `{ "op":"follow", "deviceId", "sessionId" }`，返回
  `application/x-ndjson` 流，每行一个 `{"type":"ready"|"snapshot"|"record"|"state"|"title"|"error"|"end", ...}`。

业务 op：

| op | 请求 | 返回 |
| --- | --- | --- |
| `status` | `{}` | `PluginStatus` |
| `save` | `{ "pairingCode", "deviceName"? }` | `PluginStatus` |
| `forget` | `{}` | `PluginStatus` |
| `sessions` | `{ "deviceId" }` | `{ "items": [SessionSummaryView] }` |
| `workspaces` | `{ "deviceId" }` | `{ "items": [...] }` |
| `history` | `{ "deviceId", "sessionId", "maxMessages"? }` | 同 `session.history` |
| `send` | `{ "deviceId", "sessionId", "text" }` | `{ "accepted": true }` |
| `cancel` | `{ "deviceId", "sessionId" }` | `{ "accepted": true }` |
| `create` | `{ "deviceId", "workspaceId"?, "cwd"? }` | `{ "sessionId" }` |
| `transcribe` | `{ "deviceId", "audioBase64", "language"? }` | 同 `speech.transcribe` |
| `rename` | `{ "deviceId", "sessionId", "title" }` | `{ "title" }` |

`PluginStatus`：

```json
{
  "configured": true,
  "pairingCode": "dshlink1.…",
  "device": { "id": "dev_xxx", "name": "家里的 MacBook", "platform": "macos" },
  "connection": { "state": "connected", "relayUrl": "wss://…", "lastError": null },
  "peers": [ { "id": "dev_yyy", "name": "出差笔记本", "platform": "windows" } ],
  "speech": { "available": true, "phase": "ready", "language": "zh" },
  "version": "1.0.0"
}
```

`connection.state`: `unconfigured` | `connecting` | `connected` | `offline`。

## 5. 错误码

| code | 场景 |
| --- | --- |
| `bad-request` | 参数缺失/类型错误 |
| `not-found` | 会话/工作区不存在 |
| `offline` | 目标设备不在线（relay 产生） |
| `unauthorized` | token 错误（relay 产生） |
| `unavailable` | 本机 DSH 服务未就绪 |
| `busy` | 会话正忙且操作不允许 |
| `timeout` | 等待超时 |
| `internal` | 未分类异常 |

## 6. 版本与兼容

- `v` 目前固定为 1；relay 校验 `v===1`，否则 `version` 错误。
- 新增字段向后兼容；新增方法无需升版；语义变更必须升 `v`。
- 配对码前缀中的 `1` 与协议 `v` 绑定。

## 7. 安全模型

- 公网只暴露 relay 的 8443（TLS）。电脑上的 DSH 端口永远不暴露公网，Host 主动外连 relay。
- token 是唯一凭据：持有者可在空间内调用所有 Host。泄露即轮换（relay 生成新 token，所有设备重新配对）。
- relay 记录：连接时间、设备 id/名称、方法名、耗时；**不记录** params/result 正文。
- 手机 App 的 token 存在应用私有目录；电脑端存在 DSH 凭据存储。
