package dev.dshlink.app.vm

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.dshlink.app.audio.AudioRecorder
import dev.dshlink.app.audio.RecorderState
import dev.dshlink.app.audio.Wav
import dev.dshlink.app.data.Prefs
import dev.dshlink.app.net.ConnectionState
import dev.dshlink.app.net.LinkClient
import dev.dshlink.app.net.LinkException
import dev.dshlink.app.net.SubMessage
import dev.dshlink.app.protocol.ChatRecord
import dev.dshlink.app.protocol.DeviceInfo
import dev.dshlink.app.protocol.FollowData
import dev.dshlink.app.protocol.PairingCode
import dev.dshlink.app.protocol.PairingResult
import dev.dshlink.app.protocol.Peer
import dev.dshlink.app.protocol.SessionState
import dev.dshlink.app.protocol.SessionSummary
import dev.dshlink.app.protocol.WorkspaceInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** 语音输入 UI 状态。 */
sealed interface SpeechUi {
    data object Idle : SpeechUi
    data class Recording(val elapsedMs: Long, val maxMs: Long, val level: Float) : SpeechUi
    data object Transcribing : SpeechUi
    data class Failed(val message: String) : SpeechUi
}

/** 已打开的会话。 */
data class ChatState(
    val deviceId: String,
    val sessionId: String,
    val title: String = "",
    val cwd: String? = null,
    val running: Boolean = false,
    val active: Boolean = false,
    val queueCount: Int = 0,
    val pendingInput: List<String> = emptyList(),
    val records: List<ChatRecord> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
    val followConnected: Boolean = false,
)

data class UiState(
    val configured: Boolean = false,
    val relayUrl: String = "",
    val deviceId: String = "",
    val deviceName: String = "",
    val connection: ConnectionState = ConnectionState.Unconfigured,
    val connectionDetail: String? = null,
    val selfName: String? = null,
    val peers: List<Peer> = emptyList(),
    val selectedDeviceId: String? = null,
    val deviceInfo: DeviceInfo? = null,
    val workspaces: List<WorkspaceInfo> = emptyList(),
    val sessions: List<SessionSummary> = emptyList(),
    val sessionsLoading: Boolean = false,
    val sessionsError: String? = null,
    val chat: ChatState? = null,
    val drafts: Map<String, String> = emptyMap(),
    val promptMode: String = MODE_QUEUE,
    val sending: Boolean = false,
    val speech: SpeechUi = SpeechUi.Idle,
    val retryAudioBase64: String? = null,
) {
    val selectedPeer: Peer? get() = peers.firstOrNull { it.id == selectedDeviceId }
    val selectedDeviceOnline: Boolean get() = peers.any { it.id == selectedDeviceId }

    fun draftFor(sessionId: String?): String =
        if (sessionId == null) "" else drafts[sessionId].orEmpty()

    companion object {
        const val MODE_QUEUE = "queue"
        const val MODE_STEER = "steer"
    }
}

/**
 * 单例 ViewModel：连接、设备、会话、语音的全部状态都在这里，
 * 旋转/折叠/换屏不会丢失草稿与会话。
 */
class LinkViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = Prefs(app)
    private val client = LinkClient(viewModelScope, prefs)
    private val recorder = AudioRecorder(app)

    private val _ui = MutableStateFlow(
        UiState(
            configured = prefs.configured,
            relayUrl = prefs.relayUrl.orEmpty(),
            deviceId = prefs.deviceId,
            deviceName = prefs.deviceName,
            connection = if (prefs.configured) ConnectionState.Offline else ConnectionState.Unconfigured,
        ),
    )
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private var chatJob: Job? = null
    private var transcribeJob: Job? = null
    private var speechTimerJob: Job? = null
    private var loadingDeviceId: String? = null

    init {
        observeClient()
        observeRecorder()
        if (prefs.configured) client.start()
    }

    // ------------------------------------------------------------ 连接

    private fun observeClient() {
        viewModelScope.launch {
            client.state.collect { state ->
                _ui.update { it.copy(connection = state) }
            }
        }
        viewModelScope.launch {
            client.lastError.collect { message ->
                _ui.update { it.copy(connectionDetail = message) }
            }
        }
        viewModelScope.launch {
            client.self.collect { self ->
                _ui.update { it.copy(selfName = self?.name) }
            }
        }
        viewModelScope.launch {
            client.peers.collect { peers ->
                _ui.update { state ->
                    state.copy(
                        peers = peers,
                        selectedDeviceId = state.selectedDeviceId ?: peers.firstOrNull()?.id,
                    )
                }
            }
        }
        viewModelScope.launch {
            // 每次收到 welcome（含重连成功）都重新对齐设备与会话
            client.epoch.drop(1).collect { onConnected() }
        }
    }

    private fun onConnected() {
        val peers = client.peers.value
        val previous = _ui.value.selectedDeviceId
        val target = previous?.takeIf { id -> peers.any { it.id == id } }
            ?: peers.firstOrNull()?.id
            ?: previous
        _ui.update { it.copy(selectedDeviceId = target, connectionDetail = null) }
        val chat = _ui.value.chat
        if (target != null && chat != null && chat.deviceId != target) {
            closeChat()
        }
        if (target != null) {
            loadDevice(target, force = true)
            val open = _ui.value.chat
            if (open != null) startChatFlow(open.deviceId, open.sessionId)
        }
    }

    fun submitPairingCode(raw: String): String? {
        return when (val result = PairingCode.parse(raw)) {
            is PairingResult.Ok -> {
                applyConnection(result.info.relayUrl, result.info.token)
                null
            }
            is PairingResult.UnsupportedVersion ->
                "配对码版本过新（v=${result.version}），请升级插件/App"
            is PairingResult.Invalid -> "配对码无效：${result.reason}"
        }
    }

    fun submitManual(relayUrl: String, token: String): String? {
        val normalized = PairingCode.normalizeRelayUrl(relayUrl) ?: return "中继地址无效"
        val cleanToken = token.trim()
        if (!PairingCode.isValidToken(cleanToken)) return "token 必须是 64 位十六进制"
        applyConnection(normalized, cleanToken)
        return null
    }

    private fun applyConnection(relayUrl: String, token: String) {
        prefs.savePairing(relayUrl, token)
        closeChat()
        client.stop()
        _ui.update {
            it.copy(
                configured = true,
                relayUrl = relayUrl,
                deviceId = prefs.deviceId,
                deviceName = prefs.deviceName,
                selectedDeviceId = null,
                deviceInfo = null,
                sessions = emptyList(),
                sessionsError = null,
                workspaces = emptyList(),
                peers = emptyList(),
                connectionDetail = null,
            )
        }
        client.start()
    }

    fun setDeviceName(name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        prefs.deviceName = trimmed
        _ui.update { it.copy(deviceName = trimmed) }
        // 设备名在 hello 帧里，重连后生效
        if (prefs.configured) {
            client.stop()
            client.start()
        }
    }

    fun reconnect() {
        if (!prefs.configured) return
        client.stop()
        client.start()
    }

    fun disconnect() {
        client.stop()
        _ui.update { it.copy(connection = ConnectionState.Offline) }
    }

    fun forgetPairing() {
        prefs.clearPairing()
        closeChat()
        client.stop()
        _ui.update {
            it.copy(
                configured = false,
                relayUrl = "",
                connection = ConnectionState.Unconfigured,
                connectionDetail = null,
                peers = emptyList(),
                selectedDeviceId = null,
                deviceInfo = null,
                sessions = emptyList(),
                workspaces = emptyList(),
                sessionsError = null,
            )
        }
    }

    // ------------------------------------------------------------ 设备 / 会话

    fun selectDevice(peerId: String) {
        if (_ui.value.selectedDeviceId == peerId) {
            loadDevice(peerId, force = true)
            return
        }
        cancelSpeechInternal()
        closeChat()
        _ui.update {
            it.copy(
                selectedDeviceId = peerId,
                deviceInfo = null,
                sessions = emptyList(),
                workspaces = emptyList(),
                sessionsLoading = true,
                sessionsError = null,
            )
        }
        loadDevice(peerId, force = true)
    }

    private fun loadDevice(deviceId: String, force: Boolean = false) {
        if (!force && loadingDeviceId == deviceId) return
        loadingDeviceId = deviceId
        viewModelScope.launch {
            try {
                _ui.update { state ->
                    if (state.selectedDeviceId != deviceId) state
                    else state.copy(sessionsLoading = true, sessionsError = null)
                }
                val infoObj = client.call(deviceId, "device.info", JSONObject())
                if (_ui.value.selectedDeviceId != deviceId) return@launch
                _ui.update { it.copy(deviceInfo = DeviceInfo.parse(infoObj)) }

                val sessionsObj = client.call(deviceId, "session.list", JSONObject())
                if (_ui.value.selectedDeviceId != deviceId) return@launch
                _ui.update {
                    it.copy(
                        sessions = SessionSummary.parseList(sessionsObj.optJSONArray("items")),
                        sessionsLoading = false,
                        sessionsError = null,
                    )
                }
                runCatching { loadWorkspacesInternal(deviceId) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (_ui.value.selectedDeviceId == deviceId) {
                    _ui.update {
                        it.copy(
                            sessionsLoading = false,
                            sessionsError = friendly(e),
                            connectionDetail = it.connectionDetail,
                        )
                    }
                }
            } finally {
                if (loadingDeviceId == deviceId) loadingDeviceId = null
            }
        }
    }

    private suspend fun loadWorkspacesInternal(deviceId: String) {
        val result = client.call(deviceId, "workspace.list", JSONObject())
        if (_ui.value.selectedDeviceId != deviceId) return
        _ui.update { it.copy(workspaces = WorkspaceInfo.parseList(result.optJSONArray("items"))) }
    }

    fun refreshSessions() {
        val deviceId = _ui.value.selectedDeviceId ?: return
        loadDevice(deviceId, force = true)
    }

    fun refreshWorkspaces() {
        val deviceId = _ui.value.selectedDeviceId ?: return
        viewModelScope.launch {
            runCatching { loadWorkspacesInternal(deviceId) }
        }
    }

    fun createSession(workspaceId: String?, cwd: String?) {
        val deviceId = _ui.value.selectedDeviceId ?: return
        viewModelScope.launch {
            try {
                val params = JSONObject()
                if (!workspaceId.isNullOrBlank()) params.put("workspaceId", workspaceId)
                if (!cwd.isNullOrBlank()) params.put("cwd", cwd.trim())
                val result = client.call(deviceId, "session.create", params)
                val newId = result.optString("sessionId", "").trim()
                loadDevice(deviceId, force = true)
                if (newId.isNotEmpty() && _ui.value.selectedDeviceId == deviceId) {
                    openSession(newId)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _ui.update { it.copy(sessionsError = friendly(e)) }
            }
        }
    }

    fun renameSession(sessionId: String, title: String) {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return
        val deviceId = _ui.value.selectedDeviceId ?: return
        viewModelScope.launch {
            try {
                val result = client.call(
                    deviceId,
                    "session.rename",
                    JSONObject().put("sessionId", sessionId).put("title", trimmed),
                )
                val newTitle = result.optString("title", trimmed).ifBlank { trimmed }
                patchSession(sessionId, title = newTitle)
                updateChat(sessionId) { it.copy(title = newTitle) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _ui.update { it.copy(sessionsError = friendly(e)) }
            }
        }
    }

    // ------------------------------------------------------------ 会话正文

    fun openSession(sessionId: String) {
        val state = _ui.value
        val deviceId = state.selectedDeviceId ?: return
        if (state.chat?.sessionId == sessionId && state.chat.deviceId == deviceId) return
        cancelSpeechInternal()
        val summary = state.sessions.firstOrNull { it.sessionId == sessionId }
        _ui.update {
            it.copy(
                chat = ChatState(
                    deviceId = deviceId,
                    sessionId = sessionId,
                    title = summary?.title.orEmpty(),
                    cwd = summary?.cwd,
                    running = summary?.running == true,
                    loading = true,
                ),
                speech = SpeechUi.Idle,
            )
        }
        startChatFlow(deviceId, sessionId)
    }

    fun closeChat() {
        chatJob?.cancel()
        chatJob = null
        cancelSpeechInternal()
        _ui.update { it.copy(chat = null, speech = SpeechUi.Idle) }
    }

    private fun startChatFlow(deviceId: String, sessionId: String) {
        chatJob?.cancel()
        chatJob = viewModelScope.launch {
            updateChat(sessionId) { it.copy(loading = it.records.isEmpty(), error = null, followConnected = false) }
            val followJob = launch {
                try {
                    client.subscribe(
                        deviceId,
                        "session.follow",
                        JSONObject().put("sessionId", sessionId),
                    ).collect { message -> handleFollow(sessionId, message) }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    if (_ui.value.chat?.sessionId == sessionId) {
                        updateChat(sessionId) { it.copy(error = friendly(e), loading = false) }
                    }
                }
            }
            try {
                val history = client.call(
                    deviceId,
                    "session.history",
                    JSONObject().put("sessionId", sessionId).put("maxMessages", HISTORY_PAGE),
                )
                val state = SessionState.parse(history.optJSONObject("state"))
                val records = ChatRecord.parseList(history.optJSONArray("records"))
                updateChat(sessionId) {
                    it.copy(
                        records = mergeRecords(it.records, records),
                        running = state.running,
                        active = state.active,
                        queueCount = state.queueCount,
                        pendingInput = state.pendingInput,
                        loading = false,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (_ui.value.chat?.sessionId == sessionId) {
                    updateChat(sessionId) { it.copy(loading = false, error = it.error ?: friendly(e)) }
                }
            }
            followJob.join()
        }
    }

    private fun handleFollow(sessionId: String, message: SubMessage) {
        if (_ui.value.chat?.sessionId != sessionId) return
        when (message) {
            is SubMessage.Accepted -> updateChat(sessionId) { it.copy(followConnected = true, loading = false) }

            is SubMessage.Data -> when (val data = FollowData.parse(message.json)) {
                is FollowData.Ready -> {
                    if (data.title.isNotBlank()) {
                        updateChat(sessionId) { it.copy(title = data.title) }
                        patchSession(sessionId, title = data.title)
                    }
                    updateChat(sessionId) { it.copy(followConnected = true) }
                }

                is FollowData.Snapshot -> {
                    updateChat(sessionId) {
                        it.copy(
                            records = mergeRecords(it.records, data.records),
                            running = data.state.running,
                            active = data.state.active,
                            queueCount = data.state.queueCount,
                            pendingInput = data.state.pendingInput,
                            loading = false,
                            error = null,
                            followConnected = true,
                        )
                    }
                    patchSession(sessionId, running = data.state.running)
                }

                is FollowData.Record -> updateChat(sessionId) {
                    it.copy(records = mergeRecords(it.records, listOf(data.record)), loading = false)
                }

                is FollowData.StateChanged -> {
                    updateChat(sessionId) {
                        it.copy(
                            running = data.state.running,
                            active = data.state.active,
                            queueCount = data.state.queueCount,
                            pendingInput = data.state.pendingInput,
                        )
                    }
                    patchSession(sessionId, running = data.state.running)
                }

                is FollowData.Title -> {
                    updateChat(sessionId) { it.copy(title = data.title) }
                    patchSession(sessionId, title = data.title)
                }

                is FollowData.Failure -> updateChat(sessionId) {
                    it.copy(error = data.message.ifBlank { data.code }, loading = false)
                }

                FollowData.Unknown -> Unit
            }

            is SubMessage.Ended -> updateChat(sessionId) { it.copy(followConnected = false) }

            is SubMessage.Failed -> updateChat(sessionId) {
                it.copy(
                    error = it.error ?: message.message.ifBlank { message.code },
                    loading = false,
                    followConnected = false,
                )
            }
        }
    }

    fun sendPrompt() {
        val state = _ui.value
        val chat = state.chat ?: return
        val text = state.draftFor(chat.sessionId).trim()
        if (text.isEmpty() || state.sending) return
        _ui.update { it.copy(sending = true) }
        viewModelScope.launch {
            try {
                client.call(
                    chat.deviceId,
                    "session.prompt",
                    JSONObject()
                        .put("sessionId", chat.sessionId)
                        .put("text", text)
                        .put("mode", state.promptMode),
                )
                _ui.update {
                    it.copy(
                        sending = false,
                        drafts = it.drafts + (chat.sessionId to ""),
                        chat = it.chat?.copy(error = null),
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _ui.update {
                    it.copy(
                        sending = false,
                        chat = it.chat?.copy(error = friendly(e)),
                    )
                }
            }
        }
    }

    fun stopTurn() {
        val chat = _ui.value.chat ?: return
        viewModelScope.launch {
            try {
                client.call(
                    chat.deviceId,
                    "session.cancel",
                    JSONObject().put("sessionId", chat.sessionId),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                updateChat(chat.sessionId) { it.copy(error = friendly(e)) }
            }
        }
    }

    fun updateDraft(text: String) {
        val chat = _ui.value.chat ?: return
        _ui.update { it.copy(drafts = it.drafts + (chat.sessionId to text)) }
    }

    fun setPromptMode(mode: String) {
        if (mode != UiState.MODE_QUEUE && mode != UiState.MODE_STEER) return
        _ui.update { it.copy(promptMode = mode) }
    }

    fun clearChatError() {
        val chat = _ui.value.chat ?: return
        updateChat(chat.sessionId) { it.copy(error = null) }
    }

    // ------------------------------------------------------------ 语音

    private fun observeRecorder() {
        viewModelScope.launch {
            recorder.state.collect { state ->
                if (state is RecorderState.Active) {
                    _ui.update { ui ->
                        if (ui.speech is SpeechUi.Recording) {
                            ui.copy(speech = SpeechUi.Recording(state.elapsedMs, state.maxMs, state.level))
                        } else {
                            ui
                        }
                    }
                }
            }
        }
    }

    fun startRecording() {
        val state = _ui.value
        val chat = state.chat
        when {
            chat == null -> { setSpeechFailed("请先打开一个会话"); return }
            state.selectedDeviceId == null -> { setSpeechFailed("请先选择电脑"); return }
            state.deviceInfo?.speechAvailable == false -> { setSpeechFailed("这台电脑的语音识别不可用"); return }
            state.speech is SpeechUi.Transcribing -> return
            state.speech is SpeechUi.Recording -> return
            !recorder.hasPermission() -> { setSpeechFailed("需要麦克风权限才能录音"); return }
        }
        recorder.cancel()
        val started = recorder.start(viewModelScope, AudioRecorder.DEFAULT_MAX_SECONDS)
        if (!started) {
            setSpeechFailed("无法启动录音，请检查麦克风是否被占用")
            return
        }
        _ui.update {
            it.copy(speech = SpeechUi.Recording(0L, AudioRecorder.DEFAULT_MAX_SECONDS * 1000L, 0f))
        }
        speechTimerJob?.cancel()
        speechTimerJob = viewModelScope.launch {
            delay(AudioRecorder.DEFAULT_MAX_SECONDS * 1000L)
            if (_ui.value.speech is SpeechUi.Recording) stopRecording()
        }
    }

    fun stopRecording() {
        if (_ui.value.speech !is SpeechUi.Recording) return
        speechTimerJob?.cancel()
        speechTimerJob = null
        val pcm = recorder.stop()
        if (pcm.size < MIN_PCM_BYTES) {
            _ui.update { it.copy(speech = SpeechUi.Failed("录音太短，请重试")) }
            return
        }
        if (pcm.size > AudioRecorder.MAX_PCM_BYTES) {
            _ui.update { it.copy(speech = SpeechUi.Failed("录音过长，请控制在 60 秒内")) }
            return
        }
        val audioBase64 = Wav.base64(Wav.wrapPcm16(pcm))
        _ui.update { it.copy(retryAudioBase64 = audioBase64) }
        transcribe(audioBase64)
    }

    private fun transcribe(audioBase64: String) {
        val chat = _ui.value.chat
        if (chat == null) {
            setSpeechFailed("请先打开一个会话")
            return
        }
        transcribeJob?.cancel()
        _ui.update { it.copy(speech = SpeechUi.Transcribing) }
        transcribeJob = viewModelScope.launch {
            try {
                val result = client.call(
                    chat.deviceId,
                    "speech.transcribe",
                    JSONObject().put("audioBase64", audioBase64).put("language", "zh"),
                    timeoutMs = SPEECH_TIMEOUT_MS,
                )
                val text = result.optString("text", "").trim()
                if (text.isEmpty()) {
                    if (_ui.value.speech is SpeechUi.Transcribing) {
                        _ui.update { it.copy(speech = SpeechUi.Failed("没有识别到语音内容，请重试")) }
                    }
                } else {
                    _ui.update { state ->
                        state.copy(
                            speech = SpeechUi.Idle,
                            drafts = state.drafts + (chat.sessionId to (state.draftFor(chat.sessionId) + text)),
                            retryAudioBase64 = null,
                        )
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (_ui.value.speech is SpeechUi.Transcribing) {
                    _ui.update { it.copy(speech = SpeechUi.Failed(friendly(e))) }
                }
            }
        }
    }

    fun retrySpeech() {
        val audio = _ui.value.retryAudioBase64 ?: return
        if (_ui.value.chat == null) {
            setSpeechFailed("请先打开一个会话")
            return
        }
        transcribe(audio)
    }

    fun cancelSpeech() {
        cancelSpeechInternal()
        _ui.update { it.copy(speech = SpeechUi.Idle) }
    }

    fun dismissSpeechError() {
        if (_ui.value.speech is SpeechUi.Failed) {
            _ui.update { it.copy(speech = SpeechUi.Idle) }
        }
    }

    fun onMicPermissionDenied() {
        setSpeechFailed("需要麦克风权限才能录音")
    }

    private fun cancelSpeechInternal() {
        speechTimerJob?.cancel()
        speechTimerJob = null
        transcribeJob?.cancel()
        transcribeJob = null
        if (recorder.state.value is RecorderState.Active) recorder.cancel()
    }

    private fun setSpeechFailed(message: String) {
        _ui.update { it.copy(speech = SpeechUi.Failed(message)) }
    }

    // ------------------------------------------------------------ 工具

    private fun patchSession(
        sessionId: String,
        title: String? = null,
        running: Boolean? = null,
    ) {
        _ui.update { state ->
            state.copy(
                sessions = state.sessions.map { item ->
                    if (item.sessionId != sessionId) {
                        item
                    } else {
                        item.copy(
                            title = title ?: item.title,
                            running = running ?: item.running,
                        )
                    }
                },
            )
        }
    }

    private inline fun updateChat(sessionId: String, transform: (ChatState) -> ChatState) {
        _ui.update { state ->
            val chat = state.chat
            if (chat != null && chat.sessionId == sessionId) {
                state.copy(chat = transform(chat))
            } else {
                state
            }
        }
    }

    private fun mergeRecords(old: List<ChatRecord>, incoming: List<ChatRecord>): List<ChatRecord> {
        if (incoming.isEmpty()) return old
        val map = LinkedHashMap<Long, ChatRecord>(old.size + incoming.size)
        for (record in old) map[record.seq] = record
        for (record in incoming) map[record.seq] = record
        return map.values.sortedBy { it.seq }
    }

    private fun friendly(error: Throwable): String = when (error) {
        is LinkException -> when (error.code) {
            "offline" -> "目标电脑不在线"
            "unauthorized" -> "token 无效，请重新配对"
            "timeout" -> "操作超时"
            "busy" -> "电脑正忙"
            "unavailable" -> "电脑端 DSH 未就绪"
            "not-found" -> "会话不存在"
            "bad-request" -> "请求参数无效"
            "internal" -> error.message?.takeIf { it.isNotBlank() } ?: "电脑端处理失败"
            else -> error.message?.takeIf { it.isNotBlank() } ?: "操作失败（${error.code}）"
        }
        is UnknownHostException -> "无法解析中继服务器地址"
        is ConnectException -> "无法连接中继服务器"
        is SocketTimeoutException -> "网络超时"
        is javax.net.ssl.SSLException -> "TLS 连接失败，请检查证书"
        else -> error.message?.takeIf { it.isNotBlank() } ?: "操作失败"
    }

    override fun onCleared() {
        chatJob?.cancel()
        transcribeJob?.cancel()
        speechTimerJob?.cancel()
        recorder.cancel()
        client.close()
        super.onCleared()
    }

    companion object {
        private const val HISTORY_PAGE = 80
        private const val SPEECH_TIMEOUT_MS = 150_000L
        /** 100 ms @ 16 kHz mono PCM16。 */
        private const val MIN_PCM_BYTES = 3_200
    }
}
