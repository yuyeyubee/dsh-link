package dev.dshlink.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF14548F),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD3E4FF),
    onPrimaryContainer = Color(0xFF001C38),
    secondary = Color(0xFF00696B),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFF9CF1F2),
    onSecondaryContainer = Color(0xFF002021),
    tertiary = Color(0xFF7A5900),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFDF9B),
    onTertiaryContainer = Color(0xFF261900),
    background = Color(0xFFF7F9FC),
    onBackground = Color(0xFF191C20),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF191C20),
    surfaceVariant = Color(0xFFE0E2EC),
    onSurfaceVariant = Color(0xFF44474F),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF2F4F8),
    surfaceContainer = Color(0xFFECEEF3),
    surfaceContainerHigh = Color(0xFFE6E8EE),
    surfaceContainerHighest = Color(0xFFE0E3E9),
    error = Color(0xFFBA1A1A),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    outline = Color(0xFF74777F),
    outlineVariant = Color(0xFFC4C6D0),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA3C9F9),
    onPrimary = Color(0xFF00325A),
    primaryContainer = Color(0xFF174975),
    onPrimaryContainer = Color(0xFFD3E4FF),
    secondary = Color(0xFF80D4D5),
    onSecondary = Color(0xFF003738),
    secondaryContainer = Color(0xFF004F50),
    onSecondaryContainer = Color(0xFF9CF1F2),
    tertiary = Color(0xFFE9C349),
    onTertiary = Color(0xFF402D00),
    tertiaryContainer = Color(0xFF5D4200),
    onTertiaryContainer = Color(0xFFFFDF9B),
    background = Color(0xFF0F1418),
    onBackground = Color(0xFFE1E2E8),
    surface = Color(0xFF12181D),
    onSurface = Color(0xFFE1E2E8),
    surfaceVariant = Color(0xFF44474F),
    onSurfaceVariant = Color(0xFFC4C6D0),
    surfaceContainerLowest = Color(0xFF0A0F13),
    surfaceContainerLow = Color(0xFF171C20),
    surfaceContainer = Color(0xFF1B2024),
    surfaceContainerHigh = Color(0xFF262B2F),
    surfaceContainerHighest = Color(0xFF30353A),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF8E9099),
    outlineVariant = Color(0xFF44474F),
)

@Composable
fun DshLinkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
