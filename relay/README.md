# DSH Link relay

公网 TLS WebSocket relay：在同一 space token 空间内维护**在线主机名录**并转发
`call` / `sub` / `reply` / `event` / `end` 帧。业务方法（`session.*`、`speech.*`…）
不解析、不持久化。接口契约见 [`../protocol/PROTOCOL.md`](../protocol/PROTOCOL.md) 第 2 节。
兼容：协议 **v1**；可与插件 1.2.1 及同代 Android App 配套使用。

- 公网入口：`wss://<DOMAIN>:8443/`（Let's Encrypt 证书；443 可留给其它服务）
- 单 space token（64 位 hex），只存服务器 `/opt/dsh-link/token`（0600）与权威配对码
  `/opt/dsh-link/pairing.txt`（0600）；本机参考副本放 `~/.dsh/dsh-link/pairing-code.txt`
  （0600）。**不进仓库、不进日志、不进聊天**
  - 注意：插件/App 首次导入配对码后会删除本地 `~/.dsh/dsh-link/pairing.txt`，避免 token
    以明文文件长期留在磁盘（token 已进 DSH 凭据存储），所以本地参考副本不要命名为
    `pairing.txt`。
- 服务名：`dsh-link-relay`（systemd，开机自启、失败自动重启）
- 运行环境：Node.js ≥ 20，唯一依赖 `ws`

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.mjs` | relay 实现（TLS WSS、认证、名录、转发、心跳、超时清理） |
| `package.json` | 依赖仅 `ws` |
| `test-client.mjs` | 端到端自动测试（错误 token/hello/version、presence、call、sub、event、end、unsub、offline、断线、30s 超时） |
| `deploy.sh` | **服务器端**幂等部署脚本（token、配对码、systemd、certbot hook） |
| `dsh-link-relay.service` | systemd unit |

## 部署

前提：域名 `<DOMAIN>` 解析到服务器，Let's Encrypt 证书已签发在
`/etc/letsencrypt/live/<DOMAIN>/`，服务器已装 Node（`/usr/local/bin/node`）
与 npm。

最简单的方式是在服务器上直接跑仓库里的脚本（脚本会把自身文件复制到 `/opt/dsh-link`）：

```bash
git clone https://github.com/yuyeyubee/dsh-link.git /opt/dsh-link-src
cd /opt/dsh-link-src/relay
sudo ./deploy.sh
# 自有域名：sudo DSHLINK_DOMAIN=relay.example.com ./deploy.sh
```

也可以手动上传后运行（等价）：

```bash
ssh root@<SERVER_IP> 'mkdir -p /opt/dsh-link'
scp relay/server.mjs relay/package.json relay/deploy.sh relay/dsh-link-relay.service \
    root@<SERVER_IP>:/opt/dsh-link/
ssh root@<SERVER_IP> 'chmod +x /opt/dsh-link/deploy.sh && /opt/dsh-link/deploy.sh'
```

同步配对码参考副本到本机（0600；内容不要贴到聊天/仓库）：

```bash
mkdir -p ~/.dsh/dsh-link && chmod 700 ~/.dsh/dsh-link
scp root@<SERVER_IP>:/opt/dsh-link/pairing.txt ~/.dsh/dsh-link/pairing-code.txt
chmod 600 ~/.dsh/dsh-link/pairing-code.txt
```

服务器上的 `/opt/dsh-link/pairing.txt` 是唯一权威配对码来源；把其中的字符串粘贴到插件
设置页 / Android 设置页即可完成配对。

`deploy.sh` 会：缺依赖时 `npm install`；token 不存在时用 `openssl rand -hex 32` 生成
（已存在则保留）；按当前 token 重写 `/opt/dsh-link/pairing.txt`；安装/启用 unit 并
restart；安装 certbot deploy hook；最后确认 `:8443` 在监听。脚本不打印 token/配对码。

## 验证

```bash
# 端口可达（从本机）
nc -z <SERVER_IP> 8443 && echo open

# 端到端测试（本机，先 npm install 装 ws）
cd relay && npm install --omit=dev
node test-client.mjs          # 约 5 秒
node test-client.mjs --slow   # 额外验证 30s 超时清理，约 35 秒
```

测试从 `DSHLINK_PAIRING_FILE`（默认依次尝试 `~/.dsh/dsh-link/pairing-code.txt`、
`~/.dsh/dsh-link/pairing.txt`）读取配对码，也可用 `DSHLINK_PAIRING_CODE` 或
`DSHLINK_RELAY_URL` + `DSHLINK_TOKEN`。只打印 URL，不打印 token。

服务器侧：

```bash
systemctl status dsh-link-relay --no-pager
journalctl -u dsh-link-relay -f          # 结构化 JSON 日志
journalctl -u dsh-link-relay -n 100 --no-pager
```

## 运维

- **重启**：`systemctl restart dsh-link-relay`
- **升级代码**：重新 scp `server.mjs` 后执行 `deploy.sh`（会重启）
- **改端口/域名**：改 `/etc/default/dsh-link-relay` 里的 `DSHLINK_PORT` / `DSHLINK_DOMAIN`
  （或重新执行 `DSHLINK_PORT=9443 ./deploy.sh`），然后 `systemctl restart dsh-link-relay`；
  **端口和域名是配对码的一部分**，换端口/换域名必须重新生成并分发配对码。
- **日志隐私**：只记录连接时间、远端 IP、设备 id/名称、角色、帧类型、方法名、耗时、
  `ok`/错误码；`params` / `result` 正文与 token 永不写入日志。
- **证书**：证书续期由 certbot timer 自动完成；deploy hook
  `/etc/letsencrypt/renewal-hooks/deploy/restart-dsh-link-relay.sh` 在续期成功后
  `systemctl restart dsh-link-relay`，relay 启动时重新读取证书文件。
  手动验证：`certbot renew --dry-run --cert-name <DOMAIN>`。
- relay 默认监听 8443；443 留给你的其它服务（例如反向代理），不要冲突。

## 轮换 token（token 泄露时）

```bash
# 服务器
systemctl stop dsh-link-relay
umask 077 && openssl rand -hex 32 > /opt/dsh-link/token
/opt/dsh-link/deploy.sh                      # 重写 pairing.txt 并重启
# 本机重新下载 pairing-code.txt（见“部署”第 3 步），然后所有设备重新粘贴配对码
```

旧 token 立即失效（relay 只认 token 文件里的值，启动时加载）。轮换后所有 Host /
Android 需重新配对。

## 协议行为与实现说明

- `welcome.peers` / `presence.peers` **只包含 role=host 的在线主机**；client 不出现在
  任何设备的 peers 里。host 上线/下线会向空间内所有连接（含 client）推送 presence；
  client 上下线不触发 host 侧 presence。新 client 在 `welcome` 后会收到一次 presence。
- 同一 `device.id` 以同角色重连时，新连接顶替旧连接（旧连接 close code 4001），用于
  处理断网重连时旧 TCP 尚未超时的场景；跨角色复用 id 会被 `bad-hello` 拒绝。
- `call`/`sub` 由 relay 分配全局递增 `rid`（`r<n>`），转发时把 `id` 换成 `rid`，回程
  再把 `rid` 换回调用方的 `id`。同一连接同时存在的 `id` 必须唯一，重复回
  `{t:"error",code:"bad-request"}`。
- `sub` 必须先 `{ok:true,result:{stream:true}}`，之后才转发 `event`；`unsub` 会向被调方
  发 `{t:"unsub",rid}` 并向调用方回 `end`。
- 普通 call/sub 30 秒内未被 reply 由 relay 清理：向调用方回
  `{ok:false,error:{code:"timeout"}}`（sub 同时给被调方补发 `unsub`），之后该 `rid` 的
  迟到 reply 一律丢弃。`speech.transcribe` 是例外：relay 给 180 秒，给目标电脑首次加载
  本地语音模型留时间；调用方自己的超时也应放宽到 180 秒。
- 被调方在 call 中掉线 → 调用方收到 `offline` reply；在 sub 中掉线 → 调用方收到 `end`。
  调用方断开 → 所有被调方收到对应 `unsub`。
- 帧上限 8 MiB（`maxPayload`），超过时 WebSocket 以 1009 关闭；不开启
  per-message-deflate（纯 base64 文本，压缩只浪费 2C2G 的 CPU）。
- 每 25 秒 WebSocket ping；一轮未回 pong 即断开。未在 10 秒内完成 hello 的连接被关闭。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 本机 `nc -z` 8443 不通 | 云厂商安全组是否放行 8443；`ss -ltn \| grep 8443`；`systemctl status` |
| `auth-failed` | 设备贴的配对码与服务器 `/opt/dsh-link/pairing.txt` 不一致，重新配对 |
| `bad-hello` / `version` | 设备端 hello 字段缺失或协议 v 不匹配，升级插件/App |
| 服务起不来 | `journalctl -u dsh-link-relay -n 50`；常见为 token 文件缺失/证书路径错误 |
| 证书续期失败 | `certbot renew --dry-run`；确认 80 端口空闲（relay 不占用 80） |
