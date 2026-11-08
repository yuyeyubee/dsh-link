package dev.dshlink.app.ui

import android.text.format.DateFormat
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.dshlink.app.R
import dev.dshlink.app.net.ConnectionState
import dev.dshlink.app.protocol.ChatRecord
import dev.dshlink.app.vm.ChatState
import dev.dshlink.app.vm.LinkViewModel
import dev.dshlink.app.vm.UiState
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ChatPane(
    state: UiState,
    viewModel: LinkViewModel,
    showBack: Boolean,
    onRename: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val chat = state.chat
    Column(modifier.background(MaterialTheme.colorScheme.background)) {
        ChatHeader(
            state = state,
            chat = chat,
            showBack = showBack,
            viewModel = viewModel,
            onRename = onRename,
        )
        HorizontalSeparator()

        if (chat == null) {
            EmptyChat()
        } else {
            val error = chat.error
            if (error != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = error,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { viewModel.clearChatError() }) {
                            Text(stringResource(R.string.action_ok))
                        }
                    }
                }
            }

            if (!chat.followConnected && state.connection == ConnectionState.Connected) {
                Text(
                    text = stringResource(R.string.chat_follow_lost),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                )
            }

            MessageList(chat = chat, modifier = Modifier.weight(1f))
            Composer(state = state, viewModel = viewModel)
        }
    }
}

@Composable
private fun ChatHeader(
    state: UiState,
    chat: ChatState?,
    showBack: Boolean,
    viewModel: LinkViewModel,
    onRename: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showBack) {
            IconButton(onClick = { viewModel.closeChat() }) {
                Icon(
                    painter = painterResource(R.drawable.ic_arrow_back),
                    contentDescription = stringResource(R.string.chat_back),
                )
            }
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(horizontal = if (showBack) 0.dp else 10.dp),
        ) {
            Text(
                text = chat?.title?.ifBlank { stringResource(R.string.unnamed_session) }
                    ?: stringResource(R.string.app_name),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                val cwd = chat?.cwd
                if (cwd != null) {
                    Text(
                        text = cwd,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(8.dp))
                }
                if (chat != null && chat.running) {
                    Box(Modifier.size(6.dp).background(Color(0xFF2E7D32), CircleShape))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = stringResource(R.string.running),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
                if (chat != null && chat.queueCount > 0) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.chat_queue_count, chat.queueCount),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (chat != null && state.connection != ConnectionState.Connected) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.state_offline),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
        if (chat != null) {
            IconButton(onClick = onRename) {
                Icon(
                    painter = painterResource(R.drawable.ic_edit),
                    contentDescription = stringResource(R.string.chat_rename),
                    modifier = Modifier.size(20.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (chat.running) {
                IconButton(onClick = { viewModel.stopTurn() }) {
                    Icon(
                        painter = painterResource(R.drawable.ic_stop),
                        contentDescription = stringResource(R.string.chat_stop),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun EmptyChat() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_launcher_foreground),
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.chat_empty_title),
            style = MaterialTheme.typography.titleMedium,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = stringResource(R.string.chat_empty_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun MessageList(chat: ChatState, modifier: Modifier = Modifier) {
    val listState = rememberLazyListState()

    LaunchedEffect(chat.records.size) {
        if (chat.records.isNotEmpty()) {
            listState.scrollToItem(chat.records.size - 1)
        }
    }

    if (chat.records.isEmpty()) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            if (chat.loading) {
                CircularProgressIndicator(Modifier.size(28.dp))
            } else {
                Text(
                    text = stringResource(R.string.chat_empty_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp),
                )
            }
        }
        return
    }

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(chat.records, key = { it.seq }) { record ->
            ChatRecordItem(record)
        }
    }
}

@Composable
private fun ChatRecordItem(record: ChatRecord) {
    when (record) {
        is ChatRecord.User -> UserBubble(record.text)
        is ChatRecord.Assistant -> AssistantCard(record)
        is ChatRecord.ToolCall -> ToolCallCard(record)
        is ChatRecord.ToolResult -> ToolResultCard(record)
        is ChatRecord.TurnStart -> TurnMarker(stringResource(R.string.chat_turn_start, record.turn))
        is ChatRecord.TurnEnd -> TurnMarker(stringResource(R.string.chat_turn_end, record.turn))
        is ChatRecord.ErrorEntry -> ErrorCard(record.message)
    }
}

@Composable
private fun UserBubble(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp),
            color = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
            modifier = Modifier.widthIn(max = 560.dp),
        ) {
            SelectionContainer {
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun AssistantCard(record: ChatRecord.Assistant) {
    Surface(
        shape = RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "DSH",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = formatClock(record.time),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            record.reasoning?.let { reasoning ->
                ReasoningSection(seq = record.seq, reasoning = reasoning)
            }
            if (record.text.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                SelectionContainer {
                    Text(text = record.text, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
    }
}

@Composable
private fun ReasoningSection(seq: Long, reasoning: String) {
    var expanded by remember(seq) { mutableStateOf(false) }
    Column {
        TextButton(
            onClick = { expanded = !expanded },
            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp),
        ) {
            Icon(
                painter = painterResource(R.drawable.ic_chevron_right),
                contentDescription = null,
                modifier = Modifier
                    .size(16.dp)
                    .rotate(if (expanded) 90f else 0f),
            )
            Spacer(Modifier.width(4.dp))
            Text(
                text = stringResource(R.string.chat_reasoning),
                style = MaterialTheme.typography.labelMedium,
            )
        }
        if (expanded) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                SelectionContainer {
                    Text(
                        text = reasoning,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(10.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolCallCard(record: ChatRecord.ToolCall) {
    var expanded by remember(record.seq) { mutableStateOf(false) }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_chevron_right),
                    contentDescription = null,
                    modifier = Modifier
                        .size(18.dp)
                        .rotate(if (expanded) 90f else 0f),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = stringResource(R.string.chat_tool_call) + " · " + record.name,
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = formatClock(record.time),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (expanded) {
                SelectionContainer {
                    Text(
                        text = prettyJson(record.args).ifBlank { "{}" },
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolResultCard(record: ChatRecord.ToolResult) {
    var expanded by remember(record.seq) { mutableStateOf(false) }
    val container = if (record.isError) {
        MaterialTheme.colorScheme.errorContainer
    } else {
        MaterialTheme.colorScheme.surfaceContainerLow
    }
    val content = if (record.isError) {
        MaterialTheme.colorScheme.onErrorContainer
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = container,
        contentColor = content,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_chevron_right),
                    contentDescription = null,
                    modifier = Modifier
                        .size(18.dp)
                        .rotate(if (expanded) 90f else 0f),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = buildString {
                        append(stringResource(R.string.chat_tool_result))
                        if (record.name.isNotBlank()) append(" · ").append(record.name)
                        if (record.isError) append(" · 失败")
                    },
                    style = MaterialTheme.typography.labelLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = formatClock(record.time),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            if (expanded) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 320.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    SelectionContainer {
                        Text(
                            text = record.text.ifBlank { "(empty)" },
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
                        )
                    }
                }
            } else {
                Text(
                    text = record.text.lineSequence().firstOrNull().orEmpty().take(160),
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun TurnMarker(text: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        HorizontalDivider(Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun ErrorCard(message: String) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Text(
                text = stringResource(R.string.chat_error),
                style = MaterialTheme.typography.labelLarge,
            )
            Spacer(Modifier.width(8.dp))
            SelectionContainer {
                Text(text = message, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun formatClock(time: Long): String {
    if (time <= 0L) return ""
    return DateFormat.format("HH:mm", time).toString()
}

private fun prettyJson(raw: String): String {
    val text = raw.trim()
    if (text.isEmpty()) return ""
    return try {
        when (text.first()) {
            '{' -> JSONObject(text).toString(2)
            '[' -> JSONArray(text).toString(2)
            else -> text
        }
    } catch (t: Throwable) {
        text
    }
}
