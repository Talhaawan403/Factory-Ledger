import { useEffect, useState } from 'react';
import {
  authenticateWithDeviceLock,
  enableAppLock,
  getPinLength,
  isBiometricAvailable,
  isBiometricEnabled,
  isDeviceLockAvailable,
  updatePin,
  verifyPin,
} from '../utils/securityLock';
import { playCashChime, playPopSound } from '../utils/delight';
import { Delete, Lock, Smartphone, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

export type PasscodeMode = 'create' | 'change' | 'reset_after_phone_lock';

interface IOSSetPasscodeModalProps {
  isOpen: boolean;
  mode?: PasscodeMode;
  onSuccess: (withBiometrics: boolean) => void;
  onCancel: () => void;
}

type ModalStep = 'verify_current' | 'enter_new' | 'confirm_new';

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

export default function IOSSetPasscodeModal({
  isOpen,
  mode = 'create',
  onSuccess,
  onCancel,
}: IOSSetPasscodeModalProps) {
  if (!isOpen) return null;
  return (
    <IOSSetPasscodeModalOpen
      key={mode}
      isOpen={isOpen}
      mode={mode}
      onSuccess={onSuccess}
      onCancel={onCancel}
    />
  );
}

function IOSSetPasscodeModalOpen({
  mode = 'create',
  onSuccess,
  onCancel,
}: IOSSetPasscodeModalProps) {
  const [step, setStep] = useState<ModalStep>(mode === 'change' ? 'verify_current' : 'enter_new');
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [deviceLockAvailable, setDeviceLockAvailable] = useState(false);
  const [isAuthenticatingDevice, setIsAuthenticatingDevice] = useState(false);
  const currentPinLen = getPinLength();

  useEffect(() => {
    let active = true;
    void isDeviceLockAvailable()
      .then((available) => {
        if (active) setDeviceLockAvailable(available);
      })
      .catch(() => {
        if (active) setDeviceLockAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const shakeAndReset = (message: string, target: 'current' | 'new') => {
    setIsShaking(true);
    setErrorMessage(message);
    setTimeout(() => {
      setIsShaking(false);
      if (target === 'current') setCurrentPin('');
      else {
        setPin('');
        setConfirmPin('');
        setStep('enter_new');
      }
    }, 550);
  };

  const saveNewPin = async (newPin: string) => {
    if (mode === 'create') {
      const bioSupported = await isBiometricAvailable();
      await enableAppLock(newPin, bioSupported);
      playCashChime();
      onSuccess(bioSupported);
      return;
    }

    await updatePin(newPin);
    playCashChime();
    onSuccess(isBiometricEnabled());
  };

  const handleDigit = async (digit: string) => {
    playPopSound();
    setErrorMessage('');

    if (step === 'verify_current') {
      const next = currentPin + digit;
      if (next.length > currentPinLen) return;
      setCurrentPin(next);
      if (next.length === currentPinLen) {
        if (await verifyPin(next)) setTimeout(() => setStep('enter_new'), 180);
        else shakeAndReset('Incorrect current passcode', 'current');
      }
      return;
    }

    if (step === 'enter_new') {
      const next = pin + digit;
      if (next.length > 5) return;
      setPin(next);
      if (next.length === 5) setTimeout(() => setStep('confirm_new'), 180);
      return;
    }

    const next = confirmPin + digit;
    if (next.length > 5) return;
    setConfirmPin(next);
    if (next.length === 5) {
      if (next === pin) await saveNewPin(next);
      else shakeAndReset('Passcodes do not match. Please try again.', 'new');
    }
  };

  const handleDelete = () => {
    playPopSound();
    setErrorMessage('');
    if (step === 'verify_current') setCurrentPin((value) => value.slice(0, -1));
    else if (step === 'enter_new') setPin((value) => value.slice(0, -1));
    else setConfirmPin((value) => value.slice(0, -1));
  };

  const handleForgotCurrentPin = async () => {
    if (isAuthenticatingDevice) return;
    if (!deviceLockAvailable) {
      setErrorMessage('Android Phone Lock is not available. Set up a phone PIN, pattern, or password first.');
      return;
    }
    setIsAuthenticatingDevice(true);
    setErrorMessage('');
    const success = await authenticateWithDeviceLock();
    setIsAuthenticatingDevice(false);
    if (success) {
      setCurrentPin('');
      setStep('enter_new');
      setErrorMessage('Phone owner verified. Choose a new App PIN.');
    } else {
      setErrorMessage('Phone verification was cancelled or unsuccessful.');
    }
  };

  const currentValue = step === 'verify_current' ? currentPin : step === 'enter_new' ? pin : confirmPin;
  const dotCount = step === 'verify_current' ? currentPinLen : 5;
  const heading = step === 'verify_current'
    ? 'Enter Current Passcode'
    : step === 'enter_new'
      ? mode === 'create' ? 'Set 5-Digit Passcode' : 'Enter New 5-Digit Passcode'
      : 'Re-enter New Passcode';
  const helper = step === 'verify_current'
    ? 'Verify your current passcode or use Android Phone Lock'
    : step === 'enter_new'
      ? 'Choose a five-digit security code'
      : 'Confirm your new passcode to save';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="ios-fade-in" style={{ width: '100%', maxWidth: 360, background: 'var(--bg-card, #1C1D24)', borderRadius: 24, padding: '24px 20px 28px', boxShadow: '0 16px 40px rgba(0,0,0,0.4)', border: '0.5px solid var(--separator-opaque, #2C2D35)', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <button type="button" onClick={onCancel} aria-label="Close" style={{ position: 'absolute', top: 14, right: 14, background: 'var(--fill-tertiary, #2C2D35)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-secondary)' }}>
          <X size={16} />
        </button>

        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--ios-blue)', color: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Lock size={22} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)', margin: '0 0 4px', textAlign: 'center' }}>{heading}</h3>
        <div role={errorMessage ? 'alert' : undefined} style={{ fontSize: 13, color: errorMessage && !errorMessage.startsWith('Phone owner verified') ? 'var(--ios-red)' : 'var(--label-secondary)', marginBottom: 16, textAlign: 'center', minHeight: 18, padding: '0 8px' }}>
          {errorMessage || helper}
        </div>
        {mode === 'create' && !Capacitor.isNativePlatform() && (
          <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--ios-orange)', margin: '-8px 0 16px', textAlign: 'center', maxWidth: 290 }}>
            Phone Lock reset is available only in the Android app. In this browser, a forgotten App PIN cannot be reset.
          </div>
        )}

        <div style={{ display: 'flex', gap: 16, marginBottom: step === 'verify_current' ? 12 : 24, animation: isShaking ? 'ios-shake 0.4s ease-in-out' : 'none' }}>
          {Array.from({ length: dotCount }).map((_, index) => (
            <div key={index} style={{ width: 14, height: 14, borderRadius: '50%', background: currentValue.length > index ? 'var(--ios-blue)' : 'transparent', border: currentValue.length > index ? 'none' : '1.5px solid var(--label-tertiary)' }} />
          ))}
        </div>

        {step === 'verify_current' && (
          <button type="button" onClick={() => void handleForgotCurrentPin()} disabled={isAuthenticatingDevice} style={{ minHeight: 44, background: 'none', border: 'none', color: 'var(--ios-blue)', fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Smartphone size={16} />
            {isAuthenticatingDevice ? 'Verifying Phone…' : 'Forgot PIN? Use Phone Lock'}
          </button>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 68px)', gap: '12px 18px', justifyContent: 'center' }}>
          {KEYPAD_BUTTONS.map((item) => (
            <button key={item.num} type="button" onClick={() => void handleDigit(item.num)} style={{ width: 68, height: 56, borderRadius: 14, background: 'var(--fill-quaternary)', border: '0.5px solid var(--separator-opaque)', color: 'var(--label-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
              <span style={{ fontSize: 22, fontWeight: 600 }}>{item.num}</span>
              {item.letters && <span style={{ fontSize: 8, color: 'var(--label-secondary)', fontWeight: 600 }}>{item.letters}</span>}
            </button>
          ))}
          <div style={{ width: 68, height: 56 }} />
          <button type="button" onClick={() => void handleDigit('0')} style={{ width: 68, height: 56, borderRadius: 14, background: 'var(--fill-quaternary)', border: '0.5px solid var(--separator-opaque)', color: 'var(--label-primary)', fontSize: 22, fontWeight: 600 }}>0</button>
          <button type="button" onClick={handleDelete} aria-label="Delete digit" style={{ width: 68, height: 56, borderRadius: 14, background: 'transparent', border: 'none', color: 'var(--label-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Delete size={22} />
          </button>
        </div>
      </div>
      <style>{`@keyframes ios-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-12px); } 40% { transform: translateX(12px); } 60% { transform: translateX(-8px); } 80% { transform: translateX(8px); } }`}</style>
    </div>
  );
}
