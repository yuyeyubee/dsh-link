# 安装与部署

本文按「服务器 → 电脑 → 手机」的顺序说明完整部署。命令中的 `<SERVER_IP>`、`<DOMAIN>`、`<EMAIL>` 换成你自己的值。

## 0. 检查清单

- [ ] Linux 服务器（Ubuntu 22.04 已验证），有公网 IP，**80** 与 **8443** 入站可达。
- [ ] 电脑安装 DSH Desktop 0.2.x，能打开 Web GUI。
- [ ] Android 8.0+ 手机（APK minSdk 26）。
- [ ] 仓库已克隆到服务器与本机。

## 1. 服务器：TLS 证书

relay 需要 TLS 证书。没有域名时用 sslip.io 的通配 DNS：

```bash
apt-get update && apt-get install -y certbot
certbot certonly --standalone -d <SERVER_IP>.sslip.io \
  --non-interactive --agree-tos --register-unsafely-without-email
```

证书路径：

```
/etc/letsencrypt/live/<SERVER_IP>.sslip.io/fullchain.pem
/etc/letsencrypt/live/<SERVER_IP>.sslip.io/privkey.pem
```

> 若 443 已被其它服务占用（例如 xray），不要动它。relay 使用 8443，不冲突。
> 若服务器不能开放 80 端口，可改用 DNS-01 或已有证书；把证书路径通过
> `DSHLINK_CERT` / `DSHLINK_KEY` 传给 relay。

## 2. 服务器：部署 relay

```bash
git clone https://github.com/yuyeyubee/dsh-link.git /opt/dsh-link-src
cd /opt/dsh-link-src/relay
sudo ./deploy.sh
```

`deploy.sh` 会：

1. 安装 `ws` 依赖（`npm install --omit=dev`）；
2. 复制 `server.mjs`、`package.json`、systemd unit 到 `/opt/dsh-link`；
3. **仅在缺失时**生成 32 字节 token 与配对码：
   - `/opt/dsh-link/token`（0600）
   - `/opt/dsh-link/pairing.txt`（0600）
4. 安装并启动 `dsh-link-relay.service`（enabled + restart on failure）；
5. 安装 certbot 续期 deploy hook（续期后重启 relay）。

验证：

```bash
systemctl status dsh-link-relay --no-pager
journalctl -u dsh-link-relay -n 20 --no-pager
nc -z <SERVER_IP> 8443 && echo open
```

日志中应看到 `listening`，且不应出现 token/params/result 正文。

## 3. 服务器：轮换 token（泄露时）

```bash
sudo systemctl stop dsh-link-relay
sudo sh -c 'head -c 32 /dev/urandom | xxd -p -c 64 > /opt/dsh-link/token'
sudo chmod 600 /opt/dsh-link/token
# 重新生成配对码（保持服务器地址不变）
cd /opt/dsh-link-src/relay
sudo ./deploy.sh
```

然后在每台电脑/手机上重新粘贴新的 `dshlink1.…`。旧 token 立即失效。

## 4. 电脑：安装 DSH 插件

```bash
git clone https://github.com/yuyeyubee/dsh-link.git
```

在 DSH 中安装本地 bundle：

- 方式 A：让 Agent 调用 `plugin_manager` 工具，`action=install_bundle`，`target` 为 `.../dsh-link/plugin` 的绝对路径；
- 方式 B：DSH 设置 → 插件 → 安装本地 bundle，选择该目录。

安装成功后：

- 左侧「工作区」自动出现 `[远程] 设备名` 分组（有在线电脑时）；
- 左侧栏出现「跨设备」管理入口；
- 设置 → 跨设备 出现配对页。

> 插件以 `link:` 方式安装，**不要移动或删除仓库目录**，否则需要重新安装。
> 如果更新了插件代码，可在插件管理中禁用再启用，或重启 DSH，让 Host 半重新加载。

## 5. 电脑：配对

1. 打开 设置 → 跨设备；
2. 粘贴 `/opt/dsh-link/pairing.txt` 的整串内容；
3. 设备名可留空；
4. 点「保存配对码」。

状态变为「已连接」后，在另一台电脑重复安装 + 粘贴同一配对码。

### 5.1 自动导入（批量/远程部署）

首次启动时，如果存在 `~/.dsh/dsh-link/pairing.txt`，插件会：

- 读取并校验配对码；
- 把 token 写入 DSH 凭据存储（`dsh-link/token`）；
- 把服务器地址/设备信息写入 `~/.dsh/dsh-link/config.json`（0600）；
- **删除** `pairing.txt`，避免 token 以明文文件长期留在磁盘。

因此可以把配对码通过 scp 放到该路径，然后启动/重启 DSH。参考副本请另存为
`~/.dsh/dsh-link/pairing-code.txt`，不要叫 `pairing.txt`。

## 6. Android：安装与配对

1. 从 [Releases](https://github.com/yuyeyubee/dsh-link/releases/latest) 下载 APK；
2. 传到手机（微信/华为分享/USB 均可）；
3. 安装时允许「安装未知来源应用」；
4. 打开 App，粘贴同一个配对码；
5. 顶部出现在线电脑后，点选一台开始。

华为 Mate X7 提示：

- APK 为 Android 包，鸿蒙系统可直接安装；
- 展开/折叠时 App 会自动切换单栏/双栏，铰链区域留白；
- 若系统限制后台网络，请在「应用启动管理」里允许 DSH Link 后台活动，保证长连接。

## 7. 语音识别

- 识别在**目标电脑**上执行，使用 DSH 已加载的 `speechToText` provider（默认 SenseVoice）。
- 首次使用会加载模型，可能需要几十秒；之后识别通常 1 秒内。
- 手机只负责录音（16 kHz 单声道 PCM16）和生成标准 WAV。
- 如果返回空文本：确认目标电脑的语音模型已准备（DSH 设置 → 语音输入），并在安静环境重录。

## 8. 验证清单

```bash
# 1) relay 在线
nc -z <SERVER_IP> 8443

# 2) 真实 Host 经公网应答
node tools/probe-client.mjs \
  --pairing-file ~/.dsh/dsh-link/pairing-code.txt \
  --device <device-id> --method device.info

# 3) 远程会话列表
node tools/probe-client.mjs ... --method session.list

# 4) 远程实时流（另开一台电脑/模拟器观察）
node tools/probe-client.mjs ... --method session.follow \
  --params '{"sessionId":"..."}' --stream true --seconds 5
```

桌面端验证：

1. 左侧「工作区」出现 `[远程] 项目 · 设备名` 分组，行带「远程」标签；
2. 点开远程会话，标题旁显示 `远程 · 设备名`，发一条消息能收到远端回复；
3. 点标题旁齿轮，确认会话标题/模型/思考强度/预设可读且可改；
4. 左侧「跨设备」管理页能看到本机与每台在线电脑的标签页、搜索、新建与归档操作；
5. 设置 → 跨设备 能看到「已连接」、插件版本（1.2.2）、本机配对码和「流式输出」开关；
6. 关掉「流式输出」再打开远程会话，回复应整段出现；重新打开后恢复逐字显示。

## 9. 常见故障

| 现象 | 排查 |
| --- | --- |
| 设置页显示「未配置」 | 粘贴完整 `dshlink1.…`；检查是否包含换行/空格 |
| 一直「连接中」 | 服务器 8443 是否可达；证书域名是否与配对码 URL 一致；`journalctl -u dsh-link-relay` |
| 显示「认证失败」 | token 不匹配（轮换过？），重新从服务器取配对码 |
| 远程设备列表为空 | 另一台电脑是否打开 DSH 且插件已启用；`link_status` 查看本机连接 |
| 能看会话但不能发 | 目标电脑 DSH 的会话是否仍在运行/可写；查看错误提示 |
| 语音返回空 | 目标电脑模型未准备、录音太短/太吵；先在本机 DSH 语音输入测试 |
| 手机装不上 APK | 允许未知来源；删除旧版本再装；确认 Android 8.0+（minSdk 26） |
| 折叠后布局不切换 | 确认系统分屏/折叠状态；App 需要窗口宽度变化事件（部分 ROM 需允许自适应） |

更多见 [faq.md](faq.md)。
