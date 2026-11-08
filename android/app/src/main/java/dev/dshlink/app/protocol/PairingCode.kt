package dev.dshlink.app.protocol

import org.json.JSONObject
import java.net.URI
import java.util.Base64

/** 配对码解码结果。 */
data class PairingInfo(
    val version: Int,
    val relayUrl: String,
    val token: String,
)

sealed interface PairingResult {
    data class Ok(val info: PairingInfo) : PairingResult
    data class Invalid(val reason: String) : PairingResult
    data class UnsupportedVersion(val version: Int) : PairingResult
}

/**
 * 配对码编解码（PROTOCOL.md 第 1 节）。
 *
 * 格式：`dshlink1.<base64url(JSON)>`，JSON 为 `{"v":1,"u":"wss://...","t":"<64 hex>"}`。
 * 解码端忽略未知字段。
 */
object PairingCode {

    const val PREFIX = "dshlink1."
    const val CURRENT_VERSION = 1

    private val TOKEN_RE = Regex("^[0-9a-fA-F]{64}$")
    private val BASE64URL_RE = Regex("^[A-Za-z0-9_-]+$")

    fun parse(raw: String): PairingResult {
        val text = raw.trim()
        if (!text.startsWith(PREFIX)) return PairingResult.Invalid("缺少 dshlink1. 前缀")
        val body = text.substring(PREFIX.length).trim()
        if (body.isEmpty()) return PairingResult.Invalid("配对码内容为空")
        if (!BASE64URL_RE.matches(body)) return PairingResult.Invalid("配对码不是合法的 base64url")
        val jsonText = try {
            String(decodeBase64Url(body), Charsets.UTF_8)
        } catch (t: Throwable) {
            return PairingResult.Invalid("配对码无法解码")
        }
        val json = try {
            JSONObject(jsonText)
        } catch (t: Throwable) {
            return PairingResult.Invalid("配对码内容不是 JSON")
        }
        val version = json.optInt("v", -1)
        if (version != CURRENT_VERSION) return PairingResult.UnsupportedVersion(version)
        val url = json.optString("u", "").trim()
        val token = json.optString("t", "").trim()
        if (url.isEmpty()) return PairingResult.Invalid("缺少中继地址")
        if (!isValidToken(token)) return PairingResult.Invalid("token 格式错误")
        val normalized = normalizeRelayUrl(url) ?: return PairingResult.Invalid("中继地址无效")
        return PairingResult.Ok(PairingInfo(version, normalized, token))
    }

    fun encode(info: PairingInfo): String {
        val json = JSONObject()
            .put("v", info.version)
            .put("u", info.relayUrl)
            .put("t", info.token)
            .toString()
        return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
    }

    fun isValidToken(token: String): Boolean = TOKEN_RE.matches(token)

    /**
     * 规范化 relay 地址：补 `wss://`、去掉末尾 `/`。
     * 返回 null 表示不是可用的 WebSocket 地址。
     */
    fun normalizeRelayUrl(raw: String): String? {
        var text = raw.trim()
        if (text.isEmpty()) return null
        val hasScheme = text.contains("://")
        val wsScheme = text.startsWith("ws://", ignoreCase = true) ||
            text.startsWith("wss://", ignoreCase = true)
        if (hasScheme && !wsScheme) return null
        if (!hasScheme) {
            text = "wss://$text"
        }
        val uri = try {
            URI(text)
        } catch (t: Throwable) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "ws" && scheme != "wss") return null
        if (uri.host.isNullOrBlank()) return null
        val trimmed = text.trimEnd('/')
        return if (trimmed.endsWith(":")) null else trimmed
    }

    /** 便于展示：去掉 scheme 与端口，只留主机名。 */
    fun displayHost(url: String): String {
        val uri = try {
            URI(url)
        } catch (t: Throwable) {
            return url
        }
        val host = uri.host ?: return url
        val port = if (uri.port > 0) ":${uri.port}" else ""
        val scheme = if ((uri.scheme ?: "").lowercase() == "ws") "ws://" else "wss://"
        return "$scheme$host$port"
    }

    private fun decodeBase64Url(body: String): ByteArray {
        val padding = (4 - body.length % 4) % 4
        val padded = body + "=".repeat(padding)
        return Base64.getUrlDecoder().decode(padded)
    }
}
