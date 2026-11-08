/**
 * DSH Link — Client half.
 *
 * Adds a sidebar panel ("Link") whose main page is a remote workspace: devices
 * are listed on the left, the selected remote session on the right. The
 * settings section pairs this install with a relay space and shows the local
 * pairing code. Every network call goes through this package's authenticated
 * same-origin Host route (`/api/dsh-link`), and the live session transcript is
 * an NDJSON stream from `/api/dsh-link/stream`.
 *
 * The Host half is the source of truth for pairing and relay state; this file
 * only renders it. No other Harness Client package is imported.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsh-link'
    /** Same-origin JSON operation route served by the Host half. */
    const ROUTE = 'api/dsh-link'
    /** Same-origin NDJSON session-follow route served by the Host half. */
    const STREAM_ROUTE = 'api/dsh-link/stream'
    /** Layout breakpoint below which the list and the conversation swap. */
    const NARROW_QUERY = '(max-width: 819px)'
    /** Delay before reconnecting a dropped session stream. */
    const STREAM_RETRY_MS = 1500
    /** Maximum number of live records kept in memory for one conversation. */
    const MAX_RECORDS = 400

    const LOCALE_DICTS = {
      en: {
        panel: 'Link',
        title: 'Cross-device',
        refresh: 'Refresh',
        settings: 'Settings',
        close: 'Close',
        back: 'Back',
        retry: 'Retry',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed. Select the code and copy it manually.',
        loading: 'Loading…',
        saving: 'Saving…',
        sending: 'Sending…',
        stopping: 'Stopping…',
        send: 'Send',
        stop: 'Stop',
        save: 'Save',
        cancel: 'Cancel',
        create: 'Create',
        creating: 'Creating…',
        expand: 'Expand',
        collapse: 'Collapse',
        rename: 'Rename',
        editTitle: 'Edit session title',
        titlePlaceholder: 'Session title',
        apiError: 'Request failed',
        'connection.connected': 'Connected',
        'connection.connecting': 'Connecting…',
        'connection.offline': 'Offline',
        'connection.unconfigured': 'Not paired',
        'version.label': 'Version',
        'device.label': 'This computer',
        'device.id': 'Device ID',
        'platform.macos': 'Mac',
        'platform.windows': 'Windows',
        'platform.linux': 'Linux',
        'platform.android': 'Android',
        'platform.ios': 'iOS',
        'platform.web': 'Web',
        'platform.unknown': 'Unknown',
        'group.local': 'This computer',
        'group.remote': 'Remote devices',
        'remote.online': '{n} online',
        'badge.local': 'Local',
        'badge.remote': 'Remote',
        'local.hint': 'Local sessions stay in the DSH sidebar. This panel lists and drives sessions on your other computers.',
        'local.open': 'Open local sessions',
        'search.placeholder': 'Search sessions',
        'noPeers': 'No remote devices are online. Make sure another computer runs DSH Link with the same pairing code.',
        'noPeersShort': 'No devices online',
        'noSessions': 'No sessions on this device yet.',
        'noSessionsMatch': 'No sessions match your search.',
        'loadSessionsFailed': 'Could not load remote sessions',
        'loadWorkspacesFailed': 'Could not load workspaces; you can still create a session in the default workspace.',
        'untitled': 'Untitled session',
        running: 'Running',
        active: 'Current',
        'updated.justNow': 'just now',
        'updated.minutes': '{n} min ago',
        'updated.hours': '{n} h ago',
        'updated.days': '{n} d ago',
        'select.title': 'Pick a remote session',
        'select.hint': 'Expand a device on the left and choose a session, or create a new one.',
        'empty.title': 'Connect another DSH',
        'empty.hint': 'Paste the same pairing code on another computer or in the Android app to form a private space. Its sessions then appear here.',
        'empty.pair': 'Pair a device',
        'emptyConversation.title': 'No messages yet',
        'emptyConversation.hint': 'Type below to send the first message to this remote computer.',
        'stream.connecting': 'Connecting live updates…',
        'stream.connected': 'Live updates on',
        'stream.retrying': 'Connection lost — retrying…',
        'stream.paused': 'Paused while the page is hidden',
        'stream.ended': 'Live updates ended',
        'stream.error': 'Live updates failed',
        'stream.retry': 'Reconnect',
        'stream.lost': 'Live connection lost',
        'stream.unsupported': 'Streaming responses are not supported in this browser.',
        'role.user': 'You',
        'role.assistant': 'Assistant',
        reasoning: 'Reasoning',
        'tool.call': 'Tool call',
        'tool.result': 'Tool result',
        'tool.failed': 'Tool failed',
        'error.record': 'Error',
        'turn.start': 'Turn {n}',
        'turn.end': 'Turn {n} ended ({reason})',
        'reason.completed': 'completed',
        'reason.failed': 'failed',
        'reason.cancelled': 'cancelled',
        'reason.aborted': 'aborted',
        'input.placeholder': 'Message the remote DSH… (Enter to send, Shift+Enter for a new line)',
        'input.placeholderShort': 'Message the remote DSH…',
        queue: '{n} queued',
        pendingInput: 'Waiting for approval',
        'state.running': 'Running',
        'state.idle': 'Idle',
        'send.failed': 'Could not send the message',
        'cancel.failed': 'Could not stop the remote session',
        'newSession.title': 'New remote session',
        'newSession.target': 'Device: {name}',
        'workspace.label': 'Workspace',
        'workspace.default': 'Default workspace',
        'cwd.label': 'Working directory (optional)',
        'cwd.placeholder': '/Users/me/project',
        'settings.nav': 'Cross-device',
        'settings.title': 'Cross-device',
        'settings.description': 'Link DSH installations on several computers and an Android phone through your own relay. Paste a pairing code, then browse and drive the remote sessions from the sidebar.',
        'settings.localCode': 'This device’s pairing code',
        'settings.localCodeHint': 'Paste this code on another computer or in the Android app to join the same space. It contains the secret token — do not share it.',
        'settings.code': 'Pairing code',
        'settings.codePlaceholder': 'Paste a dshlink1.… pairing code',
        'settings.deviceName': 'Device name (optional)',
        'settings.deviceNamePlaceholder': 'e.g. Home MacBook',
        'settings.save': 'Save pairing code',
        'settings.saved': 'Pairing code saved.',
        'settings.saveFailed': 'Could not save the pairing code',
        'settings.forget': 'Disconnect and forget',
        'settings.confirmForget': 'Click again to disconnect',
        'settings.forgotten': 'Pairing removed.',
        'settings.forgetFailed': 'Could not disconnect',
        'settings.connection': 'Connection',
        'settings.relay': 'Relay',
        'settings.peers': 'Online devices',
        'settings.noPeers': 'No other devices are online.',
        'settings.speech': 'Speech recognition',
        'settings.speechAvailable': 'Available ({phase})',
        'settings.speechUnavailable': 'Unavailable',
        'settings.speechProvidersLabel': 'Providers',
        'settings.android.title': 'Android pairing',
        'settings.android.hint': 'In the Android app, paste the same pairing code on its settings page. The phone joins as a client: it can browse and drive sessions here and use remote speech recognition.',
        'settings.unconfigured': 'Not paired yet. Paste a pairing code to connect.',
        'settings.loading': 'Reading connection status…',
        'settings.loadFailed': 'Could not read connection status',
        'settings.manageHint': 'You can also manage these options in DSH Settings → Cross-device.',
        'settings.codeRequired': 'Paste a pairing code first.',
        'settings.peersCount': '{n} online',
        'newSession.failed': 'Could not create the session',
      },
      zh: {
        panel: '跨设备',
        title: '跨设备',
        refresh: '刷新',
        settings: '设置',
        close: '关闭',
        back: '返回',
        retry: '重试',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败，请手动选择配对码复制。',
        loading: '正在加载…',
        saving: '保存中…',
        sending: '发送中…',
        stopping: '停止中…',
        send: '发送',
        stop: '停止',
        save: '保存',
        cancel: '取消',
        create: '创建',
        creating: '创建中…',
        expand: '展开',
        collapse: '收起',
        rename: '重命名',
        editTitle: '编辑会话标题',
        titlePlaceholder: '会话标题',
        apiError: '请求失败',
        'connection.connected': '已连接',
        'connection.connecting': '正在连接…',
        'connection.offline': '离线',
        'connection.unconfigured': '未配对',
        'version.label': '版本',
        'device.label': '本机设备',
        'device.id': '设备 ID',
        'platform.macos': 'Mac',
        'platform.windows': 'Windows',
        'platform.linux': 'Linux',
        'platform.android': 'Android',
        'platform.ios': 'iOS',
        'platform.web': 'Web',
        'platform.unknown': '未知平台',
        'group.local': '本机',
        'group.remote': '远程设备',
        'remote.online': '{n} 台在线',
        'badge.local': '本机',
        'badge.remote': '远程',
        'local.hint': '本地会话仍在 DSH 左侧会话列表中。这里列出并操作其他电脑上的会话。',
        'local.open': '回到本地会话',
        'search.placeholder': '搜索会话',
        'noPeers': '没有在线的远程设备。请确认另一台电脑已安装 DSH Link，并粘贴了相同的配对码。',
        'noPeersShort': '暂无在线设备',
        'noSessions': '这台设备还没有会话。',
        'noSessionsMatch': '没有匹配的会话。',
        'loadSessionsFailed': '无法加载远程会话',
        'loadWorkspacesFailed': '无法加载工作区列表；仍可在默认工作区新建会话。',
        untitled: '未命名会话',
        running: '运行中',
        active: '当前',
        'updated.justNow': '刚刚',
        'updated.minutes': '{n} 分钟前',
        'updated.hours': '{n} 小时前',
        'updated.days': '{n} 天前',
        'select.title': '选择一个远程会话',
        'select.hint': '在左侧展开设备并选择会话，或者新建一个会话。',
        'empty.title': '连接另一台 DSH',
        'empty.hint': '在另一台电脑或 Android App 上粘贴同一个配对码，就能组成一个私有空间，它的会话会出现在这里。',
        'empty.pair': '去配对',
        'emptyConversation.title': '还没有消息',
        'emptyConversation.hint': '在下方输入消息，发送到这台远程电脑。',
        'stream.connecting': '正在连接实时更新…',
        'stream.connected': '实时更新中',
        'stream.retrying': '连接断开，正在重连…',
        'stream.paused': '页面不可见，已暂停实时更新',
        'stream.ended': '实时更新已结束',
        'stream.error': '实时更新出错',
        'stream.retry': '重新连接',
        'stream.lost': '实时连接已断开',
        'stream.unsupported': '当前浏览器不支持流式响应。',
        'role.user': '你',
        'role.assistant': '助手',
        reasoning: '思考过程',
        'tool.call': '工具调用',
        'tool.result': '工具结果',
        'tool.failed': '工具出错',
        'error.record': '错误',
        'turn.start': '第 {n} 轮',
        'turn.end': '第 {n} 轮结束（{reason}）',
        'reason.completed': '完成',
        'reason.failed': '失败',
        'reason.cancelled': '已取消',
        'reason.aborted': '已中止',
        'input.placeholder': '发给远程 DSH…（Enter 发送，Shift+Enter 换行）',
        'input.placeholderShort': '发给远程 DSH…',
        queue: '{n} 条排队中',
        pendingInput: '等待批准',
        'state.running': '运行中',
        'state.idle': '空闲',
        'send.failed': '发送失败',
        'cancel.failed': '停止远程会话失败',
        'newSession.title': '新建远程会话',
        'newSession.target': '目标设备：{name}',
        'workspace.label': '工作区',
        'workspace.default': '默认工作区',
        'cwd.label': '工作目录（可选）',
        'cwd.placeholder': '/Users/me/project',
        'settings.nav': '跨设备',
        'settings.title': '跨设备',
        'settings.description': '通过自己的中转服务器，把多台电脑上的 DSH 与 Android 手机连成一个私有空间。粘贴配对码后，即可在这里浏览并操作远程会话。',
        'settings.localCode': '本机配对码',
        'settings.localCodeHint': '在另一台电脑或 Android App 中粘贴这串配对码即可加入同一空间。配对码包含密钥，请勿分享。',
        'settings.code': '配对码',
        'settings.codePlaceholder': '粘贴 dshlink1.… 配对码',
        'settings.deviceName': '设备名（可选）',
        'settings.deviceNamePlaceholder': '例如：家里的 MacBook',
        'settings.save': '保存配对码',
        'settings.saved': '配对码已保存。',
        'settings.saveFailed': '保存配对码失败',
        'settings.forget': '断开并清除配对',
        'settings.confirmForget': '再次点击确认断开',
        'settings.forgotten': '已清除配对。',
        'settings.forgetFailed': '断开失败',
        'settings.connection': '连接状态',
        'settings.relay': '中转服务器',
        'settings.peers': '在线设备',
        'settings.noPeers': '暂无其他在线设备。',
        'settings.speech': '语音识别',
        'settings.speechAvailable': '可用（{phase}）',
        'settings.speechUnavailable': '不可用',
        'settings.speechProvidersLabel': '提供方',
        'settings.android.title': 'Android 配对',
        'settings.android.hint': '在 Android App 的设置页粘贴同一个配对码。手机作为客户端加入：可以浏览并操作这里的会话，也可以使用远程语音识别。',
        'settings.unconfigured': '尚未配对。粘贴配对码后即可连接。',
        'settings.loading': '正在读取连接状态…',
        'settings.loadFailed': '无法读取连接状态',
        'settings.manageHint': '也可以在 DSH 设置 → 跨设备 中管理这些选项。',
        'settings.codeRequired': '请先粘贴配对码。',
        'settings.peersCount': '{n} 台在线',
        'newSession.failed': '新建会话失败',
      },
    }

    /** Scoped styles; colors come only from host theme tokens. */
    const CSS = `
      .dsh-link-page { position: relative; box-sizing: border-box; width: 100%; height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
      .dsh-link-page *, .dsh-link-settings-page * { box-sizing: border-box; }
      .dsh-link-header { flex: none; display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 16px; border-bottom: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); }
      html[data-platform="darwin"] .dsh-link-header { padding-top: calc(6px + var(--dsh-frame-top-clearance, 0px)); }
      .dsh-link-header-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
      .dsh-link-brand-mark { flex: none; display: inline-flex; color: var(--dsw-alias-brand-primary); }
      .dsh-link-header-titles { display: flex; flex-direction: column; min-width: 0; }
      .dsh-link-header-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-header-sub { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-header-meta { display: flex; align-items: center; gap: 8px; flex: none; }
      .dsh-link-header-actions { display: flex; align-items: center; gap: 4px; flex: none; }
      .dsh-link-pill { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
      .dsh-link-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); flex: none; }
      .dsh-link-dot.is-ok { background: var(--dsw-alias-state-success-primary); }
      .dsh-link-dot.is-warn { background: var(--dsw-alias-state-warn-primary); }
      .dsh-link-dot.is-error { background: var(--dsw-alias-state-error-primary); }
      .dsh-link-dot.is-idle { background: var(--dsw-alias-label-tertiary); }
      .dsh-link-dot.is-pulse { animation: dsh-link-pulse 1.4s ease-in-out infinite; }
      @keyframes dsh-link-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.78); } }
      .dsh-link-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; box-sizing: border-box; height: 30px; padding: 0 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; }
      .dsh-link-btn:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-link-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      .dsh-link-btn:disabled { opacity: .5; cursor: default; }
      .dsh-link-btn.is-primary { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground, #fff); }
      .dsh-link-btn.is-primary:not(:disabled):hover { background: var(--dsw-alias-state-business-primary); filter: brightness(1.06); }
      .dsh-link-btn.is-danger { color: var(--dsw-alias-state-error-primary); }
      .dsh-link-btn.is-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
      .dsh-link-btn.is-ghost:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsh-link-btn.is-icon { width: 30px; padding: 0; flex: none; }
      .dsh-link-btn.is-small { height: 26px; padding: 0 9px; font-size: 12px; }
      .dsh-link-btn.is-icon.is-small { width: 26px; padding: 0; }
      .dsh-link-btn-label { overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-body { flex: 1; display: flex; min-height: 0; min-width: 0; }
      .dsh-link-listpane { flex: none; width: 300px; min-height: 0; display: flex; flex-direction: column; border-right: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); }
      .dsh-link-list-top { flex: none; padding: 10px 10px 4px; }
      .dsh-link-search { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-tertiary); }
      .dsh-link-search:focus-within { border-color: var(--dsw-alias-state-business-primary); }
      .dsh-link-search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
      .dsh-link-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 10px 14px; }
      .dsh-link-group { margin-bottom: 16px; }
      .dsh-link-group-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 7px; }
      .dsh-link-group-label { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; }
      .dsh-link-group-count { font-size: 11.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
      .dsh-link-device { margin-bottom: 8px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-base); overflow: hidden; }
      .dsh-link-device.is-local { border-style: dashed; background: var(--dsw-alias-bg-layer-2); }
      .dsh-link-device-head { display: flex; align-items: center; gap: 6px; padding: 7px 7px 7px 9px; }
      .dsh-link-device-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 2px 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .dsh-link-device-toggle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: 6px; }
      .dsh-link-device-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-tertiary); transition: transform .16s ease; }
      .dsh-link-device-chevron.is-open { transform: rotate(90deg); }
      .dsh-link-device-icon { flex: none; display: inline-flex; color: var(--dsw-alias-label-secondary); }
      .dsh-link-device.is-local .dsh-link-device-icon { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-device-info { min-width: 0; display: flex; flex-direction: column; gap: 1px; flex: 1; }
      .dsh-link-device-name { font-size: 13px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-device-sub { display: flex; align-items: center; gap: 5px; font-size: 11.5px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-device-actions { flex: none; display: flex; align-items: center; gap: 2px; }
      .dsh-link-device-body { padding: 0 9px 9px; }
      .dsh-link-badge { display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border-radius: 5px; border: .5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 1; white-space: nowrap; }
      .dsh-link-badge.is-remote { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
      .dsh-link-badge.is-local { border-color: var(--dsw-alias-border-l2); }
      .dsh-link-hint { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-sessions { display: flex; flex-direction: column; gap: 1px; padding: 0 6px 7px; }
      .dsh-link-session { width: 100%; display: flex; align-items: flex-start; gap: 7px; padding: 6px 7px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .dsh-link-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-link-session.is-selected { background: var(--dsw-alias-interactive-bg-active); }
      .dsh-link-session:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -1px; }
      .dsh-link-session-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .dsh-link-session-title { font-size: 12.5px; line-height: 1.4; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-session.is-selected .dsh-link-session-title { font-weight: 600; }
      .dsh-link-session-meta { display: flex; align-items: center; gap: 5px; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-session-meta .dsh-link-dot { width: 6px; height: 6px; }
      .dsh-link-list-note { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px; border: .5px dashed var(--dsw-alias-border-l3); border-radius: 10px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dsh-link-empty { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 36px 24px; text-align: center; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-empty-icon { display: inline-flex; color: var(--dsw-alias-label-tertiary); opacity: .9; margin-bottom: 4px; }
      .dsh-link-empty-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
      .dsh-link-empty-hint { margin: 0; max-width: 440px; font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
      .dsh-link-empty-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; justify-content: center; }
      .dsh-link-banner { flex: none; display: flex; align-items: flex-start; gap: 8px; margin: 8px 14px 0; padding: 8px 11px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
      .dsh-link-banner.is-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .dsh-link-banner.is-warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
      .dsh-link-banner.is-ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
      .dsh-link-conv { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
      .dsh-link-conv-header { flex: none; display: flex; flex-direction: column; gap: 5px; padding: 11px 16px 9px; border-bottom: .5px solid var(--dsw-alias-border-l3); }
      .dsh-link-conv-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .dsh-link-conv-device { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-conv-device-name { font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-conv-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex: none; }
      .dsh-link-stream { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; white-space: nowrap; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-stream.is-ok { color: var(--dsw-alias-state-success-primary); }
      .dsh-link-stream.is-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsh-link-stream.is-error { color: var(--dsw-alias-state-error-primary); }
      .dsh-link-conv-title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .dsh-link-conv-title { flex: 1; min-width: 0; margin: 0; padding: 1px 0; font-size: 17px; font-weight: 600; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-conv-title-edit { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
      .dsh-link-conv-meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; }
      .dsh-link-conv-meta span { overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-messages { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px 24px; display: flex; flex-direction: column; gap: 13px; scroll-behavior: smooth; }
      .dsh-link-msg { display: flex; min-width: 0; }
      .dsh-link-msg.is-user { justify-content: flex-end; }
      .dsh-link-msg.is-wide { display: block; }
      .dsh-link-msg-main { max-width: min(720px, 92%); min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .dsh-link-msg.is-user .dsh-link-msg-main { align-items: flex-end; }
      .dsh-link-msg.is-wide .dsh-link-msg-main { max-width: 100%; width: 100%; }
      .dsh-link-role { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); padding: 0 2px; }
      .dsh-link-bubble { min-width: 0; padding: 9px 12px; border-radius: 12px; border: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
      .dsh-link-msg.is-user .dsh-link-bubble { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
      .dsh-link-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.65; }
      .dsh-link-text.is-muted { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-details { min-width: 0; border: .5px solid var(--dsw-alias-border-l3); border-radius: 9px; background: var(--dsw-alias-bg-base); overflow: hidden; }
      .dsh-link-details + .dsh-link-bubble, .dsh-link-bubble + .dsh-link-details { margin-top: 6px; }
      .dsh-link-details[open] { background: var(--dsw-alias-bg-layer-1); }
      .dsh-link-details > summary { display: flex; align-items: center; gap: 7px; padding: 6px 10px; cursor: pointer; list-style: none; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.5; }
      .dsh-link-details > summary::-webkit-details-marker { display: none; }
      .dsh-link-details[open] > summary { border-bottom: .5px solid var(--dsw-alias-border-l3); }
      .dsh-link-details-title { flex: none; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-tool-name { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsh-link-pre { margin: 0; padding: 9px 11px; max-height: 280px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
      .dsh-link-details.is-error { border-color: var(--dsw-alias-state-error-primary); }
      .dsh-link-details.is-error > summary { color: var(--dsw-alias-state-error-primary); }
      .dsh-link-error-record { min-width: 0; padding: 9px 12px; border: .5px solid var(--dsw-alias-state-error-primary); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
      .dsh-link-error-title { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-state-error-primary); margin-bottom: 3px; }
      .dsh-link-turn { display: flex; align-items: center; gap: 10px; margin: 3px 0; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; line-height: 1.4; }
      .dsh-link-turn::before, .dsh-link-turn::after { content: ""; flex: 1; border-top: .5px dashed var(--dsw-alias-border-l3); }
      .dsh-link-turn-label { flex: none; white-space: nowrap; }
      .dsh-link-composer { flex: none; padding: 10px 16px 14px; border-top: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); }
      .dsh-link-composer-box { display: flex; flex-direction: column; gap: 4px; padding: 7px 8px 7px 11px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 13px; background: var(--dsw-alias-bg-layer-1); }
      .dsh-link-composer-box:focus-within { border-color: var(--dsw-alias-state-business-primary); }
      .dsh-link-composer-input { display: block; width: 100%; min-height: 50px; max-height: 160px; padding: 3px 2px; border: 0; outline: 0; resize: none; field-sizing: content; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13.5px; line-height: 1.6; }
      .dsh-link-composer-input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-composer-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .dsh-link-composer-state { flex: 1; min-width: 0; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-composer-buttons { display: flex; align-items: center; gap: 6px; flex: none; }
      .dsh-link-overlay { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--dsw-alias-bg-mask-1); }
      .dsh-link-sheet { display: flex; flex-direction: column; width: min(520px, 100%); max-height: min(760px, calc(100dvh - 40px)); border: .5px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: var(--dsw-elevation-prominent, 0 20px 60px rgba(0, 0, 0, .28)); overflow: hidden; }
      .dsh-link-sheet.is-wide { width: min(600px, 100%); }
      .dsh-link-sheet:focus { outline: none; }
      .dsh-link-sheet-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 10px; border-bottom: .5px solid var(--dsw-alias-border-l3); }
      .dsh-link-sheet-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
      .dsh-link-sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
      .dsh-link-settings-page { width: 100%; max-width: 900px; padding: 24px 32px 40px; box-sizing: border-box; color: var(--dsw-alias-label-primary); }
      .dsh-link-settings { display: flex; flex-direction: column; gap: 14px; }
      .dsh-link-settings.is-sheet { gap: 12px; }
      .dsh-link-settings-title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; }
      .dsh-link-settings-desc { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
      .dsh-link-card { display: flex; flex-direction: column; gap: 10px; padding: 13px 15px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); min-width: 0; }
      .dsh-link-card.is-danger { border-color: var(--dsw-alias-state-error-primary); }
      .dsh-link-card-title { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 13px; font-weight: 600; line-height: 1.4; }
      .dsh-link-rows { display: flex; flex-direction: column; margin: 0; }
      .dsh-link-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 6px 0; border-bottom: .5px solid var(--dsw-alias-border-l3); font-size: 12.5px; line-height: 1.55; }
      .dsh-link-row:last-child { border-bottom: 0; }
      .dsh-link-row-key { flex: none; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-row-value { min-width: 0; text-align: right; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
      .dsh-link-row-value.is-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
      .dsh-link-form { display: flex; flex-direction: column; gap: 10px; }
      .dsh-link-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .dsh-link-field-label { font-size: 12px; font-weight: 500; line-height: 1.45; color: var(--dsw-alias-label-primary); }
      .dsh-link-input, .dsh-link-textarea, .dsh-link-select { width: 100%; box-sizing: border-box; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
      .dsh-link-input, .dsh-link-select { height: 32px; padding: 0 10px; }
      .dsh-link-textarea { min-height: 62px; padding: 8px 10px; line-height: 1.55; resize: vertical; }
      .dsh-link-input:focus, .dsh-link-textarea:focus, .dsh-link-select:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
      .dsh-link-input::placeholder, .dsh-link-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-field-hint { font-size: 11.5px; line-height: 1.55; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-form-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dsh-link-code-row { display: flex; align-items: stretch; gap: 6px; min-width: 0; }
      .dsh-link-code-row .dsh-link-input { flex: 1; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
      .dsh-link-notice { font-size: 12px; line-height: 1.55; }
      .dsh-link-notice.is-ok { color: var(--dsw-alias-state-success-primary); }
      .dsh-link-notice.is-error { color: var(--dsw-alias-state-error-primary); }
      .dsh-link-notice.is-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsh-link-peers { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
      .dsh-link-peer { display: flex; align-items: center; gap: 7px; padding: 5px 0; font-size: 12.5px; min-width: 0; }
      .dsh-link-peer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsh-link-inline-hint { margin: 0; padding: 9px 11px; border-radius: 9px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.65; }
      .dsh-link-linkish { padding: 0; border: 0; background: none; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
      @media (max-width: 819px) {
        .dsh-link-listpane { width: 100%; border-right: 0; }
        .dsh-link-page[data-view="chat"] .dsh-link-listpane { display: none; }
        .dsh-link-page[data-view="list"] .dsh-link-conv { display: none; }
        .dsh-link-header { padding-left: 12px; padding-right: 12px; }
        .dsh-link-messages { padding: 14px 12px 18px; }
        .dsh-link-conv-header { padding-left: 12px; padding-right: 12px; }
        .dsh-link-composer { padding: 8px 10px 12px; }
        .dsh-link-settings-page { padding: 18px 16px 32px; }
        .dsh-link-msg-main { max-width: 100%; }
      }
      @media (max-width: 520px) {
        .dsh-link-header-sub { display: none; }
        .dsh-link-header-title { font-size: 14px; }
        .dsh-link-conv-title { font-size: 15px; }
        .dsh-link-sheet { max-height: calc(100dvh - 24px); }
        .dsh-link-overlay { padding: 12px; }
      }
    `

    /* --------------------------------------------------------------------- */
    /* Small helpers                                                          */
    /* --------------------------------------------------------------------- */

    /** Join class names, skipping falsy entries. */
    function cls(...names) {
      return names.filter((name) => typeof name === 'string' && name !== '').join(' ')
    }

    /** Format an arbitrary thrown value for display. */
    function errorText(error) {
      if (error instanceof Error && error.message !== '') return error.message
      if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') return error.message
      const text = String(error ?? '')
      return text
    }

    /** Parse the route envelope `{ ok: true, ... }` or throw `payload.error`. */
    function parseEnvelope(response) {
      return response.json().catch(() => null).then((payload) => {
        if (!response.ok || payload === null || typeof payload !== 'object' || payload.ok !== true) {
          const message = payload !== null && typeof payload === 'object' && typeof payload.error === 'string' && payload.error !== ''
            ? payload.error
            : `HTTP ${response.status}`
          const failure = new Error(message)
          if (payload !== null && typeof payload === 'object' && typeof payload.code === 'string') failure.code = payload.code
          throw failure
        }
        return payload
      })
    }

    /** One POST to the authenticated Host route. */
    function postOperation(operation) {
      return fetch(ROUTE, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(operation),
      }).then(parseEnvelope)
    }

    const api = {
      async status() {
        const payload = await postOperation({ op: 'status' })
        return payload.status
      },
      async save(pairingCode, deviceName) {
        const payload = await postOperation({
          op: 'save',
          pairingCode,
          ...(typeof deviceName === 'string' && deviceName.trim() !== '' ? { deviceName: deviceName.trim() } : {}),
        })
        return payload.status
      },
      async forget() {
        const payload = await postOperation({ op: 'forget' })
        return payload.status
      },
      async sessions(deviceId) {
        const payload = await postOperation({ op: 'sessions', deviceId })
        return Array.isArray(payload.items) ? payload.items.filter((item) => item !== null && typeof item === 'object') : []
      },
      async workspaces(deviceId) {
        const payload = await postOperation({ op: 'workspaces', deviceId })
        return Array.isArray(payload.items)
          ? payload.items.filter((item) => item !== null && typeof item === 'object' && typeof item.workspaceId === 'string')
          : []
      },
      async send(deviceId, sessionId, text) {
        return postOperation({ op: 'send', deviceId, sessionId, text })
      },
      async cancel(deviceId, sessionId) {
        return postOperation({ op: 'cancel', deviceId, sessionId })
      },
      async create(deviceId, workspaceId, cwd) {
        const payload = await postOperation({
          op: 'create',
          deviceId,
          ...(typeof workspaceId === 'string' && workspaceId !== '' ? { workspaceId } : {}),
          ...(typeof cwd === 'string' && cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
        })
        if (typeof payload.sessionId !== 'string' || payload.sessionId === '') throw new Error('missing sessionId')
        return payload.sessionId
      },
      async rename(deviceId, sessionId, title) {
        const payload = await postOperation({ op: 'rename', deviceId, sessionId, title })
        return typeof payload.title === 'string' ? payload.title : title
      },
    }

    /** Normalize one `SessionStateView`; return null when the value is absent. */
    function normalizeState(value) {
      if (value === null || typeof value !== 'object') return null
      return {
        active: value.active === true,
        running: value.running === true,
        queueCount: typeof value.queueCount === 'number' && Number.isFinite(value.queueCount) ? value.queueCount : 0,
        pendingInput: Array.isArray(value.pendingInput) ? value.pendingInput.filter((item) => typeof item === 'string') : [],
      }
    }

    /** Whether one streamed record looks like the protocol's ChatRecord. */
    function isChatRecord(record) {
      return record !== null && typeof record === 'object' && typeof record.kind === 'string'
    }

    /** Stable identity for de-duplicating snapshot + live records. */
    function recordKey(record) {
      if (typeof record.seq === 'number' && Number.isFinite(record.seq)) return `${record.kind}:${record.seq}`
      return ''
    }

    /** Human platform label for a protocol platform id (accepts raw process.platform). */
    function platformKey(platform) {
      if (platform === 'darwin') return 'macos'
      if (platform === 'win32') return 'windows'
      if (platform === 'macos' || platform === 'windows' || platform === 'linux' || platform === 'android' || platform === 'ios' || platform === 'web') return platform
      return 'unknown'
    }

    /** Locate the dictionary key for a platform badge. */
    function platformLabel(t, platform) {
      return t(`platform.${platformKey(platform)}`)
    }

    /** Locate the dictionary key for a relay connection state. */
    function connectionKey(state) {
      if (state === 'connected') return 'connection.connected'
      if (state === 'connecting') return 'connection.connecting'
      if (state === 'offline') return 'connection.offline'
      return 'connection.unconfigured'
    }

    /** Tone class for a relay connection state. */
    function connectionTone(state) {
      if (state === 'connected') return 'is-ok'
      if (state === 'connecting') return 'is-warn'
      if (state === 'offline') return 'is-error'
      return 'is-idle'
    }

    /** Human reason for a turn end, with the protocol string as fallback. */
    function turnReason(t, reason) {
      if (reason === 'completed') return t('reason.completed')
      if (reason === 'failed') return t('reason.failed')
      if (reason === 'cancelled') return t('reason.cancelled')
      if (reason === 'aborted') return t('reason.aborted')
      return typeof reason === 'string' && reason !== '' ? reason : '—'
    }

    /** Relative timestamp for a session summary. */
    function relativeTime(t, value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
      const delta = Date.now() - value
      if (delta < 60_000) return t('updated.justNow')
      if (delta < 3_600_000) return t('updated.minutes', { n: Math.floor(delta / 60_000) })
      if (delta < 86_400_000) return t('updated.hours', { n: Math.floor(delta / 3_600_000) })
      if (delta < 7 * 86_400_000) return t('updated.days', { n: Math.floor(delta / 86_400_000) })
      try {
        return new Date(value).toLocaleDateString()
      } catch {
        return ''
      }
    }

    /** Pretty-print a tool-call argument payload without failing on plain text. */
    function formatArgs(args) {
      if (typeof args !== 'string') return ''
      const trimmed = args.trim()
      if (trimmed === '') return ''
      const clipped = trimmed.length > 8192 ? `${trimmed.slice(0, 8192)}…` : trimmed
      try {
        return JSON.stringify(JSON.parse(clipped), null, 2)
      } catch {
        return clipped
      }
    }

    /** Stream phase label key. */
    function streamLabel(t, phase) {
      if (phase === 'connected') return t('stream.connected')
      if (phase === 'retrying' || phase === 'reconnecting') return t('stream.retrying')
      if (phase === 'paused') return t('stream.paused')
      if (phase === 'ended') return t('stream.ended')
      if (phase === 'error' || phase === 'failed') return t('stream.error')
      return t('stream.connecting')
    }

    /** Stream phase tone class. */
    function streamTone(phase) {
      if (phase === 'connected') return 'is-ok'
      if (phase === 'retrying' || phase === 'reconnecting' || phase === 'connecting') return 'is-warn'
      if (phase === 'error' || phase === 'failed' || phase === 'ended') return 'is-error'
      return 'is-idle'
    }

    /* --------------------------------------------------------------------- */
    /* Icons                                                                  */
    /* --------------------------------------------------------------------- */

    /** Sidebar panel glyph: two linked devices. */
    function PanelIcon({ size = 16, active = false }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor' },
      },
        h('rect', { x: 1.4, y: 2.4, width: 7.4, height: 5.4, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.25 }),
        h('rect', { x: 7.2, y: 8.2, width: 7.4, height: 5.4, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.25 }),
        h('path', { d: 'M5.9 7.4l4.2 1.6', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' }),
        h('circle', { cx: 4.1, cy: 5.1, r: 0.75, fill: 'currentColor' }),
        h('circle', { cx: 11.9, cy: 10.9, r: 0.75, fill: 'currentColor' }),
      )
    }

    /** Monitor glyph for the local-computer card. */
    function DeviceGlyph({ size = 15 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' },
      },
        h('rect', { x: 1.9, y: 2.4, width: 12.2, height: 8.6, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M5.4 13.6h5.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M8 11v2.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    /** Chevron used by expandable device rows. */
    function ChevronGlyph({ size = 12 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Plus glyph. */
    function PlusGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M8 2.8v10.4M2.8 8h10.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /** Refresh glyph. */
    function RefreshGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M13 8a5 5 0 1 1-1.7-3.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('path', { d: 'M13.2 2.5v3.1h-3.1', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Settings glyph (sliders). */
    function SettingsGlyph({ size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M2.3 4.6h11.4M2.3 11.4h11.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('circle', { cx: 6, cy: 4.6, r: 1.7, fill: 'var(--dsw-alias-bg-base)', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 10.2, cy: 11.4, r: 1.7, fill: 'var(--dsw-alias-bg-base)', stroke: 'currentColor', strokeWidth: 1.2 }),
      )
    }

    /** Back glyph. */
    function BackGlyph({ size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M13 8H3.4M7.2 3.8 3 8l4.2 4.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Send glyph. */
    function SendGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M2.2 8h11.2M9 3.4 13.6 8 9 12.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Stop glyph. */
    function StopGlyph({ size = 12 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('rect', { x: 3.2, y: 3.2, width: 9.6, height: 9.6, rx: 1.6, fill: 'currentColor' }),
      )
    }

    /** Copy glyph. */
    function CopyGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('rect', { x: 5.2, y: 5.2, width: 8.2, height: 8.2, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M10.8 5.2V3.9c0-.8-.6-1.4-1.4-1.4H3.9c-.8 0-1.4.6-1.4 1.4v5.5c0 .8.6 1.4 1.4 1.4h1.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
      )
    }

    /** Edit glyph. */
    function EditGlyph({ size = 13 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M10.9 2.6l2.5 2.5M3 13l.7-3.2 7-7 2.5 2.5-7 7L3 13Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Close glyph. */
    function CloseGlyph({ size = 13 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M3.6 3.6l8.8 8.8M12.4 3.6 3.6 12.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    /* --------------------------------------------------------------------- */
    /* Hooks                                                                  */
    /* --------------------------------------------------------------------- */

    /** Re-render on locale changes through the Client locale service. */
    function useLocale(ctx) {
      return React.useSyncExternalStore(
        React.useCallback((listener) => ctx.locale.subscribe(listener), [ctx]),
        React.useCallback(() => ctx.locale.getSnapshot(), [ctx]),
      )
    }

    /** Subscribe to a CSS media query. */
    function useMediaQuery(query) {
      const [matches, setMatches] = React.useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false)
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
        const media = window.matchMedia(query)
        const update = () => setMatches(media.matches)
        update()
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', update)
          return () => media.removeEventListener('change', update)
        }
        media.addListener(update)
        return () => media.removeListener(update)
      }, [query])
      return matches
    }

    /**
     * Subscribe to one remote session stream.
     *
     * The hook owns the AbortController, the 1.5 s reconnect loop (capped so a
     * permanently failing stream offers a manual retry instead of polling
     * forever), and the visibility pause. Every state update is guarded by the
     * effect's `disposed` flag, so switching sessions or unmounting never writes
     * into a dead component.
     */
    function useFollowStream(t, deviceId, sessionId) {
      const [view, setView] = React.useState({ records: [], title: '', state: null, phase: 'idle', error: '' })
      const restartRef = React.useRef(null)

      React.useEffect(() => {
        const empty = { records: [], title: '', state: null, phase: 'idle', error: '' }
        if (typeof deviceId !== 'string' || deviceId === '' || typeof sessionId !== 'string' || sessionId === '') {
          setView(empty)
          return undefined
        }

        let disposed = false
        let active = false
        let abort = null
        let retryTimer = null
        let resumeTimer = null
        let attempt = 0
        let wake = false
        let sawEnd = false
        let sawError = false

        setView({ records: [], title: '', state: null, phase: 'connecting', error: '' })

        const patch = (value) => {
          if (!disposed) setView((previous) => ({ ...previous, ...value }))
        }

        const handleFrame = (frame) => {
          if (disposed || frame === null || typeof frame !== 'object') return
          const type = typeof frame.type === 'string' ? frame.type : ''
          if (type === 'ready') {
            if (typeof frame.title === 'string') patch({ phase: 'connected', error: '', title: frame.title })
            else patch({ phase: 'connected', error: '' })
            return
          }
          if (type === 'snapshot') {
            const records = Array.isArray(frame.records) ? frame.records.filter(isChatRecord) : []
            const state = normalizeState(frame.state)
            if (disposed) return
            setView((previous) => ({
              ...previous,
              records,
              state: state === null ? previous.state : state,
              phase: 'connected',
              error: '',
            }))
            return
          }
          if (type === 'record') {
            if (!isChatRecord(frame.record)) return
            const record = frame.record
            if (disposed) return
            setView((previous) => {
              const key = recordKey(record)
              if (key !== '' && previous.records.some((item) => recordKey(item) === key)) return previous
              const records = previous.records.length >= MAX_RECORDS
                ? previous.records.slice(previous.records.length - MAX_RECORDS + 1)
                : previous.records.slice()
              records.push(record)
              return { ...previous, records }
            })
            return
          }
          if (type === 'state') {
            const state = normalizeState(frame.state)
            if (state !== null) patch({ state })
            return
          }
          if (type === 'title') {
            if (typeof frame.title === 'string') patch({ title: frame.title })
            return
          }
          if (type === 'error') {
            sawError = true
            const message = typeof frame.message === 'string' && frame.message !== '' ? frame.message : t('stream.error')
            patch({ phase: 'error', error: message })
            return
          }
          if (type === 'end') {
            sawEnd = true
            patch({ phase: 'ended' })
            return
          }
          // 'opened' and unknown frame types are ignored on purpose.
        }

        const scheduleRetry = (message) => {
          if (disposed) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            patch({ phase: 'paused' })
            return
          }
          if (attempt >= 8) {
            patch({ phase: 'failed', error: message !== '' ? message : t('stream.lost') })
            return
          }
          attempt += 1
          if (retryTimer !== null) return
          patch({ phase: 'retrying', error: message !== '' ? message : t('stream.lost') })
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            void run()
          }, STREAM_RETRY_MS)
        }

        async function run() {
          if (disposed || active) return
          active = true
          const controller = new AbortController()
          abort = controller
          try {
            patch({ phase: attempt === 0 ? 'connecting' : 'retrying' })
            const response = await fetch(STREAM_ROUTE, {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
              body: JSON.stringify({ op: 'follow', deviceId, sessionId }),
              signal: controller.signal,
            })
            if (!response.ok) {
              let message = `HTTP ${response.status}`
              try {
                const payload = await response.json()
                if (payload !== null && typeof payload === 'object' && typeof payload.error === 'string' && payload.error !== '') message = payload.error
              } catch {
                // non-JSON error body: keep the status line
              }
              throw new Error(message)
            }
            if (response.body === null) throw new Error(t('stream.unsupported'))
            attempt = 0
            patch({ phase: 'connected', error: '' })
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            for (;;) {
              const chunk = await reader.read()
              if (chunk.done) break
              buffer += decoder.decode(chunk.value, { stream: true })
              let newline = buffer.indexOf('\n')
              while (newline >= 0) {
                const line = buffer.slice(0, newline).trim()
                buffer = buffer.slice(newline + 1)
                if (line !== '') {
                  try {
                    handleFrame(JSON.parse(line))
                  } catch {
                    // ignore a malformed frame and keep the stream alive
                  }
                }
                newline = buffer.indexOf('\n')
              }
            }
            if (disposed || controller.signal.aborted) return
            if (!sawEnd && !sawError) scheduleRetry(t('stream.lost'))
          } catch (error) {
            if (controller.signal.aborted || disposed) return
            scheduleRetry(errorText(error))
          } finally {
            if (abort === controller) abort = null
            active = false
            if (wake && !disposed) {
              wake = false
              if (document.visibilityState !== 'hidden') {
                attempt = 0
                void run()
              }
            }
          }
        }

        const onVisibility = () => {
          if (disposed) return
          if (document.visibilityState === 'hidden') {
            if (sawEnd || sawError) return
            if (retryTimer !== null) {
              clearTimeout(retryTimer)
              retryTimer = null
            }
            patch({ phase: 'paused' })
            if (abort !== null) {
              abort.abort()
              abort = null
            }
            return
          }
          if (abort !== null || resumeTimer !== null) return
          if (sawEnd || sawError) return
          attempt = 0
          if (active) {
            wake = true
            return
          }
          resumeTimer = window.setTimeout(() => {
            resumeTimer = null
            void run()
          }, 120)
        }

        restartRef.current = () => {
          if (disposed) return
          if (retryTimer !== null) {
            clearTimeout(retryTimer)
            retryTimer = null
          }
          if (resumeTimer !== null) {
            clearTimeout(resumeTimer)
            resumeTimer = null
          }
          if (abort !== null) {
            abort.abort()
            abort = null
          }
          attempt = 0
          sawEnd = false
          sawError = false
          patch({ phase: 'connecting', error: '' })
          if (active) {
            wake = true
            return
          }
          window.setTimeout(() => {
            if (!disposed) void run()
          }, 60)
        }

        document.addEventListener('visibilitychange', onVisibility)
        void run()

        return () => {
          disposed = true
          restartRef.current = null
          if (retryTimer !== null) clearTimeout(retryTimer)
          if (resumeTimer !== null) clearTimeout(resumeTimer)
          if (abort !== null) {
            abort.abort()
            abort = null
          }
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [deviceId, sessionId, t])

      const retry = React.useCallback(() => {
        if (restartRef.current !== null) restartRef.current()
      }, [])

      return {
        records: view.records,
        title: view.title,
        state: view.state,
        phase: view.phase,
        error: view.error,
        retry,
      }
    }

    /* --------------------------------------------------------------------- */
    /* Transcript                                                             */
    /* --------------------------------------------------------------------- */

    /** One mapped ChatRecord row. */
    function ChatRecordView({ record, t }) {
      if (record.kind === 'user') {
        return h('div', { className: 'dsh-link-msg is-user' },
          h('div', { className: 'dsh-link-msg-main' },
            h('div', { className: 'dsh-link-role' }, t('role.user')),
            h('div', { className: 'dsh-link-bubble' }, h('div', { className: 'dsh-link-text' }, typeof record.text === 'string' ? record.text : '')),
          ),
        )
      }
      if (record.kind === 'assistant') {
        const parts = []
        if (typeof record.reasoning === 'string' && record.reasoning.trim() !== '') {
          parts.push(h('details', { className: 'dsh-link-details', key: 'reasoning' },
            h('summary', null, h('span', { className: 'dsh-link-details-title' }, t('reasoning'))),
            h('pre', { className: 'dsh-link-pre' }, record.reasoning),
          ))
        }
        if (typeof record.text === 'string' && record.text !== '') {
          parts.push(h('div', { className: 'dsh-link-bubble', key: 'text' }, h('div', { className: 'dsh-link-text' }, record.text)))
        }
        if (parts.length === 0) return null
        return h('div', { className: 'dsh-link-msg is-wide' },
          h('div', { className: 'dsh-link-msg-main' },
            h('div', { className: 'dsh-link-role' }, t('role.assistant')),
            ...parts,
          ),
        )
      }
      if (record.kind === 'tool-call') {
        return h('div', { className: 'dsh-link-msg is-wide' },
          h('div', { className: 'dsh-link-msg-main' },
            h('details', { className: 'dsh-link-details' },
              h('summary', null,
                h('span', { className: 'dsh-link-details-title' }, t('tool.call')),
                h('code', { className: 'dsh-link-tool-name' }, typeof record.name === 'string' && record.name !== '' ? record.name : '—'),
              ),
              h('pre', { className: 'dsh-link-pre' }, formatArgs(record.args)),
            ),
          ),
        )
      }
      if (record.kind === 'tool-result') {
        const failed = record.isError === true
        return h('div', { className: 'dsh-link-msg is-wide' },
          h('div', { className: 'dsh-link-msg-main' },
            h('details', { className: failed ? 'dsh-link-details is-error' : 'dsh-link-details', open: failed ? true : undefined },
              h('summary', null,
                h('span', { className: 'dsh-link-details-title' }, failed ? t('tool.failed') : t('tool.result')),
                h('code', { className: 'dsh-link-tool-name' }, typeof record.name === 'string' && record.name !== '' ? record.name : '—'),
              ),
              h('pre', { className: 'dsh-link-pre' }, typeof record.text === 'string' ? record.text : ''),
            ),
          ),
        )
      }
      if (record.kind === 'turn-start') {
        return h('div', { className: 'dsh-link-turn', role: 'separator' },
          h('span', { className: 'dsh-link-turn-label' }, t('turn.start', { n: record.turn ?? '?' })),
        )
      }
      if (record.kind === 'turn-end') {
        return h('div', { className: 'dsh-link-turn', role: 'separator' },
          h('span', { className: 'dsh-link-turn-label' }, t('turn.end', { n: record.turn ?? '?', reason: turnReason(t, record.reason) })),
        )
      }
      if (record.kind === 'error') {
        return h('div', { className: 'dsh-link-msg is-wide' },
          h('div', { className: 'dsh-link-msg-main' },
            h('div', { className: 'dsh-link-error-record', role: 'alert' },
              h('div', { className: 'dsh-link-error-title' }, t('error.record')),
              h('div', { className: 'dsh-link-text' }, typeof record.message === 'string' ? record.message : ''),
            ),
          ),
        )
      }
      return null
    }

    /* --------------------------------------------------------------------- */
    /* Remote conversation                                                    */
    /* --------------------------------------------------------------------- */

    /** Remote device/session pane with transcript, stream status and composer. */
    function RemoteConversation({ ctx, t, device, session, onBack, onRenamed }) {
      const stream = useFollowStream(t, device.id, session.sessionId)
      const [input, setInput] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [stopping, setStopping] = React.useState(false)
      const [actionError, setActionError] = React.useState('')
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState('')
      const [renaming, setRenaming] = React.useState(false)
      const [titleOverride, setTitleOverride] = React.useState('')
      const listRef = React.useRef(null)
      const stickRef = React.useRef(true)
      const aliveRef = React.useRef(true)

      React.useEffect(() => () => {
        aliveRef.current = false
      }, [])

      React.useEffect(() => {
        setTitleOverride('')
        setEditing(false)
        setInput('')
        setActionError('')
        stickRef.current = true
      }, [device.id, session.sessionId])

      const records = stream.records
      const running = stream.state !== null && stream.state.running === true
      const displayTitle = titleOverride !== '' ? titleOverride : (stream.title !== '' ? stream.title : (typeof session.title === 'string' && session.title !== '' ? session.title : t('untitled')))

      React.useLayoutEffect(() => {
        const element = listRef.current
        if (element !== null && stickRef.current) element.scrollTop = element.scrollHeight
      }, [records, stream.state, stream.phase])

      const onScroll = () => {
        const element = listRef.current
        if (element === null) return
        stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
      }

      const send = async () => {
        const text = input.trim()
        if (text === '' || sending) return
        setSending(true)
        setActionError('')
        try {
          await api.send(device.id, session.sessionId, text)
          if (!aliveRef.current) return
          setInput('')
          stickRef.current = true
          if (stream.phase === 'ended' || stream.phase === 'error' || stream.phase === 'failed') stream.retry()
        } catch (error) {
          if (aliveRef.current) setActionError(`${t('send.failed')}: ${errorText(error)}`)
        } finally {
          if (aliveRef.current) setSending(false)
        }
      }

      const stop = async () => {
        if (stopping) return
        setStopping(true)
        setActionError('')
        try {
          await api.cancel(device.id, session.sessionId)
        } catch (error) {
          if (aliveRef.current) setActionError(`${t('cancel.failed')}: ${errorText(error)}`)
        } finally {
          if (aliveRef.current) setStopping(false)
        }
      }

      const beginRename = () => {
        setDraft(displayTitle)
        setEditing(true)
      }

      const commitRename = async () => {
        const title = draft.trim()
        if (title === '' || title === displayTitle) {
          setEditing(false)
          return
        }
        setRenaming(true)
        setActionError('')
        try {
          const saved = await api.rename(device.id, session.sessionId, title)
          if (!aliveRef.current) return
          setTitleOverride(saved)
          setEditing(false)
          if (typeof onRenamed === 'function') onRenamed(session.sessionId, saved)
        } catch (error) {
          if (aliveRef.current) setActionError(`${t('rename')}: ${errorText(error)}`)
        } finally {
          if (aliveRef.current) setRenaming(false)
        }
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return
        const composing = (event.nativeEvent !== undefined && event.nativeEvent !== null && event.nativeEvent.isComposing === true)
          || event.isComposing === true
        if (composing) return
        event.preventDefault()
        void send()
      }

      const stateParts = []
      stateParts.push(running ? t('state.running') : t('state.idle'))
      if (stream.state !== null && stream.state.queueCount > 0) stateParts.push(t('queue', { n: stream.state.queueCount }))
      if (stream.state !== null && stream.state.pendingInput.length > 0) stateParts.push(t('pendingInput'))

      const canRetry = stream.phase === 'error' || stream.phase === 'failed' || stream.phase === 'ended'
      const cwd = typeof session.cwd === 'string' && session.cwd !== '' ? session.cwd : ''

      return h('div', { className: 'dsh-link-conv' },
        h('div', { className: 'dsh-link-conv-header' },
          h('div', { className: 'dsh-link-conv-top' },
            onBack !== null && onBack !== undefined
              ? h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon is-small', onClick: onBack, 'aria-label': t('back'), title: t('back') }, h(BackGlyph, { size: 15 }))
              : null,
            h('span', { className: 'dsh-link-conv-device', title: device.name || device.id },
              h(DeviceGlyph, { size: 14 }),
              h('span', { className: 'dsh-link-conv-device-name' }, typeof device.name === 'string' && device.name !== '' ? device.name : device.id),
              h('span', { className: 'dsh-link-badge is-remote' }, t('badge.remote')),
              h('span', null, platformLabel(t, device.platform)),
            ),
            h('div', { className: 'dsh-link-conv-actions' },
              h('span', { className: cls('dsh-link-stream', streamTone(stream.phase)) },
                h('span', { className: cls('dsh-link-dot', streamTone(stream.phase), stream.phase === 'connected' ? '' : 'is-pulse') }),
                streamLabel(t, stream.phase),
              ),
              canRetry
                ? h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: stream.retry }, t('stream.retry'))
                : null,
            ),
          ),
          editing
            ? h('div', { className: 'dsh-link-conv-title-edit' },
                h('input', {
                  className: 'dsh-link-input',
                  value: draft,
                  placeholder: t('titlePlaceholder'),
                  autoFocus: true,
                  spellCheck: false,
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void commitRename()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditing(false)
                    }
                  },
                }),
                h('button', { type: 'button', className: 'dsh-link-btn is-primary is-small', disabled: renaming, onClick: () => void commitRename() }, renaming ? t('saving') : t('save')),
                h('button', { type: 'button', className: 'dsh-link-btn is-small', disabled: renaming, onClick: () => setEditing(false) }, t('cancel')),
              )
            : h('div', { className: 'dsh-link-conv-title-row' },
                h('h2', { className: 'dsh-link-conv-title', title: displayTitle }, displayTitle),
                h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon is-small', onClick: beginRename, 'aria-label': t('editTitle'), title: t('rename') }, h(EditGlyph)),
              ),
          h('div', { className: 'dsh-link-conv-meta' },
            cwd !== '' ? h('span', { title: cwd }, cwd) : null,
            typeof session.updatedAt === 'number' ? h('span', null, relativeTime(t, session.updatedAt)) : null,
          ),
        ),
        stream.error !== '' && (stream.phase === 'error' || stream.phase === 'failed' || stream.phase === 'retrying')
          ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, stream.error)
          : null,
        actionError !== ''
          ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, actionError)
          : null,
        h('div', { className: 'dsh-link-messages', ref: listRef, onScroll, role: 'log', 'aria-label': displayTitle },
          records.length === 0
            ? h('div', { className: 'dsh-link-empty' },
                h('div', { className: 'dsh-link-empty-icon' }, h(DeviceGlyph, { size: 34 })),
                h('h3', { className: 'dsh-link-empty-title' }, stream.phase === 'connecting' || stream.phase === 'retrying' ? t('stream.connecting') : t('emptyConversation.title')),
                h('p', { className: 'dsh-link-empty-hint' }, t('emptyConversation.hint')),
              )
            : records.map((record, index) => h(ChatRecordView, {
                key: `${record.kind}:${record.seq !== undefined ? record.seq : index}:${index}`,
                record,
                t,
              })),
        ),
        h('div', { className: 'dsh-link-composer' },
          h('div', { className: 'dsh-link-composer-box' },
            h('textarea', {
              className: 'dsh-link-composer-input',
              value: input,
              placeholder: t('input.placeholder'),
              rows: 2,
              spellCheck: false,
              onChange: (event) => setInput(event.target.value),
              onKeyDown,
              'aria-label': t('input.placeholderShort'),
            }),
            h('div', { className: 'dsh-link-composer-actions' },
              h('div', { className: 'dsh-link-composer-state' }, stateParts.join(' · ')),
              h('div', { className: 'dsh-link-composer-buttons' },
                running
                  ? h('button', { type: 'button', className: 'dsh-link-btn is-danger is-small', disabled: stopping, onClick: () => void stop() },
                      h(StopGlyph),
                      h('span', { className: 'dsh-link-btn-label' }, stopping ? t('stopping') : t('stop')),
                    )
                  : null,
                h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: sending || input.trim() === '', onClick: () => void send() },
                  h(SendGlyph),
                  h('span', { className: 'dsh-link-btn-label' }, sending ? t('sending') : t('send')),
                ),
              ),
            ),
          ),
        ),
      )
    }

    /* --------------------------------------------------------------------- */
    /* New session                                                            */
    /* --------------------------------------------------------------------- */

    /** Create one remote session, optionally in a chosen workspace. */
    function NewSessionPanel({ ctx, t, device, onClose, onCreated }) {
      const [workspaces, setWorkspaces] = React.useState([])
      const [workspaceId, setWorkspaceId] = React.useState('')
      const [cwd, setCwd] = React.useState('')
      const [loadError, setLoadError] = React.useState('')
      const [creating, setCreating] = React.useState(false)
      const [error, setError] = React.useState('')
      const aliveRef = React.useRef(true)

      React.useEffect(() => () => {
        aliveRef.current = false
      }, [])

      React.useEffect(() => {
        let cancelled = false
        setLoadError('')
        api.workspaces(device.id).then((items) => {
          if (cancelled) return
          setWorkspaces(items)
        }).catch((failure) => {
          if (cancelled) return
          setLoadError(errorText(failure))
        })
        return () => {
          cancelled = true
        }
      }, [device.id])

      const create = async () => {
        if (creating) return
        setCreating(true)
        setError('')
        try {
          const sessionId = await api.create(device.id, workspaceId, cwd)
          if (!aliveRef.current) return
          onCreated(sessionId)
        } catch (failure) {
          if (aliveRef.current) setError(`${t('newSession.failed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setCreating(false)
        }
      }

      return h('div', { className: 'dsh-link-form' },
        h('p', { className: 'dsh-link-hint' }, t('newSession.target', { name: typeof device.name === 'string' && device.name !== '' ? device.name : device.id })),
        loadError !== '' ? h('div', { className: 'dsh-link-banner is-warn', role: 'status' }, `${t('loadWorkspacesFailed')} (${loadError})`) : null,
        h('div', { className: 'dsh-link-field' },
          h('label', { className: 'dsh-link-field-label', htmlFor: 'dsh-link-workspace' }, t('workspace.label')),
          h('select', {
            id: 'dsh-link-workspace',
            className: 'dsh-link-select',
            value: workspaceId,
            onChange: (event) => setWorkspaceId(event.target.value),
          },
            h('option', { value: '' }, t('workspace.default')),
            ...workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId },
              typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.path,
            )),
          ),
        ),
        h('div', { className: 'dsh-link-field' },
          h('label', { className: 'dsh-link-field-label', htmlFor: 'dsh-link-cwd' }, t('cwd.label')),
          h('input', {
            id: 'dsh-link-cwd',
            className: 'dsh-link-input',
            value: cwd,
            placeholder: t('cwd.placeholder'),
            spellCheck: false,
            onChange: (event) => setCwd(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void create()
              }
            },
          }),
        ),
        error !== '' ? h('div', { className: 'dsh-link-notice is-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-link-form-actions' },
          h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: creating, onClick: () => void create() }, creating ? t('creating') : t('create')),
          h('button', { type: 'button', className: 'dsh-link-btn', disabled: creating, onClick: onClose }, t('cancel')),
        ),
      )
    }

    /* --------------------------------------------------------------------- */
    /* Settings                                                               */
    /* --------------------------------------------------------------------- */

    /** Pairing, relay, peer and speech status shared by the settings page and the in-page sheet. */
    function LinkSettingsPanel({ ctx, t, variant, onChanged }) {
      useLocale(ctx)
      const [status, setStatus] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [pairingCode, setPairingCode] = React.useState('')
      const [deviceName, setDeviceName] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [forgetting, setForgetting] = React.useState(false)
      const [confirmForget, setConfirmForget] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      const reloadRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const forgetTimer = React.useRef(null)
      const copiedTimer = React.useRef(null)
      const noticeTimer = React.useRef(null)
      const deviceNameFieldId = React.useId()

      React.useEffect(() => () => {
        aliveRef.current = false
        if (forgetTimer.current !== null) clearTimeout(forgetTimer.current)
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
      }, [])

      React.useEffect(() => {
        let disposed = false
        let sequence = 0

        const load = async (quiet) => {
          const current = sequence + 1
          sequence = current
          if (!quiet) setPhase('loading')
          try {
            const next = await api.status()
            if (disposed || current !== sequence) return
            setStatus(next)
            setError('')
            setPhase('ready')
          } catch (failure) {
            if (disposed || current !== sequence) return
            setError(`${t('settings.loadFailed')}: ${errorText(failure)}`)
            if (!quiet) setPhase('error')
          }
        }

        reloadRef.current = () => {
          void load(false)
        }
        void load(false)
        const interval = window.setInterval(() => {
          if (document.visibilityState === 'visible') void load(true)
        }, 5000)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') void load(true)
        }
        document.addEventListener('visibilitychange', onVisibility)

        return () => {
          disposed = true
          reloadRef.current = null
          window.clearInterval(interval)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [t])

      const showNotice = (text) => {
        setNotice(text)
        setError('')
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => {
          noticeTimer.current = null
          if (aliveRef.current) setNotice('')
        }, 5000)
      }

      const save = async () => {
        const code = pairingCode.trim()
        if (code === '') {
          setError(t('settings.codeRequired'))
          return
        }
        setSaving(true)
        setError('')
        setNotice('')
        try {
          const next = await api.save(code, deviceName)
          if (!aliveRef.current) return
          setStatus(next)
          setPhase('ready')
          setPairingCode('')
          setDeviceName('')
          showNotice(t('settings.saved'))
          if (typeof onChanged === 'function') onChanged()
        } catch (failure) {
          if (aliveRef.current) setError(`${t('settings.saveFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setSaving(false)
        }
      }

      const forget = async (confirmed) => {
        if (!confirmed) {
          setConfirmForget(true)
          if (forgetTimer.current !== null) clearTimeout(forgetTimer.current)
          forgetTimer.current = window.setTimeout(() => {
            forgetTimer.current = null
            if (aliveRef.current) setConfirmForget(false)
          }, 4000)
          return
        }
        if (forgetTimer.current !== null) clearTimeout(forgetTimer.current)
        forgetTimer.current = null
        setConfirmForget(false)
        setForgetting(true)
        setError('')
        setNotice('')
        try {
          const next = await api.forget()
          if (!aliveRef.current) return
          setStatus(next)
          setPhase('ready')
          showNotice(t('settings.forgotten'))
          if (typeof onChanged === 'function') onChanged()
        } catch (failure) {
          if (aliveRef.current) setError(`${t('settings.forgetFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setForgetting(false)
        }
      }

      const copyCode = async () => {
        const code = status !== null && typeof status.pairingCode === 'string' ? status.pairingCode : ''
        if (code === '') return
        try {
          if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable')
          await navigator.clipboard.writeText(code)
          if (!aliveRef.current) return
          setCopied(true)
          if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
          copiedTimer.current = window.setTimeout(() => {
            copiedTimer.current = null
            if (aliveRef.current) setCopied(false)
          }, 2000)
        } catch {
          if (aliveRef.current) setError(t('copyFailed'))
        }
      }

      const connection = status !== null && status.connection !== null && typeof status.connection === 'object' ? status.connection : {}
      const device = status !== null && status.device !== null && typeof status.device === 'object' ? status.device : null
      const peers = status !== null && Array.isArray(status.peers) ? status.peers.filter((peer) => peer !== null && typeof peer === 'object') : []
      const speech = status !== null && status.speech !== null && typeof status.speech === 'object' ? status.speech : null
      const code = status !== null && typeof status.pairingCode === 'string' ? status.pairingCode : ''

      const rows = [
        device !== null
          ? h('div', { className: 'dsh-link-row', key: 'device' },
              h('span', { className: 'dsh-link-row-key' }, t('device.label')),
              h('span', { className: 'dsh-link-row-value' }, `${typeof device.name === 'string' ? device.name : '—'} · ${platformLabel(t, device.platform)}`),
            )
          : null,
        device !== null && typeof device.id === 'string' && device.id !== ''
          ? h('div', { className: 'dsh-link-row', key: 'deviceId' },
              h('span', { className: 'dsh-link-row-key' }, t('device.id')),
              h('span', { className: 'dsh-link-row-value is-mono' }, device.id),
            )
          : null,
        h('div', { className: 'dsh-link-row', key: 'connection' },
          h('span', { className: 'dsh-link-row-key' }, t('settings.connection')),
          h('span', { className: 'dsh-link-row-value' },
            h('span', { className: cls('dsh-link-dot', connectionTone(connection.state)) }),
            ' ',
            t(connectionKey(connection.state)),
          ),
        ),
        h('div', { className: 'dsh-link-row', key: 'relay' },
          h('span', { className: 'dsh-link-row-key' }, t('settings.relay')),
          h('span', { className: 'dsh-link-row-value is-mono' }, typeof connection.relayUrl === 'string' && connection.relayUrl !== '' ? connection.relayUrl : '—'),
        ),
        status !== null && typeof status.version === 'string' && status.version !== ''
          ? h('div', { className: 'dsh-link-row', key: 'version' },
              h('span', { className: 'dsh-link-row-key' }, t('version.label')),
              h('span', { className: 'dsh-link-row-value' }, status.version),
            )
          : null,
        connection.lastError !== null && connection.lastError !== undefined && connection.lastError !== ''
          ? h('div', { className: 'dsh-link-row', key: 'lastError' },
              h('span', { className: 'dsh-link-row-key' }, t('error.record')),
              h('span', { className: 'dsh-link-row-value' }, String(connection.lastError)),
            )
          : null,
      ].filter(Boolean)

      return h('div', { className: cls('dsh-link-settings', variant === 'sheet' ? 'is-sheet' : '') },
        variant === 'sheet' ? null : h('h2', { className: 'dsh-link-settings-title' }, t('settings.title')),
        h('p', { className: 'dsh-link-settings-desc' }, t('settings.description')),
        phase === 'loading' && status === null
          ? h('p', { className: 'dsh-link-hint' }, t('settings.loading'))
          : null,
        phase === 'error' && status === null
          ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' },
              h('span', null, error !== '' ? error : t('settings.loadFailed')),
              h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => reloadRef.current?.() }, t('retry')),
            )
          : null,
        error !== '' && status !== null ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, error) : null,
        notice !== '' ? h('div', { className: 'dsh-link-banner is-ok', role: 'status' }, notice) : null,
        status !== null
          ? h('div', { className: 'dsh-link-card' },
              h('h3', { className: 'dsh-link-card-title' }, t('settings.connection')),
              h('div', { className: 'dsh-link-rows' }, ...rows),
              status.configured === false ? h('p', { className: 'dsh-link-hint' }, t('settings.unconfigured')) : null,
            )
          : null,
        h('div', { className: 'dsh-link-card' },
          h('h3', { className: 'dsh-link-card-title' }, t('settings.code')),
          h('div', { className: 'dsh-link-form' },
            h('div', { className: 'dsh-link-field' },
              h('textarea', {
                className: 'dsh-link-textarea',
                value: pairingCode,
                placeholder: t('settings.codePlaceholder'),
                'aria-label': t('settings.code'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setPairingCode(event.target.value),
              }),
            ),
            h('div', { className: 'dsh-link-field' },
              h('label', { className: 'dsh-link-field-label', htmlFor: deviceNameFieldId }, t('settings.deviceName')),
              h('input', {
                id: deviceNameFieldId,
                className: 'dsh-link-input',
                value: deviceName,
                placeholder: t('settings.deviceNamePlaceholder'),
                spellCheck: false,
                autoComplete: 'off',
                onChange: (event) => setDeviceName(event.target.value),
              }),
            ),
            h('div', { className: 'dsh-link-form-actions' },
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: saving, onClick: () => void save() }, saving ? t('saving') : t('settings.save')),
            ),
          ),
        ),
        status !== null && status.configured === true && code !== ''
          ? h('div', { className: 'dsh-link-card' },
              h('h3', { className: 'dsh-link-card-title' }, t('settings.localCode')),
              h('div', { className: 'dsh-link-code-row' },
                h('input', { className: 'dsh-link-input', value: code, readOnly: true, onFocus: (event) => event.target.select(), 'aria-label': t('settings.localCode') }),
                h('button', { type: 'button', className: 'dsh-link-btn', onClick: () => void copyCode() },
                  h(CopyGlyph),
                  h('span', { className: 'dsh-link-btn-label' }, copied ? t('copied') : t('copy')),
                ),
              ),
              h('p', { className: 'dsh-link-field-hint' }, t('settings.localCodeHint')),
            )
          : null,
        status !== null
          ? h('div', { className: 'dsh-link-card' },
              h('h3', { className: 'dsh-link-card-title' }, t('settings.peers'), h('span', { className: 'dsh-link-group-count' }, t('settings.peersCount', { n: peers.length }))),
              peers.length === 0
                ? h('p', { className: 'dsh-link-hint' }, t('settings.noPeers'))
                : h('ul', { className: 'dsh-link-peers' },
                    ...peers.map((peer) => h('li', { className: 'dsh-link-peer', key: String(peer.id) },
                      h('span', { className: 'dsh-link-dot is-ok' }),
                      h('span', { className: 'dsh-link-peer-name' }, typeof peer.name === 'string' && peer.name !== '' ? peer.name : String(peer.id)),
                      h('span', { className: 'dsh-link-badge is-remote' }, platformLabel(t, peer.platform)),
                    )),
                  ),
            )
          : null,
        status !== null
          ? h('div', { className: 'dsh-link-card' },
              h('h3', { className: 'dsh-link-card-title' }, t('settings.speech')),
              speech === null
                ? h('p', { className: 'dsh-link-hint' }, t('settings.speechUnavailable'))
                : speech.available === true
                  ? h('div', { className: 'dsh-link-rows' },
                      h('div', { className: 'dsh-link-row' },
                        h('span', { className: 'dsh-link-row-key' }, t('settings.speech')),
                        h('span', { className: 'dsh-link-row-value' }, t('settings.speechAvailable', { phase: typeof speech.phase === 'string' ? speech.phase : 'unknown' })),
                      ),
                      Array.isArray(speech.providers) && speech.providers.length > 0
                        ? h('div', { className: 'dsh-link-row' },
                            h('span', { className: 'dsh-link-row-key' }, t('settings.speechProvidersLabel')),
                            h('span', { className: 'dsh-link-row-value' }, speech.providers
                              .filter((provider) => provider !== null && typeof provider === 'object')
                              .map((provider) => typeof provider.name === 'string' && provider.name !== '' ? provider.name : String(provider.id))
                              .join(', ')),
                          )
                        : null,
                    )
                  : h('div', { className: 'dsh-link-rows' },
                      h('div', { className: 'dsh-link-row' },
                        h('span', { className: 'dsh-link-row-key' }, t('settings.speech')),
                        h('span', { className: 'dsh-link-row-value' }, t('settings.speechUnavailable')),
                      ),
                      typeof speech.message === 'string' && speech.message !== ''
                        ? h('p', { className: 'dsh-link-hint' }, speech.message)
                        : null,
                    ),
            )
          : null,
        h('div', { className: 'dsh-link-card' },
          h('h3', { className: 'dsh-link-card-title' }, t('settings.android.title')),
          h('p', { className: 'dsh-link-inline-hint' }, t('settings.android.hint')),
        ),
        status !== null && status.configured === true
          ? h('div', { className: 'dsh-link-form-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-link-btn is-danger',
                disabled: forgetting,
                onClick: () => void forget(confirmForget),
              }, forgetting ? t('saving') : (confirmForget ? t('settings.confirmForget') : t('settings.forget'))),
            )
          : null,
        variant === 'sheet'
          ? h('p', { className: 'dsh-link-field-hint' }, t('settings.manageHint'))
          : null,
      )
    }

    /* --------------------------------------------------------------------- */
    /* Modal sheet                                                            */
    /* --------------------------------------------------------------------- */

    /** In-page modal used for pairing and new-session forms. */
    function Sheet({ t, title, wide, onClose, children }) {
      const panelRef = React.useRef(null)

      React.useEffect(() => {
        panelRef.current?.focus?.()
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          onClose()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [onClose])

      return h('div', {
        className: 'dsh-link-overlay',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) onClose()
        },
      },
        h('div', {
          className: cls('dsh-link-sheet', wide ? 'is-wide' : ''),
          ref: panelRef,
          tabIndex: -1,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
        },
          h('div', { className: 'dsh-link-sheet-head' },
            h('h2', { className: 'dsh-link-sheet-title' }, title),
            h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon is-small', onClick: onClose, 'aria-label': t('close'), title: t('close') }, h(CloseGlyph)),
          ),
          h('div', { className: 'dsh-link-sheet-body' }, children),
        ),
      )
    }

    /* --------------------------------------------------------------------- */
    /* Main workspace                                                         */
    /* --------------------------------------------------------------------- */

    /** Build the main-panel component; closes over the plugin context. */
    function createWorkspace(ctx, t) {
      return function LinkWorkspace() {
        useLocale(ctx)
        const narrow = useMediaQuery(NARROW_QUERY)
        const [status, setStatus] = React.useState(null)
        const [statusPhase, setStatusPhase] = React.useState('loading')
        const [statusError, setStatusError] = React.useState('')
        const [sessions, setSessions] = React.useState({})
        const [expanded, setExpanded] = React.useState({})
        const [selection, setSelection] = React.useState(null)
        const [query, setQuery] = React.useState('')
        const [sheet, setSheet] = React.useState(null)
        const [mobileView, setMobileView] = React.useState('list')
        const statusRef = React.useRef(null)
        const statusSeq = React.useRef(0)
        const sessionSeq = React.useRef(new Map())
        const aliveRef = React.useRef(true)

        statusRef.current = status

        React.useEffect(() => () => {
          aliveRef.current = false
        }, [])

        const loadStatus = React.useCallback(async (quiet) => {
          const current = statusSeq.current + 1
          statusSeq.current = current
          if (!quiet) setStatusPhase('loading')
          try {
            const next = await api.status()
            if (!aliveRef.current || current !== statusSeq.current) return
            setStatus(next)
            setStatusError('')
            setStatusPhase('ready')
          } catch (error) {
            if (!aliveRef.current || current !== statusSeq.current) return
            setStatusError(errorText(error))
            if (!quiet || statusRef.current === null) setStatusPhase('error')
          }
        }, [])

        const loadSessions = React.useCallback(async (deviceId) => {
          const current = (sessionSeq.current.get(deviceId) ?? 0) + 1
          sessionSeq.current.set(deviceId, current)
          setSessions((previous) => {
            const entry = previous[deviceId]
            return {
              ...previous,
              [deviceId]: {
                phase: entry !== undefined && Array.isArray(entry.items) && entry.items.length > 0 ? 'refreshing' : 'loading',
                items: entry !== undefined && Array.isArray(entry.items) ? entry.items : [],
                error: '',
              },
            }
          })
          try {
            const items = await api.sessions(deviceId)
            if (!aliveRef.current || sessionSeq.current.get(deviceId) !== current) return
            setSessions((previous) => ({ ...previous, [deviceId]: { phase: 'ready', items, error: '' } }))
          } catch (error) {
            if (!aliveRef.current || sessionSeq.current.get(deviceId) !== current) return
            setSessions((previous) => {
              const entry = previous[deviceId]
              return {
                ...previous,
                [deviceId]: {
                  phase: 'error',
                  items: entry !== undefined && Array.isArray(entry.items) ? entry.items : [],
                  error: errorText(error),
                },
              }
            })
          }
        }, [])

        React.useEffect(() => {
          void loadStatus(false)
          const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void loadStatus(true)
          }, 8000)
          const onVisibility = () => {
            if (document.visibilityState === 'visible') void loadStatus(true)
          }
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, [loadStatus])

        const peers = status !== null && Array.isArray(status.peers) ? status.peers.filter((peer) => peer !== null && typeof peer === 'object' && typeof peer.id === 'string') : []
        const localDevice = status !== null && status.device !== null && typeof status.device === 'object' ? status.device : null
        const configured = status !== null && status.configured === true

        React.useEffect(() => {
          if (status === null || statusPhase !== 'ready' || selection === null) return
          if (!peers.some((peer) => peer.id === selection.deviceId)) {
            setSelection(null)
            setMobileView('list')
          }
        }, [status, statusPhase, selection])

        React.useEffect(() => {
          if (narrow && selection === null && mobileView !== 'list') setMobileView('list')
        }, [narrow, selection, mobileView])

        const selectedDevice = selection === null ? null : peers.find((peer) => peer.id === selection.deviceId) ?? null
        const selectedEntry = selection === null ? undefined : sessions[selection.deviceId]
        const selectedSession = selection === null
          ? null
          : (selectedEntry !== undefined && Array.isArray(selectedEntry.items) ? selectedEntry.items : []).find((item) => item.sessionId === selection.sessionId)
            ?? { sessionId: selection.sessionId, title: '', cwd: '', updatedAt: 0, running: false, active: false, agentAvailable: true, blank: false }

        const toggleDevice = (deviceId) => {
          const open = expanded[deviceId] === true
          setExpanded((previous) => {
            const next = { ...previous }
            if (open) delete next[deviceId]
            else next[deviceId] = true
            return next
          })
          if (!open) {
            const entry = sessions[deviceId]
            if (entry === undefined || entry.phase === 'error') void loadSessions(deviceId)
          }
        }

        const selectSession = (deviceId, sessionId) => {
          setSelection({ deviceId, sessionId })
          setMobileView('chat')
          setSheet(null)
        }

        const refreshAll = () => {
          void loadStatus(true)
          for (const deviceId of Object.keys(expanded)) {
            if (expanded[deviceId] === true) void loadSessions(deviceId)
          }
        }

        const goLocal = () => {
          const layout = ctx.get('layout')
          if (layout === undefined || layout === null || typeof layout.selectPanel !== 'function') return
          try {
            layout.selectPanel(null)
          } catch {
            // a missing local conversation panel is not fatal for this page
          }
        }

        const onCreated = (deviceId, sessionId) => {
          setSheet(null)
          setExpanded((previous) => ({ ...previous, [deviceId]: true }))
          setSelection({ deviceId, sessionId })
          setMobileView('chat')
          void loadSessions(deviceId)
        }

        const onRenamed = (deviceId, sessionId, title) => {
          setSessions((previous) => {
            const entry = previous[deviceId]
            if (entry === undefined || !Array.isArray(entry.items)) return previous
            return {
              ...previous,
              [deviceId]: {
                ...entry,
                items: entry.items.map((item) => item.sessionId === sessionId ? { ...item, title } : item),
              },
            }
          })
        }

        const queryNormalized = query.trim().toLowerCase()
        const matchesSession = (session) => queryNormalized === '' || `${typeof session.title === 'string' ? session.title : ''} ${typeof session.cwd === 'string' ? session.cwd : ''}`.toLowerCase().includes(queryNormalized)

        const renderLocalCard = () => {
          if (localDevice === null) return null
          return h('div', { className: 'dsh-link-device is-local' },
            h('div', { className: 'dsh-link-device-head' },
              h('span', { className: 'dsh-link-device-icon' }, h(DeviceGlyph, { size: 16 })),
              h('div', { className: 'dsh-link-device-info' },
                h('span', { className: 'dsh-link-device-name', title: typeof localDevice.name === 'string' ? localDevice.name : '' }, typeof localDevice.name === 'string' && localDevice.name !== '' ? localDevice.name : '—'),
                h('span', { className: 'dsh-link-device-sub' },
                  h('span', { className: cls('dsh-link-dot', connectionTone(status !== null && status.connection !== null ? status.connection.state : 'unconfigured')) }),
                  platformLabel(t, localDevice.platform),
                  h('span', { className: 'dsh-link-badge is-local' }, t('badge.local')),
                ),
              ),
            ),
            h('div', { className: 'dsh-link-device-body' },
              h('p', { className: 'dsh-link-hint' }, t('local.hint')),
              ctx.get('layout') !== undefined
                ? h('div', { className: 'dsh-link-form-actions', style: { marginTop: '7px' } },
                    h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: goLocal }, t('local.open')),
                  )
                : null,
            ),
          )
        }

        const renderSessionRow = (deviceId, session) => {
          const running = session.running === true
          const updated = relativeTime(t, session.updatedAt)
          const title = typeof session.title === 'string' && session.title !== '' ? session.title : t('untitled')
          const isSelected = selection !== null && selection.deviceId === deviceId && selection.sessionId === session.sessionId
          return h('button', {
            type: 'button',
            key: String(session.sessionId),
            className: cls('dsh-link-session', isSelected ? 'is-selected' : ''),
            onClick: () => selectSession(deviceId, session.sessionId),
            title,
          },
            h('span', { className: 'dsh-link-session-main' },
              h('span', { className: 'dsh-link-session-title' }, title),
              h('span', { className: 'dsh-link-session-meta' },
                running ? h('span', { className: 'dsh-link-dot is-ok is-pulse' }) : null,
                running ? h('span', null, t('running')) : null,
                session.active === true ? h('span', { className: 'dsh-link-badge' }, t('active')) : null,
                updated !== '' ? h('span', null, updated) : null,
              ),
            ),
          )
        }

        const renderDevice = (peer) => {
          const open = expanded[peer.id] === true
          const entry = sessions[peer.id]
          const items = entry !== undefined && Array.isArray(entry.items) ? entry.items : []
          const deviceMatches = queryNormalized !== '' && `${typeof peer.name === 'string' ? peer.name : ''} ${typeof peer.platform === 'string' ? peer.platform : ''}`.toLowerCase().includes(queryNormalized)
          const filtered = queryNormalized === '' || deviceMatches ? items : items.filter(matchesSession)
          const loading = entry === undefined || entry.phase === 'loading' || entry.phase === 'refreshing'
          const failed = entry !== undefined && entry.phase === 'error'
          let body = null
          if (open) {
            const children = []
            const errorNote = failed
              ? h('div', { className: 'dsh-link-list-note', key: 'error' },
                  h('span', null, `${t('loadSessionsFailed')}: ${entry.error}`),
                  h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => void loadSessions(peer.id) }, t('retry')),
                )
              : null
            if (loading && items.length === 0) {
              children.push(h('p', { className: 'dsh-link-hint', key: 'loading', style: { padding: '2px 6px 6px' } }, t('loading')))
            } else if (failed && items.length === 0) {
              children.push(errorNote)
            } else {
              if (errorNote !== null) children.push(errorNote)
              if (filtered.length === 0) {
                children.push(h('p', { className: 'dsh-link-hint', key: 'empty', style: { padding: '2px 6px 6px' } },
                  queryNormalized !== '' && items.length > 0 ? t('noSessionsMatch') : t('noSessions'),
                ))
              } else {
                children.push(h('div', { className: 'dsh-link-sessions', key: 'rows' }, ...filtered.map((session) => renderSessionRow(peer.id, session))))
              }
            }
            body = h('div', { className: 'dsh-link-device-body' }, ...children)
          }
          return h('div', { className: 'dsh-link-device is-remote', key: peer.id },
            h('div', { className: 'dsh-link-device-head' },
              h('button', {
                type: 'button',
                className: 'dsh-link-device-toggle',
                onClick: () => toggleDevice(peer.id),
                'aria-expanded': open,
                'aria-label': `${typeof peer.name === 'string' && peer.name !== '' ? peer.name : peer.id} — ${open ? t('collapse') : t('expand')}`,
              },
                h('span', { className: cls('dsh-link-device-chevron', open ? 'is-open' : '') }, h(ChevronGlyph)),
                h('span', { className: 'dsh-link-device-icon' }, h(DeviceGlyph, { size: 16 })),
                h('span', { className: 'dsh-link-device-info' },
                  h('span', { className: 'dsh-link-device-name' }, typeof peer.name === 'string' && peer.name !== '' ? peer.name : peer.id),
                  h('span', { className: 'dsh-link-device-sub' },
                    h('span', { className: 'dsh-link-dot is-ok' }),
                    platformLabel(t, peer.platform),
                    h('span', { className: 'dsh-link-badge is-remote' }, t('badge.remote')),
                  ),
                ),
              ),
              h('div', { className: 'dsh-link-device-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-link-btn is-ghost is-icon is-small',
                  onClick: () => setSheet({ type: 'new', deviceId: peer.id }),
                  'aria-label': t('newSession.title'),
                  title: t('newSession.title'),
                }, h(PlusGlyph)),
              ),
            ),
            body,
          )
        }

        const renderList = () => {
          const children = []
          children.push(h('div', { className: 'dsh-link-list-top', key: 'top' },
            peers.length > 0
              ? h('div', { className: 'dsh-link-search' },
                  h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
                    h('circle', { cx: 7, cy: 7, r: 4.5, stroke: 'currentColor', strokeWidth: 1.3 }),
                    h('path', { d: 'm10.5 10.5 3 3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
                  ),
                  h('input', {
                    value: query,
                    placeholder: t('search.placeholder'),
                    spellCheck: false,
                    'aria-label': t('search.placeholder'),
                    onChange: (event) => setQuery(event.target.value),
                  }),
                )
              : null,
          ))

          const scrollChildren = []
          if (localDevice !== null) {
            scrollChildren.push(h('div', { className: 'dsh-link-group', key: 'local' },
              h('div', { className: 'dsh-link-group-head' },
                h('span', { className: 'dsh-link-group-label' }, t('group.local')),
              ),
              renderLocalCard(),
            ))
          }

          if (statusError !== '' && status !== null) {
            scrollChildren.push(h('div', { className: 'dsh-link-list-note', key: 'status-error' },
              h('span', null, statusError),
              h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => void loadStatus(true) }, t('retry')),
            ))
          }

          const remoteChildren = []
          if (statusPhase === 'loading' && status === null) {
            remoteChildren.push(h('p', { className: 'dsh-link-hint', key: 'loading' }, t('loading')))
          } else if (statusPhase === 'error' && status === null) {
            remoteChildren.push(h('div', { className: 'dsh-link-list-note', key: 'error' },
              h('span', null, statusError !== '' ? statusError : t('apiError')),
              h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => void loadStatus(false) }, t('retry')),
            ))
          } else if (!configured) {
            remoteChildren.push(h('p', { className: 'dsh-link-hint', key: 'unconfigured' }, t('settings.unconfigured')))
          } else if (peers.length === 0) {
            remoteChildren.push(h('p', { className: 'dsh-link-hint', key: 'nopeers' }, t('noPeersShort')))
          } else {
            remoteChildren.push(...peers.map(renderDevice))
          }
          scrollChildren.push(h('div', { className: 'dsh-link-group', key: 'remote' },
            h('div', { className: 'dsh-link-group-head' },
              h('span', { className: 'dsh-link-group-label' }, t('group.remote')),
              configured ? h('span', { className: 'dsh-link-group-count' }, t('remote.online', { n: peers.length })) : null,
            ),
            ...remoteChildren,
          ))
          children.push(h('div', { className: 'dsh-link-list-scroll', key: 'scroll' }, ...scrollChildren))
          return h('aside', { className: 'dsh-link-listpane' }, ...children)
        }

        const renderRight = () => {
          if (statusPhase === 'loading' && status === null) {
            return h('div', { className: 'dsh-link-empty' }, h('p', { className: 'dsh-link-empty-hint' }, t('loading')))
          }
          if (statusPhase === 'error' && status === null) {
            return h('div', { className: 'dsh-link-empty' },
              h('h3', { className: 'dsh-link-empty-title' }, t('apiError')),
              h('p', { className: 'dsh-link-empty-hint' }, statusError),
              h('div', { className: 'dsh-link-empty-actions' },
                h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => void loadStatus(false) }, t('retry')),
              ),
            )
          }
          if (!configured) {
            return h('div', { className: 'dsh-link-empty' },
              h('div', { className: 'dsh-link-empty-icon' }, h(PanelIcon, { size: 58, active: true })),
              h('h3', { className: 'dsh-link-empty-title' }, t('empty.title')),
              h('p', { className: 'dsh-link-empty-hint' }, t('empty.hint')),
              h('div', { className: 'dsh-link-empty-actions' },
                h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => setSheet('settings') }, t('empty.pair')),
              ),
            )
          }
          if (selection === null) {
            if (peers.length === 0) {
              return h('div', { className: 'dsh-link-empty' },
                h('div', { className: 'dsh-link-empty-icon' }, h(PanelIcon, { size: 52, active: false })),
                h('h3', { className: 'dsh-link-empty-title' }, t('noPeersShort')),
                h('p', { className: 'dsh-link-empty-hint' }, t('noPeers')),
                h('div', { className: 'dsh-link-empty-actions' },
                  h('button', { type: 'button', className: 'dsh-link-btn', onClick: refreshAll }, t('refresh')),
                  h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => setSheet('settings') }, t('settings')),
                ),
              )
            }
            return h('div', { className: 'dsh-link-empty' },
              h('div', { className: 'dsh-link-empty-icon' }, h(PanelIcon, { size: 52, active: false })),
              h('h3', { className: 'dsh-link-empty-title' }, t('select.title')),
              h('p', { className: 'dsh-link-empty-hint' }, t('select.hint')),
            )
          }
          if (selectedDevice === null || selectedSession === null) {
            return h('div', { className: 'dsh-link-empty' },
              h('h3', { className: 'dsh-link-empty-title' }, t('noPeersShort')),
              h('p', { className: 'dsh-link-empty-hint' }, t('select.hint')),
              h('div', { className: 'dsh-link-empty-actions' },
                h('button', { type: 'button', className: 'dsh-link-btn', onClick: () => setSelection(null) }, t('back')),
              ),
            )
          }
          return h(RemoteConversation, {
            key: `${selection.deviceId}:${selection.sessionId}`,
            ctx,
            t,
            device: selectedDevice,
            session: selectedSession,
            onBack: narrow ? () => setMobileView('list') : null,
            onRenamed: (sessionId, title) => onRenamed(selection.deviceId, sessionId, title),
          })
        }

        const connectionState = status !== null && status.connection !== null && typeof status.connection === 'object' && typeof status.connection.state === 'string'
          ? status.connection.state
          : 'unconfigured'
        const view = narrow ? mobileView : 'list'

        return h('div', { className: 'dsh-link-page', 'data-view': view },
          h('style', null, CSS),
          h('header', { className: 'dsh-link-header' },
            h('div', { className: 'dsh-link-header-brand' },
              h('span', { className: 'dsh-link-brand-mark' }, h(PanelIcon, { size: 22, active: true })),
              h('div', { className: 'dsh-link-header-titles' },
                h('h1', { className: 'dsh-link-header-title' }, t('title')),
                h('div', { className: 'dsh-link-header-sub' },
                  h('span', { className: cls('dsh-link-dot', connectionTone(connectionState)) }),
                  h('span', null, localDevice !== null && typeof localDevice.name === 'string' && localDevice.name !== '' ? localDevice.name : t('connection.unconfigured')),
                  h('span', null, '·'),
                  h('span', null, t(connectionKey(connectionState))),
                ),
              ),
            ),
            h('div', { className: 'dsh-link-header-meta' },
              configured && peers.length > 0
                ? h('span', { className: 'dsh-link-pill' }, t('remote.online', { n: peers.length }))
                : null,
              h('div', { className: 'dsh-link-header-actions' },
                h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon', onClick: refreshAll, 'aria-label': t('refresh'), title: t('refresh') }, h(RefreshGlyph)),
                h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon', onClick: () => setSheet('settings'), 'aria-label': t('settings'), title: t('settings') }, h(SettingsGlyph)),
              ),
            ),
          ),
          h('div', { className: 'dsh-link-body' },
            narrow && mobileView === 'chat' ? null : renderList(),
            narrow && mobileView === 'list' ? null : renderRight(),
          ),
          sheet === 'settings'
            ? h(Sheet, { t, title: t('settings.title'), wide: true, onClose: () => setSheet(null) },
                h(LinkSettingsPanel, {
                  ctx,
                  t,
                  variant: 'sheet',
                  onChanged: () => {
                    void loadStatus(true)
                  },
                }),
              )
            : null,
          sheet !== null && sheet !== 'settings' && typeof sheet === 'object' && sheet.type === 'new'
            ? h(Sheet, { t, title: t('newSession.title'), onClose: () => setSheet(null) },
                (() => {
                  const device = peers.find((peer) => peer.id === sheet.deviceId)
                  if (device === undefined) return h('p', { className: 'dsh-link-hint' }, t('noPeers'))
                  return h(NewSessionPanel, {
                    ctx,
                    t,
                    device,
                    onClose: () => setSheet(null),
                    onCreated: (sessionId) => onCreated(device.id, sessionId),
                  })
                })(),
              )
            : null,
        )
      }
    }

    /** Build the `settings.section` page component. */
    function createSettingsPage(ctx, t) {
      return function LinkSettingsPage() {
        useLocale(ctx)
        return h('div', { className: 'dsh-link-settings-page' },
          h('style', null, CSS),
          h(LinkSettingsPanel, { ctx, t, variant: 'page' }),
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: LOCALE_DICTS.zh,
          en: LOCALE_DICTS.en,
        }), 'dsh-link: locale dictionaries')

        const t = ctx.locale.bind(NS)
        const Workspace = createWorkspace(ctx, t)
        const SettingsPage = createSettingsPage(ctx, t)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-link',
          order: 20,
          label: () => t('panel'),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-link',
        }, Workspace))

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-link',
          order: 40,
          label: () => t('settings.nav'),
        }, SettingsPage))
      },
    }
  },
})
