# DSH Link 插件

让多台电脑上的 **DeepSeek Harness（DSH）** 通过你自己的 relay 互相连通，并让
Android App 连接这些电脑。完整项目、relay 部署、Android App 与使用说明见
[仓库根目录 README](../README.md)；协议契约见 [`../protocol/PROTOCOL.md`](../protocol/PROTOCOL.md)。

插件版本 **1.2.2**，协议 **v1**。

## 安装

把本目录（`plugin/`）作为本地 bundle 安装到 DSH：

- Agent 调用 `plugin_manager` 的 `install_bundle`，`target` 为本目录绝对路径；或
- DSH 设置 → 插件 → 安装本地 bundle，选择本目录。

安装后刷新 DSH（桌面版通常随 HMR 自动生效）：

- 左侧栏出现 **跨设备**；
- 设置 → 跨设备 出现配对页；
- 有在线电脑时，左侧「工作区」出现 `[远程] …` 分组。

更新插件代码后若没生效：在「设置 → 插件」里把 dsh-link 关闭再打开，或重启 DSH。

## 配对

在「设置 → 跨设备」粘贴服务器上的配对码：

```
dshlink1.<base64url({"v":1,"u":"wss://...:8443","t":"..."})>
```

保存后插件会主动连接 relay；另一台电脑粘贴同一配对码即可互相看到。本机配对码可复制给
另一台电脑或手机使用（含 token，注意保密）。

可选自动导入：把配对码写入 `~/.dsh/dsh-link/pairing.txt`，首次启动时插件会自动导入并
删除该文件（token 转入 DSH 凭据存储）。

## 提供的能力

### 原生远程会话（工作区镜像）

- 每台在线电脑按远程项目建 `[远程] <项目> · <设备名>` 工作区；没有归属项目的会话进
  `[远程] 其他 · <设备名>`；
- 镜像该设备最近 **10 个**非子代理会话（正在运行的额外保留），会话行带「远程」标签；
- 点开会话即用 DSH **原生对话**渲染：用户/助手消息、思考过程、工具调用与结果都是原生
  可折叠工具卡片，轮次状态一致；
- 远程生成时逐字流式显示（可通过「流式输出」关闭）；
- 在原生输入框发送会**门禁拦截本机模型**并把 prompt 转发到远程，远程回复实时回填；
- 归档双向同步：本机归档会同步远端，远端归档会同步本机；用户方向按镜像持久化（`archiveDesired`），
  对端离线隐藏的镜像重新上线后会按原方向完整恢复（含最近 10 个之外的旧镜像），推送失败会自动重试，
  所以取消归档不会被反向覆盖；
- 模型/思考强度双向同步（每 5 秒对齐一次，发送提示词前再推一次）；Agent 预设由远程
  设置齿轮控制；
- 远程电脑离线时移除对应分组，重新上线后复用原镜像会话 id 重建。

### 跨设备管理页

左侧栏 **跨设备** 打开（也可从面板齿轮进入）：

- 本机 + 每台在线电脑的标签页，连接状态点与设置齿轮；
- 搜索项目/会话；
- 新建会话（可选项目、标题；或让远程设备决定）；
- 重命名会话/项目、归档/取消归档、显示已归档、复制 Session ID/项目 ID、更多操作；
- 置顶会话排在组内最前；刷新强制重拉项目与会话树。

### 远程会话设置（齿轮）

远程会话标题旁（或管理页会话行）的齿轮可远程修改：

- 会话标题（本机镜像标题跟随）；
- 模型与思考强度（远程 `model.catalog`）；
- 插件/Agent 预设；
- 归档。

对端插件过旧时会提示更新后再使用模型/预设设置。

### Agent 工具

`link_status` / `link_devices` / `link_sessions` / `link_read` / `link_create` /
`link_prompt` / `link_cancel` / `link_debug`。`device` 支持 peer id（`dev_…`）或设备名。
`link_prompt` 会向远程会话发送提示词并等待回合结束，返回最新助手回复。

### 远程语音识别

手机上传标准 16 kHz 单声道 PCM16 WAV（≤ 4 MiB，base64），Host 用本机 DSH 的
`speechToText` / SenseVoice 识别后返回文字；识别不经过云端，也不自动发送。

## 设置

「设置 → 跨设备」页面包含：连接状态（设备、设备 ID、连接状态、relay、插件版本）、
**流式输出** 开关、配对码与设备名、本机配对码、在线设备、语音识别状态、Android 配对提示。

**流式输出**（默认开启）：关闭后本机不再请求/转发远程的瞬时分片，远程回复在生成完成后
整段出现；已打开的镜像会话会立即重订阅。该开关是**本机显示偏好**，只影响本机，保存在
`config.json` 的 `streaming` 字段，不写入 relay。

## 配置与数据

- token：DSH 凭据存储 `dsh-link/token`（不会进日志/会话）；
- 非敏感配置：`~/.dsh/dsh-link/config.json`（0600，包含 relay 地址、设备 id/名称、`streaming`）；
- 镜像映射：`~/.dsh/dsh-link/mirrors.json`（0600，归档方向、远端序号）；
- 镜像目录：`~/.dsh/dsh-link/mirrors/<deviceId>/`（0700，作为本机工作区路径）；
- 不修改 profile 的 `cordis.patch.yml`；设置页通过同源 HTTP API 读写。

## 本机 HTTP API（供 Web UI 半使用）

- `POST /api/dsh-link`：`{ "op": ... }`，op 包括 `status`、`settings`、`save`、`forget`、
  `sessions`、`workspaces`、`history`、`send`、`cancel`、`create`、`tree`、`archive`、
  `rename`、`renameWorkspace`、`models`、`selectModel`、`presets`、`selectPreset`、
  `sessionInfo`、`mirrors`、`watch`、`unwatch`、`sync`、`transcribe` 等；
- `POST /api/dsh-link/stream`：NDJSON 实时会话流（`ready`/`snapshot`/`record`/`state`/`title`/`error`/`end`）。

## 开发与测试

```bash
cd plugin && node --test test/     # 纯 Node 单元测试（Host 半）
```

详细协议见 [`../protocol/PROTOCOL.md`](../protocol/PROTOCOL.md) 或
[GitHub 仓库](https://github.com/yuyeyubee/dsh-link)。
