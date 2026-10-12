import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Dispatch, Party, PurchaseOrder, AppSettings } from '../types';
import { calculateSettlement, getEffectiveAdjustments } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { DispatchReceipt } from './DispatchReceipt';
import { shareReceiptImage } from '../utils/exportSharing';
import { formatDisplayDate } from '../utils/dateUtils';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  Loader2,
  Share2,
  Edit2,
  Image,
  MessageSquare,
  Calculator,
  CheckCircle2,
  Trash2,
  ExternalLink,
} from 'lucide-react';

interface DispatchPreviewModalProps {
  dispatch: Dispatch | null;
  onClose: () => void;
  party?: Party;
  parties?: Party[];
  pos?: PurchaseOrder[];
  settings?: AppSettings;
  showParty?: boolean;
  onEdit?: (dispatch: Dispatch) => void;
  onDelete?: (dispatch: Dispatch) => void;
}

export default function DispatchPreviewModal({
  dispatch,
  onClose,
  party,
  parties,
  pos = [],
  settings,
  showParty,
  onEdit,
  onDelete
}: DispatchPreviewModalProps) {
  const navigate = useNavigate();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isDispatchShareSheetOpen, setIsDispatchShareSheetOpen] = useState(false);
  const [isSharingDispatch, setIsSharingDispatch] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const curSym = getCurrencySymbol(settings?.currency);
  const targetParty = party || (parties && dispatch ? parties.find((p) => p.id === dispatch.partyId) : undefined);
  const poObj = dispatch ? pos.find((p) => p.id === dispatch.poId) : undefined;
  const shouldDisplayParty = showParty !== undefined ? showParty : (!party && !!parties);

  const handleClose = () => {
    setIsDispatchShareSheetOpen(false);
    onClose();
  };

  const handleEdit = () => {
    if (!dispatch) return;
    handleClose();
    if (onEdit) {
      onEdit(dispatch);
    } else {
      navigate(`/parties/${dispatch.partyId}/dispatch/${dispatch.id}`);
    }
  };

  const handleShareDispatchImage = async () => {
    if (!dispatch || !receiptRef.current) return;
    setIsSharingDispatch(true);
    try {
      await shareReceiptImage(receiptRef.current, dispatch, targetParty || undefined);
      playSuccessSound();
      showToast('Settlement receipt shared successfully!');
    } catch (err: unknown) {
      console.error('Share dispatch receipt error:', err);
      showToast('Failed to share receipt image.');
    } finally {
      setIsSharingDispatch(false);
    }
  };

  const handleShareDispatchWhatsApp = useCallback(async () => {
    if (!dispatch) return;

    const curSym = getCurrencySymbol(settings?.currency);
    const settlement = calculateSettlement(dispatch, settings);
    const adj = getEffectiveAdjustments(dispatch, settings);

    const text = `*${(settings?.businessName || 'AWAN COAL LOGISTICS').toUpperCase()}*
*OFFICIAL SETTLEMENT SLIP*
----------------------------------------
*Truck No:* ${dispatch.truckNumber}
*Date:* ${formatDisplayDate(dispatch.date)}
*Party:* ${targetParty?.name || dispatch.factoryName || 'Factory Client'}
${poObj ? `*PO Number:* ${poObj.poNumber}\n` : ''}*Received Weight:* ${dispatch.labReceivedWeight || 0} Tons

*LAB ANALYSIS:*
• Target GCV: ${dispatch.targetGcv || 'N/A'} kcal/kg
• Actual GCV: ${dispatch.labActualGcv || 'N/A'} kcal/kg
• Ash / Moisture / Sulphur: ${dispatch.labAsh || 0}% / ${dispatch.labMoisture || 0}% / ${dispatch.labSulphur || 0}%

*RATE & SETTLEMENT CALCULATION:*
• Base Agreement Rate: ${curSym} ${dispatch.baseRate.toFixed(2)}/ton
${adj.deduction > 0 ? `• GCV Deduction${adj.isProrata ? ` (${adj.ruleLabel})` : ''}: - ${curSym} ${adj.deduction.toFixed(2)}/ton\n` : ''}${adj.premium > 0 ? `• Premium${adj.isProrata ? ` (${adj.ruleLabel})` : ''}: + ${curSym} ${adj.premium.toFixed(2)}/ton\n` : ''}• Adjusted Rate: ${curSym} ${settlement.adjustedRate.toFixed(2)}/ton
• Tax Deduction${dispatch.taxMethod === 'formula_18_5' ? ` ((Rate + ${dispatch.taxSalesPercent ?? 18}%) × ${dispatch.taxIncomePercent ?? 5}%)` : ''}: - ${curSym} ${settlement.taxDeduction.toFixed(2)}/ton
${dispatch.commissionPerTon ? `• Commission: - ${curSym} ${dispatch.commissionPerTon.toFixed(2)}/ton\n` : ''}----------------------------------------
*PAYABLE RATE:* ${curSym} ${settlement.payableRate.toFixed(2)} / ton
*TOTAL PAYABLE:* ${curSym} ${formatAmountNumber(settlement.totalRevenue, settings)}
----------------------------------------
${dispatch.notes ? `*Remarks:* ${dispatch.notes}\n\n` : ''}E-Verified Dispatch Voucher`;

    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: `Dispatch Settlement - ${dispatch.truckNumber}`,
          text,
          dialogTitle: 'Share Settlement Slip',
        });
        playSuccessSound();
        showToast('Settlement slip shared!');
        return;
      } else if (navigator.share) {
        await navigator.share({
          title: `Dispatch Settlement - ${dispatch.truckNumber}`,
          text,
        });
        playSuccessSound();
        showToast('Settlement slip shared!');
        return;
      }
    } catch {
      // Ignored if cancelled
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      playPopSound();
      showToast('Settlement slip text copied to clipboard!');
    }
  }, [dispatch, targetParty, poObj, settings]);

  if (!dispatch) return null;

  return (
    <>
      {/* ── PREVIEW: Dispatch ── */}
      <div className="ios-modal-backdrop" onClick={handleClose} />
      <div className="ios-bottom-sheet" style={{ background: 'var(--bg-grouped)', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="ios-sheet-handle" />
        <div className="ios-sheet-header" style={{ borderBottom: '0.5px solid var(--separator)', padding: '10px 16px 12px', background: 'var(--bg-grouped)', flexShrink: 0 }}>
          <button onClick={handleClose} className="ios-nav-action" style={{ fontWeight: 400 }}>Close</button>
          <span style={{ fontSize: 17, fontWeight: 700 }}>Dispatch Preview</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/*  <button
              type="button"
              onClick={() => setIsDispatchShareSheetOpen(true)}
              disabled={isSharingDispatch}
              className="ios-nav-action"
              title="Share Receipt"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            > 
              {isSharingDispatch ? (
                <Loader2 style={{ width: 17, height: 17 }} className="animate-spin" />
              ) : (
                <Share2 style={{ width: 18, height: 18 }} strokeWidth={2.3} />
              )}
            </button>*/}
            <button onClick={handleEdit} className="ios-nav-action" style={{ fontWeight: 600 }}>Edit</button>
          </div>
        </div>

        <div className="ios-sheet-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 0 40px', background: 'var(--bg-grouped)' }}>

          {/* Prominent Share Action */}
          <div style={{ padding: '0 16px', marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => setIsDispatchShareSheetOpen(true)}
              disabled={isSharingDispatch}
              className="ios-btn ios-btn-primary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              {isSharingDispatch ? (
                <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
              ) : (
                <Share2 style={{ width: 18, height: 18 }} strokeWidth={2.4} />
              )}
              <span>Share Settlement Receipt</span>
            </button>
          </div>

          {/* Top Banner */}
          <div style={{ padding: '0 16px', marginBottom: 20 }}>
            <div style={{ background: 'var(--fill-secondary)', padding: 16, borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Truck Number</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>{dispatch.truckNumber}</div>
                <div style={{ fontSize: 14, color: 'var(--label-secondary)', marginTop: 4 }}>Date: {formatDisplayDate(dispatch.date)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  {calculateSettlement(dispatch, settings).netProfit >= 0 ? 'Net Profit' : 'Net Loss'}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: calculateSettlement(dispatch, settings).netProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)', marginTop: 2 }} className="tabular-nums">
                  {calculateSettlement(dispatch, settings).netProfit >= 0 ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(calculateSettlement(dispatch, settings).netProfit, settings)}
                </div>
              </div>
            </div>
          </div>

          <div className="ios-group">
            <div className="ios-group-title">Contract & Lab Results</div>
            <div className="ios-card-grouped" style={{ padding: '12px 16px' }}>
              {shouldDisplayParty && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Factory Account</span>
                  <span style={{ fontWeight: 600 }}>
                    {targetParty?.name || dispatch.factoryName || 'Factory Client'}
                  </span>
                </div>
              )}
              {shouldDisplayParty && poObj?.poNumber && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Purchase Order</span>
                  <span style={{ fontWeight: 500 }}>
                    {poObj.poNumber}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Target GCV</span>
                <span className="tabular-nums" style={{ fontWeight: 500 }}>{dispatch.targetGcv || 'N/A'} kcal/kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Actual GCV</span>
                <span className="tabular-nums" style={{ fontWeight: 500 }}>{dispatch.labActualGcv || 'N/A'} kcal/kg</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Ash / Moisture / Sulphur</span>
                <span className="tabular-nums" style={{ fontWeight: 500 }}>{dispatch.labAsh || 0}% / {dispatch.labMoisture || 0}% / {dispatch.labSulphur || 0}%</span>
              </div>
              <div className="ios-separator" style={{ margin: '12px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Received Weight</span>
                <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--ios-blue)' }}>{dispatch.labReceivedWeight || 0} t</span>
              </div>
            </div>
          </div>

          <div className="ios-group">
            <div className="ios-group-title">Coal Blending Sources</div>
            <div className="ios-card-grouped">
              {dispatch.coalInputs?.map((input, idx) => (
                <div key={input.id || idx}>
                  <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--label-primary)' }}>
                          {input.sourceName || 'Unknown Source'}
                        </span>
                        {input.mineId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClose();
                              navigate(`/inventory/${input.mineId}`);
                            }}
                            style={{
                              background: 'rgba(0, 122, 255, 0.1)',
                              color: 'var(--ios-blue)',
                              border: '0.5px solid rgba(0, 122, 255, 0.25)',
                              borderRadius: 6,
                              padding: '2px 7px',
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                            title="Open Mine Ledger"
                          >
                            <span>Mine</span>
                            <ExternalLink size={10} />
                          </button>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 2 }}>
                        Purchase: {curSym} {input.purchaseRate}/t
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-primary)' }}>
                      {input.weight} t
                    </div>
                  </div>
                  {idx < (dispatch.coalInputs?.length || 0) - 1 && <div className="ios-separator" />}
                </div>
              ))}
              {(!dispatch.coalInputs || dispatch.coalInputs.length === 0) && (
                <div style={{ padding: '12px 16px', color: 'var(--label-tertiary)', fontSize: 15, textAlign: 'center' }}>
                  No coal inputs recorded.
                </div>
              )}
            </div>
          </div>

          {(() => {
            const settlement = calculateSettlement(dispatch, settings);
            const adj = getEffectiveAdjustments(dispatch, settings);
            const isProfit = settlement.netProfit >= 0;
            return (
              <div className="ios-group">
                <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calculator size={16} /> Official Settlement Breakdown
                </div>
                <div className="ios-card-grouped" style={{ padding: '16px' }}>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Base Agreement Rate</span>
                    <span style={{ fontWeight: 600 }} className="tabular-nums">{curSym} {dispatch.baseRate.toFixed(2)}</span>
                  </div>

                  {adj.deduction > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
                      <span>- {adj.isProrata ? `GCV Deduction (${adj.ruleLabel})` : 'Manual Deduction'}</span>
                      <span className="tabular-nums">- {curSym} {adj.deduction.toFixed(2)}</span>
                    </div>
                  )}

                  {adj.premium > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-green)' }}>
                      <span>+ {adj.isProrata ? `Quality Premium (${adj.ruleLabel})` : 'Manual Premium'}</span>
                      <span className="tabular-nums">+ {curSym} {adj.premium.toFixed(2)}</span>
                    </div>
                  )}

                  <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>Adjusted Rate</span>
                    <span style={{ fontWeight: 600 }} className="tabular-nums">{curSym} {settlement.adjustedRate.toFixed(2)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
                    <span>- Tax Deduction {dispatch.taxMethod === 'formula_18_5' ? `((Rate + ${dispatch.taxSalesPercent ?? 18}%) × ${dispatch.taxIncomePercent ?? 5}%)` : ''}</span>
                    <span className="tabular-nums">- {curSym} {settlement.taxDeduction.toFixed(2)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Net Rate</span>
                    <span className="tabular-nums">{curSym} {settlement.netRate.toFixed(2)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
                    <span>- Commission</span>
                    <span className="tabular-nums">- {curSym} {(dispatch.commissionPerTon || 0).toFixed(2)}</span>
                  </div>

                  <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, marginBottom: 12 }}>
                    <span style={{ fontWeight: 700, color: 'var(--ios-blue)' }}>Payable Rate (per ton)</span>
                    <span style={{ fontWeight: 700, color: 'var(--ios-blue)' }} className="tabular-nums">
                      {curSym} {settlement.payableRate.toFixed(2)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--label-secondary)', marginBottom: 6 }}>
                    <span>Total Revenue ({dispatch.labReceivedWeight || 0} t × {curSym} {settlement.payableRate.toFixed(2)})</span>
                    <span className="tabular-nums">{curSym} {formatAmountNumber(settlement.totalRevenue, settings)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--label-secondary)', marginBottom: 12 }}>
                    <span>Total Cost (Coal + Overheads)</span>
                    <span className="tabular-nums">{curSym} {formatAmountNumber(settlement.totalCost, settings)}</span>
                  </div>

                  <div style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: isProfit ? 'var(--ios-green)' : 'var(--ios-red)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>
                      {isProfit ? 'Final Net Profit' : 'Final Net Loss'}
                    </span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'white' }} className="tabular-nums">
                      {isProfit ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(Math.abs(settlement.netProfit), settings)}
                    </span>
                  </div>

                </div>
              </div>
            );
          })()}

          <div style={{ padding: '0 16px', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              onClick={handleEdit}
              className="ios-btn ios-btn-primary"
              style={{ width: '100%', padding: 16, fontSize: 16, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Edit2 size={18} /> Edit Full Entry
            </button>

            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onDelete(dispatch);
                }}
                className="ios-btn ios-btn-destructive"
                style={{ width: '100%', padding: 14, fontSize: 15, borderRadius: 14, background: 'var(--ios-red)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Trash2 size={16} /> Delete Dispatch
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ── Apple iOS Action Sheet for Dispatch Sharing ── */}
      {isDispatchShareSheetOpen && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => setIsDispatchShareSheetOpen(false)}
            style={{ zIndex: 100000 }}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100001,
              padding: '0 12px calc(14px + env(safe-area-inset-bottom, 14px))',
              maxWidth: 480,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              animation: 'slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            {/* Action Sheet Group 1: Options */}
            <div
              style={{
                background: 'var(--bg-card)',
                borderRadius: 14,
                overflow: 'hidden',
                border: '0.5px solid var(--separator)',
                boxShadow: 'var(--shadow-elevated)'
              }}
            >
              {/* Action Sheet Header */}
              <div
                style={{
                  padding: '14px 16px 12px',
                  textAlign: 'center',
                  borderBottom: '0.5px solid var(--separator)',
                  background: 'var(--fill-quaternary)'
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Share Dispatch Receipt
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {dispatch.truckNumber} · {formatDisplayDate(dispatch.date)}
                </div>
              </div>

              {/* Option 1: Share as Image */}
              <button
                type="button"
                onClick={() => {
                  setIsDispatchShareSheetOpen(false);
                  handleShareDispatchImage();
                }}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '0.5px solid var(--separator)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  fontSize: 17,
                  fontWeight: 500,
                  color: 'var(--ios-blue)',
                  cursor: 'pointer'
                }}
              >
                <Image style={{ width: 20, height: 20 }} strokeWidth={2.2} />
                <span>Share as Picture (Official Receipt)</span>
              </button>

              {/* Option 2: Share Detailed WhatsApp Message */}
              <button
                type="button"
                onClick={() => {
                  setIsDispatchShareSheetOpen(false);
                  handleShareDispatchWhatsApp();
                }}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  fontSize: 17,
                  fontWeight: 500,
                  color: 'var(--ios-green)',
                  cursor: 'pointer'
                }}
              >
                <MessageSquare style={{ width: 20, height: 20 }} strokeWidth={2.2} />
                <span>Detailed WhatsApp Message</span>
              </button>
            </div>

            {/* Action Sheet Group 2: Cancel */}
            <button
              type="button"
              onClick={() => setIsDispatchShareSheetOpen(false)}
              style={{
                width: '100%',
                padding: '16px 20px',
                background: 'var(--bg-card)',
                borderRadius: 14,
                border: '0.5px solid var(--separator)',
                fontSize: 17,
                fontWeight: 600,
                color: 'var(--ios-blue)',
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: 'var(--shadow-elevated)'
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Hidden Off-Screen Component for High-Quality Image Receipt Generation */}
      <div
        style={{
          position: 'fixed',
          left: -9999,
          top: 0,
          opacity: 1,
          pointerEvents: 'none',
          zIndex: -999,
        }}
        aria-hidden="true"
      >
        <DispatchReceipt
          ref={receiptRef}
          dispatch={dispatch}
          party={targetParty || undefined}
          po={poObj}
          settings={settings}
        />
      </div>

      {/* Floating Feedback Toast (Issue 28f: Full screen mobile width + centered) */}
      {toastMsg && (
        <div className="ios-toast-banner">
          <CheckCircle2 size={16} color="var(--ios-green)" />
          <span>{toastMsg}</span>
        </div>
      )}
    </>
  );
}
