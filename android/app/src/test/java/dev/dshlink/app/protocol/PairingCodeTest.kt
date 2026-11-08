package dev.dshlink.app.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class PairingCodeTest {

    private val token = "0123456789abcdef".repeat(4)

    private fun encodeJson(json: String): String =
        "dshlink1." + Base64.getUrlEncoder().withoutPadding()
            .encodeToString(json.toByteArray(Charsets.UTF_8))

    @Test
    fun encodeDecodeRoundTrip() {
        val info = PairingInfo(1, "wss://relay.example.com:8443", token)
        val code = PairingCode.encode(info)
        assertTrue(code.startsWith(PairingCode.PREFIX))
        assertTrue("base64url 不应包含 = 填充", !code.contains("="))

        val result = PairingCode.parse(code)
        assertTrue(result is PairingResult.Ok)
        val parsed = (result as PairingResult.Ok).info
        assertEquals(1, parsed.version)
        assertEquals("wss://relay.example.com:8443", parsed.relayUrl)
        assertEquals(token, parsed.token)
    }

    @Test
    fun parseProductionStyleCode() {
        val code = encodeJson("""{"v":1,"u":"wss://relay.example.com:8443","t":"$token"}""")
        val result = PairingCode.parse(code)
        assertTrue(result is PairingResult.Ok)
        assertEquals(
            "wss://relay.example.com:8443",
            (result as PairingResult.Ok).info.relayUrl,
        )
    }

    @Test
    fun ignoresUnknownFieldsAndKeyOrder() {
        val code = encodeJson("""{"t":"$token","x":"ignore-me","v":1,"u":"wss://h.example:8443"}""")
        val result = PairingCode.parse(code)
        assertTrue(result is PairingResult.Ok)
        assertEquals("wss://h.example:8443", (result as PairingResult.Ok).info.relayUrl)
    }

    @Test
    fun rejectsMissingPrefix() {
        val result = PairingCode.parse("https://example.com")
        assertTrue(result is PairingResult.Invalid)
    }

    @Test
    fun rejectsBrokenBase64() {
        assertTrue(PairingCode.parse("dshlink1.***") is PairingResult.Invalid)
        assertTrue(PairingCode.parse("dshlink1.") is PairingResult.Invalid)
    }

    @Test
    fun rejectsNonJsonPayload() {
        val code = "dshlink1." + Base64.getUrlEncoder().withoutPadding()
            .encodeToString("not json".toByteArray(Charsets.UTF_8))
        assertTrue(PairingCode.parse(code) is PairingResult.Invalid)
    }

    @Test
    fun reportsUnsupportedVersion() {
        val code = encodeJson("""{"v":2,"u":"wss://h.example:8443","t":"$token"}""")
        val result = PairingCode.parse(code)
        assertTrue(result is PairingResult.UnsupportedVersion)
        assertEquals(2, (result as PairingResult.UnsupportedVersion).version)
    }

    @Test
    fun rejectsBadToken() {
        val short = encodeJson("""{"v":1,"u":"wss://h.example:8443","t":"abcd"}""")
        assertTrue(PairingCode.parse(short) is PairingResult.Invalid)
        val nonHex = encodeJson("""{"v":1,"u":"wss://h.example:8443","t":"${"z".repeat(64)}"}""")
        assertTrue(PairingCode.parse(nonHex) is PairingResult.Invalid)
    }

    @Test
    fun rejectsBadUrl() {
        val code = encodeJson("""{"v":1,"u":"http://h.example","t":"$token"}""")
        assertTrue(PairingCode.parse(code) is PairingResult.Invalid)
        assertNull(PairingCode.normalizeRelayUrl(""))
        assertNull(PairingCode.normalizeRelayUrl("http://h.example"))
    }

    @Test
    fun normalizesRelayUrl() {
        assertEquals("wss://192.0.2.10:8443", PairingCode.normalizeRelayUrl("192.0.2.10:8443"))
        assertEquals("wss://h.example:8443", PairingCode.normalizeRelayUrl("wss://h.example:8443/"))
        assertEquals("ws://127.0.0.1:9000", PairingCode.normalizeRelayUrl("ws://127.0.0.1:9000"))
    }

    @Test
    fun displayHostKeepsSchemeUserInfoFree() {
        assertEquals(
            "wss://relay.example.com:8443",
            PairingCode.displayHost("wss://relay.example.com:8443"),
        )
    }

    @Test
    fun tokenValidation() {
        assertTrue(PairingCode.isValidToken(token))
        assertTrue(PairingCode.isValidToken(token.uppercase()))
        assertTrue(!PairingCode.isValidToken("abc"))
    }
}
