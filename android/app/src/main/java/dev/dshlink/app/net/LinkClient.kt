package dev.dshlink.app.net

import dev.dshlink.app.data.Prefs
import dev.dshlink.app.protocol.ChatRecord
import dev.dshlink.app.protocol.Frames
import dev.dshlink.app.protocol.Peer
import dev.dshlink.app.protocol.RelayFrame
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.random.Random

/** 带协议错误码的调用异常（错误码见 PROTOCOL.md 第 5 节）。 */
class LinkException(val code: String, message: String) : Exception(message)

/** `session.follow` 等订阅流的下行消息。 */
sealed interface SubMessage {
    data object Accepted : SubMessage
    data class Data(val json: JSONObject) : SubMessage
    data object Ended : SubMessage
    data class Failed(val code: String, val message: String) : SubMessage
}

enum class ConnectionState { Unconfigured, Connecting, Connected, Offline }

/**
 * relay WebSocket 客户端（PROTOCOL.md 第 2 节）。
 *
 * - 持有连接状态 / peers / self / lastError。
 * - `call()` 实现 30 s 超时与迟到 reply 丢弃。
 * - `subscribe()` 用 channelFlow 把 reply/event/end 映射成 [SubMessage]。
 * - 断线按 1s、2s、4s … 30s（±20% 抖动）指数退避重连，重连后重新 hello。
 */
class LinkClient(
    private val scope: CoroutineScope,
    private val prefs: Prefs,
) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val _state = MutableStateFlow(
        if (prefs.configured) ConnectionState.Offline else ConnectionState.Unconfigured,
    )
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    private val _peers = MutableStateFlow<List<Peer>>(emptyList())
    val peers: StateFlow<List<Peer>> = _peers.asStateFlow()

    private val _self = MutableStateFlow<Peer?>(null)
    val self: StateFlow<Peer?> = _self.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    /** 每次收到 welcome 自增，UI 用它触发「重连后补齐」。 */
    private val _epoch = MutableStateFlow(0)
    val epoch: StateFlow<Int> = _epoch.asStateFlow()

    @Volatile
    private var socket: WebSocket? = null

    @Volatile
    private var loopJob: Job? = null

    @Volatile
    private var stopping = false

    @Volatile
    private var fatal = false

    @Volatile
    private var attempt = 0

    private val callSeq = AtomicInteger(0)
    private val subSeq = AtomicInteger(0)

    private val pending = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val subs = ConcurrentHashMap<String, Channel<SubMessage>>()

    fun start() {
        if (!prefs.configured) {
            _state.value = ConnectionState.Unconfigured
            return
        }
        if (loopJob?.isActive == true) return
        stopping = false
        fatal = false
        attempt = 0
        loopJob = scope.launch(start = CoroutineStart.DEFAULT) { connectLoop() }
    }

    fun stop() {
        stopping = true
        fatal = false
        loopJob?.cancel()
        loopJob = null
        closeSocket()
        failAll(LinkException("offline", "连接已断开"))
        _state.value = if (prefs.configured) ConnectionState.Offline else ConnectionState.Unconfigured
        _self.value = null
        _peers.value = emptyList()
    }

    fun close() {
        stop()
    }

    /**
     * 发起一次 RPC。超时（默认 30 s，PROTOCOL.md 2.3）后抛出 `LinkException("timeout")`，
     * 迟到的 reply 会被丢弃（id 已从 pending 移除）。
     */
    suspend fun call(
        to: String,
        method: String,
        params: JSONObject = JSONObject(),
        timeoutMs: Long = CALL_TIMEOUT_MS,
    ): JSONObject {
        val ws = socket ?: throw LinkException("offline", "尚未连接到中继服务器")
        val id = "c" + callSeq.incrementAndGet()
        val deferred = CompletableDeferred<JSONObject>()
        pending[id] = deferred
        if (!ws.send(Frames.call(id, to, method, params))) {
            pending.remove(id)
            throw LinkException("offline", "发送失败，连接可能已断开")
        }
        try {
            return withTimeout(timeoutMs) { deferred.await() }
        } catch (e: TimeoutCancellationException) {
            throw LinkException("timeout", "等待 ${method} 超时")
        } catch (e: CancellationException) {
            throw e
        } finally {
            pending.remove(id)
        }
    }

    /**
     * 发起订阅（`sub`），依次产出 [SubMessage.Accepted] / [SubMessage.Data] / [SubMessage.Ended]。
     * 流被取消时自动向 relay 发 `unsub`。
     */
    fun subscribe(
        to: String,
        method: String,
        params: JSONObject,
    ): Flow<SubMessage> = channelFlow {
        val ws = socket
        if (ws == null) {
            send(SubMessage.Failed("offline", "尚未连接到中继服务器"))
            return@channelFlow
        }
        val id = "s" + subSeq.incrementAndGet()
        val channel = Channel<SubMessage>(Channel.UNLIMITED)
        subs[id] = channel
        if (!ws.send(Frames.sub(id, to, method, params))) {
            subs.remove(id)
            channel.close()
            send(SubMessage.Failed("offline", "发送失败，连接可能已断开"))
            return@channelFlow
        }
        try {
            for (message in channel) {
                send(message)
                if (message is SubMessage.Failed || message is SubMessage.Ended) break
            }
        } finally {
            subs.remove(id)
            runCatching { socket?.send(Frames.unsub(id)) }
        }
    }

    // ---------------------------------------------------------------- 连接循环

    private suspend fun connectLoop() {
        attempt = 0
        while (currentCoroutineContext().isActive && !stopping) {
            _state.value = ConnectionState.Connecting
            val sawWelcome = connectOnce()
            if (stopping || fatal) break
            attempt = if (sawWelcome) 1 else attempt + 1
            _state.value = ConnectionState.Offline
            if (_lastError.value == null) {
                _lastError.value = "连接已断开，正在重连…"
            }
            delay(backoffMillis(attempt))
        }
    }

    private suspend fun connectOnce(): Boolean {
        val url = prefs.relayUrl
        val token = prefs.token
        if (url == null || token == null) {
            _state.value = ConnectionState.Unconfigured
            return false
        }
        val welcomeSeen = AtomicBoolean(false)
        val deferred = CompletableDeferred<Boolean>()
        val request = try {
            Request.Builder().url(url).build()
        } catch (t: Throwable) {
            _lastError.value = "中继地址无效"
            return false
        }
        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                socket = webSocket
                val hello = Frames.hello(
                    token = token,
                    deviceId = prefs.deviceId,
                    deviceName = prefs.deviceName,
                    role = "client",
                )
                if (!webSocket.send(hello)) {
                    webSocket.close(1000, null)
                    deferred.complete(false)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = Frames.parse(text)
                if (frame == null) return
                if (frame is RelayFrame.Welcome) {
                    welcomeSeen.set(true)
                    attempt = 0
                }
                dispatch(frame)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                deferred.complete(welcomeSeen.get())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _lastError.value = describeFailure(t, response)
                deferred.complete(welcomeSeen.get())
            }
        }

        val ws = try {
            http.newWebSocket(request, listener)
        } catch (t: Throwable) {
            _lastError.value = describeFailure(t, null)
            return false
        }

        val sawWelcome = try {
            deferred.await()
        } catch (e: CancellationException) {
            runCatching { ws.cancel() }
            socket = null
            throw e
        } finally {
            if (socket === ws) socket = null
        }
        if (!fatal) {
            runCatching { ws.close(1000, null) }
        }
        failAll(LinkException("offline", "连接已断开"))
        return sawWelcome
    }

    private fun dispatch(frame: RelayFrame) {
        when (frame) {
            is RelayFrame.Welcome -> {
                _self.value = frame.self
                _peers.value = frame.peers
                _lastError.value = null
                _state.value = ConnectionState.Connected
                _epoch.value = _epoch.value + 1
            }

            is RelayFrame.Presence -> {
                _peers.value = frame.peers
            }

            is RelayFrame.Reply -> {
                val deferred = pending.remove(frame.id)
                if (deferred != null) {
                    if (frame.ok) {
                        deferred.complete(frame.result ?: JSONObject())
                    } else {
                        val code = frame.error?.code ?: "internal"
                        val message = frame.error?.message ?: "调用失败"
                        deferred.completeExceptionally(LinkException(code, message))
                    }
                    return
                }
                val channel = subs[frame.id] ?: return
                if (frame.ok) {
                    channel.trySend(SubMessage.Accepted)
                } else {
                    subs.remove(frame.id)
                    channel.trySend(
                        SubMessage.Failed(
                            code = frame.error?.code ?: "internal",
                            message = frame.error?.message ?: "订阅失败",
                        ),
                    )
                    channel.close()
                }
            }

            is RelayFrame.Event -> {
                subs[frame.id]?.trySend(SubMessage.Data(frame.data ?: JSONObject()))
            }

            is RelayFrame.Ended -> {
                val channel = subs.remove(frame.id) ?: return
                channel.trySend(SubMessage.Ended)
                channel.close()
            }

            is RelayFrame.ServerError -> {
                val message = frame.message.ifBlank { frame.code }
                _lastError.value = message
                if (frame.code == "auth-failed" || frame.code == "bad-hello" || frame.code == "version") {
                    fatal = true
                    _state.value = ConnectionState.Offline
                    closeSocket()
                }
            }

            RelayFrame.Unknown -> Unit
        }
    }

    // ---------------------------------------------------------------- 清理

    private fun closeSocket() {
        val ws = socket
        socket = null
        if (ws != null) {
            runCatching { ws.close(1000, null) }
            runCatching { ws.cancel() }
        }
    }

    private fun failAll(error: LinkException) {
        for (entry in pending.entries) {
            entry.value.completeExceptionally(error)
        }
        pending.clear()
        for (channel in subs.values) {
            channel.trySend(SubMessage.Failed(error.code, error.message ?: "连接已断开"))
            channel.close()
        }
        subs.clear()
    }

    private fun backoffMillis(attempt: Int): Long {
        val base = 1000L * (1L shl (attempt - 1).coerceIn(0, 5))
        val capped = base.coerceAtMost(MAX_BACKOFF_MS)
        val jitter = 0.8 + Random.nextDouble() * 0.4
        return (capped * jitter).toLong()
    }

    private fun describeFailure(t: Throwable, response: Response?): String {
        val status = response?.code
        return when {
            status == 401 || status == 403 -> "中继服务器拒绝连接（$status），请检查 token"
            status != null -> "中继服务器返回 $status"
            t is java.net.UnknownHostException -> "无法解析中继服务器地址"
            t is java.net.ConnectException -> "无法连接中继服务器"
            t is java.net.SocketTimeoutException -> "连接中继服务器超时"
            t is javax.net.ssl.SSLException -> "TLS 握手失败，请检查证书与地址"
            else -> "连接失败：${t.javaClass.simpleName}"
        }
    }

    companion object {
        const val CALL_TIMEOUT_MS = 30_000L
        private const val MAX_BACKOFF_MS = 30_000L
    }
}
