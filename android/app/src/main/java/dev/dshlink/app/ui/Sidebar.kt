package dev.dshlink.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.dshlink.app.R
import dev.dshlink.app.net.ConnectionState
import dev.dshlink.app.protocol.PairingCode
import dev.dshlink.app.protocol.Peer
import dev.dshlink.app.protocol.SessionSummary
import dev.dshlink.app.vm.LinkViewModel
import dev.dshlink.app.vm.UiState

@Composable
fun SidebarPane(
    state: UiState,
    viewModel: LinkViewModel,
    onOpenSettings: () -> Unit,
    onNewSession: () -> Unit,
    onRename: (SessionSummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.background(MaterialTheme.colorScheme.surface)) {
        SidebarHeader(state, onOpenSettings)
        HorizontalSeparator()
        DeviceStrip(state, viewModel)
        HorizontalSeparator()
        SessionSection(
            state = state,
            viewModel = viewModel,
            onNewSession = onNewSession,
            onRename = onRename,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SidebarHeader(state: UiState, onOpenSettings: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleLarge,
                )
                Spacer(Modifier.width(8.dp))
                ConnectionBadge(state.connection)
            }
            Spacer(Modifier.height(2.dp))
            Text(
                text = PairingCode.displayHost(state.relayUrl),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onOpenSettings) {
            Icon(
                painter = painterResource(R.drawable.ic_settings),
                contentDescription = stringResource(R.string.settings_title),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ConnectionBadge(connection: ConnectionState) {
    val (labelRes, dotColor) = when (connection) {
        ConnectionState.Unconfigured -> R.string.state_unconfigured to Color(0xFF9E9E9E)
        ConnectionState.Connecting -> R.string.state_connecting to Color(0xFFFFA000)
        ConnectionState.Connected -> R.string.state_connected to Color(0xFF2E7D32)
        ConnectionState.Offline -> R.string.state_offline to Color(0xFFC62828)
    }
    val container = when (connection) {
        ConnectionState.Connected -> MaterialTheme.colorScheme.secondaryContainer
        ConnectionState.Connecting -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.surfaceContainerHighest
    }
    Surface(shape = CircleShape, color = container) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(6.dp).background(dotColor, CircleShape))
            Spacer(Modifier.width(5.dp))
            Text(
                text = stringResource(labelRes),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun DeviceStrip(state: UiState, viewModel: LinkViewModel) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(R.string.devices_title),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = { viewModel.reconnect() },
                modifier = Modifier.size(32.dp),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_refresh),
                    contentDescription = stringResource(R.string.settings_reconnect),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        if (state.peers.isEmpty()) {
            Text(
                text = stringResource(R.string.devices_empty),
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.devices_empty_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(vertical = 4.dp),
            ) {
                items(state.peers, key = { it.id }) { peer ->
                    DeviceChip(
                        peer = peer,
                        selected = peer.id == state.selectedDeviceId,
                        onClick = { viewModel.selectDevice(peer.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun DeviceChip(peer: Peer, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceContainerHigh
        },
        contentColor = if (selected) {
            MaterialTheme.colorScheme.onPrimaryContainer
        } else {
            MaterialTheme.colorScheme.onSurface
        },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(7.dp).background(Color(0xFF2E7D32), CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(
                text = peer.name,
                style = MaterialTheme.typography.labelLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = peer.platformLabel,
                style = MaterialTheme.typography.labelSmall,
                color = if (selected) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}

@Composable
private fun SessionSection(
    state: UiState,
    viewModel: LinkViewModel,
    onNewSession: () -> Unit,
    onRename: (SessionSummary) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 2.dp, bottom = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.sessions_title),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = onNewSession,
                enabled = state.selectedDeviceId != null,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_add),
                    contentDescription = stringResource(R.string.sessions_new),
                    modifier = Modifier.size(20.dp),
                )
            }
            IconButton(
                onClick = { viewModel.refreshSessions() },
                enabled = state.selectedDeviceId != null,
                modifier = Modifier.size(36.dp),
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_refresh),
                    contentDescription = stringResource(R.string.sessions_refresh),
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                state.selectedDeviceId == null -> {
                    EmptyHint(stringResource(R.string.chat_no_device))
                }

                state.sessionsLoading && state.sessions.isEmpty() -> {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(26.dp))
                    }
                }

                state.sessionsError != null && state.sessions.isEmpty() -> {
                    ErrorHint(message = state.sessionsError, onRetry = { viewModel.refreshSessions() })
                }

                state.sessions.isEmpty() -> {
                    EmptyHint(stringResource(R.string.sessions_empty))
                }

                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(bottom = 12.dp),
                    ) {
                        items(state.sessions, key = { it.sessionId }) { session ->
                            SessionRow(
                                session = session,
                                selected = state.chat?.sessionId == session.sessionId,
                                onClick = { viewModel.openSession(session.sessionId) },
                                onRename = { onRename(session) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SessionRow(
    session: SessionSummary,
    selected: Boolean,
    onClick: () -> Unit,
    onRename: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    Surface(
        onClick = onClick,
        color = if (selected) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.55f)
        } else {
            Color.Transparent
        },
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = session.title.ifBlank { stringResource(R.string.unnamed_session) },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (session.cwd != null) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = session.cwd,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (session.running) {
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(6.dp).background(Color(0xFF2E7D32), CircleShape))
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = stringResource(R.string.running),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                }
            }
            Box {
                IconButton(
                    onClick = { menuExpanded = true },
                    modifier = Modifier.size(32.dp),
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_more_vert),
                        contentDescription = stringResource(R.string.chat_more),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false },
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.chat_rename)) },
                        onClick = {
                            menuExpanded = false
                            onRename()
                        },
                    )
                }
            }
        }
    }
}

@Composable
internal fun ErrorHint(message: String, onRetry: (() -> Unit)? = null) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
        )
        if (onRetry != null) {
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = onRetry) {
                Text(stringResource(R.string.action_retry))
            }
        }
    }
}
