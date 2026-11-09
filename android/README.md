# DSH Link Android

手机端 App：通过公网 relay 连接多台电脑上的 **DeepSeek Harness（DSH）**，浏览/新建/操作会话，并支持
「手机录音 → 发到指定电脑 → 该电脑本机 SenseVoice 识别 → 文字回到手机可编辑输入框」。

接口唯一契约是 [`../protocol/PROTOCOL.md`](../protocol/PROTOCOL.md)，本目录严格按第 2/3/4 节实现。

## 状态

- 已实现：配对（`dshlink1.*`）、多设备切换、会话列表/新建/重命名、`session.follow` 实时记录 +
  `session.history` 补齐、发送（queue/steer）、停止、工具调用可折叠、错误态、语音识别、深/浅色、
  中文/英文、折叠屏铰链适配。
- 构建：`./gradlew :app:assembleDebug`，产物 `app/build/outputs/apk/debug/app-debug.apk`；版本 `1.2.1`（versionCode 2），与插件 1.2.1 / 协议 v1 同代。
- 单元测试：`./gradlew :app:testDebugUnitTest`（配对码解析、relay 帧编解码、ChatRecord/follow 解析、WAV 头）。

## 环境（本机已装好的工具链）

| 组件 | 版本 / 路径 |
| --- | --- |
| JDK | Temurin 17.0.21，`~/android-toolchain/jdk` |
| Android SDK | `~/android-toolchain/sdk`（platform-tools、platforms;android-35、build-tools;35.0.0） |
| Gradle | 8.11.1，`~/android-toolchain/gradle-8.11.1` |
| AGP / Kotlin | 8.7.3 / 2.0.21（Compose 编译器插件同版本） |
| Compose | BOM 2024.12.01，Material3 |
| 其他 | OkHttp 4.12.0、androidx.window 1.3.0、org.json（系统自带） |

minSdk 26 / targetSdk 35 / compileSdk 35，JDK 17。

机器相关的配置不要提交：

- `local.properties`（已 gitignore）：`sdk.dir=/path/to/android-sdk`。
- JDK 用 `JAVA_HOME` 指定，例如 `export JAVA_HOME=$HOME/android-toolchain/jdk`。
- 构建期需要代理时，写进**用户级** `~/.gradle/gradle.properties`（不要写进仓库），例如：
  `systemProp.http.proxyHost=127.0.0.1` / `systemProp.http.proxyPort=7897`（https 同理）。
  不需要代理时删掉。

## 构建

```bash
cd dsh-link/android
./gradlew :app:assembleDebug          # 产物 app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # 单元测试
./gradlew :app:testDebugUnitTest --tests "dev.dshlink.app.protocol.*"
```

首次构建需要联网（走上面的代理配置）。APK 用 debug keystore 自签名，不提交 git。

## 安装到手机（华为 Mate X7 / 鸿蒙兼容 Android）

1. 构建后得到 `app/build/outputs/apk/debug/app-debug.apk`。
2. 手机开启「开发者选项 → USB 调试」，用数据线连接电脑后：
   ```bash
   ~/android-toolchain/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```
   也可以把 APK 传到手机（微信/文件传输/网盘），在文件管理里点击安装；
   鸿蒙会提示「外部来源应用」，允许一次即可。本 App 声明 `minSdk 26`，HarmonyOS 4/5 的 Android 兼容层可安装。
3. 首次启动按提示授予「麦克风」权限（语音输入必需）。

## 配对

1. 电脑端 DSH Link 插件设置页会显示本机设备与 **配对码**（`dshlink1.<base64url>`）。
2. 手机 App 首次启动：粘贴配对码 → 「连接」。也可以展开「手动填写地址与 token」，
   填 `wss://<relay-host>:8443` 与 64 位十六进制 token。
3. 配对信息只存本机应用私有目录（`SharedPreferences`），**除 hello 帧外不发送、不打印**。
   设置页可「重新连接 / 断开连接 / 解除配对」。

> 注意：App 关闭了明文流量（`usesCleartextTraffic=false`），relay 必须是 `wss://`（TLS）。
> 本地调试若只有 `ws://`，需要临时改 `AndroidManifest.xml` 后再构建。

## 使用

- **电脑**：同空间内在线电脑以胶囊列表展示，点选切换；断线时顶部徽标显示「连接中/离线」，
  客户端按 1s、2s、4s … 30s（±20% 抖动）指数退避自动重连。
- **会话**：右上角 `+` 新建（可选工作区、可填 `cwd`），会话行 `⋮` 可重命名；
  打开后走 `session.follow` 实时订阅，同时用 `session.history`（maxMessages=80）补齐，按 `seq` 去重合并。
- **对话**：用户气泡、DSH 回复（含可折叠「思考过程」）、工具调用/结果可折叠（参数 JSON 美化）、
  轮次分隔线、错误卡片；发送方式可切「排队 / 立即插入」，运行中可点红点停止。
- **语音**：点麦克风 → 录音（16 kHz 单声道 PCM16，上限 60 秒，有计时、电平条与取消）→
  「完成」后封装标准 WAV 并 base64 调所选电脑 `speech.transcribe` → 结果**追加到输入框**，
  可编辑、可重试（保留上次音频）、可取消。识别 `timeout` 等错误会显示在输入框上方。
- **折叠屏**：宽 ≥ 720dp 或存在分离式铰链时双栏（左：电脑+会话，右：聊天）。
  `WindowInfoTracker` 的 `FoldingFeature` 参与布局：
  - 纵向铰链（竖直折线）→ 左右分栏，左栏宽度取铰链左边界、中间留铰链宽度间隔；
  - 横向铰链（水平折线）→ 上下布局，聊天在上、侧栏在下，中间留铰链高度间隔；
  - 铰链不遮挡内容。折叠/旋转/换屏由 ViewModel 保存状态，草稿、打开的会话、录音状态都不丢。
- **主题 / 语言**：跟随系统深/浅色；中文（默认）与英文（`values-en`）。

## 目录结构

```
app/src/main/java/dev/dshlink/app/
├── MainActivity.kt            # 单 Activity + Compose
├── protocol/                  # PairingCode（配对码）、Model（模型/记录）、RelayFrames（帧编解码）
├── net/LinkClient.kt          # WebSocket、请求 id、30s 超时、订阅流、指数退避重连
├── data/Prefs.kt              # 配对信息、设备 id/名称（应用私有存储）
├── audio/Wav.kt               # 44 字节 WAV 头 + base64（纯 JVM，可单测）
├── audio/AudioRecorder.kt     # AudioRecord 16k mono PCM16
├── vm/LinkViewModel.kt        # 全部状态：连接/设备/会话/记录/草稿/语音
└── ui/                        # App（折叠屏布局）、Setup、Sidebar、Chat、Composer、Dialogs、theme
app/src/test/java/dev/dshlink/app/  # PairingCodeTest / WavTest / ProtocolCodecTest
```

## 验证记录

构建产物与验证环境（2026-11-09）：

- `./gradlew :app:assembleDebug`：BUILD SUCCESSFUL，APK 约 10.1 MiB。
- `./gradlew :app:testDebugUnitTest`：31 个用例全通过（WavTest 5 / PairingCodeTest 12 / ProtocolCodecTest 14），
  覆盖配对码编解码与异常、relay 帧类型、ChatRecord 全类型、follow 帧、WAV 头字段。
- Android 15（arm64）模拟器冒烟：安装启动、真实配对码连接公网 relay、设备列表（含假 Host 与真实 Mac）、
  session.list / history / follow 记录渲染、prompt 发送成功并有回复、断线后自动重连并切换到在线设备、
  设置/新建会话对话框、麦克风权限弹窗、录音中 UI（计时/电平/取消/完成）、识别失败态与重试/取消。
- 布局：1280dp 宽（平板横屏）自动双栏；1080×2400 / 440dpi（393dp）单栏 + 返回；深/浅色主题均验证。
- 语音链路：模拟器麦克风静音 → 生成 16 kHz 单声道 44 字节头 WAV → base64 → 真实 Host `speech.transcribe`
  被接受（返回空文本，App 显示「没有识别到语音内容，请重试」），证明 Host 的 WAV 校验通过。
- 仍待真机验证：华为 Mate X7 真实麦克风识别效果、折叠铰链 FoldingFeature 布局（模拟器不产生铰链）、
  HarmonyOS 上的安装与权限弹窗样式。

## 已知限制

- 语音是本机识别：电脑端要先在 DSH 里配好 SenseVoice 等 provider，未就绪时 App 会显示错误；
  识别耗时受模型准备影响（Host 最长等 120 s，App 侧超时 150 s）。
- 录音上限 60 秒（解码后约 1.9 MiB，满足协议 ≤ 4 MiB）。超长录音会被截断，不做分段。
- 会话记录不做本地持久化，App 重启后重新从 `session.history` 拉取。
- relay 不做消息持久化：离线期间的操作会失败，恢复连接后自动重连并补拉历史/订阅。
- 横向铰链时侧栏在下、聊天在上是刻意的「笔记本姿态」布局；若铰链偏心，左/上栏宽度会按铰链边界计算，
  极端位置（铰链贴边）会退回 320dp。
- 本 App 是个人私有应用，非上架应用；APK 自签名，升级需保持同一 debug keystore。
