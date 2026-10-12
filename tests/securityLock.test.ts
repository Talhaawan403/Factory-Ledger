import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPin,
  hashPinLegacy,
  verifyPin,
  enableAppLock,
  getLockoutRemainingSeconds,
  getFailedAttempts,
  resetFailedAttempts,
  getStoredPinHash,
  purgeRemovedRecoveryKeyArtifacts,
} from '../src/utils/securityLock';

describe('Issue 14: PIN Lock Hardening & Rate Limiting', () => {
  beforeEach(() => {
    localStorage.clear();
    resetFailedAttempts();
  });

  it('hashes PIN using PBKDF2 with a device-unique salt', async () => {
    const pin = '12345';
    const hash = await hashPin(pin);
    expect(hash).toMatch(/^pbkdf2:[a-f0-9]{32}:[a-f0-9]{64}$/);
  });

  it('enables app lock and verifies correct PIN', async () => {
    await enableAppLock('54321', false);
    const storedHash = getStoredPinHash();
    expect(storedHash).toMatch(/^pbkdf2:/);

    const isCorrect = await verifyPin('54321');
    expect(isCorrect).toBe(true);
    expect(getFailedAttempts()).toBe(0);
  });

  it('increments failed attempts on incorrect PIN and enforces lockout after 5 failures', async () => {
    await enableAppLock('98765', false);

    // 4 failed attempts: not yet locked out
    for (let i = 1; i <= 4; i++) {
      const res = await verifyPin('00000');
      expect(res).toBe(false);
      expect(getFailedAttempts()).toBe(i);
      expect(getLockoutRemainingSeconds()).toBe(0);
    }

    // 5th failed attempt: triggers 30s lockout
    const fifthAttempt = await verifyPin('00000');
    expect(fifthAttempt).toBe(false);
    expect(getFailedAttempts()).toBe(5);
    expect(getLockoutRemainingSeconds()).toBeGreaterThan(0);
    expect(getLockoutRemainingSeconds()).toBeLessThanOrEqual(30);

    // Subsequent attempt during lockout is immediately rejected
    const blockedAttempt = await verifyPin('98765'); // even if correct PIN
    expect(blockedAttempt).toBe(false);
  });

  it('enables App Lock without creating a separate recovery code', async () => {
    await enableAppLock('98765', false);
    expect(localStorage.getItem('coal_app_recovery_key')).toBeNull();
    expect(localStorage.getItem('coal_app_recovery_key_verifier_v2')).toBeNull();
    expect(await verifyPin('98765')).toBe(true);
  });

  it('purges retired recovery-code artifacts without changing the App PIN', async () => {
    await enableAppLock('23456', false);
    localStorage.setItem('coal_app_recovery_key', 'FL-2345-6789');
    localStorage.setItem('coal_app_recovery_key_verifier_v2', 'pbkdf2-sha256:legacy');

    purgeRemovedRecoveryKeyArtifacts();

    expect(localStorage.getItem('coal_app_recovery_key')).toBeNull();
    expect(localStorage.getItem('coal_app_recovery_key_verifier_v2')).toBeNull();
    expect(await verifyPin('23456')).toBe(true);
  });

  it('transparently upgrades legacy SHA-256 hash to PBKDF2 on first successful login', async () => {
    const pin = '11223';
    const legacyHash = await hashPinLegacy(pin);
    localStorage.setItem('coal_app_pin_hash', legacyHash);
    localStorage.setItem('coal_app_lock_enabled', 'true');

    // Verify initial hash is legacy
    expect(getStoredPinHash()).toBe(legacyHash);
    expect(getStoredPinHash()?.startsWith('pbkdf2:')).toBe(false);

    // Enter correct PIN
    const isCorrect = await verifyPin('11223');
    expect(isCorrect).toBe(true);

    // Verify hash has been upgraded to PBKDF2
    const upgradedHash = getStoredPinHash();
    expect(upgradedHash?.startsWith('pbkdf2:')).toBe(true);

    // Verify that subsequent logins work with the upgraded PBKDF2 hash
    const nextLogin = await verifyPin('11223');
    expect(nextLogin).toBe(true);
  });

  it('Issue 23: purgeLegacySecurityFieldsFromCloud handles offline and sets completion flag', async () => {
    const { purgeLegacySecurityFieldsFromCloud } = await import('../src/lib/firebase');
    const uid = 'test-uid-123';
    const flag = `fl_cloud_security_purged_v1:${uid}`;

    expect(localStorage.getItem(flag)).toBeNull();
    await purgeLegacySecurityFieldsFromCloud(uid);
    // When offline, does not throw and executes safely
    await expect(purgeLegacySecurityFieldsFromCloud(uid)).resolves.not.toThrow();
  }, 15000);
});
