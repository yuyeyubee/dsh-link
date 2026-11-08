package dev.dshlink.app.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

class WavTest {

    @Test
    fun headerLayoutIsStandard44Bytes() {
        val pcm = ByteArray(32_000) // 1 秒 16 kHz 单声道 PCM16
        val wav = Wav.wrapPcm16(pcm)
        assertEquals(44 + pcm.size, wav.size)
        assertEquals("RIFF", String(wav, 0, 4, Charsets.US_ASCII))
        assertEquals("WAVE", String(wav, 8, 4, Charsets.US_ASCII))
        assertEquals("fmt ", String(wav, 12, 4, Charsets.US_ASCII))

        val buffer = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(36 + pcm.size, buffer.getInt(4))
        assertEquals(16, buffer.getInt(16)) // Subchunk1Size
        assertEquals(1.toShort(), buffer.getShort(20)) // PCM
        assertEquals(1.toShort(), buffer.getShort(22)) // mono
        assertEquals(16_000, buffer.getInt(24))
        assertEquals(32_000, buffer.getInt(28)) // byteRate
        assertEquals(2.toShort(), buffer.getShort(32)) // blockAlign
        assertEquals(16.toShort(), buffer.getShort(34)) // bitsPerSample
        assertEquals("data", String(wav, 36, 4, Charsets.US_ASCII))
        assertEquals(pcm.size, buffer.getInt(40))
    }

    @Test
    fun durationMatchesBytes() {
        assertEquals(1.0, Wav.durationSeconds(32_000), 1e-9)
        assertEquals(0.1, Wav.durationSeconds(3_200), 1e-9)
        assertEquals(0.0, Wav.durationSeconds(0), 1e-9)
    }

    @Test
    fun base64RoundTrip() {
        val pcm = ByteArray(100) { (it % 128).toByte() }
        val wav = Wav.wrapPcm16(pcm)
        val encoded = Wav.base64(wav)
        assertTrue(Base64.getDecoder().decode(encoded).contentEquals(wav))
    }

    @Test
    fun isWavRecognisesHeader() {
        assertTrue(Wav.isWav(Wav.wrapPcm16(ByteArray(0))))
        assertFalse(Wav.isWav(ByteArray(10)))
        assertFalse(Wav.isWav(ByteArray(100)))
    }

    @Test
    fun sixtySecondsStaysUnderProtocolLimit() {
        val pcm = ByteArray(60 * Wav.BYTES_PER_SECOND)
        assertEquals(1_920_000, pcm.size)
        // PROTOCOL.md 3.5：解码后 ≤ 4 MiB
        assertTrue(pcm.size <= 4 * 1024 * 1024)
    }
}
