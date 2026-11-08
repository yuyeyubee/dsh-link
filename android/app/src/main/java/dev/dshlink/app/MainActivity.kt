package dev.dshlink.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import dev.dshlink.app.ui.DshLinkApp
import dev.dshlink.app.vm.LinkViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: LinkViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DshLinkApp(viewModel)
        }
    }
}
