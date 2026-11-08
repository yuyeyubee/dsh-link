package dev.dshlink.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.dshlink.app.R
import dev.dshlink.app.vm.ChatState
import dev.dshlink.app.vm.LinkViewModel
import dev.dshlink.app.vm.SpeechUi
import dev.dshlink.app.vm.UiState

@Composable
fun Composer(state: UiState, viewModel: LinkViewModel) {
    val chat = state.chat ?: return
    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            viewModel.startRecording()
        } else {
            viewModel.onMicPermissionDenied()
        }
    }

    Surface(
        tonalElevation = 3.dp,
        shadowElevation = 6.dp,
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            when (val speech = state.speech) {
                is SpeechUi.Recording -> RecordingRow(
                    speech = speech,
                    onCancel = viewModel::cancelSpeech,
                    onFinish = viewModel::stopRecording,
                )

                SpeechUi.Transcribing -> TranscribingRow(onCancel = viewModel::cancelSpeech)

                is SpeechUi.Failed -> SpeechErrorRow(
                    message = speech.message,
                    canRetry = state.retryAudioBase64 != null,
                    onRetry = viewModel::retrySpeech,
                    onDismiss = viewModel::dismissSpeechError,
                )

                SpeechUi.Idle -> InputRow(
                    state = state,
                    viewModel = viewModel,
                    chat = chat,
                    onMic = {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.RECORD_AUDIO,
                        ) == PackageManager.PERMISSION_GRANTED
                        if (granted) {
                            viewModel.startRecording()
                        } else {
                            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun InputRow(
    state: UiState,
    viewModel: LinkViewModel,
    chat: ChatState,
    onMic: () -> Unit,
) {
    var modeMenu by remember { mutableStateOf(false) }
    val draft = state.draftFor(chat.sessionId)

    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                Surface(
                    onClick = { modeMenu = true },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = stringResource(
                                if (state.promptMode == UiState.MODE_STEER) {
                                    R.string.chat_mode_steer
                                } else {
                                    R.string.chat_mode_queue
                                },
                            ),
                            style = MaterialTheme.typography.labelSmall,
                        )
                        Icon(
                            painter = painterResource(R.drawable.ic_expand_more),
                            contentDescription = stringResource(R.string.chat_mode_label),
                            modifier = Modifier.size(14.dp),
                        )
                    }
                }
                DropdownMenu(expanded = modeMenu, onDismissRequest = { modeMenu = false }) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_mode_queue)) },
                        onClick = {
                            modeMenu = false
                            viewModel.setPromptMode(UiState.MODE_QUEUE)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_mode_steer)) },
                        onClick = {
                            modeMenu = false
                            viewModel.setPromptMode(UiState.MODE_STEER)
                        },
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            if (chat.running) {
                TextButton(onClick = { viewModel.stopTurn() }) {
                    Icon(
                        painter = painterResource(R.drawable.ic_stop),
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.error,
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(stringResource(R.string.chat_stop))
                }
            }
        }

        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = draft,
                onValueChange = viewModel::updateDraft,
                placeholder = { Text(stringResource(R.string.chat_input_hint)) },
                maxLines = 5,
                shape = RoundedCornerShape(20.dp),
                textStyle = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(6.dp))
            IconButton(
                onClick = onMic,
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_mic),
                    contentDescription = stringResource(R.string.record_start),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            FilledIconButton(
                onClick = { viewModel.sendPrompt() },
                enabled = draft.isNotBlank() && !state.sending,
                modifier = Modifier.size(44.dp),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_send),
                    contentDescription = stringResource(R.string.chat_send),
                )
            }
        }
    }
}

@Composable
private fun RecordingRow(
    speech: SpeechUi.Recording,
    onCancel: () -> Unit,
    onFinish: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).background(MaterialTheme.colorScheme.error, CircleShape))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = stringResource(R.string.record_recording),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = formatDuration(speech.elapsedMs) + " / " + (speech.maxMs / 1000L) + "s",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { speech.level.coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp),
            )
        }
        TextButton(onClick = onCancel) {
            Text(stringResource(R.string.record_cancel))
        }
        Button(onClick = onFinish) {
            Text(stringResource(R.string.record_finish))
        }
    }
}

@Composable
private fun TranscribingRow(onCancel: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(
            text = stringResource(R.string.record_transcribing),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onCancel) {
            Text(stringResource(R.string.record_cancel))
        }
    }
}

@Composable
private fun SpeechErrorRow(
    message: String,
    canRetry: Boolean,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = stringResource(R.string.record_failed) + "：" + message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.weight(1f),
        )
        if (canRetry) {
            TextButton(onClick = onRetry) {
                Text(stringResource(R.string.record_retry))
            }
        }
        TextButton(onClick = onDismiss) {
            Text(stringResource(R.string.record_cancel))
        }
    }
}

private fun formatDuration(ms: Long): String {
    val seconds = (ms / 1000L).coerceAtLeast(0L)
    val minutes = seconds / 60L
    val rest = seconds % 60L
    return "$minutes:" + rest.toString().padStart(2, '0')
}
