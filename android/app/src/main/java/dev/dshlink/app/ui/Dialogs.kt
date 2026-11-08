package dev.dshlink.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.dshlink.app.R
import dev.dshlink.app.net.ConnectionState
import dev.dshlink.app.protocol.PairingCode
import dev.dshlink.app.protocol.WorkspaceInfo
import dev.dshlink.app.vm.LinkViewModel
import dev.dshlink.app.vm.UiState

internal const val APP_VERSION = "1.0.0"

@Composable
fun NewSessionDialog(
    workspaces: List<WorkspaceInfo>,
    onDismiss: () -> Unit,
    onCreate: (workspaceId: String?, cwd: String) -> Unit,
) {
    var selectedWorkspaceId by remember { mutableStateOf<String?>(null) }
    var cwd by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.new_session_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    text = stringResource(R.string.new_session_workspace),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                WorkspaceOption(
                    selected = selectedWorkspaceId == null,
                    title = stringResource(R.string.new_session_workspace_default),
                    subtitle = null,
                    onClick = { selectedWorkspaceId = null },
                )
                workspaces.forEach { workspace ->
                    WorkspaceOption(
                        selected = selectedWorkspaceId == workspace.workspaceId,
                        title = workspace.title,
                        subtitle = workspace.path,
                        onClick = { selectedWorkspaceId = workspace.workspaceId },
                    )
                }
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = cwd,
                    onValueChange = { cwd = it },
                    label = { Text(stringResource(R.string.new_session_cwd)) },
                    placeholder = { Text(stringResource(R.string.new_session_cwd_placeholder)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(selectedWorkspaceId, cwd) }) {
                Text(stringResource(R.string.new_session_create))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_cancel))
            }
        },
    )
}

@Composable
private fun WorkspaceOption(
    selected: Boolean,
    title: String,
    subtitle: String?,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, onClick = onClick)
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun RenameDialog(
    initialTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var title by remember(initialTitle) { mutableStateOf(initialTitle) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rename_title)) },
        text = {
            OutlinedTextField(
                value = title,
                onValueChange = { title = it },
                label = { Text(stringResource(R.string.rename_hint)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(title) },
                enabled = title.isNotBlank(),
            ) {
                Text(stringResource(R.string.action_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.action_cancel))
            }
        },
    )
}

@Composable
fun SettingsDialog(
    state: UiState,
    viewModel: LinkViewModel,
    onDismiss: () -> Unit,
) {
    var deviceName by remember(state.deviceName) { mutableStateOf(state.deviceName) }
    var confirmForget by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                InfoRow(
                    label = stringResource(R.string.settings_relay),
                    value = PairingCode.displayHost(state.relayUrl),
                )
                InfoRow(
                    label = stringResource(R.string.settings_connection),
                    value = stringResource(connectionLabelRes(state.connection)),
                )
                InfoRow(
                    label = stringResource(R.string.settings_device_id),
                    value = state.deviceId,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = deviceName,
                    onValueChange = { deviceName = it },
                    label = { Text(stringResource(R.string.settings_device_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                val detail = state.connectionDetail
                if (detail != null) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Row {
                    TextButton(
                        onClick = { viewModel.reconnect() },
                        contentPadding = PaddingValues(horizontal = 4.dp),
                    ) {
                        Text(stringResource(R.string.settings_reconnect))
                    }
                    TextButton(
                        onClick = { viewModel.disconnect() },
                        contentPadding = PaddingValues(horizontal = 4.dp),
                    ) {
                        Text(stringResource(R.string.settings_disconnect))
                    }
                }
                TextButton(
                    onClick = { confirmForget = true },
                    contentPadding = PaddingValues(horizontal = 4.dp),
                ) {
                    Text(
                        text = stringResource(R.string.settings_forget),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Text(
                    text = stringResource(R.string.settings_about, APP_VERSION),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    viewModel.setDeviceName(deviceName)
                    onDismiss()
                },
            ) {
                Text(stringResource(R.string.settings_save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.settings_close))
            }
        },
    )

    if (confirmForget) {
        AlertDialog(
            onDismissRequest = { confirmForget = false },
            title = { Text(stringResource(R.string.settings_forget)) },
            text = { Text(stringResource(R.string.settings_forget_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmForget = false
                        viewModel.forgetPairing()
                        onDismiss()
                    },
                ) {
                    Text(stringResource(R.string.settings_forget))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmForget = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Column(Modifier.padding(vertical = 3.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value.ifBlank { "-" },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@androidx.annotation.StringRes
private fun connectionLabelRes(connection: ConnectionState): Int = when (connection) {
    ConnectionState.Unconfigured -> R.string.state_unconfigured
    ConnectionState.Connecting -> R.string.state_connecting
    ConnectionState.Connected -> R.string.state_connected
    ConnectionState.Offline -> R.string.state_offline
}
