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
| DSH 插件 Web UI 半 | `plugin/client.js` | 左侧「工作区」多电脑标签页、远程项目树、远程设置、设置页 |
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

### 3.2 原生会话镜像

为了让远程会话直接用 DSH 原生对话界面渲染，Host 半把远程会话**镜像**成本机会话：

1. 每台在线电脑在 `~/.dsh/dsh-link/mirrors/<deviceId>/` 建一个真实目录，并注册为工作区
   `[远程] <远程项目名> · <设备名>`（按远程 Workspace 分组）；
2. 为最近 10 个非子代理远程会话创建本机镜像会话（`session-dshlink-<hash>`），把远程
   `session.history` 映射成 DSH 原生事件（`turn/start`、`user/message`、`step/start`、
   `assistant/message`、`step/end`、`turn/end`）；
3. 打开镜像会话时，Web UI 的会话头组件向 Host 发 `watch`，Host 订阅远程
   `session.follow`，新记录实时追加到本机会话日志；
4. 在原生输入框发送时，`agent/pre-step` 门禁拦截本机模型请求，把 prompt 转发到远程 Host，
   远程回复再通过 watch 追加回来；
5. 镜像映射存于 `~/.dsh/dsh-link/mirrors.json`（0600），只含设备名、标题、远程 seq，
   不含 token。

### 3.3 左侧工作区标签页

Web UI 半替换 DSH 的 `sidebar.workspaces` 区域（priority `-100`，覆盖自带列表），
在同一个位置渲染浏览器式标签栏：

1. 第一个标签固定为「本机」，读取本地 `workspace.list` / `session.list` / `workspace.snapshot`；
2. 每台在线电脑一个标签，标签内按该电脑的 Workspace 分组展示项目和会话；
3. 点远程会话时按需 `ensureMirror`，再调用原生 `uiWorkspace.openSession` 打开镜像会话；
4. 搜索、归档、重命名、新建会话、模型/思考强度/插件预设都作用于当前标签；
5. 设备离线后标签消失并自动回到「本机」；禁用插件即可恢复 DSH 自带工作区列表。

这样侧边栏分组、会话行、对话 UI、工具卡片全部复用 DSH 原生实现；插件页面只保留为
设备/配对/Android 管理入口。

### 3.3 远程会话读取

Host 半把 DSH 的 `sessionController` 服务封装成一组方法：

| 远程方法 | 本机 DSH 服务 |
| --- | --- |
| `session.list` | `sessionController.list()` + 标题 projection |
| `session.history` | `sessionController.events()` + `state()` |
| `session.follow` | `sessionController.follow()`（冷会话不激活 Agent） |
| `session.prompt/cancel/rename/create` | 同名 `sessionController` 方法 |
| `workspace.list` | `workspaceRegistry.list()` |
| `speech.transcribe` | `speechToText.prepare/resolve/transcribe` |

DSH 的原始事件被压成 7 种 `ChatRecord`（user / assistant / tool-call / tool-result /
turn-start / turn-end / error），单条文本有上限，避免手机端收到几 MB 的日志。

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

- `POST /api/dsh-link`：状态、配对、会话列表、历史、发送、停止、创建、改名、语音；
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
- 镜像中的远程工具调用/结果以文本卡片呈现；附件上传、权限弹窗、模型切换等完整 DSH UI
  仍要到目标电脑本地操作。
- 原生发送的门禁会让本地这一轮以结束/blocked 收尾，远程回复随后追加；请等待上一条回复。
- 工具调用的参数/结果有截断；超长输出需要到目标电脑查看完整内容。
- Android App 为自签名 APK，安装时需要允许「安装未知来源应用」。
