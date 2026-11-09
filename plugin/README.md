# DSH Link 插件

让多台电脑上的 **DeepSeek Harness（DSH）** 通过你自己的 relay 互相连通，并让
Android App 连接这些电脑。完整项目、relay 部署、Android App 与使用说明见
[仓库根目录 README](../README.md)。

## 安装

把本目录（`plugin/`）作为本地 bundle 安装到 DSH：

- Agent 调用 `plugin_manager` 的 `install_bundle`，`target` 为本目录绝对路径；或
- DSH 设置 → 插件 → 安装本地 bundle，选择本目录。

安装后刷新 DSH：左侧栏出现 **跨设备**，设置 → 跨设备 出现配对页。

## 配对

在「设置 → 跨设备」粘贴服务器上的配对码：

```
dshlink1.<base64url({"v":1,"u":"wss://...:8443","t":"..."})>
```

保存后插件会主动连接 relay；另一台电脑粘贴同一配对码即可互相看到。

可选自动导入：把配对码写入 `~/.dsh/dsh-link/pairing.txt`，首次启动时插件会自动导入并
删除该文件（token 转入 DSH 凭据存储）。

## 提供的能力

- 远程会话直接镜像到 DSH 左侧「工作区」的 `[远程] 设备名` 分组，会话行带「远程」标签，点开就是原生对话：工具调用显示为原生可折叠工具卡片，远程生成时逐字流式显示（设置页可关闭「流式输出」）；原生输入框发送会转发到远程电脑；
- 侧边栏 **跨设备** 管理页：设备/会话列表、配对、Android 提示；
- Agent 工具：`link_status` / `link_devices` / `link_sessions` / `link_read` /
  `link_create` / `link_prompt` / `link_cancel` / `link_debug`；
- 远程语音识别：手机上传 WAV，本机 `speechToText` 识别后返回文字。

## 设置

「设置 → 跨设备」提供 **流式输出** 开关（默认开启）：关闭后本机不再请求/转发远程的瞬时分片，
远程回复在生成完成后整段出现；已打开的镜像会话会立即重订阅。开关保存在本机
`config.json` 的 `streaming` 字段，不写入 relay。

## 配置与数据

- token：DSH 凭据存储 `dsh-link/token`（不会进日志/会话）；
- 非敏感配置：`~/.dsh/dsh-link/config.json`（0600，包含 relay 地址、设备 id/名称）；
- 不修改 profile 的 `cordis.patch.yml`；设置页通过同源 HTTP API 读写。

详细协议见 [`../protocol/PROTOCOL.md`](../protocol/PROTOCOL.md) 或
[GitHub 仓库](https://github.com/yuyeyubee/dsh-link)。
