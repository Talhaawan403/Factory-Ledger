package com.coalledger.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import io.capawesome.capacitorjs.plugins.firebase.authentication.FirebaseAuthenticationPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FirebaseAuthenticationPlugin.class);
        registerPlugin(AppBiometricPlugin.class);
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (!BuildConfig.DEBUG) {
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        }

        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
        if (insetsController != null) {
            insetsController.show(WindowInsetsCompat.Type.statusBars());
        }

        handleDevSeedIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        handleDevSeedIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDevSeedIntent(intent);
    }

    private void handleDevSeedIntent(Intent intent) {
        if (intent == null) return;
        boolean hasDevSeedExtra = intent.getBooleanExtra("devSeed", false);
        Uri data = intent.getData();
        boolean hasDevSeedUri = data != null && "factoryledger".equals(data.getScheme()) && "seed".equals(data.getHost());

        if (hasDevSeedExtra || hasDevSeedUri) {
            intent.removeExtra("devSeed");
            if (hasDevSeedUri) {
                intent.setData(null);
            }
            triggerDevSeed();
        }
    }

    private void triggerDevSeed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().postDelayed(() -> {
                String js = "if (typeof window.seedTestData === 'function') { " +
                            "  window.seedTestData({ reload: true, clearBeforeSeed: true }); " +
                            "} else { " +
                            "  window.__pendingDevSeed = true; " +
                            "}";
                getBridge().getWebView().evaluateJavascript(js, null);
            }, 600);
        }
    }
}

