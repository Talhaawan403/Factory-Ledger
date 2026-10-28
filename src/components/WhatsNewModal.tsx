import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  Banknote,
  Link2,
  Layers,
  ShieldCheck,
  Pickaxe,
  FileSpreadsheet,
  X,
  RotateCcw
} from 'lucide-react';
import { useRefraction } from '../hooks/useRefraction';
import { playPopSound } from '../utils/delight';

export const CURRENT_WHATS_NEW_VERSION = '2.4.0';
export const WHATS_NEW_STORAGE_KEY = 'factory_ledger_last_seen_version';

export interface WhatsNewModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: typeof Banknote;
  color: string;
}

const FEATURES: FeatureItem[] = [
  {
    id: 'on-the-spot-payments',
    title: 'Pay Cash or Fare on Trucks',
    description: 'Enter payments or freight directly when dispatching or receiving a truck. It automatically updates their ledger and calculates the balance due.',
    icon: Banknote,
    color: '#34C759', // iOS System Green
  },
  {
    id: 'smart-linkage',
    title: 'Payments Connected to Trucks',
    description: 'Every truck payment stays tied to that exact truck. Tap any payment in the ledger to open the original truck slip with one tap.',
    icon: Link2,
    color: '#007AFF', // iOS System Blue
  },
  {
    id: 'multi-material-pos',
    title: 'Contracts for All Materials',
    description: 'You can now create buyer contracts (POs) for any material—like Laterite, Bauxite, or Coal—not just coal.',
    icon: Layers,
    color: '#AF52DE', // iOS System Purple
  },
  {
    id: 'po-protection',
    title: 'Contract Safety Guard',
    description: 'Stops accidental mistakes by locking the material once trucks start moving and preventing target tons from dropping below what was already sent.',
    icon: ShieldCheck,
    color: '#FF9500', // iOS System Orange
  },
  {
    id: 'mine-tagging',
    title: 'Separate Mine Stock',
    description: 'Your own mines now clearly show as "Direct Mine" in your stock list, keeping them separate from third-party supplier trucks.',
    icon: Pickaxe,
    color: '#30B0C7', // iOS System Teal
  },
  {
    id: 'enhanced-receipts',
    title: 'Clearer Receipts & WhatsApp',
    description: 'Printed slips, WhatsApp messages, and Excel sheets now clearly show the payment given on the spot and what balance remains.',
    icon: FileSpreadsheet,
    color: '#5856D6', // iOS System Indigo
  },
];

export default function WhatsNewModal({ forceOpen, onClose }: WhatsNewModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 28;

  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 20, saturate: 1.8 });

  useEffect(() => {
    if (typeof forceOpen === 'boolean') {
      setIsOpen(forceOpen);
      return;
    }

    // Force open via URL: ?whatsnew, ?whatsnew=true, /whatsnew, #whatsnew
    const hasWhatsNewUrl =
      window.location.search.toLowerCase().includes('whatsnew') ||
      window.location.pathname.toLowerCase().includes('whatsnew') ||
      window.location.hash.toLowerCase().includes('whatsnew');

    if (hasWhatsNewUrl) {
      setIsOpen(true);
      return;
    }

    try {
      const lastSeen = localStorage.getItem(WHATS_NEW_STORAGE_KEY);
      if (lastSeen !== CURRENT_WHATS_NEW_VERSION) {
        setIsOpen(true);
      }
    } catch {
      // safe fallback
    }
  }, [forceOpen]);

  // Global developer testing hooks
  useEffect(() => {
    (window as any).showWhatsNew = () => {
      playPopSound();
      setIsOpen(true);
    };

    (window as any).resetWhatsNew = () => {
      try {
        localStorage.removeItem(WHATS_NEW_STORAGE_KEY);
      } catch {
        // no-op
      }
      playPopSound();
      setIsOpen(true);
    };

    const handleCustomOpen = () => {
      playPopSound();
      setIsOpen(true);
    };

    window.addEventListener('open-whats-new', handleCustomOpen);
    return () => {
      window.removeEventListener('open-whats-new', handleCustomOpen);
      delete (window as any).showWhatsNew;
      delete (window as any).resetWhatsNew;
    };
  }, []);

  const handleDismiss = () => {
    playPopSound();
    try {
      localStorage.setItem(WHATS_NEW_STORAGE_KEY, CURRENT_WHATS_NEW_VERSION);
    } catch {
      // safe fallback
    }
    try {
      if (window.location.search.toLowerCase().includes('whatsnew') || window.location.pathname.toLowerCase().includes('whatsnew')) {
        const cleanPath = window.location.pathname === '/whatsnew' ? '/' : window.location.pathname;
        window.history.replaceState({}, document.title, cleanPath);
      }
    } catch {
      // safe fallback
    }
    setIsOpen(false);
    if (onClose) onClose();
  };

  const handleResetFlag = () => {
    try {
      localStorage.removeItem(WHATS_NEW_STORAGE_KEY);
    } catch {
      // no-op
    }
    playPopSound();
    alert('Version flag cleared from local storage. The pop-up will appear on your next clean page reload.');
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="ios-welcome-overlay">
      {/* Native Apple Dimmer Backdrop */}
      <div
        className="ios-modal-backdrop"
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          animation: 'fadeIn 0.25s ease-out forwards',
        }}
      />

      {/* Apple HIG Welcome Sheet / Dialog */}
      <div
        ref={modalRef}
        className="ios-welcome-sheet glass"
        style={{
          '--glass-radius': `${GLASS_RADIUS}px`,
          zIndex: 2,
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        {/* iOS Grabber Handle */}
        <div
          style={{
            width: '36px',
            height: '5px',
            borderRadius: '3px',
            background: 'var(--label-quaternary, rgba(255, 255, 255, 0.2))',
            margin: '8px auto 0',
            flexShrink: 0,
          }}
        />

        {/* Circular Close Button (top-right) */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '16px',
            right: '18px',
            width: '30px',
            height: '30px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--fill-tertiary, rgba(255, 255, 255, 0.08))',
            border: 'none',
            color: 'var(--label-secondary, #94A3B8)',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--fill-secondary, rgba(255, 255, 255, 0.16))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--fill-tertiary, rgba(255, 255, 255, 0.08))';
          }}
        >
          <X size={15} strokeWidth={2.6} />
        </button>

        {/* Apple Centered Welcome Title Header */}
        <div
          style={{
            padding: '24px 28px 12px',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--ios-blue, #007AFF)',
              letterSpacing: '0.2px',
              textTransform: 'uppercase',
              marginBottom: '4px',
            }}
          >
            What&apos;s New in
          </div>
          <h1
            id="whats-new-title"
            style={{
              margin: 0,
              fontSize: '28px',
              fontWeight: 800,
              letterSpacing: '-0.6px',
              color: 'var(--label-primary, #FFFFFF)',
              lineHeight: 1.15,
            }}
          >
            Factory Ledger
          </h1>
        </div>

        {/* Unboxed Clean Apple Feature Rows */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 28px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {FEATURES.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '18px',
                }}
              >
                {/* Clean SF Glyph in soft tinted circle */}
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${item.color}1F`, // 12% opacity hex
                    color: item.color,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={22} strokeWidth={2.2} />
                </div>

                {/* Typography Block */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      letterSpacing: '-0.25px',
                      color: 'var(--label-primary, #FFFFFF)',
                      lineHeight: 1.3,
                      marginBottom: '3px',
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: '13.5px',
                      fontWeight: 400,
                      lineHeight: 1.4,
                      color: 'var(--label-secondary, #94A3B8)',
                    }}
                  >
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky Apple Continue Footer */}
        <div
          style={{
            padding: '16px 28px 24px',
            borderTop: '0.5px solid var(--separator, rgba(255, 255, 255, 0.08))',
            background: 'var(--bg-elevated, #181A24)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {/* Full-width Apple Continue Button */}
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              width: '100%',
              height: '50px',
              borderRadius: '14px',
              background: 'var(--ios-blue, #007AFF)',
              color: '#FFFFFF',
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '-0.3px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.1s ease, filter 0.15s ease',
              boxShadow: 'none',
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'brightness(1.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)';
            }}
          >
            Continue
          </button>

          {/* Version Caption (Clean for production, dev reset when testing) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              padding: '2px 4px 0',
              fontSize: '12px',
              color: 'var(--label-tertiary, #64748B)',
            }}
          >
            <span>Factory Ledger {CURRENT_WHATS_NEW_VERSION}</span>
            {(import.meta.env.DEV || window.location.search.toLowerCase().includes('whatsnew')) && (
              <button
                type="button"
                onClick={handleResetFlag}
                title="Reset seen flag in local storage"
                style={{
                  position: 'absolute',
                  right: 0,
                  background: 'none',
                  border: 'none',
                  color: 'var(--label-tertiary, #64748B)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 4px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--ios-blue, #007AFF)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--label-tertiary, #64748B)';
                }}
              >
                <RotateCcw size={11} strokeWidth={2.2} />
                <span>Reset Flag</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
