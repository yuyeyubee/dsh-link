# DSH Link · 跨设备互联

> 用一台你自己的公网 relay，把多台电脑上的 **DeepSeek Harness（DSH）** 和 **Android 手机** 连成一个只属于你的私有空间：在这台电脑上直接看到、打开、操作另一台电脑的 DSH 会话；本机 AI 也能用工具驱动远程 DSH；手机可以连接多台电脑，并用语音输入把话发到指定电脑、由那台电脑本地识别后把文字传回手机。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Plugin](https://img.shields.io/badge/plugin-1.2.2-brightgreen)
![Protocol](https://img.shields.io/badge/protocol-v1-blue)
![Android](https://img.shields.io/badge/Android-8.0%2B-3ddc84)

**中文** | [English](README.en.md)

![远程会话直接出现在 DSH 工作区](docs/images/link-sidebar-remote.png)

![原生会话里的远程设备标签](docs/images/link-chat.png)

## 功能总览

| 能力 | 说明 | 入口 |
| --- | --- | --- |
| **远程工作区镜像** | 每台在线电脑在左侧「工作区」自动出现 `[远程] 项目 · 设备名` 分组，会话行带「远程」标签 | 左侧「工作区」 |
| **原生远程会话** | 远程消息、工具调用/结果、轮次状态按 DSH 原生方式渲染（工具卡片默认折叠），远程生成时逐字流式显示；原生输入框发送会转发到那台电脑 | 点开远程会话 |
| **跨设备管理页** | 本机 + 每台在线电脑的标签页；搜索项目/会话、新建会话、重命名会话/项目、归档/取消归档、显示已归档、复制 ID、更多操作 | 左侧「跨设备」或面板设置 |
| **远程会话设置** | 会话标题、模型、思考强度、Agent 预设、归档；模型/思考强度与本机选择器双向同步 | 远程会话标题旁齿轮 / 会话行齿轮 |
| **AI 直接操作远程电脑** | 8 个 Agent 工具：列设备、列会话、读消息、建会话、发提示词并等回复、停止回合、诊断 | 任意 DSH 会话里对 AI 说一句 |
| **流式输出开关** | 关闭后本机不再请求/转发瞬时助手分片，远程回复在生成完成后整段出现；只影响本机显示 | 设置 → 跨设备 |
| **Android App** | 一个 App 连接多台电脑，多设备切换、会话列表/新建/重命名、发送（排队/插入）、停止、折叠工具卡片、深/浅色、中英文、折叠屏适配 | `android/` |
| **手机语音输入** | 手机录音 → 发到所选电脑 → 该电脑本机 SenseVoice 识别 → 文字回到手机输入框，可修改后再发送 | App 麦克风按钮 |
| **不暴露端口** | 电脑和手机都主动外连 relay，不需要公网 IP、内网穿透或 VPN；relay 只转发、不保存会话内容 | — |

## 架构

```
┌──────────────────────┐        ┌──────────────────────┐
│ 电脑 A · DSH Desktop │        │ 电脑 B · DSH Desktop │
│  DSH Link 插件       │        │  DSH Link 插件       │
└──────────┬───────────┘        └──────────┬───────────┘
           │ WSS（主动外连，无需公网 IP）    │ WSS
           ▼                               ▼
      ┌─────────────────────────────────────────┐
      │ 你的服务器 · relay（TLS 8443）          │
      │ 同 token 空间：设备名录 + 呼叫/流式转发 │
      └────────────────────▲────────────────────┘
                           │ WSS
                    ┌──────┴───────┐
                    │ Android App  │
                    │ 多设备 + 语音 │
                    └──────────────┘
```

| 组件 | 目录 | 职责 |
| --- | --- | --- |
| 插件 Host 半 | `plugin/index.js` | 配对与 token 存储、relay 连接、远程 RPC、本机 DSH 服务适配、Agent 工具、语音识别、同源 HTTP API |
| 插件 Web UI 半 | `plugin/client.js` | 「跨设备」管理页、远程工作区装饰（远程标签/会话头/齿轮）、设置页与流式开关 |
| relay | `relay/` | 公网 TLS WebSocket 中转；只维护在线设备名录与转发，不解析/不保存业务数据 |
| Android App | `android/` | Kotlin + Jetpack Compose：多设备会话控制、语音录制回传、折叠屏适配 |
| 协议 | `protocol/PROTOCOL.md` | Host / Web UI / App / relay 的唯一契约（v1） |
| 工具 | `tools/` | `fake-host.mjs` 模拟远程电脑、`probe-client.mjs` 探针客户端 |

## 目录

```
dsh-link/
├── plugin/      DSH 插件（Host + Web UI + 中英文元数据 + 图标 + 单元测试）
├── relay/       relay 服务端、部署脚本、systemd unit、协议测试
├── android/     Android App（Kotlin + Compose + 折叠屏）
├── protocol/    v1 协议规范
├── tools/       probe-client / fake-host 开发测试工具
└── docs/        架构、安装、FAQ、截图
```

## 快速开始

### 0. 准备

- 一台有公网 IP 的 Linux 服务器（Ubuntu 22.04 已验证，1C1G 起步；需要 80 与 8443 入站）。
- 一台或多台安装了 **DSH Desktop 0.2.x**（已验证 0.2.1 / 0.2.2-rc.1）的电脑，macOS / Windows / Linux 均可。
- Android **8.0+** 手机（鸿蒙设备的 Android 兼容层也可安装 APK）。iOS 暂不支持。

### 1. 部署 relay（服务器上，只需一次）

relay 默认监听 **8443/TLS**，用 Let's Encrypt 证书。没有域名也可以：用 [sslip.io](https://sslip.io) 把 `<服务器IP>.sslip.io` 解析到你的 IP，用它申请证书。

```bash
# 服务器上
apt-get update && apt-get install -y certbot
certbot certonly --standalone -d <服务器IP>.sslip.io \
  --non-interactive --agree-tos --register-unsafely-without-email
git clone https://github.com/yuyeyubee/dsh-link.git /opt/dsh-link-src
cd /opt/dsh-link-src/relay
sudo ./deploy.sh        # 安装依赖、生成 token/配对码、装 systemd 并启动
# 自有域名：sudo DSHLINK_DOMAIN=relay.example.com ./deploy.sh
```

完成后：

- 服务：`systemctl status dsh-link-relay`（要求 Node.js ≥ 20，`deploy.sh` 会检查）
- 权威配对码：`/opt/dsh-link/pairing.txt`（0600，含 token，请勿外传）
- 公网入口：`wss://<服务器IP>.sslip.io:8443/`

> 证书续期、token 轮换、端口/防火墙、日志排查见 [relay/README.md](relay/README.md)。

### 2. 在每台电脑安装插件

```bash
git clone https://github.com/yuyeyubee/dsh-link.git
```

在 DSH 中以**本地 bundle** 安装 `dsh-link/plugin`（绝对路径）：

- 让 Agent 调用 `plugin_manager` 的 `install_bundle`；或
- DSH 设置 → 插件 → 安装本地 bundle，选择该目录。

安装后刷新 DSH（桌面版多数情况下随 HMR 自动生效）：

- 左侧栏出现 **跨设备** 入口；
- 「设置 → 跨设备」出现配对页；
- 左侧「工作区」出现 `[远程] …` 分组（有在线电脑时）。

> 插件以 `link:` 方式安装，不要移动或删除仓库目录。更新代码后若插件没生效，在「设置 → 插件」里把 dsh-link 关闭再打开，或重启 DSH；详见 [docs/faq.md](docs/faq.md)。

### 3. 配对

1. 打开 **设置 → 跨设备**；
2. 把服务器 `/opt/dsh-link/pairing.txt` 里的整串 `dshlink1.…` 粘贴到「配对码」；
3. 设备名可留空（默认使用电脑名，可随时修改）；
4. 点「保存配对码」。

配对成功后页面显示「已连接」、本机设备/版本、中转服务器和其他在线电脑。每台电脑重复一次。

> 本机配对码也可以复制给手机用；配对码包含 token，等同密码，不要发到公开群聊或提交到仓库。
>
> 支持**自动导入**：首次启动时若存在 `~/.dsh/dsh-link/pairing.txt`，会自动读取并把 token 转入 DSH 凭据存储，然后删除该文件，适合批量/远程部署。

### 4. 安装 Android App

从 [Releases](https://github.com/yuyeyubee/dsh-link/releases) 下载 APK，或自行构建（`cd android && ./gradlew :app:assembleDebug`），传到手机安装（需要允许「安装未知来源应用」）。

![Android App](docs/images/link-android.png)

打开 App：

1. 粘贴与电脑**同一个** `dshlink1.…` 配对码（也可手动填 `wss://` 地址 + token）；
2. 连接后顶部会出现在线电脑胶囊列表，点选要操作的电脑；
3. 浏览会话、新建、重命名、发送消息（排队/立即插入）、停止运行中的回合；
4. 点麦克风录音 → 完成 → 等待所选电脑识别 → 文字回到输入框，确认/修改后发送。

> App 关闭了明文流量（`usesCleartextTraffic=false`），relay 必须是 `wss://`。

## 使用指南

### 1. 远程工作区（原生镜像）

配对成功后，DSH 左侧「工作区」会自动出现：

```
📁 [远程] 我的项目 · 家里的 MacBook
   ├─ 会话 A          远程
   └─ 会话 B          远程
📁 [远程] 其他 · 家里的 MacBook      ← 没有归属项目的会话
📁 MyGitHub                          ← 本地工作区
```

- 分组名格式：`[远程] <远程项目名> · <设备名>`；没有归属项目的会话进 `[远程] 其他 · <设备名>`。
- 每个会话行右侧有「远程」标签，本地会话没有。
- 点远程会话，直接用 **DSH 原生对话界面** 打开：标题旁显示 `远程 · 设备名`，消息、工具调用/结果、轮次都按原生方式渲染；工具调用是可折叠的原生工具卡片。
- 远程生成时逐字流式显示；可在「设置 → 跨设备 → 流式输出」关闭（见下文）。
- 在原生输入框发送：消息会转发给那台电脑，远程回复实时回填；本地模型被门禁拦截，不会在本机另答一遍。
- 每台电脑镜像它**最近 10 个**非子代理会话（正在运行的额外保留），按远程项目分组；远程新会话约 60 秒内出现，打开会话时立即补拉最新记录。
- **远程电脑离线时对应分组会被移除**，重新上线后自动重建并复用原来的镜像会话 id，不会产生重复副本。
- **在远程分组里新建会话**：自动在远端创建对应会话，首条提示和后续回复都由远端执行。
- **归档双向同步**：本机归档远程会话，远端也归档；远端归档后本机也对齐归档。每个镜像单独保存「用户想要的归档方向」，与插件自己写入的临时状态分开：对端离线时镜像行会被隐藏，重新上线后按原方向完整恢复（包括最近 10 个之外的旧镜像），推送失败会在下一轮重试，所以取消归档不会被反向覆盖。
- **模型/思考强度双向同步**：在本机选择器（或远程设置齿轮）里改，5 秒内同步到执行提示词的那台电脑；发送提示词前还会先同步一次。远程电脑上改了也会回同步到本机镜像。Agent 预设由远程设置齿轮控制。

### 2. 跨设备管理页

左侧栏 **跨设备** 打开管理页，也可以从侧边栏面板的设置齿轮进入：

- **标签页**：本机 + 每台在线电脑；顶部有连接状态点，右侧齿轮打开设置面板。
- **搜索**：按项目名/项目路径/会话标题/cwd 过滤。
- **新建会话**：在所选设备的标签页里新建，可指定项目（或「让远程设备决定」）与标题。
- **会话/项目操作**：重命名、归档/取消归档、复制 Session ID / 项目 ID、在项目里新建会话、更多操作。
- **已归档**：显示/隐藏已归档会话（带数量），归档会话不会混在正常列表里。
- **置顶会话**排在组内最前（跟随目标设备的置顶顺序）。
- **刷新**：强制重新拉取目标设备的项目与会话树。

### 3. 远程会话设置（齿轮）

在远程会话标题旁（或管理页会话行）点齿轮，可远程修改：

| 项 | 说明 |
| --- | --- |
| 会话标题 | 重命名远程会话，本机镜像标题跟随更新 |
| 模型 | 从远程 `model.catalog` 选择 provider/模型 |
| 思考强度 | 随所选模型提供可选档位 |
| Agent 预设 | 远程插件/Agent 预设（与 DSH 预设列表一致） |
| 归档 | 归档远程会话，本机镜像对齐 |

> 对端插件版本过旧时会提示「另一台电脑的插件版本过旧，请更新后再使用模型和预设设置」。

### 4. 流式输出开关

「设置 → 跨设备」里的 **流式输出** 开关控制远程回复的显示方式：

- **开启（默认）**：远程电脑边生成边逐字显示（本机原生镜像会话与插件内远程会话都适用）。
- **关闭**：本机不再向远程电脑请求/转发瞬时的助手分片，回复在提交为完整消息后整段出现；已打开的会话会立即重订阅。
- 这是**本机显示偏好**：只影响这台电脑显示远程回复的方式，不会改变其他设备；保存在本机 `~/.dsh/dsh-link/config.json` 的 `streaming` 字段，不写入 relay。

### 5. 让 AI 操作另一台电脑

在任意 DSH 会话里直接说「看看出差笔记本上有什么会话」「让家里的电脑继续跑测试」，AI 会使用：

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `link_status` | — | 本机配对/连接状态、版本、在线设备 |
| `link_devices` | — | 列出其他在线电脑 |
| `link_sessions` | `device` | 列出某台电脑的会话（含运行状态、cwd） |
| `link_read` | `device`、`session_id`、`max_messages`? | 读取某个远程会话最近消息（默认 30，最多 200） |
| `link_create` | `device`、`cwd`? | 在某台电脑新建会话，返回 Session ID |
| `link_prompt` | `device`、`session_id`、`text`、`wait_seconds`? | 向远程会话发消息并等待回合结束，返回最新助手回复（等待窗口默认 120 s，最长 600 s） |
| `link_cancel` | `device`、`session_id` | 停止远程会话当前回合 |
| `link_debug` | `what`、`session_id`?、`before_seq`?、`device`?、`title`? | 诊断：配置、会话/标题 projection、工作区、语音 provider、镜像状态、事件流等 |

`device` 既可以写 peer id（`dev_xxx`），也可以写设备显示名。

### 6. Android App 用法

- **连接**：粘贴同一个配对码；断线按 1s、2s、4s … 30s（±20% 抖动）指数退避自动重连。
- **电脑**：顶部胶囊列表切换目标电脑，徽标显示「连接中/离线」。
- **会话**：`+` 新建（可选工作区、可填 `cwd`），`⋮` 重命名；打开后 `session.follow` 实时订阅并用 `session.history` 补齐、按 `seq` 去重。
- **对话**：用户气泡、DSH 回复（含可折叠思考过程）、工具调用/结果折叠卡片（参数 JSON 美化）、轮次分隔线、错误卡片；发送方式可切「排队 / 立即插入」，运行中可停止。
- **语音**：麦克风 → 录音（16 kHz 单声道 PCM16，上限 60 秒，计时/电平/取消）→ 完成 → 目标电脑识别 → 文字追加到输入框，可编辑、可重试、可取消。
- **折叠屏**：宽 ≥ 720dp 或存在分离式铰链时双栏；纵向铰链左右分栏、横向铰链上下布局，铰链区域留白不压内容；折叠/旋转不丢当前设备、会话和草稿。
- **主题/语言**：跟随系统深/浅色；中文（默认）与英文。

### 7. 语音链路

```
手机录音（16 kHz 单声道 PCM16）→ 手机写标准 WAV → base64
      → relay → 目标电脑 DSH Link → 本机 speechToText / SenseVoice
      → 文字 → relay → 手机输入框（可编辑，不自动发送）
```

- 识别发生在**目标电脑**，手机不下载模型、音频不上传第三方云端。
- 只接受标准 44 字节头 WAV（`fmt ` 后紧跟 `data`）；解码后 ≤ 4 MiB。
- 首次识别会唤醒本地模型，可能需要数秒（Host 触发 prepare 最长等 120 秒）。

## 设置与数据

「设置 → 跨设备」页面包含：

- **连接状态**：本机设备名、设备 ID、连接状态、中转服务器、插件版本；
- **流式输出**：本机显示偏好（见上文）；
- **配对码**：粘贴/保存配对码、设备名（可选）、断开并清除配对；
- **本机配对码**：复制给另一台电脑或手机；
- **在线设备**：同空间其他电脑的名称/平台/在线数量；
- **语音识别**：本机 provider 是否可用、当前阶段与 provider 列表；
- **Android 配对**：给手机粘贴同一配对码的提示。

本机文件：

| 路径 | 内容 | 权限 |
| --- | --- | --- |
| `~/.dsh/dsh-link/config.json` | relay 地址、设备 id/名称、`streaming` 等非敏感配置 | 0600 |
| DSH 凭据存储 `dsh-link/token` | space token（等同密码） | 凭据库 |
| `~/.dsh/dsh-link/mirrors.json` | 镜像映射、归档方向、远端序号 | 0600 |
| `~/.dsh/dsh-link/mirrors/<deviceId>/` | 远程项目镜像目录（本机工作区路径） | 0700 |
| `~/.dsh/dsh-link/pairing.txt` | 可选，首次启动自动导入后删除 | 0600 |

插件不修改 profile 的 `cordis.patch.yml`；设置页通过同源 HTTP API 读写。

## 安全

- 公网只暴露 relay 的 8443（TLS）；电脑和手机都主动外连，不开放入站端口。
- 一个 space token 就是全部权限；泄露后轮换 token 并重新配对（见 [relay/README.md](relay/README.md)）。
- 电脑端 token 保存在 DSH 凭据存储（`dsh-link/token`），配置 0600；手机端存应用私有目录；relay 不记录请求/响应正文。
- 这是个人自用工具，没有多租户、角色、审计或分享权限。

## 已知限制

- relay 不做离线队列：目标电脑没开 DSH 时远程调用立即失败。
- 远程会话是**镜像**：每台电脑同步最近 10 个非子代理会话（运行中的额外保留）；远程删除的会话不会自动从本地工作区移除。
- 镜像会话复用 DSH 原生工具卡片；附件上传、权限弹窗应答等完整 DSH UI 仍需到目标电脑本地操作。
- 升级到 1.1.0 前同步过的旧镜像历史仍是旧版文本形式；需要 `link_debug what=rebuild-mirrors` 重建（旧镜像会被归档，新镜像自动补拉远端历史）。
- 原生输入框发送走「拦截本地 step + 转发远程」：本地这一轮会以结束/blocked 收尾，远程回复随后追加；极短时间内的重复发送请等待上一条回复。
- 长文本会截断（防止超大帧）：用户/助手文本 8 KiB、思考 4 KiB、工具参数 4 KiB、工具结果 2 KiB；完整内容需到目标电脑查看。
- 协议 v1 不做跨版本兼容承诺；插件、relay、App 请使用同一版本（插件 1.2.2 / 协议 v1）。
- APK 为自签名 debug 包，安装时需允许未知来源；上架应用商店需自行配置 release 签名。

## 排障

常见问题见 [docs/faq.md](docs/faq.md)，例如：

- 插件安装后左侧没有「跨设备」→ 见「插件安装后左侧没有「跨设备」？」；
- 显示「已连接」但看不到另一台电脑 → 检查对端 DSH 是否打开、插件是否启用；
- 更新插件后远程离线/版本没变 → Host 半需要重启 DSH 或在「设置 → 插件」里关闭再打开；
- 远程会话标题为空、工作区看起来空 → 先 `link_debug` 看 projection；
- 语音识别失败/为空 → 检查对端 DSH 的语音 provider。

## 开发与验证

```bash
# 插件 Host 半（纯 Node 测试，29 个用例）
cd plugin && node --test test/

# relay（本机对公网 WSS 跑协议套件）
cd relay && npm install && node test-client.mjs
cd relay && node test-client.mjs --slow

# Android
cd android && ./gradlew :app:assembleDebug
cd android && ./gradlew :app:testDebugUnitTest

# 开发用：模拟一台远程电脑 / 探针客户端
node tools/fake-host.mjs --pairing-file ~/.dsh/dsh-link/pairing-code.txt --name "模拟笔记本"
node tools/probe-client.mjs --pairing-file ~/.dsh/dsh-link/pairing-code.txt --method device.info
```

更详细的设计见 [docs/architecture.md](docs/architecture.md)，安装/排障见 [docs/install.md](docs/install.md) 与 [docs/faq.md](docs/faq.md)，协议见 [protocol/PROTOCOL.md](protocol/PROTOCOL.md)。

## 版本与兼容

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| DSH Link 插件 | 1.2.2 | 修复离线恢复与取消归档不同步：归档方向按用户意图持久化，隐藏镜像重新上线后完整恢复；含「流式输出」开关、跨设备管理页、远程会话设置 |
| 协议 | v1 | 新增字段向后兼容；新增方法无需升版 |
| relay | 1.0.0（protocol v1） | Node.js ≥ 20，`ws` 单依赖 |
| Android App | 1.2.1 | minSdk 26（Android 8.0+），协议 v1（与 1.2.2 插件兼容） |

升级插件后如果版本号没变，是 Host 半仍在内存中运行旧模块：在「设置 → 插件」里关闭再打开 dsh-link，或重启 DSH 即可。

## License

[MIT](LICENSE)
