import { useRef, type CSSProperties } from 'react';
import { useRefraction } from '../hooks/useRefraction';
import { playPopSound } from '../utils/delight';
import {
  Users,
  CloudDownload,
  GitMerge,
  Trash2,
  HardDrive
} from 'lucide-react';

/* ── Modal 1: Account Switch Dialog (e.g. Brother logs in) ── */
export interface AccountSwitchModalProps {
  isOpen: boolean;
  previousEmail: string;
  newEmail: string;
  localCount: number;
  cloudCount: number;
  onSwitchToNewAccount: () => void;
  onMergeIntoNewAccount: () => void;
  onCancel: () => void;
}

export function AccountSwitchModal({
  isOpen,
  previousEmail,
  newEmail,
  localCount,
  cloudCount,
  onSwitchToNewAccount,
  onMergeIntoNewAccount,
  onCancel,
}: AccountSwitchModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;
  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 14, saturate: 1.4 });

  if (!isOpen) return null;

  return (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={onCancel}
        style={{
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.48)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />
      <div
        ref={modalRef}
        className="ios-confirm-dialog glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 99999,
          maxWidth: 400,
          padding: '24px 20px',
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: 'rgba(255, 149, 0, 0.15)',
              color: 'var(--ios-orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            <Users style={{ width: 26, height: 26 }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: 'var(--label-primary)' }}>
            Switching Accounts
          </h2>
          <p style={{ fontSize: 13, color: 'var(--label-secondary)', margin: 0, lineHeight: 1.45 }}>
            This device has <strong>{localCount}</strong> records from{' '}
            <span style={{ color: 'var(--label-primary)', fontWeight: 600 }}>{previousEmail}</span>.
            You are signing in as{' '}
            <span style={{ color: 'var(--ios-blue)', fontWeight: 600 }}>{newEmail}</span>.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Action A: Safe Switch to New Account (Recommended) */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onSwitchToNewAccount();
            }}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'var(--ios-blue)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <CloudDownload style={{ width: 17, height: 17 }} />
            <span>Load {newEmail.split('@')[0]}’s Cloud Data ({cloudCount} records)</span>
          </button>

          {/* Action B: Merge */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onMergeIntoNewAccount();
            }}
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: 14,
              border: '1px solid var(--separator-opaque)',
              background: 'var(--fill-tertiary)',
              color: 'var(--label-primary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <GitMerge style={{ width: 16, height: 16, color: 'var(--ios-teal)' }} />
            <span>Merge Device Records into {newEmail.split('@')[0]}</span>
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onCancel();
            }}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'transparent',
              color: 'var(--label-secondary)',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel Sign-In
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Modal 2: Offline Data Conflict Dialog ── */
export interface AnonymousConflictModalProps {
  isOpen: boolean;
  email: string;
  localCount: number;
  cloudCount: number;
  onMerge: () => void;
  onUseCloud: () => void;
  onCancel: () => void;
}

export function AnonymousConflictModal({
  isOpen,
  email,
  localCount,
  cloudCount,
  onMerge,
  onUseCloud,
  onCancel,
}: AnonymousConflictModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;
  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 14, saturate: 1.4 });

  if (!isOpen) return null;

  return (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={onCancel}
        style={{
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.48)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />
      <div
        ref={modalRef}
        className="ios-confirm-dialog glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 99999,
          maxWidth: 400,
          padding: '24px 20px',
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: 'rgba(0, 122, 255, 0.15)',
              color: 'var(--ios-blue)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            <GitMerge style={{ width: 26, height: 26 }} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: 'var(--label-primary)' }}>
            Cloud Backup Found
          </h2>
          <p style={{ fontSize: 13, color: 'var(--label-secondary)', margin: 0, lineHeight: 1.45 }}>
            <strong>{email}</strong> already has <strong>{cloudCount}</strong> records in Firebase Cloud,
            and this device has <strong>{localCount}</strong> offline records.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Merge Both (Recommended) */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onMerge();
            }}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'var(--ios-blue)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <GitMerge style={{ width: 17, height: 17 }} />
            <span>Merge Both (Keep All {localCount + cloudCount} Records)</span>
          </button>

          {/* Use Cloud Only */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onUseCloud();
            }}
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: 14,
              border: '1px solid var(--separator-opaque)',
              background: 'var(--fill-tertiary)',
              color: 'var(--label-primary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <CloudDownload style={{ width: 16, height: 16 }} />
            <span>Use Cloud Records Only ({cloudCount})</span>
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onCancel();
            }}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'transparent',
              color: 'var(--label-secondary)',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Modal 3: Sign Out Action Sheet ── */
export interface SignOutActionSheetProps {
  isOpen: boolean;
  email: string;
  onKeepData: () => void;
  onClearData: () => void;
  onCancel: () => void;
}

export function SignOutActionSheet({
  isOpen,
  email,
  onKeepData,
  onClearData,
  onCancel,
}: SignOutActionSheetProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;
  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 14, saturate: 1.4 });

  if (!isOpen) return null;

  return (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={onCancel}
        style={{
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.48)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />
      <div
        ref={modalRef}
        className="ios-confirm-dialog glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 99999,
          maxWidth: 400,
          padding: '24px 20px',
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: 'var(--label-primary)' }}>
            Sign Out of Google
          </h2>
          <p style={{ fontSize: 13, color: 'var(--label-secondary)', margin: 0, lineHeight: 1.45 }}>
            Signing out of <strong style={{ color: 'var(--ios-green)' }}>{email}</strong>.<br />
            What would you like to do with data on this device?
          </p>
        </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Option A: Keep Data on Device (Recommended) */}
        <button
          type="button"
          onClick={() => {
            playPopSound();
            onKeepData();
          }}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--ios-blue)',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <HardDrive style={{ width: 17, height: 17 }} />
          <span>Keep Data on This Device (Offline)</span>
        </button>

        {/* Option B: Clear Data from Device */}
        <button
          type="button"
          onClick={() => {
            playPopSound();
            onClearData();
          }}
          style={{
            width: '100%',
            padding: '11px 14px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--ios-red)',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Trash2 style={{ width: 16, height: 16 }} />
          <span>Clear Device Data (Cloud Remains Safe)</span>
        </button>

        {/* Cancel */}
        <button
          type="button"
          onClick={() => {
            playPopSound();
            onCancel();
          }}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 14,
            border: 'none',
            background: 'transparent',
            color: 'var(--label-secondary)',
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div >
    </>
  );
}

/* ── Modal 4: Clear Data Options Sheet (Issue 17) ── */
export interface ClearDataOptionsSheetProps {
  isOpen: boolean;
  email: string;
  onClearDeviceOnly: () => void;
  onClearCloudAndDevice: () => void;
  onCancel: () => void;
}

export function ClearDataOptionsSheet({
  isOpen,
  email,
  onClearDeviceOnly,
  onClearCloudAndDevice,
  onCancel,
}: ClearDataOptionsSheetProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;
  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 14, saturate: 1.4 });

  if (!isOpen) return null;

  return (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={onCancel}
        style={{
          zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.48)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'fadeIn 0.2s ease',
        }}
      />
      <div
        ref={modalRef}
        className="ios-confirm-dialog glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 99999,
          maxWidth: 420,
          padding: '24px 20px',
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: 'var(--label-primary)' }}>
            Erase Database Records
          </h2>
          <p style={{ fontSize: 13, color: 'var(--label-secondary)', margin: 0, lineHeight: 1.45 }}>
            You are signed in as <strong style={{ color: 'var(--ios-green)' }}>{email}</strong>.<br />
            Choose how you would like to clear your data:
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Option A: Clear Device Only */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onClearDeviceOnly();
            }}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              border: '0.5px solid var(--separator-opaque, rgba(255,255,255,0.15))',
              background: 'var(--fill-tertiary, #2C2C2E)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <HardDrive style={{ width: 17, height: 17, color: 'var(--ios-blue)' }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Erase This Device Only</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--label-secondary)', fontWeight: 400, textAlign: 'left', paddingLeft: 25 }}>
              Wipes local records & signs out. Your cloud Firestore ledger remains intact.
            </span>
          </button>

          {/* Option B: Delete Everything (Device & Cloud) */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onClearCloudAndDevice();
            }}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'var(--ios-red, #ff3b30)',
              color: '#FFFFFF',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
              <Trash2 style={{ width: 17, height: 17, color: '#FFFFFF' }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>Delete Everything (Device & Cloud)</span>
            </div>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 400, textAlign: 'left', paddingLeft: 25 }}>
              Permanently wipes all records from this phone AND deletes all documents from Firestore.
            </span>
          </button>

          {/* Cancel */}
          <button
            type="button"
            onClick={() => {
              playPopSound();
              onCancel();
            }}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: 14,
              border: 'none',
              background: 'transparent',
              color: 'var(--label-secondary)',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

