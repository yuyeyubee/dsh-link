package dev.dshlink.app.protocol

import org.json.JSONObject

/** relay 下行帧（PROTOCOL.md 第 2 节）。 */
sealed interface RelayFrame {
    data class Welcome(val self: Peer?, val peers: List<Peer>) : RelayFrame
    data class Presence(val peers: List<Peer>) : RelayFrame
    data class Reply(
        val id: String,
        val ok: Boolean,
        val result: JSONObject?,
        val error: RelayError?,
    ) : RelayFrame

    data class Event(val id: String, val data: JSONObject?) : RelayFrame
    data class Ended(val id: String) : RelayFrame

    /** relay 层错误：`{"t":"error","code":"auth-failed"|"bad-hello"|"version", ...}`，随后关闭连接。 */
    data class ServerError(val code: String, val message: String) : RelayFrame
    data object Unknown : RelayFrame
}

/** 帧编解码。所有上行帧都在这里生成，避免各处手写 JSON。 */
object Frames {

    const val PROTOCOL_VERSION = 1

    fun parse(text: String): RelayFrame? {
        val obj = try {
            JSONObject(text)
        } catch (t: Throwable) {
            return null
        }
        return when (obj.optString("t", "")) {
            "welcome" -> RelayFrame.Welcome(
                self = Peer.parse(obj.optJSONObject("self")),
                peers = Peer.parseList(obj.optJSONArray("peers")),
            )
            "presence" -> RelayFrame.Presence(Peer.parseList(obj.optJSONArray("peers")))
            "reply" -> {
                val id = obj.optString("id", "")
                if (id.isEmpty()) return null
                RelayFrame.Reply(
                    id = id,
                    ok = obj.optBoolean("ok", false),
                    result = obj.optJSONObject("result"),
                    error = RelayError.parse(obj.optJSONObject("error")),
                )
            }
            "event" -> {
                val id = obj.optString("id", "")
                if (id.isEmpty()) return null
                RelayFrame.Event(id, obj.optJSONObject("data"))
            }
            "end" -> {
                val id = obj.optString("id", "")
                if (id.isEmpty()) return null
                RelayFrame.Ended(id)
            }
            "error" -> RelayFrame.ServerError(
                code = obj.optString("code", ""),
                message = obj.optString("message", ""),
            )
            else -> RelayFrame.Unknown
        }
    }

    fun hello(
        token: String,
        deviceId: String,
        deviceName: String,
        role: String = "client",
    ): String {
        val device = JSONObject()
            .put("id", deviceId)
            .put("name", deviceName)
            .put("platform", "android")
        return JSONObject()
            .put("t", "hello")
            .put("v", PROTOCOL_VERSION)
            .put("role", role)
            .put("token", token)
            .put("device", device)
            .toString()
    }

    fun call(id: String, to: String, method: String, params: JSONObject): String =
        JSONObject()
            .put("t", "call")
            .put("id", id)
            .put("to", to)
            .put("method", method)
            .put("params", params)
            .toString()

    fun sub(id: String, to: String, method: String, params: JSONObject): String =
        JSONObject()
            .put("t", "sub")
            .put("id", id)
            .put("to", to)
            .put("method", method)
            .put("params", params)
            .toString()

    fun unsub(id: String): String =
        JSONObject()
            .put("t", "unsub")
            .put("id", id)
            .toString()
}
