import { useState, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Calculator, Check, Percent, FileText } from 'lucide-react';
import { useRefraction } from '../hooks/useRefraction';
import { playPopSound, playSuccessSound } from '../utils/delight';
import type { TaxMethod } from '../types';

export interface IOSTaxFormulaModalProps {
  isOpen: boolean;
  initialMethod?: TaxMethod;
  initialSalesPercent?: number;
  initialIncomePercent?: number;
  onSave: (method: TaxMethod, salesPercent: number, incomePercent: number) => void | Promise<void>;
  onCancel: () => void;
}

export default function IOSTaxFormulaModal({
  isOpen,
  initialMethod = 'formula_18_5',
  initialSalesPercent = 18,
  initialIncomePercent = 5,
  onSave,
  onCancel,
}: IOSTaxFormulaModalProps) {
  const [selectedMethod, setSelectedMethod] = useState<TaxMethod>(initialMethod);
  const [salesPercent, setSalesPercent] = useState<string>(String(initialSalesPercent));
  const [incomePercent, setIncomePercent] = useState<string>(String(initialIncomePercent));
  const [isSaving, setIsSaving] = useState(false);

  const [prevProps, setPrevProps] = useState({ isOpen, initialMethod, initialSalesPercent, initialIncomePercent });
  if (
    isOpen &&
    (!prevProps.isOpen ||
      prevProps.initialMethod !== initialMethod ||
      prevProps.initialSalesPercent !== initialSalesPercent ||
      prevProps.initialIncomePercent !== initialIncomePercent)
  ) {
    setPrevProps({ isOpen, initialMethod, initialSalesPercent, initialIncomePercent });
    setSelectedMethod(initialMethod || 'formula_18_5');
    setSalesPercent(String(typeof initialSalesPercent === 'number' ? initialSalesPercent : 18));
    setIncomePercent(String(typeof initialIncomePercent === 'number' ? initialIncomePercent : 5));
    setIsSaving(false);
  } else if (!isOpen && prevProps.isOpen) {
    setPrevProps({ isOpen, initialMethod, initialSalesPercent, initialIncomePercent });
  }

  const modalRef = useRef<HTMLDivElement>(null);
  const GLASS_RADIUS = 24;

  useRefraction(modalRef, isOpen, { radius: GLASS_RADIUS, blur: 12, saturate: 1.5 });

  if (!isOpen) return null;

  const numSales = parseFloat(salesPercent) || 0;
  const numIncome = parseFloat(incomePercent) || 0;

  // Effective tax factor = (1 + sales% / 100) * (income% / 100)
  const effectiveFactor = (1 + numSales / 100) * (numIncome / 100);
  const effectivePct = (effectiveFactor * 100).toFixed(2);
  const sampleBase = 10000;
  const sampleTax = ((sampleBase * (1 + numSales / 100)) * (numIncome / 100)).toFixed(2);

  const handleSave = async () => {
    playSuccessSound();
    setIsSaving(true);
    try {
      await onSave(
        selectedMethod,
        Math.max(0, numSales),
        Math.max(0, numIncome)
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    playPopSound();
    onCancel();
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
          maxWidth: 380,
          width: '92%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-tax-modal-title"
      >
        {/* Modal Header */}
        <div style={{ padding: '20px 20px 14px', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 10px',
              borderRadius: '50%',
              background: 'rgba(255, 149, 0, 0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ios-orange, #FF9500)',
            }}
          >
            <Calculator size={24} strokeWidth={2.2} />
          </div>

          <div
            id="ios-tax-modal-title"
            style={{
              fontSize: 17.5,
              fontWeight: 700,
              letterSpacing: '-0.3px',
              color: 'var(--label-primary)',
              lineHeight: 1.3,
            }}
          >
            Tax Calculation Formula
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 400,
              lineHeight: 1.4,
              color: 'var(--label-secondary)',
              marginTop: 4,
            }}
          >
            Configure default deduction method and tax percentage factors for new dispatches
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div
          style={{
            padding: '0 18px 16px',
            position: 'relative',
            zIndex: 1,
            overflowY: 'auto',
            maxHeight: 'calc(90vh - 180px)',
          }}
        >
          {/* Method Selection (iOS Inset List) */}
          <div
            style={{
              background: 'var(--fill-quaternary, rgba(120, 120, 128, 0.08))',
              borderRadius: 14,
              overflow: 'hidden',
              marginBottom: 14,
              border: '0.5px solid var(--separator, rgba(60, 60, 67, 0.18))',
            }}
          >
            {/* Option 1: Sales Tax Formula */}
            <div
              onClick={() => {
                playPopSound();
                setSelectedMethod('formula_18_5');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                cursor: 'pointer',
                background: selectedMethod === 'formula_18_5' ? 'rgba(0, 122, 255, 0.08)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--ios-orange, #FF9500)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                  }}
                >
                  <Percent size={17} strokeWidth={2.4} />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--label-primary)' }}>
                    Sales Tax Formula
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--label-secondary)' }}>
                    (Rate + {numSales}%) × {numIncome}% auto-calculated
                  </div>
                </div>
              </div>

              {selectedMethod === 'formula_18_5' && (
                <div style={{ color: 'var(--ios-blue)', display: 'flex', alignItems: 'center' }}>
                  <Check size={18} strokeWidth={2.5} />
                </div>
              )}
            </div>

            <div style={{ height: '0.5px', background: 'var(--separator, rgba(60, 60, 67, 0.18))', marginLeft: 56 }} />

            {/* Option 2: Manual Tax Entry */}
            <div
              onClick={() => {
                playPopSound();
                setSelectedMethod('manual');
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                cursor: 'pointer',
                background: selectedMethod === 'manual' ? 'rgba(0, 122, 255, 0.08)' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--ios-blue, #007AFF)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                  }}
                >
                  <FileText size={17} strokeWidth={2.4} />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--label-primary)' }}>
                    Manual Tax Entry
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--label-secondary)' }}>
                    Enter tax deductions directly per dispatch
                  </div>
                </div>
              </div>

              {selectedMethod === 'manual' && (
                <div style={{ color: 'var(--ios-blue)', display: 'flex', alignItems: 'center' }}>
                  <Check size={18} strokeWidth={2.5} />
                </div>
              )}
            </div>
          </div>

          {/* Formula Percentage Factors Inputs */}
          {selectedMethod === 'formula_18_5' && (
            <div
              style={{
                background: 'var(--fill-quaternary, rgba(120, 120, 128, 0.08))',
                borderRadius: 14,
                padding: '14px',
                border: '0.5px solid var(--separator, rgba(60, 60, 67, 0.18))',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  color: 'var(--label-secondary)',
                  marginBottom: 10,
                }}
              >
                Formula Percentage Factors
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                {/* Sales Tax % */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--label-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    Sales Tax Factor
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--bg-card, #FFFFFF)',
                      border: '1px solid var(--separator, rgba(60, 60, 67, 0.2))',
                      borderRadius: 9,
                      padding: '0 8px',
                      height: 38,
                    }}
                  >
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={salesPercent}
                      onChange={(e) => setSalesPercent(e.target.value)}
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--label-primary)',
                        textAlign: 'right',
                        fontFamily: 'inherit',
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-secondary)', marginLeft: 4 }}>
                      %
                    </span>
                  </div>
                </div>

                {/* Advance Income Tax % */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--label-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    Advance Tax Factor
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'var(--bg-card, #FFFFFF)',
                      border: '1px solid var(--separator, rgba(60, 60, 67, 0.2))',
                      borderRadius: 9,
                      padding: '0 8px',
                      height: 38,
                    }}
                  >
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={incomePercent}
                      onChange={(e) => setIncomePercent(e.target.value)}
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--label-primary)',
                        textAlign: 'right',
                        fontFamily: 'inherit',
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-secondary)', marginLeft: 4 }}>
                      %
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Formula Preview Box */}
              <div
                style={{
                  background: 'var(--bg-card, #FFFFFF)',
                  border: '1px dashed var(--separator, rgba(60, 60, 67, 0.24))',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 11.5,
                  color: 'var(--label-secondary)',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: 'var(--label-primary)' }}>Formula Rule:</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--ios-orange)' }}>
                    (Rate + {numSales}%) × {numIncome}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span>Effective rate deduction:</span>
                  <strong style={{ color: 'var(--label-primary)' }}>{effectivePct}% of rate</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '0.5px solid var(--separator)', paddingTop: 4, marginTop: 4 }}>
                  <span>Example on 10,000/t:</span>
                  <strong style={{ color: 'var(--ios-blue)' }}>- {sampleTax} / t</strong>
                </div>
              </div>

              {/* Immutable History Guarantee Note */}
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(0, 122, 255, 0.06)',
                  border: '0.5px solid rgba(0, 122, 255, 0.2)',
                  fontSize: 11.5,
                  color: 'var(--label-primary)',
                  lineHeight: 1.4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ color: 'var(--ios-blue)', fontWeight: 700 }}>ℹ</span>
                <span>
                  Applies to <strong>future new dispatches</strong>. All previously saved dispatches remain permanently locked at their creation rates.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Bottom Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', position: 'relative', zIndex: 1 }}>
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="ios-confirm-action"
            style={{
              borderTop: '0.5px solid var(--separator, rgba(60, 60, 67, 0.18))',
              color: 'var(--ios-blue, #007AFF)',
              fontWeight: 600,
              cursor: 'pointer',
              height: 48,
              fontSize: 16,
              background: 'transparent',
              border: 'none',
              borderTopStyle: 'solid',
              borderTopWidth: 0.5,
              borderTopColor: 'var(--separator, rgba(60, 60, 67, 0.18))',
            }}
          >
            {isSaving ? 'Saving…' : 'Save Settings'}
          </button>

          <button
            type="button"
            onClick={handleCancel}
            className="ios-confirm-action is-cancel"
            style={{
              borderTop: '0.5px solid var(--separator, rgba(60, 60, 67, 0.18))',
              color: 'var(--label-secondary, #8E8E93)',
              fontWeight: 500,
              cursor: 'pointer',
              height: 46,
              fontSize: 16,
              background: 'transparent',
              border: 'none',
              borderTopStyle: 'solid',
              borderTopWidth: 0.5,
              borderTopColor: 'var(--separator, rgba(60, 60, 67, 0.18))',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
