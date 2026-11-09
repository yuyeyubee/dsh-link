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
        'browser.tabLocal': 'This computer',
        'browser.search': 'Search projects and sessions',
        'browser.clearSearch': 'Clear search',
        'browser.new': 'New session',
        'browser.newTitle': 'New session',
        'browser.newTarget': 'On {name}',
        'browser.project': 'Project',
        'browser.projectAuto': 'Current or most recent project',
        'browser.projectAutoRemote': 'Let the remote device choose',
        'browser.projectPlaceholder': 'Project name',
        'browser.sessionPlaceholder': 'Session title',
        'browser.renameSession': 'Rename session',
        'browser.renameWorkspace': 'Rename project',
        'browser.archive': 'Archive',
        'browser.unarchive': 'Unarchive',
        'browser.archived': 'Archived',
        'browser.showArchived': 'Show archived ({n})',
        'browser.hideArchived': 'Hide archived',
        'browser.copySessionId': 'Copy Session ID',
        'browser.copyWorkspaceId': 'Copy project ID',
        'browser.copied': 'Copied',
        'browser.copyFailed': 'Copy failed. Select the text and copy it manually.',
        'browser.more': 'More actions',
        'browser.newInProject': 'New session here',
        'browser.orphan': 'Ungrouped sessions',
        'browser.noProjects': 'No projects on this device yet.',
        'browser.noSessions': 'No sessions in this project.',
        'browser.noMatches': 'No projects or sessions match your search.',
        'browser.allArchived': 'All sessions are archived. Show archived sessions to open them.',
        'browser.loadFailed': 'Could not load this workspace',
        'browser.loading': 'Loading workspaces…',
        'browser.projectCount': '{n} sessions',
        'browser.archivedCount': '{n} archived',
        'browser.mirrorFailed': 'Could not mirror this remote session',
        'browser.openFailed': 'Could not open the session',
        'browser.createFailed': 'Could not create the session',
        'browser.renameFailed': 'Could not rename',
        'browser.archiveFailed': 'Could not archive the session',
        'browser.unarchiveFailed': 'Could not unarchive the session',
        'browser.titleRequired': 'Enter a title first.',
        'browser.unpaired': 'Not paired yet. You can browse this computer; pair in Settings to add remote computers.',
        'browser.emptyTitle': 'No workspaces yet',
        'browser.emptyHint': 'Create a session on this device to start a project, or open a project in DSH.',
        'browser.archivedDone': 'Session archived.',
        'browser.unarchivedDone': 'Session restored.',
        'browser.renameDone': 'Renamed.',
        'remoteSettings.title': 'Remote session settings',
        'remoteSettings.open': 'Remote session settings',
        'remoteSettings.loading': 'Reading the remote session…',
        'remoteSettings.loadFailed': 'Could not read the remote session settings',
        'remoteSettings.sessionTitle': 'Session title',
        'remoteSettings.rename': 'Rename',
        'remoteSettings.renamed': 'Title updated.',
        'remoteSettings.renameFailed': 'Could not rename the session',
        'remoteSettings.model': 'Model',
        'remoteSettings.reasoning': 'Reasoning effort',
        'remoteSettings.noReasoning': 'This model has no reasoning effort options.',
        'remoteSettings.applyModel': 'Apply model',
        'remoteSettings.modelSaved': 'Model settings updated.',
        'remoteSettings.modelFailed': 'Could not update the model',
        'remoteSettings.preset': 'Plugin / Agent preset',
        'remoteSettings.applyPreset': 'Apply preset',
        'remoteSettings.presetSaved': 'Preset updated.',
        'remoteSettings.presetFailed': 'Could not update the preset',
        'remoteSettings.defaultPreset': '(default)',
        'remoteSettings.archive': 'Archive this session',
        'remoteSettings.archived': 'Session archived.',
        'remoteSettings.archiveFailed': 'Could not archive the session',
        'remoteSettings.oldHost': 'The plugin on the other computer is too old. Update it there to use model and preset settings.',
        'remoteSettings.catalogFailed': 'Could not load the model catalog',
        'remoteSettings.presetsFailed': 'Could not load presets',
        'remoteSettings.noModels': 'No models available.',
        'remoteSettings.chooseModel': 'Choose a model…',
        'remoteSettings.choosePreset': 'Choose a preset…',
        'remoteSettings.noPresets': 'No presets available.',
        'remoteSettings.remoteId': 'Remote Session ID',
        'remoteSettings.localId': 'Local mirror Session ID',
        'mirror.badge': 'Remote',
        'mirror.header': 'Remote · {name}',
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
        'browser.tabLocal': '本机',
        'browser.search': '搜索项目或会话',
        'browser.clearSearch': '清除搜索',
        'browser.new': '新建会话',
        'browser.newTitle': '新建会话',
        'browser.newTarget': '在 {name} 上',
        'browser.project': '项目',
        'browser.projectAuto': '当前或最近的项目',
        'browser.projectAutoRemote': '由远程电脑决定',
        'browser.projectPlaceholder': '项目名称',
        'browser.sessionPlaceholder': '会话标题',
        'browser.renameSession': '重命名会话',
        'browser.renameWorkspace': '重命名项目',
        'browser.archive': '归档',
        'browser.unarchive': '取消归档',
        'browser.archived': '已归档',
        'browser.showArchived': '显示已归档（{n}）',
        'browser.hideArchived': '隐藏已归档',
        'browser.copySessionId': '复制 Session ID',
        'browser.copyWorkspaceId': '复制项目 ID',
        'browser.copied': '已复制',
        'browser.copyFailed': '复制失败，请手动选择文本复制。',
        'browser.more': '更多操作',
        'browser.newInProject': '在此项目新建会话',
        'browser.orphan': '未归入项目的会话',
        'browser.noProjects': '这台设备还没有项目。',
        'browser.noSessions': '这个项目还没有会话。',
        'browser.noMatches': '没有匹配的项目或会话。',
        'browser.allArchived': '所有会话都已归档。显示已归档会话后才能打开。',
        'browser.loadFailed': '无法加载这个工作区',
        'browser.loading': '正在加载工作区…',
        'browser.projectCount': '{n} 个会话',
        'browser.archivedCount': '{n} 个已归档',
        'browser.mirrorFailed': '无法镜像这个远程会话',
        'browser.openFailed': '无法打开会话',
        'browser.createFailed': '新建会话失败',
        'browser.renameFailed': '重命名失败',
        'browser.archiveFailed': '归档会话失败',
        'browser.unarchiveFailed': '取消归档失败',
        'browser.titleRequired': '请先输入标题。',
        'browser.unpaired': '尚未配对。你可以浏览本机；在设置中配对后可加入远程电脑。',
        'browser.emptyTitle': '还没有工作区',
        'browser.emptyHint': '在这台设备上新建会话即可开始一个项目，或在 DSH 中打开已有项目。',
        'browser.archivedDone': '会话已归档。',
        'browser.unarchivedDone': '会话已恢复。',
        'browser.renameDone': '已重命名。',
        'remoteSettings.title': '远程会话设置',
        'remoteSettings.open': '远程会话设置',
        'remoteSettings.loading': '正在读取远程会话…',
        'remoteSettings.loadFailed': '无法读取远程会话设置',
        'remoteSettings.sessionTitle': '会话标题',
        'remoteSettings.rename': '重命名',
        'remoteSettings.renamed': '标题已更新。',
        'remoteSettings.renameFailed': '重命名会话失败',
        'remoteSettings.model': '模型',
        'remoteSettings.reasoning': '思考强度',
        'remoteSettings.noReasoning': '这个模型没有思考强度选项。',
        'remoteSettings.applyModel': '应用模型',
        'remoteSettings.modelSaved': '模型设置已更新。',
        'remoteSettings.modelFailed': '更新模型失败',
        'remoteSettings.preset': '插件 / Agent 预设',
        'remoteSettings.applyPreset': '应用预设',
        'remoteSettings.presetSaved': '预设已更新。',
        'remoteSettings.presetFailed': '更新预设失败',
        'remoteSettings.defaultPreset': '（默认）',
        'remoteSettings.archive': '归档此会话',
        'remoteSettings.archived': '会话已归档。',
        'remoteSettings.archiveFailed': '归档会话失败',
        'remoteSettings.oldHost': '另一台电脑的插件版本过旧，请更新后再使用模型和预设设置。',
        'remoteSettings.catalogFailed': '读取模型目录失败',
        'remoteSettings.presetsFailed': '读取预设失败',
        'remoteSettings.noModels': '没有可用模型。',
        'remoteSettings.chooseModel': '选择模型…',
        'remoteSettings.choosePreset': '选择预设…',
        'remoteSettings.noPresets': '没有可用预设。',
        'remoteSettings.remoteId': '远程 Session ID',
        'remoteSettings.localId': '本地镜像 Session ID',
        'mirror.badge': '远程',
        'mirror.header': '远程 · {name}',
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

      .dsh-link-remote-chip { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 999px; border: .5px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); font-size: 10px; font-weight: 600; line-height: 1; letter-spacing: .02em; white-space: nowrap; flex: none; }
      .dsh-link-remote-chip.is-header { height: 22px; padding: 0 8px; font-size: 11px; font-weight: 500; }
      .dsh-link-remote-header { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
      .dsh-link-native-gear { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; flex: none; }
      .dsh-link-native-gear:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsh-link-native-gear:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      .dsh-link-native-gear.is-header { width: 26px; height: 26px; }
      .dsh-link-tabbar { flex: none; display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-bottom: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); }
      html[data-platform="darwin"] .dsh-link-tabbar { padding-top: calc(5px + var(--dsh-frame-top-clearance, 0px)); }
      .dsh-link-tablist { flex: 1; min-width: 0; display: flex; align-items: center; gap: 3px; overflow-x: auto; scrollbar-width: none; }
      .dsh-link-tablist::-webkit-scrollbar { display: none; }
      .dsh-link-tab { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 31px; padding: 0 12px; border: .5px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; max-width: 220px; }
      .dsh-link-tab:not(.is-active):hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsh-link-tab.is-active { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: inset 0 -2px 0 var(--dsw-alias-state-business-primary); }
      .dsh-link-tab:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
      .dsh-link-tab-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsh-link-tabbar-actions { flex: none; display: flex; align-items: center; gap: 5px; padding-left: 5px; }
      .dsh-link-tabs-body { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
      .dsh-link-browser { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
      .dsh-link-browser-toolbar { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: .5px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); flex-wrap: wrap; }
      .dsh-link-browser-search { flex: 1 1 260px; max-width: 380px; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary); }
      .dsh-link-browser-search:focus-within { border-color: var(--dsw-alias-state-business-primary); }
      .dsh-link-browser-search input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; }
      .dsh-link-browser-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dsh-link-browser-search-clear { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; flex: none; }
      .dsh-link-browser-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dsh-link-browser-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
      .dsh-link-browser-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 28px; }
      .dsh-link-browser-inner { max-width: 980px; margin: 0 auto; }
      .dsh-link-project { position: relative; margin-bottom: 8px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: visible; }
      .dsh-link-project-head { display: flex; align-items: center; gap: 2px; padding: 3px 6px; }
      .dsh-link-project-toggle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .dsh-link-project-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-link-project-toggle:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -1px; }
      .dsh-link-project-chevron { display: inline-flex; color: var(--dsw-alias-label-tertiary); flex: none; transition: transform .16s ease; }
      .dsh-link-project-chevron.is-open { transform: rotate(90deg); }
      .dsh-link-project-folder { display: inline-flex; color: var(--dsw-alias-label-secondary); flex: none; }
      .dsh-link-project-info { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 1px; }
      .dsh-link-project-title { font-size: 13px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-project-path { font-size: 11.5px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-project-count { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
      .dsh-link-project-actions { flex: none; display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity .12s; }
      .dsh-link-project-head:hover .dsh-link-project-actions, .dsh-link-project-head:focus-within .dsh-link-project-actions, .dsh-link-project-actions.is-open { opacity: 1; }
      .dsh-link-project-sessions { border-top: .5px solid var(--dsw-alias-border-l3); }
      .dsh-link-project-note { margin: 0; padding: 10px 12px 12px 32px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-browser-session { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px 8px 7px 30px; border-top: .5px solid var(--dsw-alias-border-l3); cursor: pointer; color: var(--dsw-alias-label-primary); }
      .dsh-link-browser-session:first-child { border-top: 0; }
      .dsh-link-browser-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-link-browser-session:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
      .dsh-link-browser-session.is-archived { opacity: .64; }
      .dsh-link-browser-session.is-busy { opacity: .7; cursor: progress; }
      .dsh-link-browser-session-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .dsh-link-browser-session-title { font-size: 12.5px; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-browser-session-meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-browser-session-meta span { overflow: hidden; text-overflow: ellipsis; }
      .dsh-link-browser-session-badges { display: flex; align-items: center; gap: 4px; flex: none; }
      .dsh-link-browser-session-actions { flex: none; display: flex; align-items: center; gap: 1px; opacity: 0; transition: opacity .12s; }
      .dsh-link-browser-session:hover .dsh-link-browser-session-actions, .dsh-link-browser-session:focus-within .dsh-link-browser-session-actions, .dsh-link-browser-session-actions.is-open { opacity: 1; }
      .dsh-link-browser-menu { position: absolute; top: calc(100% - 2px); right: 8px; z-index: 60; display: flex; flex-direction: column; min-width: 190px; padding: 4px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0, 0, 0, .22)); }
      .dsh-link-browser-menu.is-project { top: 32px; right: 34px; }
      .dsh-link-browser-menu-item { display: flex; align-items: center; gap: 7px; width: 100%; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; text-align: left; white-space: nowrap; cursor: pointer; }
      .dsh-link-browser-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dsh-link-browser-menu-item.is-danger { color: var(--dsw-alias-state-error-primary); }
      .dsh-link-browser-menu-sep { height: .5px; margin: 3px 6px; background: var(--dsw-alias-border-l3); }
      .dsh-link-browser-empty { flex: 1; min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 40px 20px; text-align: center; color: var(--dsw-alias-label-tertiary); }
      .dsh-link-browser-empty-icon { display: inline-flex; color: var(--dsw-alias-label-tertiary); margin-bottom: 2px; }
      .dsh-link-browser-empty-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
      .dsh-link-browser-empty-hint { margin: 0; max-width: 440px; font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
      .dsh-link-browser-empty-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
      .dsh-link-toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 1300; max-width: min(520px, calc(100% - 32px)); padding: 9px 14px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0, 0, 0, .22)); font-size: 12.5px; line-height: 1.5; }
      .dsh-link-toast.is-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .dsh-link-toast.is-ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
      .dsh-link-remote-panel { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .dsh-link-remote-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      @media (hover: none) {
        .dsh-link-project-actions, .dsh-link-browser-session-actions { opacity: 1; }
      }
      @media (max-width: 700px) {
        .dsh-link-tabbar { padding-left: 8px; padding-right: 8px; }
        .dsh-link-browser-toolbar { padding: 9px 10px; }
        .dsh-link-browser-search { flex-basis: 100%; max-width: none; }
        .dsh-link-browser-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
        .dsh-link-browser-scroll { padding: 10px 10px 24px; }
        .dsh-link-browser-session { padding-left: 14px; }
        .dsh-link-project-note { padding-left: 14px; }
        .dsh-link-browser-menu { right: 4px; }
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
      async tree(deviceId) {
        const payload = await postOperation({
          op: 'tree',
          ...(typeof deviceId === 'string' && deviceId !== '' ? { deviceId } : {}),
        })
        return payload.tree
      },
      async ensureMirror(deviceId, sessionId) {
        return postOperation({ op: 'ensureMirror', deviceId, sessionId })
      },
      async createRemote(deviceId, workspaceId, cwd) {
        return postOperation({
          op: 'create',
          deviceId,
          ...(typeof workspaceId === 'string' && workspaceId !== '' ? { workspaceId } : {}),
          ...(typeof cwd === 'string' && cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
        })
      },
      async archive(deviceId, sessionId, archived) {
        return postOperation({
          op: 'archive',
          ...(typeof deviceId === 'string' && deviceId !== '' ? { deviceId } : {}),
          sessionId,
          archived: archived === true,
        })
      },
      async renameWorkspace(deviceId, workspaceId, title) {
        return postOperation({ op: 'renameWorkspace', deviceId, workspaceId, title })
      },
      async localRenameSession(sessionId, title) {
        return postOperation({ op: 'localRenameSession', sessionId, title })
      },
      async localRenameWorkspace(workspaceId, title) {
        return postOperation({ op: 'localRenameWorkspace', workspaceId, title })
      },
      async models(deviceId) {
        return postOperation({ op: 'models', deviceId })
      },
      async selectModel(deviceId, sessionId, selection) {
        return postOperation({ op: 'selectModel', deviceId, sessionId, selection })
      },
      async sessionInfo(deviceId, sessionId) {
        return postOperation({ op: 'sessionInfo', deviceId, sessionId })
      },
      async presets(deviceId) {
        return postOperation({ op: 'presets', deviceId })
      },
      async selectPreset(deviceId, sessionId, agentPreset) {
        return postOperation({ op: 'selectPreset', deviceId, sessionId, agentPreset })
      },
      async mirrors() {
        const payload = await postOperation({ op: 'mirrors' })
        return Array.isArray(payload.items) ? payload.items.filter((item) => item !== null && typeof item === 'object' && typeof item.localSessionId === 'string') : []
      },
      async watch(sessionId) {
        return postOperation({ op: 'watch', sessionId })
      },
      async unwatch(sessionId) {
        return postOperation({ op: 'unwatch', sessionId })
      },
    }

    /** Shared mirror index for sidebar and conversation decorations. */
    const mirrorStore = { items: [], at: 0, loading: null, listeners: new Set() }
    function notifyMirrors() {
      for (const listener of mirrorStore.listeners) listener()
    }
    function refreshMirrors(force = false) {
      if (mirrorStore.loading !== null) return mirrorStore.loading
      if (!force && Date.now() - mirrorStore.at < 8000) return Promise.resolve()
      mirrorStore.loading = api.mirrors().then((items) => {
        mirrorStore.items = items
        mirrorStore.at = Date.now()
        notifyMirrors()
        return items
      }).catch(() => []).finally(() => {
        mirrorStore.loading = null
      })
      return mirrorStore.loading
    }
    /** Subscribe one component to the shared mirror index. */
    function useMirrorItem(sessionId) {
      const [version, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        mirrorStore.listeners.add(listener)
        void refreshMirrors()
        return () => {
          mirrorStore.listeners.delete(listener)
        }
      }, [])
      void version
      return mirrorStore.items.find((item) => item.localSessionId === sessionId)
    }

    /** Shared open/closed state for the remote-session settings modal. */
    const remoteSettingsStore = { target: null, listeners: new Set() }

    function openRemoteSettings(mirror) {
      if (mirror === null || typeof mirror !== 'object') return
      remoteSettingsStore.target = {
        deviceId: typeof mirror.deviceId === 'string' ? mirror.deviceId : '',
        deviceName: typeof mirror.deviceName === 'string' ? mirror.deviceName : '',
        remoteSessionId: typeof mirror.remoteSessionId === 'string' ? mirror.remoteSessionId : '',
        localSessionId: typeof mirror.localSessionId === 'string' ? mirror.localSessionId : '',
        title: typeof mirror.title === 'string' ? mirror.title : '',
      }
      for (const listener of remoteSettingsStore.listeners) listener()
    }

    function closeRemoteSettings() {
      remoteSettingsStore.target = null
      for (const listener of remoteSettingsStore.listeners) listener()
    }

    function useRemoteSettingsTarget() {
      const [version, bump] = React.useState(0)
      React.useEffect(() => {
        const listener = () => bump((value) => value + 1)
        remoteSettingsStore.listeners.add(listener)
        return () => {
          remoteSettingsStore.listeners.delete(listener)
        }
      }, [])
      void version
      return remoteSettingsStore.target
    }

    /** Sidebar trailing badge for a mirrored remote Session. */
    function createRemoteBadge(t) {
      return function RemoteSessionBadge({ sessionId }) {
        const mirror = useMirrorItem(sessionId)
        if (mirror === undefined) return null
        return React.createElement('span', {
          className: 'dsh-link-remote-chip',
          title: `${mirror.deviceName ?? ''}`,
        }, t('mirror.badge'))
      }
    }

    /** Conversation header chip plus the remote-settings gear; also owns live watch. */
    function createRemoteHeaderBadge(t) {
      return function RemoteSessionHeaderBadge({ sessionId }) {
        const mirror = useMirrorItem(sessionId)
        React.useEffect(() => {
          if (mirror === undefined) return undefined
          void api.watch(sessionId).catch(() => {})
          return () => {
            void api.unwatch(sessionId).catch(() => {})
          }
        }, [sessionId, mirror === undefined])
        if (mirror === undefined) return null
        return React.createElement(React.Fragment, null,
          React.createElement('span', {
            className: 'dsh-link-remote-chip is-header',
            title: mirror.deviceName ?? '',
          }, t('mirror.header', { name: mirror.deviceName ?? '' })),
          React.createElement('button', {
            type: 'button',
            className: 'dsh-link-native-gear is-header',
            title: t('remoteSettings.open'),
            'aria-label': t('remoteSettings.open'),
            onClick: (event) => {
              event.stopPropagation()
              openRemoteSettings({ ...mirror, localSessionId: sessionId })
            },
            onPointerDown: (event) => event.stopPropagation(),
          }, React.createElement(SettingsGlyph, { size: 14 })),
        )
      }
    }

    /** Hover gear on a mirrored native sidebar row. */
    function createRemoteSettingsRowAction(t) {
      return function RemoteSettingsRowAction({ sessionId }) {
        const mirror = useMirrorItem(sessionId)
        if (mirror === undefined) return null
        return React.createElement('button', {
          type: 'button',
          className: 'dsh-link-native-gear',
          title: t('remoteSettings.open'),
          'aria-label': t('remoteSettings.open'),
          onClick: (event) => {
            event.stopPropagation()
            openRemoteSettings({ ...mirror, localSessionId: sessionId })
          },
          onPointerDown: (event) => event.stopPropagation(),
        }, React.createElement(SettingsGlyph, { size: 13 }))
      }
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

    /** Normalize one workspace tree (local or remote) into the shape the browser renders. */
    function normalizeTree(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      const sessionOf = (item) => {
        if (item === null || typeof item !== 'object' || typeof item.sessionId !== 'string' || item.sessionId === '') return null
        return {
          sessionId: item.sessionId,
          title: typeof item.title === 'string' ? item.title : '',
          cwd: typeof item.cwd === 'string' ? item.cwd : '',
          updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
          running: item.running === true,
          active: item.active === true,
          agentAvailable: item.agentAvailable !== false,
          blank: item.blank === true,
          parentSessionId: typeof item.parentSessionId === 'string' ? item.parentSessionId : null,
          workspaceId: typeof item.workspaceId === 'string' ? item.workspaceId : '',
          localSessionId: typeof item.localSessionId === 'string' ? item.localSessionId : '',
        }
      }
      const workspaces = Array.isArray(source.workspaces)
        ? source.workspaces
          .filter((workspace) => workspace !== null && typeof workspace === 'object' && typeof workspace.workspaceId === 'string' && workspace.workspaceId !== '')
          .map((workspace) => ({
            workspaceId: workspace.workspaceId,
            title: typeof workspace.title === 'string' ? workspace.title : '',
            path: typeof workspace.path === 'string' ? workspace.path : '',
            localWorkspaceId: typeof workspace.localWorkspaceId === 'string' ? workspace.localWorkspaceId : '',
            sessions: Array.isArray(workspace.sessions) ? workspace.sessions.map(sessionOf).filter((item) => item !== null) : [],
          }))
        : []
      const orphanSessions = Array.isArray(source.orphanSessions) ? source.orphanSessions.map(sessionOf).filter((item) => item !== null) : []
      const ids = (list) => Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item !== '') : []
      return {
        workspaces,
        orphanSessions,
        archivedSessionIds: ids(source.archivedSessionIds),
        pinnedSessionIds: ids(source.pinnedSessionIds),
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

    /** Folder glyph for workspace project rows. */
    function FolderGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('path', { d: 'M1.8 4.2c0-.7.6-1.3 1.3-1.3h3l1.5 1.6h5.3c.7 0 1.3.6 1.3 1.3v6.3c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.2Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
      )
    }

    /** Three-dot overflow glyph. */
    function MoreGlyph({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false', style: { display: 'block' } },
        h('circle', { cx: 3.4, cy: 8, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 8, cy: 8, r: 1.1, fill: 'currentColor' }),
        h('circle', { cx: 12.6, cy: 8, r: 1.1, fill: 'currentColor' }),
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
    /* Remote session settings                                                */
    /* --------------------------------------------------------------------- */

    /** Whether a failed remote call looks like an older Host without the method. */
    function isUnknownMethodError(error) {
      const text = errorText(error)
      return /未知方法|unknown method|unknown-method|method not found|not implemented/iu.test(text)
    }

    /** Remote Session settings: title, model, reasoning effort, preset and archive. */
    function RemoteSettingsPanel({ ctx, t, target }) {
      const [phase, setPhase] = React.useState('loading')
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [session, setSession] = React.useState(null)
      const [catalog, setCatalog] = React.useState(null)
      const [presetRoster, setPresetRoster] = React.useState([])
      const [catalogError, setCatalogError] = React.useState('')
      const [presetError, setPresetError] = React.useState('')
      const [title, setTitle] = React.useState(target.title || '')
      const [selection, setSelection] = React.useState({ provider: '', model: '', reasoningEffort: '' })
      const [preset, setPreset] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [reloadKey, setReloadKey] = React.useState(0)
      const aliveRef = React.useRef(true)
      const noticeTimer = React.useRef(null)

      React.useEffect(() => () => {
        aliveRef.current = false
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
      }, [])

      const showNotice = React.useCallback((text) => {
        setNotice(text)
        setError('')
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = window.setTimeout(() => {
          noticeTimer.current = null
          if (aliveRef.current) setNotice('')
        }, 4000)
      }, [])

      React.useEffect(() => {
        let cancelled = false
        setPhase('loading')
        setError('')
        setNotice('')
        setCatalogError('')
        setPresetError('')
        const load = async () => {
          let info
          try {
            info = await api.sessionInfo(target.deviceId, target.remoteSessionId)
          } catch (failure) {
            if (cancelled) return
            setError(errorText(failure))
            setPhase('error')
            return
          }
          if (cancelled) return
          const value = info !== null && typeof info === 'object' && info.session !== null && typeof info.session === 'object' ? info.session : null
          setSession(value)
          const initialTitle = value !== null && typeof value.title === 'string' && value.title !== '' ? value.title : (target.title || '')
          setTitle(initialTitle)
          const current = value !== null && value.modelSelection !== null && typeof value.modelSelection === 'object' ? value.modelSelection : null
          setSelection({
            provider: current !== null && typeof current.provider === 'string' ? current.provider : '',
            model: current !== null && typeof current.model === 'string' ? current.model : '',
            reasoningEffort: current !== null && typeof current.reasoningEffort === 'string' ? current.reasoningEffort : '',
          })
          setPreset(value !== null && typeof value.agentPreset === 'string' ? value.agentPreset : '')
          setPhase('ready')

          const [modelsResult, presetsResult] = await Promise.allSettled([
            api.models(target.deviceId),
            api.presets(target.deviceId),
          ])
          if (cancelled) return
          if (modelsResult.status === 'fulfilled') {
            const payload = modelsResult.value
            setCatalog(payload !== null && typeof payload === 'object' && payload.catalog !== null && typeof payload.catalog === 'object' ? payload.catalog : null)
            setCatalogError('')
          } else {
            setCatalog(null)
            setCatalogError(errorText(modelsResult.reason))
          }
          if (presetsResult.status === 'fulfilled') {
            const payload = presetsResult.value
            const roster = payload !== null && typeof payload === 'object' && payload.roster !== null && typeof payload.roster === 'object' ? payload.roster : null
            setPresetRoster(roster !== null && Array.isArray(roster.presets) ? roster.presets.filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string') : [])
            setPresetError('')
          } else {
            setPresetRoster([])
            setPresetError(errorText(presetsResult.reason))
          }
        }
        void load()
        return () => {
          cancelled = true
        }
      }, [target.deviceId, target.remoteSessionId, reloadKey])

      const modelEntries = []
      const groups = catalog !== null && Array.isArray(catalog.groups) ? catalog.groups : []
      for (const group of groups) {
        if (group === null || typeof group !== 'object' || typeof group.id !== 'string') continue
        const models = Array.isArray(group.models) ? group.models : []
        for (const model of models) {
          if (model === null || typeof model !== 'object' || typeof model.id !== 'string') continue
          const reasoning = model.reasoning !== null && typeof model.reasoning === 'object' ? model.reasoning : null
          const efforts = reasoning !== null && Array.isArray(reasoning.efforts)
            ? reasoning.efforts.filter((effort) => effort !== null && typeof effort === 'object' && typeof effort.id === 'string')
            : []
          modelEntries.push({
            provider: group.id,
            providerName: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
            model: model.id,
            modelName: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
            efforts,
            defaultEffort: reasoning !== null && typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : '',
          })
        }
      }
      if (selection.provider !== '' && selection.model !== '' && !modelEntries.some((entry) => entry.provider === selection.provider && entry.model === selection.model)) {
        modelEntries.unshift({
          provider: selection.provider,
          providerName: selection.provider,
          model: selection.model,
          modelName: selection.model,
          efforts: [],
          defaultEffort: '',
        })
      }
      const selectedModel = modelEntries.find((entry) => entry.provider === selection.provider && entry.model === selection.model) ?? null
      const effortOptions = selectedModel === null ? [] : selectedModel.efforts
      const presetList = presetRoster.slice().sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
      if (preset !== '' && !presetList.some((item) => item.id === preset)) presetList.unshift({ id: preset, isDefault: false })
      const oldHost = isUnknownMethodError(catalogError) || isUnknownMethodError(presetError) || (phase === 'error' && isUnknownMethodError(error))

      React.useEffect(() => {
        if (phase !== 'ready') return
        const entry = modelEntries.find((item) => item.provider === selection.provider && item.model === selection.model)
        if (entry === undefined) return
        if (entry.efforts.length === 0) {
          if (selection.reasoningEffort !== '') setSelection((previous) => ({ ...previous, reasoningEffort: '' }))
          return
        }
        if (entry.efforts.some((effort) => effort.id === selection.reasoningEffort)) return
        const fallback = entry.defaultEffort !== '' && entry.efforts.some((effort) => effort.id === entry.defaultEffort)
          ? entry.defaultEffort
          : entry.efforts[0].id
        setSelection((previous) => previous.reasoningEffort === fallback ? previous : { ...previous, reasoningEffort: fallback })
      }, [phase, catalog, selection.provider, selection.model, selection.reasoningEffort])

      const renameSession = async () => {
        const next = title.trim()
        if (next === '') {
          setError(t('browser.titleRequired'))
          return
        }
        if (busy !== '') return
        setBusy('rename')
        setError('')
        try {
          await api.rename(target.deviceId, target.remoteSessionId, next)
          if (!aliveRef.current) return
          setTitle(next)
          setSession((previous) => previous === null ? previous : { ...previous, title: next })
          showNotice(t('remoteSettings.renamed'))
          void refreshMirrors(true)
        } catch (failure) {
          if (aliveRef.current) setError(`${t('remoteSettings.renameFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setBusy('')
        }
      }

      const applyModel = async () => {
        if (selection.provider === '' || selection.model === '') {
          setError(modelEntries.length === 0 ? t('remoteSettings.noModels') : t('remoteSettings.chooseModel'))
          return
        }
        if (busy !== '') return
        setBusy('model')
        setError('')
        const next = {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort !== '' && effortOptions.length > 0 ? { reasoningEffort: selection.reasoningEffort } : {}),
        }
        try {
          await api.selectModel(target.deviceId, target.remoteSessionId, next)
          if (!aliveRef.current) return
          setSelection({
            provider: next.provider,
            model: next.model,
            reasoningEffort: typeof next.reasoningEffort === 'string' ? next.reasoningEffort : '',
          })
          setSession((previous) => previous === null ? previous : { ...previous, modelSelection: next })
          showNotice(t('remoteSettings.modelSaved'))
        } catch (failure) {
          if (aliveRef.current) setError(`${t('remoteSettings.modelFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setBusy('')
        }
      }

      const applyPreset = async () => {
        if (preset === '') {
          setError(presetList.length === 0 ? t('remoteSettings.noPresets') : t('remoteSettings.noPresets'))
          return
        }
        if (busy !== '') return
        setBusy('preset')
        setError('')
        try {
          await api.selectPreset(target.deviceId, target.remoteSessionId, preset)
          if (!aliveRef.current) return
          setSession((previous) => previous === null ? previous : { ...previous, agentPreset: preset })
          showNotice(t('remoteSettings.presetSaved'))
        } catch (failure) {
          if (aliveRef.current) setError(`${t('remoteSettings.presetFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setBusy('')
        }
      }

      const archiveSession = async () => {
        if (busy !== '') return
        setBusy('archive')
        setError('')
        try {
          await api.archive(target.deviceId, target.remoteSessionId, true)
          if (!aliveRef.current) return
          showNotice(t('remoteSettings.archived'))
          void refreshMirrors(true)
        } catch (failure) {
          if (aliveRef.current) setError(`${t('remoteSettings.archiveFailed')}: ${errorText(failure)}`)
        } finally {
          if (aliveRef.current) setBusy('')
        }
      }

      const currentModelValue = selection.provider !== '' && selection.model !== '' ? JSON.stringify([selection.provider, selection.model]) : ''

      const children = []
      if (phase === 'loading') {
        children.push(h('p', { className: 'dsh-link-hint', key: 'loading' }, t('remoteSettings.loading')))
      } else if (phase === 'error') {
        children.push(h('div', { className: 'dsh-link-banner is-error', role: 'alert', key: 'loadError' },
          h('span', null, error !== '' ? `${t('remoteSettings.loadFailed')}: ${error}` : t('remoteSettings.loadFailed')),
          h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => setReloadKey((value) => value + 1) }, t('retry')),
        ))
        if (isUnknownMethodError(error)) children.push(h('p', { className: 'dsh-link-hint', key: 'oldHost' }, t('remoteSettings.oldHost')))
      } else {
        children.push(h('div', { className: 'dsh-link-card', key: 'meta' },
          h('h3', { className: 'dsh-link-card-title' }, target.deviceName !== '' ? target.deviceName : target.deviceId),
          h('div', { className: 'dsh-link-rows' },
            h('div', { className: 'dsh-link-row' },
              h('span', { className: 'dsh-link-row-key' }, t('remoteSettings.remoteId')),
              h('span', { className: 'dsh-link-row-value is-mono' }, target.remoteSessionId),
            ),
            target.localSessionId !== '' ? h('div', { className: 'dsh-link-row' },
              h('span', { className: 'dsh-link-row-key' }, t('remoteSettings.localId')),
              h('span', { className: 'dsh-link-row-value is-mono' }, target.localSessionId),
            ) : null,
            session !== null && typeof session.modelSelection === 'object' && session.modelSelection !== null
              ? h('div', { className: 'dsh-link-row' },
                  h('span', { className: 'dsh-link-row-key' }, t('remoteSettings.model')),
                  h('span', { className: 'dsh-link-row-value' }, `${session.modelSelection.provider ?? ''} / ${session.modelSelection.model ?? ''}${session.modelSelection.reasoningEffort ? ` · ${session.modelSelection.reasoningEffort}` : ''}`),
                )
              : null,
          ),
        ))

        children.push(h('div', { className: 'dsh-link-card', key: 'title' },
          h('h3', { className: 'dsh-link-card-title' }, t('remoteSettings.sessionTitle')),
          h('div', { className: 'dsh-link-form' },
            h('input', {
              className: 'dsh-link-input',
              value: title,
              placeholder: t('browser.sessionPlaceholder'),
              spellCheck: false,
              onChange: (event) => setTitle(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void renameSession()
                }
              },
            }),
            h('div', { className: 'dsh-link-form-actions' },
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: busy !== '', onClick: () => void renameSession() }, busy === 'rename' ? t('saving') : t('remoteSettings.rename')),
            ),
          ),
        ))

        if (catalogError !== '') {
          children.push(h('div', { className: 'dsh-link-banner is-error', role: 'alert', key: 'catalogError' }, `${t('remoteSettings.catalogFailed')}: ${catalogError}`))
        }
        if (presetError !== '') {
          children.push(h('div', { className: 'dsh-link-banner is-error', role: 'alert', key: 'presetError' }, `${t('remoteSettings.presetsFailed')}: ${presetError}`))
        }
        if (oldHost) {
          children.push(h('p', { className: 'dsh-link-hint', key: 'oldHostHint' }, t('remoteSettings.oldHost')))
        }

        children.push(h('div', { className: 'dsh-link-card', key: 'model' },
          h('h3', { className: 'dsh-link-card-title' }, t('remoteSettings.model')),
          h('div', { className: 'dsh-link-form' },
            modelEntries.length === 0
              ? h('p', { className: 'dsh-link-hint' }, t('remoteSettings.noModels'))
              : h('div', { className: 'dsh-link-field' },
                  h('label', { className: 'dsh-link-field-label', htmlFor: 'dsh-link-remote-model' }, t('remoteSettings.model')),
                  h('select', {
                    id: 'dsh-link-remote-model',
                    className: 'dsh-link-select',
                    value: currentModelValue,
                    onChange: (event) => {
                      let next
                      try {
                        next = JSON.parse(event.target.value)
                      } catch {
                        return
                      }
                      if (!Array.isArray(next) || next.length !== 2) return
                      const entry = modelEntries.find((item) => item.provider === next[0] && item.model === next[1])
                      const effort = entry !== null && entry !== undefined && entry.efforts.some((item) => item.id === selection.reasoningEffort)
                        ? selection.reasoningEffort
                        : (entry !== null && entry !== undefined ? (entry.defaultEffort || (entry.efforts[0] !== undefined ? entry.efforts[0].id : '')) : '')
                      setSelection({ provider: String(next[0]), model: String(next[1]), reasoningEffort: effort })
                    },
                  },
                    selectedModel === null ? h('option', { value: '' }, t('remoteSettings.chooseModel')) : null,
                    ...groups.map((group) => h('optgroup', { key: group.id, label: typeof group.name === 'string' && group.name !== '' ? group.name : group.id },
                      ...(Array.isArray(group.models) ? group.models : [])
                        .filter((model) => model !== null && typeof model === 'object' && typeof model.id === 'string')
                        .map((model) => h('option', { key: `${group.id}:${model.id}`, value: JSON.stringify([group.id, model.id]) },
                          typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
                        )),
                    )),
                  ),
                ),
            effortOptions.length === 0
              ? h('p', { className: 'dsh-link-hint' }, t('remoteSettings.noReasoning'))
              : h('div', { className: 'dsh-link-field' },
                  h('label', { className: 'dsh-link-field-label', htmlFor: 'dsh-link-remote-effort' }, t('remoteSettings.reasoning')),
                  h('select', {
                    id: 'dsh-link-remote-effort',
                    className: 'dsh-link-select',
                    value: selection.reasoningEffort,
                    onChange: (event) => setSelection((previous) => ({ ...previous, reasoningEffort: event.target.value })),
                  },
                    ...effortOptions.map((effort) => h('option', { key: effort.id, value: effort.id, title: typeof effort.description === 'string' ? effort.description : undefined }, typeof effort.name === 'string' && effort.name !== '' ? effort.name : effort.id)),
                  ),
                ),
            h('div', { className: 'dsh-link-form-actions' },
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: busy !== '' || modelEntries.length === 0 || selection.provider === '' || selection.model === '', onClick: () => void applyModel() }, busy === 'model' ? t('saving') : t('remoteSettings.applyModel')),
            ),
          ),
        ))

        children.push(h('div', { className: 'dsh-link-card', key: 'preset' },
          h('h3', { className: 'dsh-link-card-title' }, t('remoteSettings.preset')),
          h('div', { className: 'dsh-link-form' },
            presetList.length === 0
              ? h('p', { className: 'dsh-link-hint' }, t('remoteSettings.noPresets'))
              : h('div', { className: 'dsh-link-field' },
                  h('label', { className: 'dsh-link-field-label', htmlFor: 'dsh-link-remote-preset' }, t('remoteSettings.preset')),
                  h('select', {
                    id: 'dsh-link-remote-preset',
                    className: 'dsh-link-select',
                    value: preset,
                    onChange: (event) => setPreset(event.target.value),
                  },
                    preset === '' ? h('option', { value: '' }, t('remoteSettings.choosePreset')) : null,
                    ...presetList.map((item) => h('option', { key: item.id, value: item.id },
                      `${item.id}${item.isDefault === true ? ` ${t('remoteSettings.defaultPreset')}` : ''}`,
                    )),
                  ),
                ),
            h('div', { className: 'dsh-link-form-actions' },
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: busy !== '' || presetList.length === 0 || preset === '', onClick: () => void applyPreset() }, busy === 'preset' ? t('saving') : t('remoteSettings.applyPreset')),
            ),
          ),
        ))

        children.push(h('div', { className: 'dsh-link-form-actions', key: 'archive' },
          h('button', { type: 'button', className: 'dsh-link-btn is-danger', disabled: busy !== '', onClick: () => void archiveSession() }, busy === 'archive' ? t('saving') : t('remoteSettings.archive')),
        ))
      }

      return h('div', { className: 'dsh-link-remote-panel' },
        error !== '' && phase !== 'error' ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, error) : null,
        notice !== '' ? h('div', { className: 'dsh-link-banner is-ok', role: 'status' }, notice) : null,
        ...children,
      )
    }

    /** Shell overlay registration for the remote-session settings modal. */
    function RemoteSettingsOverlay({ ctx, t }) {
      useLocale(ctx)
      const target = useRemoteSettingsTarget()
      if (target === null) return null
      return h(React.Fragment, null,
        h('style', null, CSS),
        h(Sheet, {
          t,
          title: t('remoteSettings.title'),
          wide: true,
          onClose: closeRemoteSettings,
        },
          h(RemoteSettingsPanel, {
            key: `${target.deviceId}:${target.remoteSessionId}`,
            ctx,
            t,
            target,
          }),
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
    /** Rename form shared by session and project rows. */
    function RenameDialogContent({ t, initialValue, description, label, placeholder, saving, error, onCancel, onSubmit }) {
      const [value, setValue] = React.useState(initialValue || '')
      const inputId = React.useId()
      const submit = () => {
        if (saving) return
        onSubmit(value)
      }
      return h('div', { className: 'dsh-link-form' },
        description !== undefined && description !== '' ? h('p', { className: 'dsh-link-hint' }, description) : null,
        h('div', { className: 'dsh-link-field' },
          h('label', { className: 'dsh-link-field-label', htmlFor: inputId }, label || t('browser.sessionPlaceholder')),
          h('input', {
            id: inputId,
            className: 'dsh-link-input',
            value,
            placeholder: placeholder || t('browser.sessionPlaceholder'),
            spellCheck: false,
            autoFocus: true,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            },
          }),
        ),
        error !== '' ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-link-form-actions' },
          h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: saving, onClick: submit }, saving ? t('saving') : t('save')),
          h('button', { type: 'button', className: 'dsh-link-btn', disabled: saving, onClick: onCancel }, t('cancel')),
        ),
      )
    }

    /** New-session form: local startSession or remote create + mirror + open. */
    function CreateSessionDialogContent({ t, tab, tree, initialWorkspaceId, saving, error, onCancel, onSubmit }) {
      const workspaces = tree !== null && tree !== undefined && Array.isArray(tree.workspaces) ? tree.workspaces : []
      const initial = typeof initialWorkspaceId === 'string' && workspaces.some((workspace) => workspace.workspaceId === initialWorkspaceId) ? initialWorkspaceId : ''
      const [workspaceId, setWorkspaceId] = React.useState(initial)
      const [cwd, setCwd] = React.useState('')
      const selectId = React.useId()
      const cwdId = React.useId()
      const local = tab.key === 'local'
      const submit = () => {
        if (saving) return
        onSubmit({ workspaceId, cwd })
      }
      return h('div', { className: 'dsh-link-form' },
        h('p', { className: 'dsh-link-hint' }, t('browser.newTarget', { name: tab.label })),
        h('div', { className: 'dsh-link-field' },
          h('label', { className: 'dsh-link-field-label', htmlFor: selectId }, t('browser.project')),
          h('select', {
            id: selectId,
            className: 'dsh-link-select',
            value: workspaceId,
            onChange: (event) => setWorkspaceId(event.target.value),
          },
            h('option', { value: '' }, local ? t('browser.projectAuto') : t('browser.projectAutoRemote')),
            ...workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId },
              `${workspace.title !== '' ? workspace.title : t('browser.project')}${workspace.path !== '' ? ` — ${workspace.path}` : ''}`,
            )),
          ),
        ),
        local
          ? null
          : h('div', { className: 'dsh-link-field' },
              h('label', { className: 'dsh-link-field-label', htmlFor: cwdId }, t('cwd.label')),
              h('input', {
                id: cwdId,
                className: 'dsh-link-input',
                value: cwd,
                placeholder: t('cwd.placeholder'),
                spellCheck: false,
                onChange: (event) => setCwd(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submit()
                  }
                },
              }),
            ),
        error !== '' ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-link-form-actions' },
          h('button', { type: 'button', className: 'dsh-link-btn is-primary', disabled: saving, onClick: submit }, saving ? t('creating') : t('create')),
          h('button', { type: 'button', className: 'dsh-link-btn', disabled: saving, onClick: onCancel }, t('cancel')),
        ),
      )
    }

    /**
     * Build the main-panel component: one browser-like tab per computer, each
     * showing that device's Workspace/Session tree. Clicking a session opens the
     * native DSH conversation; remote sessions are mirrored on demand first.
     */
    function createWorkspace(ctx, t) {
      return function LinkWorkspace() {
        useLocale(ctx)
        const [status, setStatus] = React.useState(null)
        const [statusPhase, setStatusPhase] = React.useState('loading')
        const [statusError, setStatusError] = React.useState('')
        const [activeKey, setActiveKey] = React.useState('local')
        const [trees, setTrees] = React.useState({})
        const [search, setSearch] = React.useState('')
        const [showArchived, setShowArchived] = React.useState(false)
        const [collapsed, setCollapsed] = React.useState({})
        const [menu, setMenu] = React.useState(null)
        const [dialog, setDialog] = React.useState(null)
        const [toast, setToast] = React.useState(null)
        const [busy, setBusy] = React.useState('')
        const statusRef = React.useRef(null)
        const statusSeq = React.useRef(0)
        const treeSeq = React.useRef(new Map())
        const treesRef = React.useRef({})
        const aliveRef = React.useRef(true)
        const menuRef = React.useRef(null)
        const toastTimer = React.useRef(null)

        statusRef.current = status
        treesRef.current = trees

        React.useEffect(() => () => {
          aliveRef.current = false
          if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        }, [])

        const showToast = React.useCallback((kind, text) => {
          setToast({ kind, text })
          if (toastTimer.current !== null) clearTimeout(toastTimer.current)
          toastTimer.current = window.setTimeout(() => {
            toastTimer.current = null
            if (aliveRef.current) setToast(null)
          }, 4500)
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

        const loadTree = React.useCallback(async (tabKey, options) => {
          const force = options !== undefined && options.force === true
          const entry = treesRef.current[tabKey]
          if (entry !== undefined && entry.loading === true) return
          if (!force && entry !== undefined && entry.tree !== null && Date.now() - entry.at < 10_000) return
          const current = (treeSeq.current.get(tabKey) ?? 0) + 1
          treeSeq.current.set(tabKey, current)
          setTrees((previous) => {
            const previousEntry = previous[tabKey]
            return {
              ...previous,
              [tabKey]: {
                tree: previousEntry !== undefined ? previousEntry.tree : null,
                error: '',
                loading: true,
                at: previousEntry !== undefined ? previousEntry.at : 0,
              },
            }
          })
          try {
            const raw = tabKey === 'local' ? await api.tree() : await api.tree(tabKey)
            if (!aliveRef.current || treeSeq.current.get(tabKey) !== current) return
            setTrees((previous) => ({
              ...previous,
              [tabKey]: { tree: normalizeTree(raw), error: '', loading: false, at: Date.now() },
            }))
          } catch (error) {
            if (!aliveRef.current || treeSeq.current.get(tabKey) !== current) return
            setTrees((previous) => {
              const previousEntry = previous[tabKey]
              return {
                ...previous,
                [tabKey]: {
                  tree: previousEntry !== undefined ? previousEntry.tree : null,
                  error: errorText(error),
                  loading: false,
                  at: previousEntry !== undefined ? previousEntry.at : 0,
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
            if (document.visibilityState === 'visible') {
              void loadStatus(true)
              void loadTree(activeKey, { force: true })
            }
          }
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, [loadStatus, loadTree, activeKey])

        React.useEffect(() => {
          if (statusPhase !== 'ready') return
          void loadTree(activeKey, { force: true })
        }, [statusPhase, activeKey, loadTree])

        React.useEffect(() => {
          if (statusPhase !== 'ready') return undefined
          const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void loadTree(activeKey, { force: true })
          }, 12_000)
          return () => window.clearInterval(interval)
        }, [statusPhase, activeKey, loadTree])

        const peers = status !== null && Array.isArray(status.peers) ? status.peers.filter((peer) => peer !== null && typeof peer === 'object' && typeof peer.id === 'string') : []
        const localDevice = status !== null && status.device !== null && typeof status.device === 'object' ? status.device : null
        const configured = status !== null && status.configured === true
        const connectionState = status !== null && status.connection !== null && typeof status.connection === 'object' && typeof status.connection.state === 'string' ? status.connection.state : 'unconfigured'
        const tabs = [
          { key: 'local', label: t('browser.tabLocal'), device: null, local: true },
          ...peers.map((peer) => ({
            key: peer.id,
            label: typeof peer.name === 'string' && peer.name !== '' ? peer.name : peer.id,
            device: peer,
            local: false,
          })),
        ]
        const activeTab = tabs.find((tab) => tab.key === activeKey) ?? tabs[0]

        React.useEffect(() => {
          if (!tabs.some((tab) => tab.key === activeKey)) setActiveKey('local')
        }, [status, activeKey])

        React.useEffect(() => {
          if (menu === null) return undefined
          const onPointerDown = (event) => {
            if (menuRef.current !== null && menuRef.current.contains(event.target)) return
            setMenu(null)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setMenu(null)
          }
          document.addEventListener('mousedown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('mousedown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [menu])

        React.useEffect(() => {
          setMenu(null)
        }, [activeKey])

        const q = search.trim().toLowerCase()

        const toggleArchived = () => setShowArchived((value) => !value)
        const toggleProject = (groupKey) => {
          const key = `${activeTab.key}:${groupKey}`
          setCollapsed((previous) => ({ ...previous, [key]: previous[key] !== true }))
        }

        const openCreate = (workspaceId) => {
          setMenu(null)
          setDialog({ kind: 'create', tabKey: activeTab.key, workspaceId: typeof workspaceId === 'string' ? workspaceId : '', saving: false, error: '' })
        }

        const openRenameSession = (tab, session, title) => {
          setMenu(null)
          setDialog({ kind: 'renameSession', tabKey: tab.key, sessionId: session.sessionId, initial: title, saving: false, error: '' })
        }

        const openRenameWorkspace = (tab, workspace, title) => {
          setMenu(null)
          setDialog({ kind: 'renameWorkspace', tabKey: tab.key, workspaceId: workspace.workspaceId, initial: title, saving: false, error: '' })
        }

        const openSession = async (tab, session) => {
          const key = `open:${tab.key}:${session.sessionId}`
          if (busy !== '') return
          setBusy(key)
          try {
            const ui = ctx.get('uiWorkspace')
            if (ui === undefined || ui === null || typeof ui.openSession !== 'function') throw new Error('uiWorkspace unavailable')
            let localSessionId = session.sessionId
            if (tab.key !== 'local') {
              localSessionId = session.localSessionId
              if (localSessionId === '') {
                const mirror = await api.ensureMirror(tab.key, session.sessionId)
                localSessionId = mirror !== null && typeof mirror === 'object' && typeof mirror.localSessionId === 'string' ? mirror.localSessionId : ''
              }
              if (localSessionId === '') throw new Error(t('browser.mirrorFailed'))
            }
            ui.openSession(localSessionId)
          } catch (error) {
            if (aliveRef.current) showToast('error', `${t('browser.openFailed')}: ${errorText(error)}`)
          } finally {
            if (aliveRef.current) setBusy('')
          }
        }

        const archiveSession = async (tab, session, archived) => {
          if (busy !== '') return
          setMenu(null)
          setBusy(`archive:${tab.key}:${session.sessionId}`)
          try {
            await api.archive(tab.key === 'local' ? undefined : tab.key, session.sessionId, archived)
            if (!aliveRef.current) return
            showToast('ok', archived ? t('browser.archivedDone') : t('browser.unarchivedDone'))
            void loadTree(tab.key, { force: true })
          } catch (error) {
            if (aliveRef.current) showToast('error', `${archived ? t('browser.archiveFailed') : t('browser.unarchiveFailed')}: ${errorText(error)}`)
          } finally {
            if (aliveRef.current) setBusy('')
          }
        }

        const copyText = async (text) => {
          setMenu(null)
          try {
            if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable')
            await navigator.clipboard.writeText(text)
            if (aliveRef.current) showToast('ok', t('browser.copied'))
          } catch {
            if (aliveRef.current) showToast('error', t('browser.copyFailed'))
          }
        }

        const submitCreate = async (values) => {
          if (dialog === null || dialog.kind !== 'create') return
          const tab = tabs.find((item) => item.key === dialog.tabKey)
          if (tab === undefined) {
            setDialog(null)
            return
          }
          setDialog((previous) => previous === null ? previous : { ...previous, saving: true, error: '' })
          try {
            const ui = ctx.get('uiWorkspace')
            if (ui === undefined || ui === null) throw new Error('uiWorkspace unavailable')
            if (tab.key === 'local') {
              if (typeof ui.startSession !== 'function') throw new Error('uiWorkspace unavailable')
              ui.startSession(values.workspaceId === '' ? undefined : values.workspaceId)
              if (aliveRef.current) setDialog(null)
              return
            }
            const payload = await api.createRemote(tab.key, values.workspaceId, values.cwd)
            let localSessionId = payload !== null && typeof payload === 'object' && typeof payload.localSessionId === 'string' ? payload.localSessionId : ''
            const remoteSessionId = payload !== null && typeof payload === 'object' && typeof payload.sessionId === 'string' ? payload.sessionId : ''
            if (localSessionId === '') {
              if (remoteSessionId === '') throw new Error('missing sessionId')
              const mirror = await api.ensureMirror(tab.key, remoteSessionId)
              localSessionId = mirror !== null && typeof mirror === 'object' && typeof mirror.localSessionId === 'string' ? mirror.localSessionId : ''
            }
            if (localSessionId === '') throw new Error(t('browser.mirrorFailed'))
            if (typeof ui.openSession !== 'function') throw new Error('uiWorkspace unavailable')
            if (aliveRef.current) setDialog(null)
            void loadTree(tab.key, { force: true })
            try {
              ui.openSession(localSessionId)
            } catch (error) {
              showToast('error', `${t('browser.openFailed')}: ${errorText(error)}`)
            }
          } catch (error) {
            if (aliveRef.current) setDialog((previous) => previous === null ? previous : { ...previous, saving: false, error: `${t('browser.createFailed')}: ${errorText(error)}` })
          }
        }

        const submitRename = async (value) => {
          if (dialog === null || (dialog.kind !== 'renameSession' && dialog.kind !== 'renameWorkspace')) return
          const title = value.trim()
          if (title === '') {
            setDialog((previous) => previous === null ? previous : { ...previous, error: t('browser.titleRequired') })
            return
          }
          const tab = tabs.find((item) => item.key === dialog.tabKey)
          if (tab === undefined) {
            setDialog(null)
            return
          }
          setDialog((previous) => previous === null ? previous : { ...previous, saving: true, error: '' })
          try {
            if (dialog.kind === 'renameSession') {
              if (tab.key === 'local') await api.localRenameSession(dialog.sessionId, title)
              else await api.rename(tab.key, dialog.sessionId, title)
              void refreshMirrors(true)
            } else {
              if (tab.key === 'local') await api.localRenameWorkspace(dialog.workspaceId, title)
              else await api.renameWorkspace(tab.key, dialog.workspaceId, title)
            }
            if (!aliveRef.current) return
            setDialog(null)
            showToast('ok', t('browser.renameDone'))
            void loadTree(dialog.tabKey, { force: true })
          } catch (error) {
            if (aliveRef.current) setDialog((previous) => previous === null ? previous : { ...previous, saving: false, error: `${t('browser.renameFailed')}: ${errorText(error)}` })
          }
        }

        const renderEmpty = (title, hint, actions) => h('div', { className: 'dsh-link-browser-empty' },
          h('div', { className: 'dsh-link-browser-empty-icon' }, h(PanelIcon, { size: 42, active: false })),
          h('h3', { className: 'dsh-link-browser-empty-title' }, title),
          hint !== '' ? h('p', { className: 'dsh-link-browser-empty-hint' }, hint) : null,
          actions !== undefined && actions !== null ? h('div', { className: 'dsh-link-browser-empty-actions' }, ...actions) : null,
        )

        const renderSession = (tab, session, archived) => {
          const sessionTitle = session.title !== '' ? session.title : t('untitled')
          const updated = relativeTime(t, session.updatedAt)
          const busyKey = `open:${tab.key}:${session.sessionId}`
          const archiveBusy = `archive:${tab.key}:${session.sessionId}`
          const opening = busy === busyKey
          const archiving = busy === archiveBusy
          const menuOpen = menu !== null && menu.kind === 'session' && menu.tabKey === tab.key && menu.id === session.sessionId
          return h('div', {
            key: `session:${session.sessionId}`,
            className: cls('dsh-link-browser-session', archived ? 'is-archived' : '', opening || archiving ? 'is-busy' : ''),
            role: 'button',
            tabIndex: 0,
            'aria-busy': opening || archiving,
            title: `${sessionTitle}${session.cwd !== '' ? ` — ${session.cwd}` : ''}`,
            onClick: () => void openSession(tab, session),
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                void openSession(tab, session)
              }
            },
          },
            h('span', { className: 'dsh-link-browser-session-main' },
              h('span', { className: 'dsh-link-browser-session-title' }, sessionTitle),
              h('span', { className: 'dsh-link-browser-session-meta' },
                session.running ? h('span', { className: 'dsh-link-dot is-ok is-pulse' }) : null,
                session.running ? h('span', null, t('running')) : null,
                updated !== '' ? h('span', null, updated) : null,
                session.cwd !== '' && session.title === '' ? h('span', null, session.cwd) : null,
              ),
            ),
            h('span', { className: 'dsh-link-browser-session-badges' },
              tab.key !== 'local' ? h('span', { className: 'dsh-link-badge is-remote' }, t('badge.remote')) : null,
              archived ? h('span', { className: 'dsh-link-badge' }, t('browser.archived')) : null,
            ),
            h('span', { className: cls('dsh-link-browser-session-actions', menuOpen ? 'is-open' : '') },
              h('button', {
                type: 'button',
                className: 'dsh-link-native-gear',
                'aria-label': t('browser.more'),
                title: t('browser.more'),
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen,
                onClick: (event) => {
                  event.stopPropagation()
                  setMenu((previous) => previous !== null && previous.kind === 'session' && previous.tabKey === tab.key && previous.id === session.sessionId ? null : { kind: 'session', tabKey: tab.key, id: session.sessionId, title: sessionTitle, session, archived })
                },
                onPointerDown: (event) => event.stopPropagation(),
              }, h(MoreGlyph)),
            ),
            menuOpen ? h('div', { className: 'dsh-link-browser-menu', role: 'menu', ref: menuRef },
              h('button', {
                type: 'button',
                className: 'dsh-link-browser-menu-item',
                role: 'menuitem',
                onClick: (event) => {
                  event.stopPropagation()
                  openRenameSession(tab, session, sessionTitle)
                },
              }, t('browser.renameSession')),
              h('button', {
                type: 'button',
                className: 'dsh-link-browser-menu-item',
                role: 'menuitem',
                disabled: archiving,
                onClick: (event) => {
                  event.stopPropagation()
                  void archiveSession(tab, session, !archived)
                },
              }, archived ? t('browser.unarchive') : t('browser.archive')),
              h('div', { className: 'dsh-link-browser-menu-sep' }),
              h('button', {
                type: 'button',
                className: 'dsh-link-browser-menu-item',
                role: 'menuitem',
                onClick: (event) => {
                  event.stopPropagation()
                  void copyText(session.sessionId)
                },
              }, t('browser.copySessionId')),
            ) : null,
          )
        }

        const renderGroup = (tab, group, archivedSet, pinnedSet) => {
          const collapsedKey = `${tab.key}:${group.key}`
          const isCollapsed = q === '' && collapsed[collapsedKey] === true
          const groupMenuOpen = menu !== null && menu.kind === 'workspace' && menu.tabKey === tab.key && menu.id === group.workspaceId
          const sessions = group.sessions.slice().sort((left, right) => {
            const leftPinned = pinnedSet.has(left.sessionId) ? 1 : 0
            const rightPinned = pinnedSet.has(right.sessionId) ? 1 : 0
            if (leftPinned !== rightPinned) return rightPinned - leftPinned
            return (right.updatedAt || 0) - (left.updatedAt || 0)
          })
          return h('div', { className: 'dsh-link-project', key: group.key },
            h('div', { className: 'dsh-link-project-head' },
              h('button', {
                type: 'button',
                className: 'dsh-link-project-toggle',
                'aria-expanded': !isCollapsed,
                onClick: () => { if (q === '') toggleProject(group.key) },
              },
                h('span', { className: cls('dsh-link-project-chevron', isCollapsed ? '' : 'is-open') }, h(ChevronGlyph)),
                h('span', { className: 'dsh-link-project-folder' }, h(FolderGlyph, { size: 15 })),
                h('span', { className: 'dsh-link-project-info' },
                  h('span', { className: 'dsh-link-project-title' }, group.title),
                  group.path !== '' ? h('span', { className: 'dsh-link-project-path' }, group.path) : null,
                ),
                h('span', { className: 'dsh-link-project-count' }, t('browser.projectCount', { n: sessions.length })),
              ),
              group.orphan
                ? null
                : h('div', { className: cls('dsh-link-project-actions', groupMenuOpen ? 'is-open' : '') },
                    h('button', {
                      type: 'button',
                      className: 'dsh-link-native-gear',
                      title: t('browser.newInProject'),
                      'aria-label': t('browser.newInProject'),
                      onClick: (event) => {
                        event.stopPropagation()
                        openCreate(group.workspaceId)
                      },
                    }, h(PlusGlyph)),
                    h('button', {
                      type: 'button',
                      className: 'dsh-link-native-gear',
                      title: t('browser.more'),
                      'aria-label': t('browser.more'),
                      'aria-haspopup': 'menu',
                      'aria-expanded': groupMenuOpen,
                      onClick: (event) => {
                        event.stopPropagation()
                        setMenu((previous) => previous !== null && previous.kind === 'workspace' && previous.tabKey === tab.key && previous.id === group.workspaceId ? null : { kind: 'workspace', tabKey: tab.key, id: group.workspaceId, title: group.title, workspace: group.workspace })
                      },
                      onPointerDown: (event) => event.stopPropagation(),
                    }, h(MoreGlyph)),
                    groupMenuOpen ? h('div', { className: 'dsh-link-browser-menu is-project', role: 'menu', ref: menuRef },
                      h('button', { type: 'button', className: 'dsh-link-browser-menu-item', role: 'menuitem', onClick: (event) => { event.stopPropagation(); openRenameWorkspace(tab, group.workspace, group.title) } }, t('browser.renameWorkspace')),
                      h('button', { type: 'button', className: 'dsh-link-browser-menu-item', role: 'menuitem', onClick: (event) => { event.stopPropagation(); openCreate(group.workspaceId) } }, t('browser.newInProject')),
                      h('div', { className: 'dsh-link-browser-menu-sep' }),
                      h('button', { type: 'button', className: 'dsh-link-browser-menu-item', role: 'menuitem', onClick: (event) => { event.stopPropagation(); void copyText(group.workspaceId) } }, t('browser.copyWorkspaceId')),
                    ) : null,
                  ),
            ),
            isCollapsed
              ? null
              : h('div', { className: 'dsh-link-project-sessions' },
                  sessions.length === 0
                    ? h('p', { className: 'dsh-link-project-note' }, t('browser.noSessions'))
                    : sessions.map((session) => renderSession(tab, session, archivedSet.has(session.sessionId))),
                ),
          )
        }

        const renderBrowser = () => {
          const entry = trees[activeTab.key]
          const tree = entry !== undefined && entry.tree !== null ? entry.tree : null
          const loading = entry === undefined || entry.loading === true
          const archivedSet = tree !== null ? new Set(tree.archivedSessionIds) : new Set()
          const pinnedSet = tree !== null ? new Set(tree.pinnedSessionIds) : new Set()
          const groups = []
          if (tree !== null) {
            for (const workspace of tree.workspaces) {
              const sessions = []
              for (const session of workspace.sessions) {
                if (!showArchived && archivedSet.has(session.sessionId)) continue
                sessions.push(session)
              }
              const projectHit = q === '' || workspace.title.toLowerCase().includes(q) || workspace.path.toLowerCase().includes(q)
              const matched = q === '' || projectHit
                ? sessions
                : sessions.filter((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(q))
              if (q !== '' && !projectHit && matched.length === 0) continue
              groups.push({
                key: `workspace:${workspace.workspaceId}`,
                workspace,
                workspaceId: workspace.workspaceId,
                title: workspace.title !== '' ? workspace.title : t('browser.project'),
                path: workspace.path,
                sessions: matched,
                orphan: false,
              })
            }
            const orphanSessions = []
            for (const session of tree.orphanSessions) {
              if (!showArchived && archivedSet.has(session.sessionId)) continue
              orphanSessions.push(session)
            }
            const orphanMatched = q === ''
              ? orphanSessions
              : orphanSessions.filter((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(q))
            if (q === '' || orphanMatched.length > 0) {
              if (orphanSessions.length > 0 || orphanMatched.length > 0) {
                groups.push({
                  key: 'orphan',
                  workspace: null,
                  workspaceId: '',
                  title: t('browser.orphan'),
                  path: '',
                  sessions: orphanMatched,
                  orphan: true,
                })
              }
            }
          }
          const visibleCount = groups.reduce((total, group) => total + group.sessions.length, 0)
          const hasSessions = tree !== null && (tree.workspaces.some((workspace) => workspace.sessions.length > 0) || tree.orphanSessions.length > 0)
          const archivedCount = archivedSet.size
          let body = null
          if (statusPhase === 'loading' && status === null) {
            body = h('p', { className: 'dsh-link-hint', style: { padding: '24px' } }, t('loading'))
          } else if (statusPhase === 'error' && status === null) {
            body = renderEmpty(t('apiError'), statusError, [
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => void loadStatus(false) }, t('retry')),
              h('button', { type: 'button', className: 'dsh-link-btn', onClick: () => setDialog({ kind: 'settings' }) }, t('settings')),
            ])
          } else if (tree === null) {
            body = loading
              ? h('p', { className: 'dsh-link-hint', style: { padding: '24px' } }, t('browser.loading'))
              : renderEmpty(t('browser.loadFailed'), entry.error, [
                  h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => void loadTree(activeTab.key, { force: true }) }, t('retry')),
                ])
          } else if (q !== '' && groups.length === 0) {
            body = renderEmpty(t('browser.noMatches'), '', [
              h('button', { type: 'button', className: 'dsh-link-btn', onClick: () => setSearch('') }, t('browser.clearSearch')),
            ])
          } else if (q === '' && visibleCount === 0 && archivedCount > 0) {
            body = renderEmpty(t('browser.allArchived'), t('browser.allArchived'), [
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: toggleArchived }, t('browser.showArchived', { n: archivedCount })),
            ])
          } else if (groups.length === 0 && (!hasSessions || q !== '')) {
            body = renderEmpty(t('browser.emptyTitle'), t('browser.emptyHint'), [
              h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => openCreate('') }, t('browser.new')),
            ])
          } else {
            body = h('div', { className: 'dsh-link-browser-scroll' },
              h('div', { className: 'dsh-link-browser-inner' },
                ...groups.map((group) => renderGroup(activeTab, group, archivedSet, pinnedSet)),
              ),
            )
          }
          const showArchivedToggle = archivedCount > 0
          return h('div', { className: 'dsh-link-browser' },
            h('div', { className: 'dsh-link-browser-toolbar' },
              h('div', { className: 'dsh-link-browser-search' },
                h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
                  h('circle', { cx: 7, cy: 7, r: 4.5, stroke: 'currentColor', strokeWidth: 1.3 }),
                  h('path', { d: 'm10.5 10.5 3 3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
                ),
                h('input', {
                  value: search,
                  placeholder: t('browser.search'),
                  'aria-label': t('browser.search'),
                  spellCheck: false,
                  onChange: (event) => setSearch(event.target.value),
                }),
                search !== ''
                  ? h('button', { type: 'button', className: 'dsh-link-browser-search-clear', 'aria-label': t('close'), title: t('close'), onClick: () => setSearch('') }, h(CloseGlyph, { size: 11 }))
                  : null,
              ),
              h('div', { className: 'dsh-link-browser-actions' },
                showArchivedToggle
                  ? h('button', { type: 'button', className: cls('dsh-link-btn is-small', showArchived ? 'is-primary' : ''), 'aria-pressed': showArchived, onClick: toggleArchived }, showArchived ? t('browser.hideArchived') : t('browser.showArchived', { n: archivedCount }))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dsh-link-btn is-small',
                  disabled: loading,
                  onClick: () => void loadTree(activeTab.key, { force: true }),
                }, h(RefreshGlyph), h('span', { className: 'dsh-link-btn-label' }, t('refresh'))),
                h('button', { type: 'button', className: 'dsh-link-btn is-primary', onClick: () => openCreate('') }, h(PlusGlyph), h('span', { className: 'dsh-link-btn-label' }, t('browser.new'))),
              ),
            ),
            entry !== undefined && entry.error !== '' && tree !== null ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' },
              h('span', null, entry.error),
              h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => void loadTree(activeTab.key, { force: true }) }, t('retry')),
            ) : null,
            !configured && status !== null && statusPhase === 'ready' && activeTab.key === 'local'
              ? h('div', { className: 'dsh-link-banner is-warn' },
                  h('span', null, t('browser.unpaired')),
                  h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => setDialog({ kind: 'settings' }) }, t('empty.pair')),
                )
              : null,
            body,
          )
        }

        const renameDialog = () => {
          if (dialog === null || (dialog.kind !== 'renameSession' && dialog.kind !== 'renameWorkspace')) return null
          const tab = tabs.find((item) => item.key === dialog.tabKey)
          if (tab === undefined) return null
          return h(Sheet, {
            t,
            title: dialog.kind === 'renameSession' ? t('browser.renameSession') : t('browser.renameWorkspace'),
            onClose: () => setDialog(null),
          },
            h(RenameDialogContent, {
              t,
              initialValue: typeof dialog.initial === 'string' ? dialog.initial : '',
              description: dialog.kind === 'renameSession' ? t('remoteSettings.sessionTitle') : tab.label,
              label: dialog.kind === 'renameSession' ? t('browser.sessionPlaceholder') : t('browser.projectPlaceholder'),
              placeholder: dialog.kind === 'renameSession' ? t('browser.sessionPlaceholder') : t('browser.projectPlaceholder'),
              saving: dialog.saving === true,
              error: typeof dialog.error === 'string' ? dialog.error : '',
              onCancel: () => setDialog(null),
              onSubmit: (value) => void submitRename(value),
            }),
          )
        }

        const createDialog = () => {
          if (dialog === null || dialog.kind !== 'create') return null
          const tab = tabs.find((item) => item.key === dialog.tabKey)
          if (tab === undefined) return null
          const entry = trees[tab.key]
          return h(Sheet, { t, title: t('browser.newTitle'), onClose: () => setDialog(null) },
            h(CreateSessionDialogContent, {
              t,
              tab,
              tree: entry !== undefined ? entry.tree : null,
              initialWorkspaceId: dialog.workspaceId,
              saving: dialog.saving === true,
              error: typeof dialog.error === 'string' ? dialog.error : '',
              onCancel: () => setDialog(null),
              onSubmit: (values) => void submitCreate(values),
            }),
          )
        }

        return h('div', { className: 'dsh-link-page' },
          h('style', null, CSS),
          h('div', { className: 'dsh-link-tabbar' },
            h('div', { className: 'dsh-link-tablist', role: 'tablist' },
              ...tabs.map((tab) => h('button', {
                key: tab.key,
                type: 'button',
                role: 'tab',
                className: cls('dsh-link-tab', tab.key === activeTab.key ? 'is-active' : ''),
                'aria-selected': tab.key === activeTab.key,
                title: tab.local
                  ? (localDevice !== null && typeof localDevice.name === 'string' ? localDevice.name : t('browser.tabLocal'))
                  : `${tab.label} · ${platformLabel(t, tab.device !== null ? tab.device.platform : 'unknown')}`,
                onClick: () => {
                  setActiveKey(tab.key)
                  setMenu(null)
                },
              },
                h('span', { className: 'dsh-link-tab-label' }, tab.label),
              )),
            ),
            h('div', { className: 'dsh-link-tabbar-actions' },
              h('span', { className: cls('dsh-link-dot', connectionTone(connectionState)), title: t(connectionKey(connectionState)) }),
              h('button', { type: 'button', className: 'dsh-link-btn is-ghost is-icon', 'aria-label': t('settings'), title: t('settings'), onClick: () => setDialog({ kind: 'settings' }) }, h(SettingsGlyph)),
            ),
          ),
          statusError !== '' && status !== null
            ? h('div', { className: 'dsh-link-banner is-error', role: 'alert' },
                h('span', null, statusError),
                h('button', { type: 'button', className: 'dsh-link-btn is-small', onClick: () => void loadStatus(true) }, t('retry')),
              )
            : null,
          h('div', { className: 'dsh-link-tabs-body' }, renderBrowser()),
          dialog !== null && dialog.kind === 'settings'
            ? h(Sheet, { t, title: t('settings.title'), wide: true, onClose: () => setDialog(null) },
                h(LinkSettingsPanel, {
                  ctx,
                  t,
                  variant: 'sheet',
                  onChanged: () => {
                    void loadStatus(true)
                    void loadTree(activeKey, { force: true })
                  },
                }),
              )
            : null,
          renameDialog(),
          createDialog(),
          toast !== null
            ? h('div', { className: cls('dsh-link-toast', toast.kind === 'error' ? 'is-error' : 'is-ok'), role: toast.kind === 'error' ? 'alert' : 'status' }, toast.text)
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
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, {
          zh: LOCALE_DICTS.zh,
          en: LOCALE_DICTS.en,
        }), 'dsh-link: locale dictionaries')

        const t = ctx.locale.bind(NS)
        const Workspace = createWorkspace(ctx, t)
        const SettingsPage = createSettingsPage(ctx, t)
        const RemoteBadge = createRemoteBadge(t)
        const RemoteHeaderBadge = createRemoteHeaderBadge(t)
        const RemoteSettingsRowAction = createRemoteSettingsRowAction(t)

        ctx.effect(() => {
          void refreshMirrors(true)
          const timer = setInterval(() => { void refreshMirrors(true) }, 15000)
          return () => clearInterval(timer)
        }, 'dsh-link: mirror index')

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

        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'dsh-link-remote',
          order: 30,
        }, RemoteBadge))

        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'dsh-link-remote',
          order: 30,
        }, RemoteHeaderBadge))

        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action',
          id: 'dsh-link-remote-settings',
          order: 50,
        }, RemoteSettingsRowAction))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-link-remote-settings',
          order: 60,
        }, () => h(RemoteSettingsOverlay, { ctx, t })))
      },
    }
  },
})
