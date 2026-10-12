import { useState, useEffect, useRef, useCallback } from 'react';
import {
  isAppLockEnabled,
  isBiometricEnabled,
  getPinLength,
  verifyPin,
  authenticateWithBiometrics,
  authenticateWithDeviceLock,
  isDeviceLockAvailable,
  isSessionLocked,
  getLockoutRemainingSeconds,
  unlockSession,
} from '../utils/securityLock';
import { playCashChime, playPopSound } from '../utils/delight';
import { Fingerprint, Delete, ShieldAlert, Lock, Smartphone } from 'lucide-react';
import IOSSetPasscodeModal from './IOSSetPasscodeModal';

interface IOSAppLockScreenProps {
  onUnlocked?: () => void;
}

export default function IOSAppLockScreen({ onUnlocked }: IOSAppLockScreenProps) {
  const [isLocked, setIsLocked] = useState(() => isSessionLocked());
  const [pinLength, setPinLengthState] = useState(() => getPinLength());
  const [pin, setPin] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [lockoutRemaining, setLockoutRemaining] = useState(() => getLockoutRemainingSeconds());
  const [isAuthenticatingBio, setIsAuthenticatingBio] = useState(false);
  const [isAuthenticatingDevice, setIsAuthenticatingDevice] = useState(false);
  const [showSetNewPasscodeModal, setShowSetNewPasscodeModal] = useState(false);
  const bioTriggeredRef = useRef(false);

  useEffect(() => {
    const handleStatusChange = () => {
      setIsLocked(isSessionLocked());
      setPinLengthState(getPinLength());
    };
    window.addEventListener('coal_lock_status_changed', handleStatusChange);
    return () => window.removeEventListener('coal_lock_status_changed', handleStatusChange);
  }, []);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const interval = setInterval(() => {
      const rem = getLockoutRemainingSeconds();
      setLockoutRemaining(rem);
      if (rem <= 0) {
        setErrorMessage('');
      } else {
        setErrorMessage(`Too many attempts. Locked for ${rem}s`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutRemaining]);

  const triggerBiometrics = useCallback(async () => {
    if (lockoutRemaining > 0) return;
    setIsAuthenticatingBio(true);
    try {
      const success = await authenticateWithBiometrics();
      if (success) {
        playCashChime();
        setPin('');
        setErrorMessage('');
        setIsLocked(false);
        onUnlocked?.();
      }
    } finally {
      setIsAuthenticatingBio(false);
    }
  }, [lockoutRemaining, onUnlocked]);

  // Auto-prompt biometrics once on screen lock mount if enabled
  useEffect(() => {
    if (isLocked && isBiometricEnabled() && !bioTriggeredRef.current && lockoutRemaining <= 0) {
      bioTriggeredRef.current = true;
      triggerBiometrics();
    } else if (!isLocked) {
      bioTriggeredRef.current = false;
    }
  }, [isLocked, lockoutRemaining, triggerBiometrics]);

  const handleDigit = async (digit: string) => {
    if (lockoutRemaining > 0 || pin.length >= pinLength) return;
    playPopSound();
    const nextPin = pin + digit;
    setPin(nextPin);
    setErrorMessage('');

    if (nextPin.length === pinLength) {
      // Verify PIN
      const isValid = await verifyPin(nextPin);
      if (isValid) {
        playCashChime();
        setPin('');
        setErrorMessage('');
        setIsLocked(false);
        onUnlocked?.();
      } else {
        const remaining = getLockoutRemainingSeconds();
        if (remaining > 0) {
          setLockoutRemaining(remaining);
          setErrorMessage(`Too many attempts. Locked for ${remaining}s`);
        } else {
          setErrorMessage('Incorrect passcode');
        }
        // Trigger shake & clear
        setIsShaking(true);
        setTimeout(() => {
          setIsShaking(false);
          setPin('');
        }, 500);
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      playPopSound();
      setPin(pin.slice(0, -1));
      setErrorMessage('');
    }
  };

  const handleForgotPasscode = async () => {
    if (isAuthenticatingDevice || lockoutRemaining > 0) return;
    playPopSound();
    setErrorMessage('');
    if (!(await isDeviceLockAvailable())) {
      setErrorMessage('Android Phone Lock is not available. Set up a phone PIN, pattern, or password first.');
      return;
    }
    setIsAuthenticatingDevice(true);
    const success = await authenticateWithDeviceLock();
    setIsAuthenticatingDevice(false);
    if (success) {
      setShowSetNewPasscodeModal(true);
    } else {
      setErrorMessage('Phone verification was cancelled or unsuccessful.');
    }
  };

  if (!isLocked || !isAppLockEnabled()) {
    return null;
  }

  const KEYPAD_BUTTONS = [
    { num: '1', letters: '' },
    { num: '2', letters: 'A B C' },
    { num: '3', letters: 'D E F' },
    { num: '4', letters: 'G H I' },
    { num: '5', letters: 'J K L' },
    { num: '6', letters: 'M N O' },
    { num: '7', letters: 'P Q R S' },
    { num: '8', letters: 'T U V' },
    { num: '9', letters: 'W X Y Z' },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '50px 24px 36px',
        color: 'var(--label-primary)',
        fontFamily: 'var(--font-system)',
        userSelect: 'none',
      }}
    >
      {/* Top Header & Dot Indicators */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginTop: 20,
        }}
      >
        {/* Lock Icon */}
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'var(--fill-quaternary)',
            border: '1px solid var(--separator)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Lock size={30} color="var(--ios-blue)" />
        </div>

        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.3px',
            margin: 0,
            marginBottom: 6,
            color: 'var(--label-primary)',
          }}
        >
          Factory Ledger
        </h1>

        <div
          style={{
            fontSize: 14,
            color: 'var(--label-secondary)',
            marginBottom: 28,
            minHeight: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {errorMessage ? (
            <span style={{ color: 'var(--ios-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ShieldAlert size={14} />
              {errorMessage}
            </span>
          ) : (
            `Enter ${pinLength}-Digit Passcode to Unlock`
          )}
        </div>

        {/* Pin Dots */}
        <div
          style={{
            display: 'flex',
            gap: pinLength > 4 ? 16 : 20,
            transform: isShaking ? 'translateX(-12px)' : 'none',
            transition: isShaking ? 'transform 0.08s ease' : 'none',
            animation: isShaking ? 'ios-shake 0.4s ease-in-out' : 'none',
          }}
        >
          {Array.from({ length: pinLength }).map((_, idx) => {
            const isFilled = pin.length > idx;
            return (
              <div
                key={idx}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: isFilled ? 'var(--label-primary)' : 'transparent',
                  border: isFilled ? 'none' : '1.5px solid var(--label-tertiary)',
                  transition: 'all 0.15s ease',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Keypad Grid (3 x 4) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 76px)',
          gap: '20px 28px',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        {KEYPAD_BUTTONS.map((item) => (
          <button
            key={item.num}
            type="button"
            onClick={() => handleDigit(item.num)}
            className="ios-keypad-button"
            style={{
              width: 76,
              height: 76,
              borderRadius: '50%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
            }}
          >
            <span style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1, color: 'var(--label-primary)' }}>
              {item.num}
            </span>
            {item.letters && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '1.2px',
                  color: 'var(--label-secondary)',
                  marginTop: 2,
                }}
              >
                {item.letters}
              </span>
            )}
          </button>
        ))}

        {/* Row 4: Biometrics | '0' | Delete */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isBiometricEnabled() ? (
            <button
              type="button"
              onClick={triggerBiometrics}
              disabled={isAuthenticatingBio}
              title="Unlock with Fingerprint / Biometrics"
              style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                color: 'var(--ios-blue)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <Fingerprint size={32} />
            </button>
          ) : (
            <div style={{ width: 76, height: 76 }} />
          )}
        </div>

        {/* '0' Button */}
        <button
          type="button"
          onClick={() => handleDigit('0')}
          className="ios-keypad-button"
          style={{
            width: 76,
            height: 76,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            outline: 'none',
            padding: 0,
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 500, color: 'var(--label-primary)' }}>0</span>
        </button>

        {/* Delete Button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {pin.length > 0 ? (
            <button
              type="button"
              onClick={handleDelete}
              title="Delete"
              style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                color: 'var(--label-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <Delete size={26} />
            </button>
          ) : (
            <div style={{ width: 76, height: 76 }} />
          )}
        </div>
      </div>

      {/* Forgot Passcode Action Button */}
      <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => void handleForgotPasscode()}
          disabled={isAuthenticatingDevice || lockoutRemaining > 0}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--ios-blue)',
            fontSize: 14,
            fontWeight: 500,
            cursor: isAuthenticatingDevice ? 'wait' : 'pointer',
            padding: '8px 16px',
            outline: 'none',
            opacity: 0.9,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Smartphone size={16} />
            {isAuthenticatingDevice ? 'Verifying Phone…' : 'Forgot PIN? Use Phone Lock'}
          </span>
        </button>
      </div>

      {/* Set a replacement App PIN only after Android Phone Lock succeeds. */}
      {showSetNewPasscodeModal && (
        <IOSSetPasscodeModal
          isOpen={showSetNewPasscodeModal}
          mode="reset_after_phone_lock"
          onSuccess={() => {
            unlockSession();
            setShowSetNewPasscodeModal(false);
            setPin('');
            setErrorMessage('');
            setIsLocked(false);
            onUnlocked?.();
          }}
          onCancel={() => setShowSetNewPasscodeModal(false)}
        />
      )}

      <style>{`
        @keyframes ios-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-14px); }
          40% { transform: translateX(14px); }
          60% { transform: translateX(-10px); }
          80% { transform: translateX(10px); }
        }
      `}</style>
    </div>
  );
}
