# DSH Link 架构

## 1. 目标

让同一个人自己的多台电脑上的 DeepSeek Harness（DSH）通过公网互相连通，并让 Android 手机也能控制这些 DSH：

- 电脑 A 的 DSH 能看到、打开、操作电脑 B 的 DSH 会话；
- 电脑 A 上的 AI 也能通过 `link_*` 工具直接驱动电脑 B 上的 DSH；
- Android App 可以连接多台电脑，浏览/新建/发送/停止会话；
- 手机录音发到指定电脑，由该电脑本地的 SenseVoice 识别，文字回到手机再编辑；
- 不暴露电脑上的任何端口，不需要公网 IP、域名、内网穿透或 VPN。

## 2. 组成

```
┌──────────────────────┐        ┌──────────────────────┐
│ 电脑 A · DSH Desktop │        │ 电脑 B · DSH Desktop │
│  ┌────────────────┐  │        │  ┌────────────────┐  │
│  │ DSH Link 插件  │  │        │  │ DSH Link 插件  │  │
│  │ Host + Web UI  │  │        │  │ Host + Web UI  │  │
│  └───────┬────────┘  │        │  └───────┬────────┘  │
└──────────┼───────────┘        └──────────┼───────────┘
           │ WSS（主动外连）                 │ WSS
           ▼                               ▼
   ┌──────────────────────────────────────────────┐
   │ 你自己服务器上的 relay（0.0.0.0:8443, TLS）  │
   │ 同 token 空间：设备名录 + 呼叫/订阅转发      │
   └────────────────────▲─────────────────────────┘
                        │ WSS
                 ┌──────┴───────┐
                 │ Android App  │
                 │ 多设备 + 语音 │
                 └──────────────┘
```

| 组件 | 目录 | 职责 |
| --- | --- | --- |
| DSH 插件 Host 半 | `plugin/index.js` | 配对存储、WebSocket 客户端、主机 RPC、本地会话/语音适配、Agent 工具、同源 HTTP API |
| DSH 插件 Web UI 半 | `plugin/client.js` | 「跨设备」管理页（本机 + 每台设备标签页、搜索、新建/改名/归档）、远程工作区装饰（远程标签/会话头/齿轮）、远程会话设置弹窗、设置页与流式开关 |
| Relay | `relay/` | 公网 TLS WebSocket 中转；只转发，不存业务数据 |
| Android App | `android/` | 多设备会话控制、语音录制与回传、折叠屏适配 |
| 协议 | `protocol/PROTOCOL.md` | 三方唯一契约 |

## 3. 关键链路

### 3.1 配对

1. relay 部署时生成 32 字节随机 token，并生成配对码
   `dshlink1.<base64url({v,u,t})>`；
2. 电脑/手机粘贴同一个配对码；
3. 每台电脑生成稳定的 `deviceId`，以 `hello` 主动连接 relay；
4. relay 只在同一 token 空间内广播「哪些 host 在线」。

电脑端无需开放端口：NAT/防火墙后的 DSH 主动外连 `wss://...:8443`。

### 3.2 原生工作区镜像

为了让远程会话出现在 DSH 左侧「工作区」而不是插件页面，Host 半把远程会话**镜像**成本机会话：

1. 每台在线电脑按远程 Workspace 在 `~/.dsh/dsh-link/mirrors/<deviceId>/ws-<workspaceId>/`
   建真实目录并注册为工作区 `[远程] <远程项目名> · <设备名>`；没有归属项目的会话进
   `~/.dsh/dsh-link/mirrors/<deviceId>/_other/`，标题为 `[远程] 其他 · <设备名>`；
2. 为最近 10 个非子代理远程会话创建本机镜像会话（`session-dshlink-<hash>`），把远程
   `session.history` 映射成 DSH 原生事件（`turn/start`、`user/message`、`step/start`、
   `assistant/message`、`tool/call`、`tool/result`、`step/end`、`turn/end`）。工具调用保留原生
   `turn`/`step`/`callId`/`arguments` 与结果消息，因此复用 DSH 原生工具卡片（默认折叠），
   不再拼成展开的文本；
3. 打开镜像会话时，Web UI 的会话头组件向 Host 发 `watch`，Host 订阅远程
   `session.follow`（`assistantStream` 跟随设置，默认 `true`），提交记录继续追加到本机会话
   日志；远程正在生成时，瞬时 `assistant-stream` 分片通过本机 Cordis 的
   `agent/assistant-stream` 事件转发给 Web UI，于是镜像会话也能像原生会话一样逐字流式显示。
   在「设置 → 跨设备 → 流式输出」关闭后，Host 不再请求/转发瞬时分片，已打开的 watch 会
   立即重订阅，回复只在提交为 `assistant/message` 后整段出现；
4. 在原生输入框发送时，`agent/pre-step` 门禁拦截本机模型请求，把 prompt 转发到远程 Host，
   并在转发前用 `agent/pre-step` 携带的 `modelSelection` 把本机刚改过的模型/思考强度推给
   远程（`session.selectModel`），避免这一轮仍用旧等级；远程回复再通过 watch 追加回来；
5. 镜像打开时，本机会话头部选择器与远程会话的模型/思考强度双向同步：`syncPeerState` 每
   5 秒对比两侧的 `modelSelection` projection（优先读 `next`，即下一次请求实际会用的选择），
   本机改了就推给远程，远程改了就拉回本机；远程 Host 收到 `{ sessionId, selection }` 后
   转成 DSH `sessionController.selectModel()` 需要的扁平参数
   `{ sessionId, provider, model, reasoningEffort }`；
6. 镜像映射存于 `~/.dsh/dsh-link/mirrors.json`（0600），包含设备名、标题、远程 seq、
   本地镜像 id、归档方向（`archiveLocal` / `archiveRemote`）和离线隐藏标记
   `offlineHidden`；不含 token。映射在远程离线时保留，重连后复用同一镜像会话，
   归档方向也只由 `syncPeerArchives` 更新，镜像刷新不会改动它。

这样侧边栏分组、会话行、对话 UI、工具卡片全部复用 DSH 原生实现；插件页面只保留为
设备/配对/Android 管理入口。

### 3.2.1 跨设备管理页与远程会话设置

Web UI 半另外提供一层「管理」界面，用于那些不适合只靠镜像完成的动作：

- **本机与每台在线电脑的标签页**：每台设备调用自己的 `workspace.list` / `session.list`
  组合出「项目 → 会话」树，并按置顶/归档 projection 排序；搜索在客户端过滤标题。
- **新建/改名/归档/复制 ID**：`create`、`rename`、`renameWorkspace`、`archive` 等 op 直接
  转成远程 RPC，作用在目标电脑上（不是镜像），因此和在那台电脑上操作等价。
- **远程会话设置弹窗**：读取 `session.info` + `model.catalog` + 预设列表，写入时调用
  `session.selectModel` / `session.selectPreset` / `session.rename` / `session.archive`；
  镜像会把结果同步回来（标题、模型、归档方向）。
- **流式输出开关**：`settings` op 写入本机 `config.json`；Host 在订阅 `session.follow`
  时把 `assistantStream` 设为该偏好，并在关闭时丢弃/停止转发瞬时分片，同时对已打开的
  watch 重订阅。

### 3.3 远程会话读取

Host 半把 DSH 的 `sessionController` 服务封装成一组方法：

| 远程方法 | 本机 DSH 服务 |
| --- | --- |
| `session.list` | `sessionController.list()` + 标题 projection |
| `session.history` | `sessionController.events()` + `state()` |
| `session.follow` | `sessionController.follow()`（冷会话不激活 Agent） |
| `session.prompt/cancel/rename/create` | 同名 `sessionController` 方法 |
| `session.info` | 会话标题/cwd/模型/预设 projection |
| `session.archive/unarchive/pin/unpin` | `sessionController` 对应方法（镜像归档与置顶） |
| `session.selectModel` | `sessionController.selectModel()`（把 `selection` 摊平成 provider/model/reasoningEffort） |
| `session.selectPreset` | `sessionController.selectPreset()` |
| `model.catalog` | 本机模型目录（provider / model / 思考强度档位） |
| `workspace.list/snapshot/rename/delete` | `workspaceRegistry` 对应方法 |
| `speech.status/transcribe` | `speechToText.prepare/resolve/transcribe` |

DSH 的原始事件被压成 7 种 `ChatRecord`（user / assistant / tool-call / tool-result /
turn-start / turn-end / error），单条文本有上限，避免手机端收到几 MB 的日志。`assistant` 与
工具记录额外带 `turn`/`step`，本机镜像据此还原原生 Turn/Step 结构和工具卡片。

### 3.4 远程会话写入

`session.prompt` 使用 DSH 自己的 `sessionController.prompt()`，因此远程写入与在
那台电脑上直接输入完全等价：同一个 Agent、同一个权限、同一份会话日志。手机/另一台
电脑只是「另一个输入源」。

### 3.5 手机语音

```
手机录音 PCM16 16k → 手机生成 WAV → base64
      → relay → 目标电脑插件 → 本机 speechToText
      → SenseVoice 本地识别 → 文本 → relay → 手机输入框（可编辑）
```

语音识别始终发生在**目标电脑**（用户要求），手机不下载模型、不上传云端。
识别结果只回填输入框，不自动发送。

### 3.6 本机 Web UI

插件 Host 半在 DSH Web 服务器注册两条同源认证路由：

- `POST /api/dsh-link`：状态、设置（含 `streaming` 开关）、配对、会话/工作区树、历史、
  发送、停止、创建、改名、归档、模型/预设读写、镜像 watch、语音；
- `POST /api/dsh-link/stream`：NDJSON 实时会话流。

Web UI 半不直接连接 relay，也不接触 token 的保存逻辑；所有远程操作都经过本机
Host 半，凭据只留在 Host 进程。

## 4. 安全模型

- **只暴露 relay**：电脑上的 DSH 端口不对外开放；relay 只有 8443（TLS）。
- **单一 token**：这是个人私有空间，token 泄露等于全部设备失守；泄露后重新生成并
  在所有设备重新配对。
- **TLS**：relay 使用 Let's Encrypt 证书（域名 `<DOMAIN>`，由
  sslip.io 通配 DNS 指向服务器 IP），客户端走系统信任链，不做「信任所有证书」。
- **凭据落盘**：电脑端 token 存 DSH 凭据存储（`dsh-link/token`），配置文件 0600；
  手机端存应用私有 SharedPreferences，不写日志。
- **relay 不存业务数据**：只记录连接、方法名、耗时，不记录 params/result。

## 5. 为什么不用现成方案

- DSH 自带的 LiveShare 需要独立的 OAuth/数据库服务，且面向「分享给同事」；
- 反向代理/内网穿透需要公网 IP 或第三方服务，且不解决 Android 原生控制与语音回传；
- Tailscale/WireGuard 类方案需要两台电脑与手机都装 VPN，且无法直接复用 DSH 会话
  API。自建 relay + DSH 插件更贴合需求。

## 6. 目录

```
dsh-link/
├── plugin/       DSH bundle（Host + Web UI + 图标 + 中英文元数据）
├── relay/        relay 服务端、部署脚本、systemd、协议测试
├── android/      Android App（Kotlin + Compose）
├── protocol/     协议规范
├── tools/        probe-client / fake-host 开发测试工具
└── docs/         架构、安装、FAQ
```

## 7. 已知限制

- 个人自用设计，没有多租户、角色、审计；token 即全部权限。
- relay 不做离线消息队列：目标电脑没开 DSH 时，远程调用立即失败。
- 远程会话是镜像：每台电脑只同步最近 10 个非子代理会话；远程删除不会自动删除本地镜像。
- 镜像中的远程工具调用/结果复用 DSH 原生工具卡片（默认折叠）；升级前已同步的历史仍保留
  旧版文本形式，只有新同步的内容使用原生事件。附件上传、权限弹窗等完整 DSH UI 仍要到
  目标电脑本地操作。
- 原生发送的门禁会让本地这一轮以结束/blocked 收尾，远程回复随后追加；请等待上一条回复。
- 长文本有截断（用户/助手 8 KiB、思考 4 KiB、工具参数 4 KiB、工具结果 2 KiB）；超长输出需要到目标电脑查看完整内容。
- Android App 为自签名 APK，安装时需要允许「安装未知来源应用」。
