/**
 * securityLock.ts
 * Manages Passcode PIN, Fingerprint / Biometric authentication,
 * and App Locking lifecycle for Factory Ledger.
 */

import { registerPlugin, Capacitor } from '@capacitor/core';

interface AppBiometricPluginInterface {
  isAvailable(): Promise<{ available: boolean }>;
  authenticate(): Promise<{ success: boolean; error?: string; errorCode?: number }>;
  isDeviceCredentialAvailable(): Promise<{ available: boolean }>;
  authenticateDeviceCredential(): Promise<{ success: boolean; error?: string; errorCode?: number }>;
}

const AppBiometric = registerPlugin<AppBiometricPluginInterface>('AppBiometric');

const LOCK_ENABLED_KEY = 'coal_app_lock_enabled';
const BIOMETRIC_ENABLED_KEY = 'coal_biometric_enabled';
const PIN_HASH_KEY = 'coal_app_pin_hash';
const PIN_LENGTH_KEY = 'coal_pin_length';
const LOCK_TIMEOUT_KEY = 'coal_lock_timeout'; // in seconds: 0 = immediate, 60 = 1 min, 300 = 5 min
const LAST_ACTIVE_KEY = 'coal_last_active_time';
const BIOMETRIC_CRED_ID_KEY = 'coal_biometric_cred_id';
// Retired recovery-code keys are kept only so upgrades can remove the old
// device-local artifacts. They are never accepted for authentication.
const RECOVERY_KEY_KEY = 'coal_app_recovery_key';
const RECOVERY_KEY_VERIFIER_KEY = 'coal_app_recovery_key_verifier_v2';
const DEVICE_SALT_KEY = 'coal_device_pin_salt';
const FAILED_ATTEMPTS_KEY = 'coal_pin_failed_attempts';
const LOCKOUT_EXPIRY_KEY = 'coal_pin_lockout_expiry';

export const DEFAULT_PIN_LENGTH = 5;

// Session state (in-memory, lost on full app reload, but checked on startup)
let isLockedInMemory = false;

/**
 * Retrieve or generate a device-unique cryptographically secure random salt
 */
export function getOrCreateDeviceSalt(): string {
  if (typeof window === 'undefined') return 'factory_ledger_salt_device_fallback';
  let salt = localStorage.getItem(DEVICE_SALT_KEY);
  if (!salt) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    salt = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_SALT_KEY, salt);
  }
  return salt;
}

/**
 * High-security PBKDF2 hash using WebCrypto (100,000 iterations, SHA-256)
 */
export async function hashPin(pin: string, customSalt?: string): Promise<string> {
  const salt = customSalt || getOrCreateDeviceSalt();
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${salt}:${hex}`;
}

/**
 * Legacy SHA-256 hash calculator for zero-friction migration
 */
export async function hashPinLegacy(pin: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(pin + '_factory_ledger_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate Limiting & Lockout Utilities
 */
export function getFailedAttempts(): number {
  if (typeof window === 'undefined') return 0;
  const val = localStorage.getItem(FAILED_ATTEMPTS_KEY);
  return val ? parseInt(val, 10) : 0;
}

export function getLockoutRemainingSeconds(): number {
  if (typeof window === 'undefined') return 0;
  const expiryStr = localStorage.getItem(LOCKOUT_EXPIRY_KEY);
  if (!expiryStr) return 0;
  const expiry = parseInt(expiryStr, 10);
  const remaining = Math.ceil((expiry - Date.now()) / 1000);
  if (remaining <= 0) {
    localStorage.removeItem(LOCKOUT_EXPIRY_KEY);
    return 0;
  }
  return remaining;
}

export function recordFailedAttempt(): { lockedOut: boolean; remainingSeconds: number; attempts: number } {
  const attempts = getFailedAttempts() + 1;
  localStorage.setItem(FAILED_ATTEMPTS_KEY, String(attempts));

  if (attempts >= 5) {
    // 5 attempts = 30s, 6 = 60s, 7 = 120s, capped at 300s
    const penaltyExponent = Math.min(attempts - 5, 4);
    const durationSec = 30 * Math.pow(2, penaltyExponent);
    const expiry = Date.now() + durationSec * 1000;
    localStorage.setItem(LOCKOUT_EXPIRY_KEY, String(expiry));
    return { lockedOut: true, remainingSeconds: durationSec, attempts };
  }

  return { lockedOut: false, remainingSeconds: 0, attempts };
}

export function resetFailedAttempts(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FAILED_ATTEMPTS_KEY);
  localStorage.removeItem(LOCKOUT_EXPIRY_KEY);
}

export function isAppLockEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(LOCK_ENABLED_KEY) === 'true';
}

export function getPinLength(): number {
  if (typeof window === 'undefined') return DEFAULT_PIN_LENGTH;
  const stored = localStorage.getItem(PIN_LENGTH_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  // Backward-compatibility: If an existing PIN hash exists without a recorded length, it is a legacy 4-digit PIN
  if (getStoredPinHash()) {
    return 4;
  }
  return DEFAULT_PIN_LENGTH;
}

export function setPinLength(length: number): void {
  localStorage.setItem(PIN_LENGTH_KEY, String(length));
}

export function isBiometricEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === 'true';
}

export function setBiometricEnabled(enabled: boolean): void {
  localStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
  notifyLockStatusChanged();
}

export function getStoredPinHash(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PIN_HASH_KEY);
}

export function getLockTimeout(): number {
  if (typeof window === 'undefined') return 0;
  const val = localStorage.getItem(LOCK_TIMEOUT_KEY);
  return val ? parseInt(val, 10) : 0;
}

export function setLockTimeout(seconds: number) {
  localStorage.setItem(LOCK_TIMEOUT_KEY, String(seconds));
  notifyLockStatusChanged();
}

/**
 * Check if the device hardware supports platform biometrics (Fingerprint / Face ID)
 */
export async function isBiometricAvailable(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await AppBiometric.isAvailable();
      return Boolean(res?.available);
    } catch (err) {
      console.warn('Native biometric availability check failed:', err);
      return false;
    }
  }

  try {
    if (
      typeof window !== 'undefined' &&
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    ) {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch (err) {
    console.warn('Biometric check error:', err);
  }
  return false;
}

/**
 * Register biometric platform authenticator
 */
export async function registerBiometrics(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const available = await isBiometricAvailable();
    if (available) {
      localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
      notifyLockStatusChanged();
      return true;
    }
    return false;
  }

  try {
    if (!window.PublicKeyCredential) return false;

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: 'Factory Ledger',
          id: window.location.hostname || 'localhost',
        },
        user: {
          id: userId,
          name: 'factory-ledger-admin',
          displayName: 'Factory Ledger Operator',
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },  // ES256
          { alg: -257, type: 'public-key' }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'discouraged',
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (credential && credential.id) {
      localStorage.setItem(BIOMETRIC_CRED_ID_KEY, credential.id);
      localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
      notifyLockStatusChanged();
      return true;
    }
  } catch (err: any) {
    console.warn('Biometric registration error/cancelled:', err);
    // If registration fails or cancelled, user can still use PIN
  }
  return false;
}

/**
 * Authenticate using device Fingerprint / Biometrics
 */
export async function authenticateWithBiometrics(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await AppBiometric.authenticate();
      if (res && res.success) {
        unlockSession();
        return true;
      }
    } catch (err: any) {
      console.warn('Native biometric authentication error:', err);
    }
    return false;
  }

  try {
    if (!window.PublicKeyCredential) return false;

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credId = localStorage.getItem(BIOMETRIC_CRED_ID_KEY);
    const allowCredentials: PublicKeyCredentialDescriptor[] = credId
      ? [
          {
            id: Uint8Array.from(atob(credId.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
            type: 'public-key',
          },
        ]
      : [];

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname || 'localhost',
        userVerification: 'required',
        allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
        timeout: 60000,
      },
    });

    if (assertion) {
      unlockSession();
      return true;
    }
  } catch (err: any) {
    console.warn('Biometric authentication failed or cancelled:', err);
  }
  return false;
}

/**
 * Check whether Android has a secure screen lock configured. This is separate
 * from biometric availability: recovery may use the phone PIN/pattern/password.
 */
export async function isDeviceLockAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await AppBiometric.isDeviceCredentialAvailable();
    return Boolean(res?.available);
  } catch (err) {
    console.warn('Device lock availability check failed:', err);
    return false;
  }
}

/**
 * Ask Android to verify the phone owner using its system-controlled prompt.
 * Factory Ledger receives only success/failure and never sees the phone secret.
 */
export async function authenticateWithDeviceLock(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const res = await AppBiometric.authenticateDeviceCredential();
    return Boolean(res?.success);
  } catch (err) {
    console.warn('Device lock authentication failed or was cancelled:', err);
    return false;
  }
}

/**
 * Enable App Lock with a given PIN (now 5 digits standard)
 */
export async function enableAppLock(pin: string, enableBio = true): Promise<void> {
  const hash = await hashPin(pin);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.setItem(PIN_LENGTH_KEY, String(pin.length));
  localStorage.setItem(LOCK_ENABLED_KEY, 'true');
  if (enableBio) {
    const supported = await isBiometricAvailable();
    if (supported) {
      await registerBiometrics();
    }
  }
  notifyLockStatusChanged();
}

/**
 * Disable App Lock completely
 */
export function disableAppLock(): void {
  localStorage.removeItem(LOCK_ENABLED_KEY);
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_LENGTH_KEY);
  localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
  localStorage.removeItem(BIOMETRIC_CRED_ID_KEY);
  localStorage.removeItem(RECOVERY_KEY_KEY);
  localStorage.removeItem(RECOVERY_KEY_VERIFIER_KEY);
  localStorage.removeItem(DEVICE_SALT_KEY);
  resetFailedAttempts();
  isLockedInMemory = false;
  notifyLockStatusChanged();
}

/**
 * Update PIN
 */
export async function updatePin(newPin: string): Promise<void> {
  const hash = await hashPin(newPin);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.setItem(PIN_LENGTH_KEY, String(newPin.length));
  resetFailedAttempts();
  notifyLockStatusChanged();
}

/** Remove retired recovery-code artifacts without touching the App PIN or ledger. */
export function purgeRemovedRecoveryKeyArtifacts(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(RECOVERY_KEY_KEY);
  localStorage.removeItem(RECOVERY_KEY_VERIFIER_KEY);
}

/**
 * @deprecated Issue 14: PIN and security credentials are strictly local to this device and never synced to the cloud.
 */
export function applyCloudSecuritySettings(
  _cloudSettings?: {
    appLockEnabled?: boolean;
    pinHash?: string;
    pinLength?: number;
    lockTimeout?: number;
  },
  _shouldLockSession = true
): void {
  // Intentionally NO-OP for security: PIN is per-device only and never synced via cloud.
}

/**
 * Verify typed PIN with rate limiting, lockout, and transparent PBKDF2 migration
 */
export async function verifyPin(pin: string): Promise<boolean> {
  if (getLockoutRemainingSeconds() > 0) {
    return false;
  }

  const storedHash = getStoredPinHash();
  if (!storedHash) return true;

  let isValid = false;

  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length === 3) {
      const salt = parts[1];
      const computed = await hashPin(pin, salt);
      isValid = computed === storedHash;
    }
  } else {
    // Check legacy SHA-256 hash
    const legacy = await hashPinLegacy(pin);
    if (legacy === storedHash) {
      isValid = true;
      // Transparently upgrade to PBKDF2 with device salt
      const upgraded = await hashPin(pin);
      localStorage.setItem(PIN_HASH_KEY, upgraded);
    }
  }

  if (isValid) {
    resetFailedAttempts();
    unlockSession();
    return true;
  } else {
    recordFailedAttempt();
    return false;
  }
}

/**
 * Check if session is currently locked
 */
export function isSessionLocked(): boolean {
  if (!isAppLockEnabled()) return false;
  return isLockedInMemory;
}

/**
 * Manually lock the app immediately
 */
export function lockSession(): void {
  if (!isAppLockEnabled()) return;
  isLockedInMemory = true;
  notifyLockStatusChanged();
}

/**
 * Unlock the session
 */
export function unlockSession(): void {
  isLockedInMemory = false;
  recordActivity();
  notifyLockStatusChanged();
}

/**
 * Record user activity timestamp
 */
export function recordActivity(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

/**
 * Evaluate whether app should be locked based on elapsed time
 */
export function evaluateLockOnResume(): boolean {
  if (!isAppLockEnabled()) {
    isLockedInMemory = false;
    return false;
  }

  const timeoutSec = getLockTimeout();
  const lastActiveStr = localStorage.getItem(LAST_ACTIVE_KEY);
  const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : 0;
  const elapsedSec = (Date.now() - lastActive) / 1000;

  if (lastActive === 0 || elapsedSec >= timeoutSec) {
    isLockedInMemory = true;
    notifyLockStatusChanged();
    return true;
  }
  return isLockedInMemory;
}

export function notifyLockStatusChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('coal_lock_status_changed'));
  }
}
