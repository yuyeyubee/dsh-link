package dev.dshlink.app.audio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64

/**
 * 标准 44 字节 WAV 封装（PROTOCOL.md 3.5：16 kHz / 单声道 / 16-bit PCM）。
 * 纯 JVM 实现，便于单元测试。
 */
object Wav {

    const val HEADER_BYTES = 44
    const val SAMPLE_RATE = 16_000
    const val CHANNELS = 1
    const val BITS_PER_SAMPLE = 16
    const val BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
    const val BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE

    /** 在 PCM16 数据前加 44 字节 WAV 头。 */
    fun wrapPcm16(
        pcm: ByteArray,
        sampleRate: Int = SAMPLE_RATE,
        channels: Int = CHANNELS,
    ): ByteArray {
        val dataLen = pcm.size
        val blockAlign = channels * BYTES_PER_SAMPLE
        val byteRate = sampleRate * blockAlign
        val buffer = ByteBuffer.allocate(HEADER_BYTES + dataLen).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(ascii("RIFF"))
        buffer.putInt(36 + dataLen)
        buffer.put(ascii("WAVE"))
        buffer.put(ascii("fmt "))
        buffer.putInt(16) // Subchunk1Size
        buffer.putShort(1) // AudioFormat = PCM
        buffer.putShort(channels.toShort())
        buffer.putInt(sampleRate)
        buffer.putInt(byteRate)
        buffer.putShort(blockAlign.toShort())
        buffer.putShort(BITS_PER_SAMPLE.toShort())
        buffer.put(ascii("data"))
        buffer.putInt(dataLen)
        buffer.put(pcm)
        return buffer.array()
    }

    fun base64(wav: ByteArray): String = Base64.getEncoder().encodeToString(wav)

    fun durationSeconds(pcmBytes: Int, sampleRate: Int = SAMPLE_RATE, channels: Int = CHANNELS): Double {
        val bytesPerSecond = sampleRate * channels * BYTES_PER_SAMPLE
        if (bytesPerSecond <= 0) return 0.0
        return pcmBytes.toDouble() / bytesPerSecond
    }

    fun isWav(bytes: ByteArray): Boolean {
        if (bytes.size < HEADER_BYTES) return false
        val riff = String(bytes, 0, 4, Charsets.US_ASCII)
        val wave = String(bytes, 8, 4, Charsets.US_ASCII)
        return riff == "RIFF" && wave == "WAVE"
    }

    private fun ascii(value: String): ByteArray = value.toByteArray(Charsets.US_ASCII)
}
