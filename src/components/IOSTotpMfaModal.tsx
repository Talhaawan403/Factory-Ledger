import { useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';

interface IOSTotpMfaModalProps {
  isOpen: boolean;
  onVerify: (code: string) => Promise<void>;
  onCancel: () => void;
}

/** Temporary sign-in bridge for accounts enrolled by an older app release. */
export default function IOSTotpMfaModal({
  isOpen,
  onVerify,
  onCancel,
}: IOSTotpMfaModalProps) {
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previousSession, setPreviousSession] = useState('');
  const session = String(isOpen);
  if (session !== previousSession) {
    setPreviousSession(session);
    setCode('');
    setErrorMessage('');
    setIsSubmitting(false);
  }

  if (!isOpen) return null;

  const handleCodeChange = (value: string) => {
    setCode(value.replace(/\D/g, '').slice(0, 10));
    setErrorMessage('');
  };

  const handleVerify = async () => {
    if (isSubmitting) return;
    if (!/^\d{6,10}$/.test(code)) {
      setErrorMessage('Enter the current numeric code from your authenticator.');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await onVerify(code);
    } catch (error: any) {
      setErrorMessage(error?.message || 'The code could not be verified. Check it and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onCancel();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.42)',
        padding: '16px 12px max(16px, env(safe-area-inset-bottom))',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="totp-mfa-title"
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--separator)',
          borderRadius: 22,
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.22)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 20px 14px', position: 'relative' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cancel authenticator sign-in"
            style={{
              position: 'absolute', top: 12, right: 12, width: 44, height: 44,
              border: 0, borderRadius: 22, background: 'var(--fill-tertiary)',
              color: 'var(--label-secondary)', display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}
          >
            <X size={19} />
          </button>

          <div style={{
            width: 48, height: 48, borderRadius: 14, background: 'rgba(0, 122, 255, 0.14)',
            color: 'var(--ios-blue)', display: 'grid', placeItems: 'center', marginBottom: 12,
          }}>
            <ShieldCheck size={24} />
          </div>
          <h2 id="totp-mfa-title" style={{ margin: 0, color: 'var(--label-primary)', fontSize: 20, lineHeight: 1.25, letterSpacing: '-0.3px' }}>
            Authenticator Code Required
          </h2>
          <p style={{ margin: '7px 0 0', color: 'var(--label-secondary)', fontSize: 14, lineHeight: 1.45 }}>
            Enter the current code from your old Factory Ledger authenticator. After sign-in, the app will remove this factor so future sign-ins use Google only.
          </p>

          <label htmlFor="totp-code" style={{ display: 'block', marginTop: 18, color: 'var(--label-secondary)', fontSize: 13, fontWeight: 600 }}>
            AUTHENTICATOR CODE
          </label>
          <input
            id="totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => handleCodeChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void handleVerify(); }}
            disabled={isSubmitting}
            placeholder="Enter code"
            aria-describedby={errorMessage ? 'totp-error' : undefined}
            style={{
              marginTop: 7, width: '100%', minHeight: 52, boxSizing: 'border-box', borderRadius: 13,
              border: `1px solid ${errorMessage ? 'var(--ios-red)' : 'var(--separator)'}`,
              background: 'var(--fill-secondary)', color: 'var(--label-primary)', padding: '0 14px',
              fontSize: 20, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums', outline: 'none',
            }}
          />
          <div id="totp-error" role="alert" style={{ minHeight: 18, marginTop: 6, color: 'var(--ios-red)', fontSize: 12 }}>
            {errorMessage}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '12px 20px max(20px, env(safe-area-inset-bottom))', borderTop: '0.5px solid var(--separator)' }}>
          <button type="button" onClick={onCancel} disabled={isSubmitting} style={{ minHeight: 48, flex: 1, border: 0, borderRadius: 13, background: 'var(--fill-tertiary)', color: 'var(--label-primary)', fontWeight: 650, cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={() => void handleVerify()} disabled={isSubmitting} style={{ minHeight: 48, flex: 1.35, border: 0, borderRadius: 13, background: 'var(--ios-blue)', color: '#fff', fontWeight: 700, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            {isSubmitting && <Loader2 size={18} className="animate-spin" />}
            Verify & Continue
          </button>
        </div>
      </section>
    </div>
  );
}
