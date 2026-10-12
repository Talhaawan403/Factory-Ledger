import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, AlertTriangle, Lock } from 'lucide-react';
import { useRefraction } from '../hooks/useRefraction';
import { playPopSound } from '../utils/delight';

export interface IOSConfirmModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  singleButton?: boolean;
  destructive?: boolean;
  countdownSeconds?: number;
  icon?: 'trash' | 'warning' | 'none';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export default function IOSConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  singleButton = false,
  destructive = true,
  countdownSeconds = 2,
  icon = 'trash',
  onConfirm,
  onCancel,
}: IOSConfirmModalProps) {
  const initialCountdown = singleButton ? 0 : countdownSeconds;
  const [countdown, setCountdown] = useState(initialCountdown);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    setCountdown(initialCountdown);
    setIsSubmitting(false);
  }

  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;

  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 12, saturate: 1.5 });

  useEffect(() => {
    if (!isOpen || initialCountdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, initialCountdown]);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (countdown > 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    playPopSound();
    if (onCancel) {
      onCancel();
    } else {
      onConfirm();
    }
  };

  const content = (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={handleCancel}
        style={{
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.42)',
          backdropFilter: 'blur(5px)',
          WebkitBackdropFilter: 'blur(5px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />
      <div
        ref={modalRef}
        className="ios-confirm-dialog glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 99999,
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-confirm-title"
      >
        <div style={{ padding: '22px 20px 18px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {icon === 'trash' && (
            <div
              style={{
                width: 48,
                height: 48,
                margin: '0 auto 12px',
                borderRadius: '50%',
                background: 'var(--ios-red, #FF3B30)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
              }}
            >
              <Trash2 size={23} strokeWidth={2.2} />
            </div>
          )}
          {icon === 'warning' && (
            <div
              style={{
                width: 48,
                height: 48,
                margin: '0 auto 12px',
                borderRadius: '50%',
                background: 'rgba(255, 149, 0, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ios-orange, #FF9500)',
              }}
            >
              <AlertTriangle size={23} strokeWidth={2.2} />
            </div>
          )}

          <div
            id="ios-confirm-title"
            style={{
              fontSize: 17.5,
              fontWeight: 700,
              letterSpacing: '-0.3px',
              color: 'var(--label-primary)',
              lineHeight: 1.3,
            }}
          >
            {title}
          </div>

          {message && (
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 400,
                lineHeight: 1.42,
                color: 'var(--label-secondary)',
                marginTop: 6,
                wordBreak: 'break-word',
              }}
            >
              {message}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', position: 'relative', zIndex: 1 }}>
          <button
            type="button"
            disabled={countdown > 0 || isSubmitting}
            onClick={handleConfirm}
            className={`ios-confirm-action ${destructive ? 'is-destructive' : ''}`}
            style={{
              borderTop: '0.5px solid var(--separator)',
              color: countdown > 0 ? 'var(--label-tertiary)' : (destructive ? 'var(--ios-red)' : 'var(--ios-blue)'),
              cursor: countdown > 0 ? 'not-allowed' : 'pointer',
              opacity: countdown > 0 ? 0.6 : 1,
              fontWeight: 600,
            }}
          >
            {countdown > 0 ? (
              <>
                <Lock size={15} strokeWidth={2.2} style={{ opacity: 0.8 }} />
                <span>{confirmText} ({countdown}s)</span>
              </>
            ) : (
              <span>{isSubmitting ? 'Deleting…' : confirmText}</span>
            )}
          </button>

          {!singleButton && cancelText && (
            <button
              type="button"
              onClick={handleCancel}
              className="ios-confirm-action is-cancel"
              style={{
                borderTop: '0.5px solid var(--separator)',
                color: 'var(--ios-blue)',
                fontWeight: 500,
              }}
            >
              {cancelText}
            </button>
          )}
        </div>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
