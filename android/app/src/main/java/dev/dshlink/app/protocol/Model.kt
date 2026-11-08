package dev.dshlink.app.protocol

import org.json.JSONArray
import org.json.JSONObject

/** relay 返回的错误体（PROTOCOL.md 第 5 节）。 */
data class RelayError(val code: String, val message: String) {
    companion object {
        fun parse(obj: JSONObject?): RelayError? {
            if (obj == null) return null
            return RelayError(
                code = obj.optString("code", "internal"),
                message = obj.optString("message", ""),
            )
        }
    }
}

/** 同空间内的在线设备（peers 不含自己）。 */
data class Peer(
    val id: String,
    val name: String,
    val platform: String,
    val since: Long?,
) {
    val platformLabel: String
        get() = when (platform.lowercase()) {
            "macos" -> "macOS"
            "windows" -> "Windows"
            "linux" -> "Linux"
            "android" -> "Android"
            "ios" -> "iOS"
            "web" -> "Web"
            else -> platform
        }

    companion object {
        fun parse(obj: JSONObject?): Peer? {
            if (obj == null) return null
            val id = obj.optString("id", "").trim()
            if (id.isEmpty()) return null
            return Peer(
                id = id,
                name = obj.optString("name", "").trim().ifBlank { id },
                platform = obj.optString("platform", ""),
                since = obj.optLong("since", 0L).takeIf { it > 0L },
            )
        }

        fun parseList(arr: JSONArray?): List<Peer> {
            if (arr == null) return emptyList()
            val out = ArrayList<Peer>(arr.length())
            for (i in 0 until arr.length()) {
                val peer = parse(arr.optJSONObject(i))
                if (peer != null) out.add(peer)
            }
            return out
        }
    }
}

/** `device.info` 返回（PROTOCOL.md 3.1）。 */
data class DeviceInfo(
    val deviceId: String,
    val name: String,
    val platform: String,
    val version: String?,
    val dshVersion: String?,
    val time: Long,
    val workspaceDefault: String?,
    val capabilities: List<String>,
    val speechAvailable: Boolean?,
    val speechProviders: List<String>,
    val speechLanguage: String?,
) {
    companion object {
        fun parse(obj: JSONObject): DeviceInfo {
            val speech = obj.optJSONObject("speech")
            val available = when {
                speech == null -> null
                !speech.has("available") -> null
                else -> speech.optBoolean("available", false)
            }
            val providers = ArrayList<String>()
            val providerArr = speech?.optJSONArray("providers")
            if (providerArr != null) {
                for (i in 0 until providerArr.length()) {
                    val item = providerArr.optJSONObject(i)
                    if (item != null) {
                        providers.add(item.optString("id", ""))
                    } else {
                        val plain = providerArr.optString(i, "")
                        if (plain.isNotEmpty()) providers.add(plain)
                    }
                }
            }
            val caps = ArrayList<String>()
            val capArr = obj.optJSONArray("capabilities")
            if (capArr != null) {
                for (i in 0 until capArr.length()) {
                    val cap = capArr.optString(i, "")
                    if (cap.isNotEmpty()) caps.add(cap)
                }
            }
            return DeviceInfo(
                deviceId = obj.optString("deviceId", ""),
                name = obj.optString("name", ""),
                platform = obj.optString("platform", ""),
                version = obj.optString("version", "").ifBlank { null },
                dshVersion = obj.optString("dshVersion", "").ifBlank { null },
                time = obj.optLong("time", 0L),
                workspaceDefault = obj.optString("workspaceDefault", "").ifBlank { null },
                capabilities = caps,
                speechAvailable = available,
                speechProviders = providers,
                speechLanguage = speech?.optString("language", "")?.ifBlank { null },
            )
        }
    }
}

/** `workspace.list` 的单项。 */
data class WorkspaceInfo(
    val workspaceId: String,
    val title: String,
    val path: String?,
) {
    companion object {
        fun parseList(arr: JSONArray?): List<WorkspaceInfo> {
            if (arr == null) return emptyList()
            val out = ArrayList<WorkspaceInfo>(arr.length())
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = obj.optString("workspaceId", "").trim()
                if (id.isEmpty()) continue
                out.add(
                    WorkspaceInfo(
                        workspaceId = id,
                        title = obj.optString("title", "").trim().ifBlank { id },
                        path = obj.optString("path", "").ifBlank { null },
                    ),
                )
            }
            return out
        }
    }
}

/** `SessionSummaryView`（PROTOCOL.md 3.2）。 */
data class SessionSummary(
    val sessionId: String,
    val title: String,
    val cwd: String?,
    val updatedAt: Long,
    val running: Boolean,
    val active: Boolean,
    val agentAvailable: Boolean,
    val blank: Boolean,
    val parentSessionId: String?,
) {
    companion object {
        fun parse(obj: JSONObject?): SessionSummary? {
            if (obj == null) return null
            val id = obj.optString("sessionId", "").trim()
            if (id.isEmpty()) return null
            return SessionSummary(
                sessionId = id,
                title = obj.optString("title", "").trim(),
                cwd = obj.optString("cwd", "").ifBlank { null },
                updatedAt = obj.optLong("updatedAt", 0L),
                running = obj.optBoolean("running", false),
                active = obj.optBoolean("active", false),
                agentAvailable = obj.optBoolean("agentAvailable", true),
                blank = obj.optBoolean("blank", false),
                parentSessionId = obj.optString("parentSessionId", "").ifBlank { null },
            )
        }

        fun parseList(arr: JSONArray?): List<SessionSummary> {
            if (arr == null) return emptyList()
            val out = ArrayList<SessionSummary>(arr.length())
            for (i in 0 until arr.length()) {
                val item = parse(arr.optJSONObject(i))
                if (item != null) out.add(item)
            }
            return out
        }
    }
}

/** `SessionStateView`（PROTOCOL.md 3.2）。 */
data class SessionState(
    val active: Boolean,
    val running: Boolean,
    val queueCount: Int,
    val pendingInput: List<String>,
) {
    companion object {
        val EMPTY = SessionState(active = false, running = false, queueCount = 0, pendingInput = emptyList())

        fun parse(obj: JSONObject?): SessionState {
            if (obj == null) return EMPTY
            val pending = ArrayList<String>()
            val arr = obj.optJSONArray("pendingInput")
            if (arr != null) {
                for (i in 0 until arr.length()) pending.add(arr.optString(i, ""))
            }
            return SessionState(
                active = obj.optBoolean("active", false),
                running = obj.optBoolean("running", false),
                queueCount = obj.optInt("queueCount", 0),
                pendingInput = pending,
            )
        }
    }
}

/** 历史/实时记录（PROTOCOL.md 3.3）。 */
sealed class ChatRecord {
    abstract val seq: Long
    abstract val time: Long

    data class User(
        override val seq: Long,
        override val time: Long,
        val text: String,
    ) : ChatRecord()

    data class Assistant(
        override val seq: Long,
        override val time: Long,
        val text: String,
        val reasoning: String?,
    ) : ChatRecord()

    data class ToolCall(
        override val seq: Long,
        override val time: Long,
        val callId: String,
        val name: String,
        val args: String,
    ) : ChatRecord()

    data class ToolResult(
        override val seq: Long,
        override val time: Long,
        val callId: String,
        val name: String,
        val isError: Boolean,
        val text: String,
    ) : ChatRecord()

    data class TurnStart(
        override val seq: Long,
        override val time: Long,
        val turn: Int,
    ) : ChatRecord()

    data class TurnEnd(
        override val seq: Long,
        override val time: Long,
        val turn: Int,
        val reason: String,
    ) : ChatRecord()

    data class ErrorEntry(
        override val seq: Long,
        override val time: Long,
        val message: String,
    ) : ChatRecord()

    companion object {
        fun parse(obj: JSONObject?): ChatRecord? {
            if (obj == null) return null
            if (!obj.has("seq")) return null
            val seq = obj.optLong("seq", -1L)
            if (seq < 0L) return null
            val time = obj.optLong("time", 0L)
            return when (obj.optString("kind", "")) {
                "user" -> User(seq, time, obj.optString("text", ""))
                "assistant" -> Assistant(
                    seq = seq,
                    time = time,
                    text = obj.optString("text", ""),
                    reasoning = obj.optString("reasoning", "").ifBlank { null },
                )
                "tool-call" -> ToolCall(
                    seq = seq,
                    time = time,
                    callId = obj.optString("callId", ""),
                    name = obj.optString("name", ""),
                    args = obj.optString("args", ""),
                )
                "tool-result" -> ToolResult(
                    seq = seq,
                    time = time,
                    callId = obj.optString("callId", ""),
                    name = obj.optString("name", ""),
                    isError = obj.optBoolean("isError", false),
                    text = obj.optString("text", ""),
                )
                "turn-start" -> TurnStart(seq, time, obj.optInt("turn", 0))
                "turn-end" -> TurnEnd(seq, time, obj.optInt("turn", 0), obj.optString("reason", ""))
                "error" -> ErrorEntry(seq, time, obj.optString("message", ""))
                else -> null // 未知事件忽略
            }
        }

        fun parseList(arr: JSONArray?): List<ChatRecord> {
            if (arr == null) return emptyList()
            val out = ArrayList<ChatRecord>(arr.length())
            for (i in 0 until arr.length()) {
                val record = parse(arr.optJSONObject(i))
                if (record != null) out.add(record)
            }
            return out
        }
    }
}

/** `session.follow` 流帧的 data 内容（PROTOCOL.md 3.4）。 */
sealed interface FollowData {
    data class Ready(val sessionId: String, val title: String) : FollowData
    data class Snapshot(
        val records: List<ChatRecord>,
        val cursor: Long,
        val state: SessionState,
    ) : FollowData

    data class Record(val record: ChatRecord) : FollowData
    data class StateChanged(val state: SessionState) : FollowData
    data class Title(val title: String) : FollowData
    data class Failure(val code: String, val message: String) : FollowData
    data object Unknown : FollowData

    companion object {
        fun parse(obj: JSONObject?): FollowData {
            if (obj == null) return Unknown
            return when (obj.optString("t", "")) {
                "ready" -> Ready(obj.optString("sessionId", ""), obj.optString("title", ""))
                "snapshot" -> Snapshot(
                    records = ChatRecord.parseList(obj.optJSONArray("records")),
                    cursor = obj.optLong("cursor", -1L),
                    state = SessionState.parse(obj.optJSONObject("state")),
                )
                "record" -> {
                    val record = ChatRecord.parse(obj.optJSONObject("record"))
                    if (record == null) Unknown else Record(record)
                }
                "state" -> StateChanged(SessionState.parse(obj.optJSONObject("state")))
                "title" -> Title(obj.optString("title", ""))
                "error" -> Failure(obj.optString("code", "internal"), obj.optString("message", ""))
                else -> Unknown
            }
        }
    }
}
