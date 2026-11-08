package dev.dshlink.app.data

import android.content.Context
import android.os.Build
import java.security.SecureRandom

/**
 * 应用私有存储：配对信息、本机设备身份。
 *
 * token 只保存在这里（应用私有目录），除了 hello 帧外不发送、不打印。
 */
class Prefs(context: Context) {

    private val sp = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    val relayUrl: String?
        get() = sp.getString(KEY_URL, null)?.takeIf { it.isNotBlank() }

    val token: String?
        get() = sp.getString(KEY_TOKEN, null)?.takeIf { it.isNotBlank() }

    val configured: Boolean
        get() = relayUrl != null && token != null

    /** `dev_` + 16 hex，首次使用时生成并持久化。 */
    val deviceId: String
        get() {
            val existing = sp.getString(KEY_DEVICE_ID, null)
            if (!existing.isNullOrBlank()) return existing
            val generated = "dev_" + randomHex(8)
            sp.edit().putString(KEY_DEVICE_ID, generated).apply()
            return generated
        }

    var deviceName: String
        get() = sp.getString(KEY_DEVICE_NAME, null)?.trim().takeUnless { it.isNullOrEmpty() }
            ?: defaultDeviceName()
        set(value) {
            sp.edit().putString(KEY_DEVICE_NAME, value.trim()).apply()
        }

    fun savePairing(relayUrl: String, token: String) {
        sp.edit().putString(KEY_URL, relayUrl).putString(KEY_TOKEN, token).apply()
    }

    fun clearPairing() {
        sp.edit().remove(KEY_URL).remove(KEY_TOKEN).apply()
    }

    companion object {
        private const val FILE = "dsh_link"
        private const val KEY_URL = "relay_url"
        private const val KEY_TOKEN = "space_token"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_NAME = "device_name"

        fun defaultDeviceName(): String {
            val model = (Build.MODEL ?: "").trim()
            return if (model.isEmpty()) "Android 手机" else model
        }

        fun randomHex(bytes: Int): String {
            val random = SecureRandom()
            val data = ByteArray(bytes)
            random.nextBytes(data)
            val sb = StringBuilder(bytes * 2)
            for (b in data) {
                val v = b.toInt() and 0xFF
                sb.append(HEX[v ushr 4])
                sb.append(HEX[v and 0x0F])
            }
            return sb.toString()
        }

        private val HEX = "0123456789abcdef".toCharArray()
    }
}
