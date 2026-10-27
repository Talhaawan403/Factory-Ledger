import { useState } from 'react';
import { Pickaxe, Check, X, Info } from 'lucide-react';
import { playPopSound } from '../utils/delight';

interface DirectMineLedgerInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  mineName: string;
  supplierName: string;
}

export default function DirectMineLedgerInfoModal({
  isOpen,
  onClose,
  mineName,
  supplierName,
}: DirectMineLedgerInfoModalProps) {
  const [language, setLanguage] = useState<'en' | 'ur'>('en');

  if (!isOpen) return null;

  const handleClose = () => {
    playPopSound();
    onClose();
  };

  return (
    <>
      <div
        className="ios-modal-backdrop"
        onClick={handleClose}
        style={{ zIndex: 99998 }}
      />
      <div
        className="ios-modal-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: 440,
          background: 'var(--bg-card)',
          borderRadius: 20,
          border: '0.5px solid var(--separator)',
          padding: 0,
          zIndex: 99999,
          overflow: 'hidden',
          boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
          fontFamily: 'var(--font-system)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div
          style={{
            padding: '16px 20px 12px',
            borderBottom: '0.5px solid var(--separator)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-grouped)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(10, 132, 255, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Pickaxe size={17} color="var(--ios-blue)" strokeWidth={2.2} />
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>
              {language === 'en' ? 'Direct Mine Ledger' : 'ڈائریکٹ مائن لیجر'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'var(--fill-tertiary)',
              border: 'none',
              borderRadius: '50%',
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--label-secondary)',
              cursor: 'pointer',
              padding: 0,
            }}
            aria-label="Close"
          >
            <X size={15} strokeWidth={2.2} />
          </button>
        </div>

        {/* Language Segmented Toggle */}
        <div style={{ padding: '14px 20px 10px', background: 'var(--bg-grouped)' }}>
          <div className="ios-segmented">
            <button
              type="button"
              className={`ios-segmented-item ${language === 'en' ? 'active' : ''}`}
              onClick={() => {
                playPopSound();
                setLanguage('en');
              }}
              style={language === 'en' ? { background: 'var(--ios-blue)', color: '#FFFFFF', fontWeight: 600 } : {}}
            >
              English
            </button>
            <button
              type="button"
              className={`ios-segmented-item ${language === 'ur' ? 'active' : ''}`}
              onClick={() => {
                playPopSound();
                setLanguage('ur');
              }}
              style={language === 'ur' ? { background: 'var(--ios-blue)', color: '#FFFFFF', fontWeight: 600 } : {}}
            >
              اردو (Urdu)
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div style={{ padding: '16px 20px', maxHeight: '60vh', overflowY: 'auto' }}>
          {language === 'en' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', letterSpacing: -0.3 }}>
                  Direct Supplier Created
                </div>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 4, lineHeight: 1.45 }}>
                  A dedicated supplier account has been automatically set up in your Parties list for {mineName}.
                </div>
              </div>

              {/* Account Card Preview */}
              <div
                style={{
                  background: 'var(--bg-grouped)',
                  border: '0.5px solid var(--separator)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(10, 132, 255, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Pickaxe size={18} color="var(--ios-blue)" strokeWidth={2} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {supplierName}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                      Direct Purchases & Payments
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--ios-blue)',
                    background: 'rgba(10, 132, 255, 0.12)',
                    border: '1px solid rgba(10, 132, 255, 0.28)',
                    padding: '2px 6px',
                    borderRadius: 5,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    flexShrink: 0,
                  }}
                >
                  Direct Mine
                </span>
              </div>

              {/* Bullet points */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Check size={16} color="var(--ios-blue)" strokeWidth={2.5} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-primary)', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 600 }}>Direct Purchases:</span> Coal bought straight from {mineName} will be recorded under this ledger automatically.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Check size={16} color="var(--ios-blue)" strokeWidth={2.5} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-primary)', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 600 }}>Owner Payments:</span> Payments you record in Mine Ledger will update this account, keeping all your payables in one place.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Info size={16} color="var(--label-tertiary)" strokeWidth={2.2} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-secondary)', lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 600 }}>Middlemen Dealers:</span> If you ever purchase {mineName} coal from a middleman (like James), simply pick their name from the supplier list.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'right' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }}>
                  ڈائریکٹ مائن لیجر تیار ہو گیا ہے
                </div>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  ہم نے آپ کی سپلائرز کی لسٹ میں {mineName} کے لیے مخصوص اکاؤنٹ شامل کر دیا ہے۔
                </div>
              </div>

              {/* Account Card Preview in Urdu */}
              <div
                style={{
                  background: 'var(--bg-grouped)',
                  border: '0.5px solid var(--separator)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(10, 132, 255, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Pickaxe size={18} color="var(--ios-blue)" strokeWidth={2} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {supplierName}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                      براہِ راست خریداری اور ادائیگیاں
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--ios-blue)',
                    background: 'rgba(10, 132, 255, 0.12)',
                    border: '1px solid rgba(10, 132, 255, 0.28)',
                    padding: '2px 6px',
                    borderRadius: 5,
                    letterSpacing: 0.3,
                    flexShrink: 0,
                  }}
                >
                  ڈائریکٹ مائن
                </span>
              </div>

              {/* Bullet points in Urdu */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Check size={16} color="var(--ios-blue)" strokeWidth={2.5} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-primary)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>براہِ راست خریداری:</span> جب بھی آپ {mineName} سے براہِ راست کوئلہ لیں گے، وہ خودکار طور پر اس لیجر میں درج ہو گا۔
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Check size={16} color="var(--ios-blue)" strokeWidth={2.5} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-primary)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>مالک کو ادائیگیاں:</span> مائن مالک کو کی جانے والی تمام ادائیگیاں اب یہاں محفوظ ہوں گی تاکہ تمام قرضے ایک ہی جگہ نظر آئیں۔
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ marginTop: 2, flexShrink: 0 }}>
                    <Info size={16} color="var(--label-tertiary)" strokeWidth={2.2} />
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--label-secondary)', lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 600 }}>ڈیلرز / مڈل مین:</span> اگر آپ یہی کوئلہ کسی ڈیلر (جیسے جیمز) سے خریدیں گے، تو آپ آسانی سے ان کا نام منتخب کر سکتے ہیں۔
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action button */}
        <div style={{ padding: '12px 20px 16px', background: 'var(--bg-card)', borderTop: '0.5px solid var(--separator)' }}>
          <button
            type="button"
            onClick={handleClose}
            className="ios-button-primary"
            style={{
              width: '100%',
              padding: '12px',
              fontSize: 16,
              fontWeight: 600,
              background: 'var(--ios-blue)',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {language === 'en' ? 'Got It' : 'سمجھ آ گئی'}
          </button>
        </div>
      </div>
    </>
  );
}
