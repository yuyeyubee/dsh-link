package dev.dshlink.app.audio

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import kotlin.math.sqrt

sealed interface RecorderState {
    data object Idle : RecorderState
    data class Active(
        val elapsedMs: Long,
        val level: Float,
        val maxMs: Long,
    ) : RecorderState
}

/**
 * AudioRecord 录音：16 kHz / 单声道 / PCM16，累计到内存（≤ maxSeconds 秒）。
 * 停止后返回裸 PCM；WAV 头由 [Wav] 负责。
 */
class AudioRecorder(private val context: Context) {

    private val _state = MutableStateFlow<RecorderState>(RecorderState.Idle)
    val state: StateFlow<RecorderState> = _state.asStateFlow()

    private val buffer = ByteArrayOutputStream()
    private var record: AudioRecord? = null
    private var job: Job? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start(scope: CoroutineScope, maxSeconds: Int = DEFAULT_MAX_SECONDS): Boolean {
        if (job?.isActive == true) return false
        if (!hasPermission()) return false

        val minBuffer = AudioRecord.getMinBufferSize(
            Wav.SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) return false
        val bufferSize = maxOf(minBuffer * 2, Wav.SAMPLE_RATE * Wav.BYTES_PER_SAMPLE / 5)

        val recorder = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                Wav.SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize,
            )
        } catch (t: Throwable) {
            return false
        }
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { recorder.release() }
            return false
        }

        synchronized(buffer) { buffer.reset() }
        try {
            recorder.startRecording()
        } catch (t: Throwable) {
            runCatching { recorder.release() }
            return false
        }
        if (recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
            runCatching { recorder.release() }
            return false
        }

        record = recorder
        val maxBytes = maxSeconds * Wav.BYTES_PER_SECOND
        val maxMs = maxSeconds * 1000L

        job = scope.launch(Dispatchers.IO) {
            val chunk = ByteArray(Wav.SAMPLE_RATE / 10 * Wav.BYTES_PER_SAMPLE) // 100 ms
            var total = 0
            var level = 0f
            var lastEmit = 0L
            try {
                while (isActive) {
                    val read = recorder.read(chunk, 0, chunk.size)
                    if (read <= 0) {
                        if (read < 0) break
                        continue
                    }
                    synchronized(buffer) {
                        val room = maxBytes - total
                        if (room > 0) {
                            val n = minOf(read, room)
                            buffer.write(chunk, 0, n)
                            total += n
                        }
                    }
                    level = rmsLevel(chunk, read)
                    val now = System.currentTimeMillis()
                    if (now - lastEmit >= 100L) {
                        lastEmit = now
                        _state.value = RecorderState.Active(
                            elapsedMs = (Wav.durationSeconds(total) * 1000.0).toLong(),
                            level = level,
                            maxMs = maxMs,
                        )
                    }
                    if (total >= maxBytes) break
                }
            } catch (t: Throwable) {
                // 录音线程异常（设备被抢占等）：保持已录内容，交给 stop() 返回
            } finally {
                runCatching { if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop() }
                runCatching { recorder.release() }
                if (record === recorder) record = null
                if (_state.value is RecorderState.Active) {
                    _state.value = RecorderState.Idle
                }
            }
        }
        _state.value = RecorderState.Active(elapsedMs = 0L, level = 0f, maxMs = maxMs)
        return true
    }

    /** 停止并返回裸 PCM16（可能为空数组）。 */
    fun stop(): ByteArray {
        val recorder = record
        job?.cancel()
        job = null
        record = null
        if (recorder != null) {
            runCatching { if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) recorder.stop() }
            runCatching { recorder.release() }
        }
        val pcm = synchronized(buffer) {
            val data = buffer.toByteArray()
            buffer.reset()
            data
        }
        _state.value = RecorderState.Idle
        return pcm
    }

    /** 放弃当前录音。 */
    fun cancel() {
        stop()
    }

    private fun rmsLevel(chunk: ByteArray, length: Int): Float {
        if (length < 2) return 0f
        var sum = 0.0
        var count = 0
        var i = 0
        while (i + 1 < length) {
            val sample = ((chunk[i + 1].toInt() shl 8) or (chunk[i].toInt() and 0xFF)).toShort().toInt()
            sum += sample.toDouble() * sample.toDouble()
            count++
            i += 2
        }
        if (count == 0) return 0f
        val rms = sqrt(sum / count) / 32768.0
        return (rms * 4.0).coerceIn(0.0, 1.0).toFloat()
    }

    companion object {
        const val DEFAULT_MAX_SECONDS = 60
        /** 解码后 ≤ 4 MiB（PROTOCOL.md 3.5）；60 s PCM16 单声道约 1.9 MiB。 */
        const val MAX_PCM_BYTES = 3_500_000
    }
}
