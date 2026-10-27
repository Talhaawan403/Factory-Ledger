import { useState, useRef, useCallback } from 'react';
import type { InventoryLot, Party, AppSettings } from '../types';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { SupplierDeliveryReceipt } from './SupplierDeliveryReceipt';
import { shareSupplierDeliveryImage, generateSupplierDeliveryWhatsappText } from '../utils/exportSharing';
import { formatDisplayDate } from '../utils/dateUtils';
import {
  Share2,
  Image,
  MessageSquare,
  Loader2,
  CheckCircle2,
  Trash2,
  Edit2,
  Store,
  MapPin,
  Warehouse
} from 'lucide-react';

interface SupplierDeliveryPreviewModalProps {
  lot: InventoryLot | null;
  onClose: () => void;
  party?: Party;
  parties?: Party[];
  settings?: AppSettings;
  showParty?: boolean;
  onEdit?: (lot: InventoryLot) => void;
  onDelete?: (lot: InventoryLot) => void;
}

export default function SupplierDeliveryPreviewModal({
  lot,
  onClose,
  party,
  parties = [],
  settings,
  showParty = false,
  onEdit,
  onDelete
}: SupplierDeliveryPreviewModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const [isSharingImage, setIsSharingImage] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const curSym = getCurrencySymbol(settings?.currency);
  const targetParty = party || (lot ? parties.find((p) => p.id === lot.supplierId || p.name === lot.supplier) : undefined);

  const handleClose = () => {
    setIsShareSheetOpen(false);
    onClose();
  };

  const handleEdit = () => {
    if (!lot) return;
    handleClose();
    if (onEdit) {
      onEdit(lot);
    }
  };

  const handleSharePicture = useCallback(async () => {
    if (!lot || !receiptRef.current) return;
    try {
      setIsSharingImage(true);
      await shareSupplierDeliveryImage(receiptRef.current, lot, targetParty);
      playSuccessSound();
      showToast('Delivery voucher picture ready to share!');
      setIsShareSheetOpen(false);
    } catch (err) {
      console.error('Share delivery image failed:', err);
      showToast('Could not share delivery picture.');
    } finally {
      setIsSharingImage(false);
    }
  }, [lot, targetParty]);

  const handleShareWhatsapp = useCallback(async () => {
    if (!lot) return;
    try {
      const text = generateSupplierDeliveryWhatsappText(lot, targetParty, settings);
      if (navigator.share) {
        await navigator.share({
          title: `Delivery Receipt - ${lot.truckNumber || 'Truck'}`,
          text,
        });
      } else {
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
      }
      playSuccessSound();
      showToast('Delivery text receipt shared!');
      setIsShareSheetOpen(false);
    } catch (err) {
      console.error('Share delivery text failed:', err);
      showToast('Could not share text receipt.');
    }
  }, [lot, targetParty, settings]);

  if (!lot) return null;

  const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
  const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
  const freight = Number(lot.freightCost || 0);
  const materialCost = weight * rate;
  const totalAmount = lot.totalValue !== undefined ? Number(lot.totalValue) : materialCost + freight;
  const landedRate = weight > 0 ? (lot.landedRate || totalAmount / weight) : rate;

  return (
    <>
      {/* ── BACKDROP ── */}
      <div className="ios-modal-backdrop" onClick={handleClose} style={{ zIndex: 99990 }} />

      {/* ── MAIN BOTTOM SHEET ── */}
      <div
        className="ios-bottom-sheet"
        style={{
          background: 'var(--bg-grouped)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 99995,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* iOS Drag Handle */}
        <div className="ios-sheet-handle" />

        {/* Navigation Bar */}
        <div
          className="ios-sheet-header"
          style={{
            borderBottom: '0.5px solid var(--separator)',
            padding: '10px 16px 12px',
            background: 'var(--bg-grouped)',
            flexShrink: 0
          }}
        >
          <button
            onClick={() => {
              playPopSound();
              handleClose();
            }}
            className="ios-nav-action"
            style={{ fontWeight: 400 }}
          >
            Close
          </button>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
            Inward Delivery Preview
          </span>
          {onEdit && (
            <button
              onClick={() => {
                playPopSound();
                handleEdit();
              }}
              className="ios-nav-action"
              style={{ fontWeight: 600 }}
            >
              Edit
            </button>
          )}
        </div>

        {/* Toast Notification */}
        {toastMsg && (
          <div
            style={{
              position: 'absolute',
              top: 60,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.85)',
              color: 'white',
              padding: '8px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              zIndex: 100000,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <CheckCircle2 size={16} color="var(--ios-green)" />
            {toastMsg}
          </div>
        )}

        {/* Content Body */}
        <div className="ios-sheet-body" style={{ flex: 1, overflowY: 'auto', padding: '16px 0 40px', background: 'var(--bg-grouped)' }}>
          {/* Prominent Share Action */}
          <div style={{ padding: '0 16px', marginBottom: 14 }}>
            <button
              type="button"
              onClick={() => {
                playPopSound();
                setIsShareSheetOpen(true);
              }}
              disabled={isSharingImage}
              className="ios-btn ios-btn-primary"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: '#FF9500',
              }}
            >
              {isSharingImage ? (
                <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
              ) : (
                <Share2 style={{ width: 18, height: 18 }} strokeWidth={2.4} />
              )}
              <span>Share Delivery Receipt</span>
            </button>
          </div>

          {/* Top Banner (Matching Dispatch Preview) */}
          <div style={{ padding: '0 16px', marginBottom: 18 }}>
            <div
              style={{
                background: 'var(--fill-secondary)',
                padding: 16,
                borderRadius: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  Truck Number
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {lot.truckNumber || 'No Truck Number'}
                </div>
                <div style={{ fontSize: 14, color: 'var(--label-secondary)', marginTop: 4 }}>
                  Date: {formatDisplayDate(lot.date)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                  Total Inward Value
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#FF9500', marginTop: 2 }} className="tabular-nums">
                  {curSym} {formatAmountNumber(totalAmount, settings)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 3 }}>
                  Landed: {curSym} {landedRate.toFixed(2)}/t
                </div>
              </div>
            </div>
          </div>

          {/* Key Facts Section */}
          <div className="ios-group" style={{ marginBottom: 18 }}>
            <div className="ios-group-title">Delivery & Purchase Details</div>
            <div className="ios-card-grouped" style={{ padding: '16px' }}>
              {(showParty || !party) && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Supplier / Vendor</span>
                    <span style={{ fontWeight: 600, color: 'var(--label-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Store size={15} color="#FF9500" />
                      {targetParty?.name || lot.supplier || lot.boughtFrom || 'Supplier'}
                    </span>
                  </div>
                  <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Commodity</span>
                <span style={{ fontWeight: 700, color: 'var(--label-primary)' }}>
                  {lot.itemName || 'Raw Material'}
                </span>
              </div>

              {lot.grade && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Quality / Purity</span>
                  <span style={{ fontWeight: 650, color: '#FF9500' }}>
                    {lot.grade}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Net Inward Weight</span>
                <span style={{ fontWeight: 700, color: 'var(--label-primary)' }} className="tabular-nums">
                  {weight.toFixed(2)} Tons
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Purchase Agreement Rate</span>
                <span style={{ fontWeight: 600, color: 'var(--label-primary)' }} className="tabular-nums">
                  {curSym} {rate.toLocaleString()} / Ton
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Raw Material Cost</span>
                <span style={{ fontWeight: 600, color: 'var(--label-primary)' }} className="tabular-nums">
                  {curSym} {formatAmountNumber(materialCost, settings)}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 15 }}>
                <span style={{ color: 'var(--label-secondary)' }}>Freight / Transport Fare</span>
                <span style={{ fontWeight: 600, color: freight > 0 ? 'var(--label-primary)' : 'var(--label-tertiary)' }} className="tabular-nums">
                  {freight > 0 ? `${curSym} ${formatAmountNumber(freight, settings)}` : 'Included / Rs. 0'}
                </span>
              </div>

              <div style={{ height: 0.5, background: 'var(--separator)', margin: '12px 0 10px' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15 }}>
                <span style={{ fontWeight: 700, color: 'var(--label-primary)' }}>Effective Landed Cost</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#FF9500' }} className="tabular-nums">
                  {curSym} {landedRate.toFixed(2)} / Ton
                </span>
              </div>
            </div>
          </div>

          {/* Location & Sourcing Details */}
          {(lot.mineName || lot.mineSource || lot.storedAt) && (
            <div className="ios-group" style={{ marginBottom: 18 }}>
              <div className="ios-group-title">Origin & Yard Location</div>
              <div className="ios-card-grouped" style={{ padding: '16px' }}>
                {(lot.mineName || lot.mineSource) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: lot.storedAt ? 10 : 0, fontSize: 15 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Mine / Pit Source</span>
                    <span style={{ fontWeight: 600, color: 'var(--label-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={15} color="#FF9500" />
                      {lot.mineName || lot.mineSource}
                    </span>
                  </div>
                )}

                {(lot.mineName || lot.mineSource) && lot.storedAt && (
                  <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />
                )}

                {lot.storedAt && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 15 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Storage Yard</span>
                    <span style={{ fontWeight: 600, color: 'var(--label-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Warehouse size={15} color="#FF9500" />
                      {lot.storedAt}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {lot.notes && (
            <div className="ios-group" style={{ marginBottom: 18 }}>
              <div className="ios-group-title">Remarks & Notes</div>
              <div
                style={{
                  background: 'var(--fill-tertiary)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  fontSize: 14,
                  color: 'var(--label-secondary)',
                  margin: '0 16px',
                }}
              >
                {lot.notes}
              </div>
            </div>
          )}

          {/* Action Buttons matching DispatchPreviewModal */}
          <div style={{ padding: '0 16px', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {onEdit && (
              <button
                type="button"
                onClick={handleEdit}
                className="ios-btn ios-btn-primary"
                style={{ width: '100%', padding: 16, fontSize: 16, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Edit2 size={18} /> Edit Full Entry
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onDelete(lot);
                }}
                className="ios-btn ios-btn-destructive"
                style={{ width: '100%', padding: 14, fontSize: 15, borderRadius: 14, background: 'var(--ios-red)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <Trash2 size={16} /> Delete Delivery
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Apple iOS Action Sheet for Delivery Sharing ── */}
      {isShareSheetOpen && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => setIsShareSheetOpen(false)}
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
              animation: 'slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* Action Sheet Group 1: Options */}
            <div
              style={{
                background: 'var(--bg-card)',
                borderRadius: 14,
                overflow: 'hidden',
                border: '0.5px solid var(--separator)',
                boxShadow: 'var(--shadow-elevated)',
              }}
            >
              <div
                style={{
                  padding: '14px 16px 12px',
                  textAlign: 'center',
                  borderBottom: '0.5px solid var(--separator)',
                  background: 'var(--fill-quaternary)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Share Delivery Receipt
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {lot.truckNumber || 'Delivery'} · {formatDisplayDate(lot.date)}
                </div>
              </div>

              {/* Option 1: Share as Image */}
              <button
                type="button"
                onClick={() => {
                  setIsShareSheetOpen(false);
                  handleSharePicture();
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
                  cursor: 'pointer',
                }}
              >
                <Image style={{ width: 20, height: 20 }} strokeWidth={2.2} />
                <span>Share as Picture (Official Receipt)</span>
              </button>

              {/* Option 2: Share Detailed WhatsApp Message */}
              <button
                type="button"
                onClick={() => {
                  setIsShareSheetOpen(false);
                  handleShareWhatsapp();
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
                  cursor: 'pointer',
                }}
              >
                <MessageSquare style={{ width: 20, height: 20 }} strokeWidth={2.2} />
                <span>Detailed WhatsApp Message</span>
              </button>
            </div>

            {/* Action Sheet Group 2: Cancel */}
            <button
              type="button"
              onClick={() => setIsShareSheetOpen(false)}
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
                boxShadow: 'var(--shadow-elevated)',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Off-screen Receipt for Image Capture */}
      <div
        style={{
          position: 'fixed',
          top: -99999,
          left: -99999,
          width: 800,
          pointerEvents: 'none',
          opacity: 0,
        }}
      >
        <SupplierDeliveryReceipt ref={receiptRef} lot={lot} party={targetParty} settings={settings} />
      </div>
    </>
  );
}
