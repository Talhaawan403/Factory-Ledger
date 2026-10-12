import { X, FileJson, Calendar, Database, Merge, Trash2, ShieldCheck } from 'lucide-react';
import type { BackupPayload } from '../lib/db';
import { playPopSound } from '../utils/delight';

interface IOSImportConfirmModalProps {
  isOpen: boolean;
  fileName: string;
  backupData: BackupPayload | null;
  onConfirm: (mode: 'replace' | 'merge') => void;
  onCancel: () => void;
}

export default function IOSImportConfirmModal({
  isOpen,
  fileName,
  backupData,
  onConfirm,
  onCancel,
}: IOSImportConfirmModalProps) {
  if (!isOpen || !backupData) return null;

  const partiesCount = backupData.parties?.length || 0;
  const dispatchesCount = backupData.dispatches?.length || 0;
  const paymentsCount = backupData.payments?.length || 0;
  const posCount = backupData.pos?.length || 0;

  const formattedDate = backupData.exportDate
    ? new Date(backupData.exportDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown Date';

  const businessName = backupData.settings?.businessName || 'Standard Backup';

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
          maxWidth: 420,
          background: 'var(--bg-card, #1C1D24)',
          borderRadius: 24,
          padding: '24px 20px',
          boxShadow: '0 20px 48px rgba(0,0,0,0.5)',
          border: '0.5px solid var(--separator-opaque, #2C2D35)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Cancel Button */}
        <button
          type="button"
          onClick={() => {
            playPopSound();
            onCancel();
          }}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'var(--fill-tertiary, #2C2D35)',
            border: 'none',
            borderRadius: '50%',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--label-secondary, #8E8E93)',
          }}
        >
          <X size={17} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: 14,
              background: 'rgba(10, 132, 255, 0.15)',
              color: 'var(--ios-blue, #0A84FF)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <FileJson size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--label-primary, #FFFFFF)',
                margin: 0,
                letterSpacing: '-0.3px',
              }}
            >
              Import Backup File
            </h3>
            <div
              style={{
                fontSize: 12,
                color: 'var(--label-secondary, #8E8E93)',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {fileName}
            </div>
          </div>
        </div>

        {/* File Metadata Card */}
        <div
          style={{
            background: 'var(--fill-quaternary, #24252E)',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 16,
            border: '0.5px solid var(--separator-opaque, #2E2F3A)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--label-secondary, #8E8E93)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={14} /> Export Date
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary, #FFFFFF)' }}>
              {formattedDate}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 13, color: 'var(--label-secondary, #8E8E93)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Database size={14} /> Ledger Name
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary, #FFFFFF)' }}>
              {businessName}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              paddingTop: 12,
              borderTop: '0.5px solid var(--separator-opaque, #33343F)',
              textAlign: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ios-blue, #0A84FF)' }}>{partiesCount}</div>
              <div style={{ fontSize: 10, color: 'var(--label-secondary, #8E8E93)', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>Parties</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ios-green, #30D158)' }}>{dispatchesCount}</div>
              <div style={{ fontSize: 10, color: 'var(--label-secondary, #8E8E93)', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>Dispatches</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ios-orange, #FF9F0A)' }}>{paymentsCount}</div>
              <div style={{ fontSize: 10, color: 'var(--label-secondary, #8E8E93)', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>Payments</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ios-purple, #BF5AF2)' }}>{posCount}</div>
              <div style={{ fontSize: 10, color: 'var(--label-secondary, #8E8E93)', fontWeight: 600, textTransform: 'uppercase', marginTop: 2 }}>Orders</div>
            </div>
          </div>
        </div>

        {/* Security Shield Callout */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(48, 209, 88, 0.1)',
            borderRadius: 12,
            border: '0.5px solid rgba(48, 209, 88, 0.25)',
            marginBottom: 20,
          }}
        >
          <ShieldCheck size={18} color="var(--ios-green, #30D158)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--label-primary, #FFFFFF)', lineHeight: 1.4 }}>
            <strong>Security Protected:</strong> Your current 5-digit PIN, fingerprint, and Google account connection will remain safe and unchanged.
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Smart Merge Button (Recommended) */}
          <button
            type="button"
            onClick={() => onConfirm('merge')}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 16,
              background: 'var(--ios-blue, #0A84FF)',
              color: '#FFFFFF',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Merge size={18} />
              <div style={{ textAlign: 'left' }}>
                <div>Smart Merge Records</div>
                <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 400 }}>Combines records safely · Zero existing entries lost</div>
              </div>
            </div>
            <span style={{ fontSize: 12, opacity: 0.9, background: 'rgba(255,255,255,0.2)', padding: '3px 8px', borderRadius: 8 }}>
              Recommended
            </span>
          </button>

          {/* Replace Entire Database Button */}
          <button
            type="button"
            onClick={() => onConfirm('replace')}
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 16,
              background: 'var(--fill-tertiary, #2A2B35)',
              color: 'var(--ios-red, #FF453A)',
              border: '0.5px solid rgba(255, 69, 58, 0.25)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            <Trash2 size={18} />
            <div style={{ textAlign: 'left' }}>
              <div>Replace Entire Database</div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary, #8E8E93)', fontWeight: 400 }}>
                Wipes existing local data and loads this backup file cleanly
              </div>
            </div>
          </button>

          {/* Cancel Button */}
          <button
            type="button"
            onClick={onCancel}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 14,
              background: 'transparent',
              color: 'var(--label-secondary, #8E8E93)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 14,
              marginTop: 4,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
