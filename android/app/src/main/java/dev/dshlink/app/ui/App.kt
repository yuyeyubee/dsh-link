package dev.dshlink.app.ui

import android.app.Activity
import android.util.Log
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import dev.dshlink.app.protocol.SessionSummary
import dev.dshlink.app.ui.theme.DshLinkTheme
import dev.dshlink.app.vm.LinkViewModel
import dev.dshlink.app.vm.UiState

private const val TAG = "DshLinkUi"

/** 折叠/铰链几何信息（dp）。 */
private data class FoldInfo(
    val separating: Boolean,
    val vertical: Boolean,
    val gap: Dp,
    val start: Dp,
)

@Composable
fun DshLinkApp(viewModel: LinkViewModel) {
    val state by viewModel.ui.collectAsStateWithLifecycle()

    val activity = LocalContext.current as? Activity
    var layoutInfo by remember { mutableStateOf<WindowLayoutInfo?>(null) }
    LaunchedEffect(activity) {
        val host = activity ?: return@LaunchedEffect
        try {
            WindowInfoTracker.getOrCreate(host).windowLayoutInfo(host).collect { info ->
                layoutInfo = info
            }
        } catch (t: Throwable) {
            Log.w(TAG, "window layout info unavailable", t)
        }
    }

    val density = LocalDensity.current
    val foldFeature = remember(layoutInfo) {
        layoutInfo?.displayFeatures?.filterIsInstance<FoldingFeature>()?.firstOrNull()
    }
    val fold = remember(foldFeature) { foldFeature?.let { toFoldInfo(it, density) } }
    val screenWidthDp = LocalConfiguration.current.screenWidthDp.dp

    var showSettings by remember { mutableStateOf(false) }
    var showNewSession by remember { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<SessionSummary?>(null) }

    DshLinkTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
        ) {
            Box(Modifier.safeDrawingPadding()) {
                if (!state.configured) {
                    SetupScreen(
                        viewModel = viewModel,
                        initialDeviceName = state.deviceName,
                    )
                } else {
                    MainContent(
                        state = state,
                        viewModel = viewModel,
                        fold = fold,
                        screenWidthDp = screenWidthDp,
                        onOpenSettings = { showSettings = true },
                        onNewSession = { showNewSession = true },
                        onRename = { renameTarget = it },
                    )
                }
            }
        }

        if (showNewSession) {
            NewSessionDialog(
                workspaces = state.workspaces,
                onDismiss = { showNewSession = false },
                onCreate = { workspaceId, cwd ->
                    showNewSession = false
                    viewModel.createSession(workspaceId, cwd)
                },
            )
        }
        if (showSettings) {
            SettingsDialog(
                state = state,
                viewModel = viewModel,
                onDismiss = { showSettings = false },
            )
        }
        renameTarget?.let { target ->
            RenameDialog(
                initialTitle = target.title,
                onDismiss = { renameTarget = null },
                onConfirm = { title ->
                    renameTarget = null
                    viewModel.renameSession(target.sessionId, title)
                },
            )
        }
    }
}

@Composable
private fun MainContent(
    state: UiState,
    viewModel: LinkViewModel,
    fold: FoldInfo?,
    screenWidthDp: Dp,
    onOpenSettings: () -> Unit,
    onNewSession: () -> Unit,
    onRename: (SessionSummary) -> Unit,
) {
    val isWide = screenWidthDp >= 720.dp
    val separating = fold != null && fold.separating
    val twoPane = separating || isWide

    if (!twoPane) {
        if (state.chat != null) {
            BackHandler { viewModel.closeChat() }
            ChatPane(
                state = state,
                viewModel = viewModel,
                showBack = true,
                onRename = {
                    val chat = state.chat
                    if (chat != null) {
                        onRename(
                            SessionSummary(
                                sessionId = chat.sessionId,
                                title = chat.title,
                                cwd = chat.cwd,
                                updatedAt = 0L,
                                running = chat.running,
                                active = chat.active,
                                agentAvailable = true,
                                blank = false,
                                parentSessionId = null,
                            ),
                        )
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            SidebarPane(
                state = state,
                viewModel = viewModel,
                onOpenSettings = onOpenSettings,
                onNewSession = onNewSession,
                onRename = onRename,
                modifier = Modifier.fillMaxSize(),
            )
        }
        return
    }

    val sidebar: @Composable (Modifier) -> Unit = { modifier ->
        SidebarPane(
            state = state,
            viewModel = viewModel,
            onOpenSettings = onOpenSettings,
            onNewSession = onNewSession,
            onRename = onRename,
            modifier = modifier,
        )
    }
    val chat: @Composable (Modifier) -> Unit = { modifier ->
        ChatPane(
            state = state,
            viewModel = viewModel,
            showBack = false,
            onRename = {
                val open = state.chat
                if (open != null) {
                    onRename(
                        SessionSummary(
                            sessionId = open.sessionId,
                            title = open.title,
                            cwd = open.cwd,
                            updatedAt = 0L,
                            running = open.running,
                            active = open.active,
                            agentAvailable = true,
                            blank = false,
                            parentSessionId = null,
                        ),
                    )
                }
            },
            modifier = modifier,
        )
    }

    when {
        separating && fold != null && fold.vertical -> {
            val leftWidth = if (fold.start > 200.dp) fold.start else 320.dp
            Row(Modifier.fillMaxSize()) {
                sidebar(Modifier.width(leftWidth).fillMaxHeight())
                Box(
                    Modifier
                        .width(fold.gap.coerceAtLeast(1.dp))
                        .fillMaxHeight()
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                )
                chat(Modifier.weight(1f).fillMaxHeight())
            }
        }

        separating && fold != null && !fold.vertical -> {
            Column(Modifier.fillMaxSize()) {
                chat(Modifier.weight(1.2f).fillMaxWidth())
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(fold.gap.coerceAtLeast(1.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                )
                sidebar(Modifier.weight(0.8f).fillMaxWidth())
            }
        }

        else -> {
            Row(Modifier.fillMaxSize()) {
                sidebar(Modifier.width(340.dp).fillMaxHeight())
                Box(
                    Modifier
                        .width(1.dp)
                        .fillMaxHeight()
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest),
                )
                chat(Modifier.weight(1f).fillMaxHeight())
            }
        }
    }
}

private fun toFoldInfo(feature: FoldingFeature, density: androidx.compose.ui.unit.Density): FoldInfo {
    val vertical = feature.orientation == FoldingFeature.Orientation.VERTICAL
    val gapPx = if (vertical) feature.bounds.width() else feature.bounds.height()
    val startPx = if (vertical) feature.bounds.left else feature.bounds.top
    val gap = with(density) { gapPx.toDp() }
    val start = with(density) { startPx.toDp() }
    return FoldInfo(
        separating = feature.isSeparating,
        vertical = vertical,
        gap = if (gap < 1.dp) 0.dp else gap,
        start = start,
    )
}

/** 供 Composables 复用的空占位。 */
@Composable
internal fun EmptyHint(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        androidx.compose.material3.Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun HorizontalSeparator() {
    Spacer(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest),
    )
}
