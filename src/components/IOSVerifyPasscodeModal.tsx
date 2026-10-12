import { useState, useEffect } from 'react';
import {
  authenticateWithDeviceLock,
  getPinLength,
  isDeviceLockAvailable,
  verifyPin,
} from '../utils/securityLock';
import { playCashChime, playPopSound } from '../utils/delight';
import { ShieldCheck, X, Delete, Smartphone } from 'lucide-react';

interface IOSVerifyPasscodeModalProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function IOSVerifyPasscodeModal({
  isOpen,
  title,
  subtitle = 'Enter your passcode to authenticate',
  onSuccess,
  onCancel,
}: IOSVerifyPasscodeModalProps) {
  const [pin, setPin] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [deviceLockAvailable, setDeviceLockAvailable] = useState(false);
  const [isAuthenticatingDevice, setIsAuthenticatingDevice] = useState(false);
  const pinLength = getPinLength();

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setPin('');
      setErrorMessage('');
      setIsShaking(false);
      setIsAuthenticatingDevice(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      isDeviceLockAvailable().then(setDeviceLockAvailable).catch(() => setDeviceLockAvailable(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDigit = async (digit: string) => {
    if (pin.length >= pinLength) return;
    playPopSound();
    setErrorMessage('');

    const next = pin + digit;
    setPin(next);

    if (next.length === pinLength) {
      const isValid = await verifyPin(next);
      if (isValid) {
        playCashChime();
        onSuccess();
      } else {
        setIsShaking(true);
        setErrorMessage('Incorrect passcode');
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

  const handleDeviceAuthentication = async () => {
    if (isAuthenticatingDevice) return;
    playPopSound();
    setErrorMessage('');
    setIsAuthenticatingDevice(true);
    const success = await authenticateWithDeviceLock();
    setIsAuthenticatingDevice(false);
    if (success) {
      playCashChime();
      onSuccess();
    } else {
      setErrorMessage('Phone verification was cancelled or unsuccessful.');
    }
  };

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
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="ios-fade-in"
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--bg-card, #1C1D24)',
          borderRadius: 24,
          padding: '24px 20px 28px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
          border: '0.5px solid var(--separator-opaque, #2C2D35)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {/* Cancel button */}
        <button
          type="button"
          onClick={onCancel}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            background: 'var(--fill-tertiary, #2C2D35)',
            border: 'none',
            borderRadius: '50%',
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--label-secondary, #8E8E93)',
          }}
        >
          <X size={16} />
        </button>

        {/* Header Icon */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(10, 132, 255, 0.14)',
            color: 'var(--ios-blue, #0A84FF)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <ShieldCheck size={24} />
        </div>

        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--label-primary, #FFFFFF)',
            margin: '0 0 4px',
            textAlign: 'center',
          }}
        >
          {title}
        </h3>

        <div
          style={{
            fontSize: 13,
            color: errorMessage ? 'var(--ios-red, #FF453A)' : 'var(--label-secondary, #8E8E93)',
            marginBottom: 20,
            textAlign: 'center',
            minHeight: 18,
          }}
        >
          {errorMessage || subtitle}
        </div>

        {/* Pin Dots */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 24,
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
                  background: isFilled ? 'var(--ios-blue, #0A84FF)' : 'transparent',
                  border: isFilled ? 'none' : '1.5px solid var(--label-tertiary, #636366)',
                  transition: 'all 0.15s ease',
                }}
              />
            );
          })}
        </div>

        {/* Compact Keypad */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 68px)',
            gap: '12px 18px',
            justifyContent: 'center',
          }}
        >
          {KEYPAD_BUTTONS.map((item) => (
            <button
              key={item.num}
              type="button"
              onClick={() => handleDigit(item.num)}
              style={{
                width: 68,
                height: 56,
                borderRadius: 14,
                background: 'var(--fill-quaternary, #262730)',
                border: '0.5px solid var(--separator-opaque, #33343F)',
                color: 'var(--label-primary, #FFFFFF)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                outline: 'none',
                padding: 0,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 600 }}>{item.num}</span>
              {item.letters && (
                <span style={{ fontSize: 8, color: 'var(--label-secondary, #8E8E93)', fontWeight: 600 }}>
                  {item.letters}
                </span>
              )}
            </button>
          ))}

          <div style={{ width: 68, height: 56 }} />

          <button
            type="button"
            onClick={() => handleDigit('0')}
            style={{
              width: 68,
              height: 56,
              borderRadius: 14,
              background: 'var(--fill-quaternary, #262730)',
              border: '0.5px solid var(--separator-opaque, #33343F)',
              color: 'var(--label-primary, #FFFFFF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 600 }}>0</span>
          </button>

          <button
            type="button"
            onClick={handleDelete}
            style={{
              width: 68,
              height: 56,
              borderRadius: 14,
              background: 'transparent',
              border: 'none',
              color: 'var(--label-secondary, #8E8E93)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              outline: 'none',
              padding: 0,
            }}
          >
            <Delete size={22} />
          </button>
        </div>

        {deviceLockAvailable && (
          <button
            type="button"
            onClick={handleDeviceAuthentication}
            disabled={isAuthenticatingDevice}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ios-blue, #0A84FF)',
              fontSize: 13,
              fontWeight: 600,
              cursor: isAuthenticatingDevice ? 'wait' : 'pointer',
              marginTop: 14,
              padding: '8px 12px',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Smartphone size={16} />
            {isAuthenticatingDevice ? 'Verifying…' : 'Use Phone Lock Instead'}
          </button>
        )}

        <style>{`
          @keyframes ios-shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-12px); }
            40% { transform: translateX(12px); }
            60% { transform: translateX(-8px); }
            80% { transform: translateX(8px); }
          }
        `}</style>
      </div>
    </div>
  );
}
