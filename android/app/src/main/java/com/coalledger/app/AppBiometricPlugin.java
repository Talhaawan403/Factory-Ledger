package com.coalledger.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "AppBiometric")
public class AppBiometricPlugin extends Plugin {

    @PluginMethod
    public void isDeviceCredentialAvailable(PluginCall call) {
        try {
            KeyguardManager keyguardManager =
                (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
            JSObject ret = new JSObject();
            ret.put("available", keyguardManager != null && keyguardManager.isDeviceSecure());
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            BiometricManager biometricManager = BiometricManager.from(getContext());
            int canAuthenticate = biometricManager.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK
            );
            boolean isAvailable = (canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS);
            JSObject ret = new JSObject();
            ret.put("available", isAvailable);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(getActivity());
                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Unlock Factory Ledger")
                    .setSubtitle("Touch fingerprint sensor to continue")
                    .setNegativeButtonText("Use PIN")
                    .build();

                BiometricPrompt biometricPrompt = new BiometricPrompt(getActivity(), executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        super.onAuthenticationSucceeded(result);
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        super.onAuthenticationError(errorCode, errString);
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("error", errString.toString());
                        ret.put("errorCode", errorCode);
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        super.onAuthenticationFailed();
                    }
                });

                biometricPrompt.authenticate(promptInfo);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage() != null ? e.getMessage() : "Authentication error");
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void authenticateDeviceCredential(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                KeyguardManager keyguardManager =
                    (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
                if (keyguardManager == null || !keyguardManager.isDeviceSecure()) {
                    JSObject ret = new JSObject();
                    ret.put("success", false);
                    ret.put("error", "No secure phone lock is configured");
                    call.resolve(ret);
                    return;
                }

                Executor executor = ContextCompat.getMainExecutor(getActivity());
                BiometricPrompt.PromptInfo.Builder promptBuilder = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Verify phone owner")
                    .setSubtitle("Use your fingerprint, face, or phone screen lock");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    promptBuilder.setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG |
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL
                    );
                } else {
                    // AndroidX provides a compatible device-credential flow on Android 7-10.
                    promptBuilder.setDeviceCredentialAllowed(true);
                }

                BiometricPrompt biometricPrompt = new BiometricPrompt(
                    getActivity(),
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            JSObject ret = new JSObject();
                            ret.put("success", false);
                            ret.put("error", errString.toString());
                            ret.put("errorCode", errorCode);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                        }
                    }
                );

                biometricPrompt.authenticate(promptBuilder.build());
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage() != null ? e.getMessage() : "Phone lock authentication error");
                call.resolve(ret);
            }
        });
    }
}
