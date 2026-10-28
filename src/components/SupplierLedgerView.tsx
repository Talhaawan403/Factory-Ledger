import { useState, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import type { Party, Payment, InventoryLot, AppSettings, Dispatch, Mine } from '../types';
import { cleanNumber } from '../lib/db';
import { calculatePartyBalance, roundPartyLedgerAmount, calculateSupplierStock, calculateLotStock } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber, formatCompactFinancial } from '../utils/currency';
import { formatDisplayDate, getTodayDateString } from '../utils/dateUtils';
import { playPopSound, playSuccessSound } from '../utils/delight';
import SupplierDeliveryPreviewModal from './SupplierDeliveryPreviewModal';
import SupplierInwardSheet from './SupplierInwardSheet';
import { PaymentReceipt } from './PaymentReceipt.tsx';
import { sharePaymentImage } from '../utils/exportSharing';
import IOSDatePicker from './IOSDatePicker';
import NumericInput from './NumericInput';
import PartyGlyph from './PartyGlyph';
import ExportDateRangeSheet from './ExportDateRangeSheet';
import IOSConfirmModal from './IOSConfirmModal';
import { COAL_ITEM_ID, getMaterialById, getMaterialBadgeTheme } from '../utils/materials';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  ChevronLeft,
  ChevronRight,
  Edit2,
  Trash2,
  ArchiveRestore,
  Truck,
  CreditCard,
  Share2,
  Check,
  ArrowDown,
  ArrowUp,
  Store,
  MessageSquare,
  Loader2,
  Image,
  Pickaxe,
  Link2,
} from 'lucide-react';

interface SupplierLedgerViewProps {
  party: Party;
  lots: InventoryLot[];
  payments: Payment[];
  settings?: AppSettings;
  dispatches?: Dispatch[];
  mines?: Mine[];
  onRefresh: () => Promise<void>;
  onEditParty: () => void;
  onDeleteParty: () => void;
  onArchiveParty: () => void;
  onSavePayment: (payment: Partial<Payment>) => Promise<void>;
  onDeletePayment: (id: string) => Promise<void>;
  onSaveLot: (lot: Partial<InventoryLot>) => Promise<void>;
  onDeleteLot: (id: string) => Promise<void>;
}

export default function SupplierLedgerView({
  party,
  lots,
  payments,
  settings,
  dispatches = [],
  mines = [],
  onRefresh,
  onEditParty,
  onDeleteParty,
  onArchiveParty,
  onSavePayment,
  onDeletePayment,
  onSaveLot,
  onDeleteLot,
}: SupplierLedgerViewProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'lots' | 'payments'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [previewLot, setPreviewLot] = useState<InventoryLot | null>(null);
  const [editingLot, setEditingLot] = useState<InventoryLot | null>(null);
  const [isInwardSheetOpen, setIsInwardSheetOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [previewPayment, setPreviewPayment] = useState<Payment | null>(null);
  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const [isPaymentShareSheetOpen, setIsPaymentShareSheetOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Interception notice modal for on-the-spot linked payment
  const [linkedPaymentNotice, setLinkedPaymentNotice] = useState<{
    isOpen: boolean;
    targetLot: InventoryLot;
    action: 'edit' | 'delete';
  } | null>(null);

  // Payment form state
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [isSharingPayment, setIsSharingPayment] = useState(false);
  const paymentReceiptRef = useRef<HTMLDivElement>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentType, setPaymentType] = useState<'paid' | 'received'>('paid');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'bank' | 'online' | 'cheque'>('bank');
  const [paymentDate, setPaymentDate] = useState(getTodayDateString());
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const curSym = getCurrencySymbol(settings?.currency);

  const isDirectMine = Boolean(party.isDirectMine || party.linkedMineId || party.name.toLowerCase().includes('direct ledger'));
  const linkedMine = useMemo(() => {
    if (!party) return undefined;
    if (party.linkedMineId) {
      return mines.find((m) => m.id === party.linkedMineId);
    }
    const cleanPartyName = party.name.toLowerCase();
    return mines.find((m) => cleanPartyName.startsWith(m.name.toLowerCase()) || cleanPartyName.includes(m.name.toLowerCase()));
  }, [party, mines]);

  const primaryMaterialId = party.materialIds?.[0] || COAL_ITEM_ID;
  const primaryMaterial = useMemo(() => getMaterialById(primaryMaterialId, settings), [primaryMaterialId, settings]);
  const materialTheme = useMemo(() => getMaterialBadgeTheme(primaryMaterial.id), [primaryMaterial.id]);

  // Filter lots specifically for this supplier
  const supplierLots = useMemo(() => {
    const cleanTarget = String(party.name || '').trim().toLowerCase();
    return lots.filter((l) => !l.deleted && (
      (party.id && l.supplierId === party.id) ||
      (!l.supplierId && cleanTarget && (l.supplier || l.boughtFrom || '').trim().toLowerCase() === cleanTarget)
    ));
  }, [lots, party]);

  // Filter payments specifically for this supplier
  const supplierPayments = useMemo(() => {
    const cleanTarget = String(party.name || '').trim().toLowerCase();
    return payments.filter((p) => !p.deleted && (
      (party.id && (p.partyId === party.id || p.supplierId === party.id)) ||
      (!p.partyId && !p.supplierId && cleanTarget && (p as any).partyName?.trim().toLowerCase() === cleanTarget)
    ));
  }, [payments, party]);

  // Financial balance
  const balance = useMemo(() => {
    return calculatePartyBalance([], supplierPayments, party, supplierLots);
  }, [supplierPayments, party, supplierLots]);

  // Stock tracking summary for this supplier across all lots & dispatches
  const supplierStockSummary = useMemo(() => {
    return calculateSupplierStock(party, supplierLots, dispatches);
  }, [party, supplierLots, dispatches]);

  // Merged chronological ledger timeline with sort support
  const ledgerTimeline = useMemo(() => {
    const items: Array<{
      kind: 'lot' | 'payment';
      id: string;
      date: string;
      createdAt: number;
      data: any;
    }> = [];

    for (const l of supplierLots) {
      items.push({
        kind: 'lot',
        id: l.id,
        date: l.date,
        createdAt: l.createdAt || 0,
        data: l,
      });
    }

    for (const p of supplierPayments) {
      items.push({
        kind: 'payment',
        id: p.id,
        date: p.date,
        createdAt: p.createdAt || 0,
        data: p,
      });
    }

    return items.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      const primary = dateCmp !== 0 ? dateCmp : (b.createdAt || 0) - (a.createdAt || 0);
      return sortOrder === 'desc' ? primary : -primary;
    });
  }, [supplierLots, supplierPayments, sortOrder]);

  const filteredTimeline = useMemo(() => {
    if (activeTab === 'lots') return ledgerTimeline.filter((t) => t.kind === 'lot');
    if (activeTab === 'payments') return ledgerTimeline.filter((t) => t.kind === 'payment');
    return ledgerTimeline;
  }, [ledgerTimeline, activeTab]);

  // Handle open add inward delivery
  const handleOpenAddInward = () => {
    playPopSound();
    setEditingLot(null);
    setIsInwardSheetOpen(true);
  };

  // Handle open edit inward delivery
  const handleOpenEditInward = (lotToEdit: InventoryLot) => {
    playPopSound();
    setEditingLot(lotToEdit);
    setIsInwardSheetOpen(true);
  };

  // Handle save inward delivery
  const handleSaveInward = async (lotData: Partial<InventoryLot>) => {
    const targetMatId = lotData.itemId || editingLot?.itemId || party.materialIds?.[0] || COAL_ITEM_ID;
    const targetMat = getMaterialById(targetMatId, settings);

    const paidAmount = cleanNumber(lotData.paidOnSpot);
    let finalLinkedPaymentId = editingLot?.linkedPaymentId || lotData.linkedPaymentId;
    const finalLotId = editingLot?.id || lotData.id || uuidv4();

    if (paidAmount > 0) {
      finalLinkedPaymentId = finalLinkedPaymentId || uuidv4();
      await onSavePayment({
        id: finalLinkedPaymentId,
        partyId: party.id,
        supplierId: party.id,
        linkedLotId: finalLotId,
        date: lotData.date || getTodayDateString(),
        amount: paidAmount,
        type: 'paid',
        mode: lotData.paidOnSpotMode || 'cash',
        referenceNote: `Payment paid for Inward Truck ${lotData.truckNumber || ''}${lotData.paidOnSpotNote ? ` - ${lotData.paidOnSpotNote}` : ''}`,
      });
    } else if (finalLinkedPaymentId) {
      await onDeletePayment(finalLinkedPaymentId);
      finalLinkedPaymentId = undefined;
    }

    const fullLot: Partial<InventoryLot> = {
      ...(editingLot || {}),
      ...lotData,
      id: finalLotId,
      paidOnSpot: paidAmount > 0 ? paidAmount : undefined,
      paidOnSpotMode: paidAmount > 0 ? (lotData.paidOnSpotMode || 'cash') : undefined,
      paidOnSpotNote: paidAmount > 0 ? (lotData.paidOnSpotNote || undefined) : undefined,
      linkedPaymentId: finalLinkedPaymentId,
      supplierId: party.id,
      supplier: party.name,
      boughtFrom: party.name,
      itemId: targetMat.id,
      itemName: targetMat.name,
    };
    await onSaveLot(fullLot);
    await onRefresh();
    showToast(editingLot ? 'Inward delivery updated' : `Inward ${targetMat.name} added to inventory`);
  };

  // Handle open payment modal
  const handleOpenPayment = () => {
    playPopSound();
    setEditingPaymentId(null);
    setPaymentAmount('');
    setPaymentType('paid');
    setPaymentMode('bank');
    setPaymentDate(getTodayDateString());
    setPaymentNotes('');
    setIsPaymentModalOpen(true);
  };

  // Handle open payment edit modal
  const handleOpenPaymentEdit = (pay: Payment) => {
    playPopSound();
    const linked = lots.find(
      (l) => !l.deleted && (l.linkedPaymentId === pay.id || (pay.linkedLotId && l.id === pay.linkedLotId))
    );
    if (linked) {
      setLinkedPaymentNotice({
        isOpen: true,
        targetLot: linked,
        action: 'edit',
      });
      return;
    }

    setEditingPaymentId(pay.id);
    setPaymentAmount(String(pay.amount));
    setPaymentType((pay.type as 'paid' | 'received') || 'paid');
    setPaymentMode((pay.mode as any) || 'bank');
    setPaymentDate(pay.date || getTodayDateString());
    setPaymentNotes(pay.referenceNote || '');
    setPreviewPayment(null);
    setIsPaymentModalOpen(true);
  };

  // Handle save payment
  const handleSavePaymentSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const amt = parseFloat(String(paymentAmount).replace(/,/g, ''));
    if (!amt || amt <= 0) {
      showToast('Please enter a valid payment amount');
      return;
    }

    try {
      setIsSavingPayment(true);
      const existingPay = editingPaymentId ? payments.find((p) => p.id === editingPaymentId) : undefined;
      await onSavePayment({
        id: editingPaymentId || undefined,
        partyId: party.id,
        supplierId: party.id,
        amount: amt,
        type: paymentType,
        mode: paymentMode,
        date: paymentDate,
        referenceNote: paymentNotes.trim(),
        createdAt: existingPay?.createdAt || Date.now(),
      });
      await onRefresh();
      setIsPaymentModalOpen(false);
      setEditingPaymentId(null);
      showToast(editingPaymentId ? 'Payment updated' : (paymentType === 'paid' ? 'Payment to supplier recorded' : 'Supplier refund recorded'));
    } catch {
      showToast('Failed to record payment');
    } finally {
      setIsSavingPayment(false);
    }
  };

  // Share payment voucher as picture image
  const handleSharePaymentVoucherImage = async (pay: Payment) => {
    if (!paymentReceiptRef.current) return;
    setIsSharingPayment(true);
    try {
      await sharePaymentImage(paymentReceiptRef.current, pay, party);
      playSuccessSound();
      showToast('Payment voucher picture shared!');
    } catch (err: any) {
      console.error('Share payment voucher error:', err);
      showToast('Failed to share payment voucher picture.');
    } finally {
      setIsSharingPayment(false);
    }
  };

  // Share payment voucher text
  const handleSharePaymentVoucher = useCallback(async (pay: Payment) => {
    const isPaid = pay.type === 'paid';
    const text = `*OFFICIAL PAYMENT RECEIPT*
Receipt Ref: ${(pay.id || '').slice(0, 8).toUpperCase()}
Date: ${formatDisplayDate(pay.date)}
Supplier: ${party.name}
Amount: ${curSym} ${formatAmountNumber(pay.amount, settings)}
Direction: ${isPaid ? 'PAYMENT PAID (OUTFLOW)' : 'REFUND RECEIVED (INFLOW)'}
Payment Mode: ${pay.mode.toUpperCase()}
Reference Note: ${pay.referenceNote || 'Direct Settlement'}
----------------------------------------
Outstanding Balance: ${curSym} ${formatAmountNumber(Math.abs(balance.outstandingBalance), settings)} (${balance.isPayable ? 'Payable to Supplier' : balance.isAdvance ? 'Advance Paid' : 'Account Settled'})

*${settings?.businessName || 'Awan Coal Logistics'}*`;

    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: `Payment Receipt - ${party.name}`,
          text,
          dialogTitle: 'Share Payment Receipt',
        });
        playSuccessSound();
        showToast('Payment receipt shared!');
        return;
      } else if (navigator.share) {
        await navigator.share({
          title: `Payment Receipt - ${party.name}`,
          text,
        });
        return;
      }
    } catch {
      // User cancelled share or failed, fallback to clipboard
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast('Payment receipt copied to clipboard!');
    } catch {
      showToast('Failed to copy');
    }
  }, [party, curSym, settings, balance]);



  return (
    <div className="ios-fade-in" style={{ paddingBottom: 32 }}>
      {/* ── Toast Notification Banner ── */}
      {toastMsg && (
        <div className="ios-toast-banner">
          <Check style={{ width: 16, height: 16, color: 'var(--ios-green)' }} strokeWidth={3} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Top Apple iOS Navigation Bar ── */}
      <div className="ios-navbar">
        <div className="ios-navbar-top-row">
          <Link to="/parties" className="ios-back-button">
            <ChevronLeft style={{ width: 22, height: 22 }} strokeWidth={2.6} />
            <span></span>
          </Link>
          <div className="ios-navbar-title-inline">{party.name}</div>
          <button
            className="ios-nav-action"
            title="Share Statement"
            onClick={() => {
              playPopSound();
              setIsShareSheetOpen(true);
            }}
          >
            <Share2 style={{ width: 20, height: 20 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── Supplier Profile & Quick Edit / Delete Buttons ── */}
      <div style={{ padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <PartyGlyph name={party.name} size={58} borderRadius={16} iconSize={28} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--label-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {party.name}
            </h1>
            {isDirectMine ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#007AFF',
                  background: 'rgba(0, 122, 255, 0.12)',
                  border: '1px solid rgba(0, 122, 255, 0.28)',
                  padding: '1px 6px',
                  borderRadius: 5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3
                }}
              >
                <Pickaxe size={10} />
                <span>Direct Mine</span>
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: materialTheme.color,
                  background: materialTheme.bg,
                  border: `1px solid ${materialTheme.border}`,
                  padding: '1px 6px',
                  borderRadius: 5,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3
                }}
              >
                <span>{primaryMaterial.name}</span>
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, color: 'var(--label-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isDirectMine
              ? (linkedMine ? `Official Direct Account for ${linkedMine.name} Mine` : 'Direct Mine Owner Account · Inventory Linked')
              : [party.contactPerson || 'Raw Material Supplier', party.phone, party.address].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => {
              playPopSound();
              onEditParty();
            }}
            style={{
              background: 'var(--fill-secondary)',
              border: 'none',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--label-primary)',
              cursor: 'pointer',
            }}
            title="Edit Supplier"
            aria-label="Edit Supplier"
          >
            <Edit2 style={{ width: 18, height: 18 }} strokeWidth={2} />
          </button>

          <button
            onClick={() => {
              playPopSound();
              onDeleteParty();
            }}
            style={{
              background: 'var(--ios-red)',
              border: 'none',
              borderRadius: '50%',
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              cursor: 'pointer',
            }}
            title="Delete Supplier"
            aria-label="Delete Supplier"
          >
            <Trash2 style={{ width: 17, height: 17 }} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── Direct Mine Linked Banner ── */}
      {isDirectMine && linkedMine && (
        <div
          style={{
            margin: '0 20px 14px',
            padding: '10px 14px',
            background: 'rgba(0, 122, 255, 0.06)',
            borderRadius: 12,
            border: '1px solid rgba(0, 122, 255, 0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: '#007AFF',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Pickaxe size={15} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }}>
                Linked to {linkedMine.name} Mine
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--label-secondary)' }}>
                Direct mine entries & payments sync with this ledger
              </div>
            </div>
          </div>
          <Link
            to={`/inventory/${linkedMine.id}`}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#007AFF',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              textDecoration: 'none',
              flexShrink: 0
            }}
          >
            <span>Mine Ledger</span>
            <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {/* ── Archived Warning Banner ── */}
      {party.isArchived && (
        <div
          style={{
            margin: '0 16px 16px',
            padding: '12px 16px',
            borderRadius: 14,
            background: 'var(--fill-secondary)',
            border: '0.5px solid var(--separator)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ios-orange)' }}>
              Supplier is Archived
            </div>
            <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2 }}>
              Hidden from active accounts. Unarchive to resume new operations.
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              playPopSound();
              await onArchiveParty();
            }}
            className="ios-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              background: 'var(--ios-blue)',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <ArchiveRestore size={14} />
            Unarchive
          </button>
        </div>
      )}

      {/* ── 3 Action Buttons (Above Hero Card, Matching Buyer) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '0 16px', marginBottom: 18 }}>
        <button
          onClick={handleOpenAddInward}
          style={{
            padding: '13px 8px',
            borderRadius: 16,
            background: '#FF9500',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: 'none',
            transition: 'transform 0.15s ease',
          }}
          className="ios-tile-btn interactive-scale"
        >
          <Truck style={{ width: 22, height: 22 }} strokeWidth={2.4} />
          <span>+ Inward Stock</span>
        </button>

        <button
          onClick={handleOpenPayment}
          style={{
            padding: '13px 8px',
            borderRadius: 16,
            background: 'var(--ios-green)',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: 'none',
            transition: 'transform 0.15s ease',
          }}
          className="ios-tile-btn interactive-scale"
        >
          <CreditCard style={{ width: 22, height: 22 }} strokeWidth={2.4} />
          <span>+ Payment</span>
        </button>

        <button
          onClick={() => {
            playPopSound();
            setIsShareSheetOpen(true);
          }}
          style={{
            padding: '13px 8px',
            borderRadius: 16,
            background: 'var(--ios-purple)',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: 'none',
            transition: 'transform 0.15s ease',
          }}
          className="ios-tile-btn interactive-scale"
        >
          <Share2 style={{ width: 22, height: 22 }} strokeWidth={2.4} />
          <span>Statement</span>
        </button>
      </div>

      {/* ── Dashboard Hero Card (Sleek Horizontal Stats) ── */}
      <div style={{ width: '100%', marginBottom: 18 }}>
        <div className="ios-hero-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Supplier Account Status
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 8,
                  background: balance.isPayable
                    ? 'rgba(255,149,0,0.15)'
                    : balance.isAdvance
                      ? 'rgba(52,199,89,0.15)'
                      : 'rgba(142,142,147,0.15)',
                  color: balance.isPayable
                    ? '#FF9500'
                    : balance.isAdvance
                      ? 'var(--ios-green)'
                      : 'var(--label-secondary)',
                  letterSpacing: '0.3px',
                }}
              >
                {balance.isPayable ? 'Payable to Supplier' : balance.isAdvance ? 'Advance Paid' : 'Account Settled'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 34,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: balance.isPayable ? '#FF9500' : balance.isAdvance ? 'var(--ios-green)' : 'var(--label-primary)',
                lineHeight: 1.15,
              }}
              className="tabular-nums"
            >
              {curSym} {formatAmountNumber(Math.abs(balance.outstandingBalance), settings)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 2, fontWeight: 500 }}>
              {balance.isPayable
                ? 'Balance owed to supplier for stock deliveries'
                : balance.isAdvance
                  ? 'Advance credit held with supplier'
                  : 'All stock purchases and payments balanced'}
            </div>
          </div>

          {/* Sleek Horizontal Stats Row */}
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '0.5px solid var(--separator)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              textAlign: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                Purchases
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }} className="tabular-nums">
                {curSym} {formatCompactFinancial(balance.totalBilled, settings, 1).value} {formatCompactFinancial(balance.totalBilled, settings, 1).unit}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                Paid Out
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ios-green)', marginTop: 2 }} className="tabular-nums">
                {curSym} {formatCompactFinancial(balance.totalPaymentsPaid, settings, 1).value} {formatCompactFinancial(balance.totalPaymentsPaid, settings, 1).unit}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                Total Inward
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }} className="tabular-nums">
                {balance.totalTons.toFixed(1)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--label-secondary)' }}>t</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                Yard Stock
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: supplierStockSummary.remainingTons > 0.001 ? 'var(--ios-blue)' : 'var(--label-secondary)', marginTop: 2 }} className="tabular-nums">
                {supplierStockSummary.remainingTons.toFixed(1)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--label-secondary)' }}>t</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Transaction History Filter Segment & Sort Toggle ── */}
      <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="ios-segmented" style={{ flex: 1 }}>
          <button
            className={`ios-segmented-item ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => {
              playPopSound();
              setActiveTab('all');
            }}
          >
            All
          </button>
          <button
            className={`ios-segmented-item ${activeTab === 'lots' ? 'active' : ''}`}
            onClick={() => {
              playPopSound();
              setActiveTab('lots');
            }}
          >
            Deliveries
          </button>
          <button
            className={`ios-segmented-item ${activeTab === 'payments' ? 'active' : ''}`}
            onClick={() => {
              playPopSound();
              setActiveTab('payments');
            }}
          >
            Payments
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            playPopSound();
            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
          }}
          className="ios-btn-secondary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '7px 11px',
            borderRadius: 9,
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--fill-secondary)',
            color: 'var(--label-primary)',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          title={sortOrder === 'desc' ? 'Sorted: Newest on Top' : 'Sorted: Oldest on Top'}
        >
          {sortOrder === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
          <span>{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
        </button>
      </div>

      {/* ── TIMELINE LIST ── */}
      <div className="ios-group">
        <div className="ios-group-title">
          {activeTab === 'lots'
            ? 'Inward Stock Deliveries'
            : activeTab === 'payments'
              ? 'Payment Disbursements & Refunds'
              : 'Chronological Supplier Ledger'}
        </div>

        <div className="ios-card-grouped">
          {filteredTimeline.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
              <Store size={36} style={{ margin: '0 auto 10px', opacity: 0.35 }} />
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>No Entries Yet</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Tap "+ Inward Stock" to record incoming {primaryMaterial.name} from this supplier
              </div>
            </div>
          ) : (
            filteredTimeline.map((item, idx) => {
              const dateParts = (item.date || '').split('-');
              const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
              const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
              const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

              if (item.kind === 'lot') {
                const lot = item.data as InventoryLot;
                const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
                const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
                const freight = Number(lot.freightCost || 0);
                const totalAmt = lot.totalValue !== undefined ? Number(lot.totalValue) : weight * rate + freight;

                return (
                  <div
                    key={`lot-${lot.id}`}
                    className="ios-cell"
                    onClick={() => {
                      playPopSound();
                      setPreviewLot(lot);
                    }}
                    style={{ cursor: 'pointer', padding: '12px 16px' }}
                  >
                    {/* Sleek Apple Frosted-Glass Date Tile */}
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: 'var(--fill-tertiary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 14,
                        flexShrink: 0,
                        border: '0.5px solid var(--separator)',
                      }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#FF9500', letterSpacing: 0.3 }}>
                        {monthStr}
                      </span>
                      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                        {dayStr}
                      </span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      {/* Line 1: Truck Number + Item Badge & Amount */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', whiteSpace: 'nowrap' }}>
                            {lot.truckNumber || 'Inward Stock'}
                          </span>
                          {lot.itemName && (
                            <span
                              style={{
                                color: 'var(--ios-blue)',
                                fontSize: 10.5,
                                fontWeight: 650,
                                background: 'rgba(0, 122, 255, 0.12)',
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {lot.itemName}
                            </span>
                          )}
                          {Boolean(lot.paidOnSpot && lot.paidOnSpot > 0) && (
                            <span
                              style={{
                                color: 'var(--ios-green)',
                                fontSize: 10,
                                fontWeight: 700,
                                background: 'rgba(52, 199, 89, 0.14)',
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {(lot.paidOnSpot || 0) >= totalAmt ? 'PAID' : `PAID ${curSym} ${formatAmountNumber(lot.paidOnSpot || 0, settings)}`}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#FF9500', flexShrink: 0, whiteSpace: 'nowrap' }} className="tabular-nums">
                          + {curSym} {formatAmountNumber(totalAmt, settings)}
                        </span>
                      </div>

                      {/* Line 2: Weight, Rate, Mine/Source chip, and Inward badge */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 8 }}>
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--label-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ whiteSpace: 'nowrap' }}>{weight.toFixed(2)} t · {curSym} {rate.toLocaleString()}/t</span>
                          {(lot.mineName || lot.mineSource) && (
                            <span
                              style={{
                                color: 'var(--ios-blue)',
                                fontSize: 11,
                                background: 'rgba(0, 122, 255, 0.1)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Origin: {lot.mineName || lot.mineSource}
                            </span>
                          )}
                          {lot.storedAt && (
                            <span
                              style={{
                                color: 'var(--label-secondary)',
                                fontSize: 11,
                                background: 'var(--fill-tertiary)',
                                padding: '1px 5px',
                                borderRadius: 4,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {lot.storedAt}
                            </span>
                          )}
                          {freight > 0 && (
                            <span
                              style={{
                                color: 'var(--label-secondary)',
                                fontSize: 11,
                                background: 'var(--fill-tertiary)',
                                padding: '1px 5px',
                                borderRadius: 4,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Fare: {curSym} {formatAmountNumber(freight, settings)}
                            </span>
                          )}
                        </span>
                        {(() => {
                          const stock = calculateLotStock(lot, dispatches);
                          if (stock.remainingWeight > 0.001) {
                            return (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 650,
                                  color: 'var(--ios-green)',
                                  background: 'rgba(52, 199, 89, 0.12)',
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  flexShrink: 0,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ● {stock.remainingWeight.toFixed(1)}t Yard
                              </span>
                            );
                          }
                          if (stock.usedWeight > 0.001) {
                            return (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: 'var(--label-tertiary)',
                                  background: 'var(--fill-tertiary)',
                                  padding: '1.5px 6px',
                                  borderRadius: 4,
                                  flexShrink: 0,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ✓ Dispatched
                              </span>
                            );
                          }
                          return (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 650,
                                color: '#FF9500',
                                background: 'rgba(255, 149, 0, 0.12)',
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              INWARD
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    <ChevronRight className="ios-chevron" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                    {idx < filteredTimeline.length - 1 && <div className="ios-separator with-glyph" style={{ left: 74 }} />}
                  </div>
                );
              } else {
                const pay = item.data as Payment;
                const isPaidOut = pay.type === 'paid';
                const amt = roundPartyLedgerAmount(pay.amount);

                return (
                  <div
                    key={`pay-${pay.id}`}
                    className="ios-cell"
                    onClick={() => {
                      playPopSound();
                      setPreviewPayment(pay);
                    }}
                    style={{ cursor: 'pointer', padding: '12px 16px' }}
                  >
                    {/* Sleek Apple Frosted-Glass Date Tile */}
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: 'var(--fill-tertiary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 14,
                        flexShrink: 0,
                        border: '0.5px solid var(--separator)',
                      }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 700, color: isPaidOut ? 'var(--ios-green)' : '#FF9500', letterSpacing: 0.3 }}>
                        {monthStr}
                      </span>
                      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                        {dayStr}
                      </span>
                    </div>

                    <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      {/* Line 1: Payment Direction + Mode Badge & Amount */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', whiteSpace: 'nowrap' }}>
                            {isPaidOut ? 'Cash Sent' : 'Cash Rcvd'}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '1.5px 6px',
                              borderRadius: 4,
                              background: isPaidOut ? 'rgba(52, 199, 89, 0.14)' : 'rgba(255, 149, 0, 0.14)',
                              color: isPaidOut ? 'var(--ios-green)' : '#FF9500',
                              textTransform: 'uppercase',
                              letterSpacing: '0.4px',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {pay.mode || 'BANK'}
                          </span>
                          {Boolean(pay.linkedLotId || lots.some((l) => !l.deleted && l.linkedPaymentId === pay.id)) && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1.5px 6px',
                                borderRadius: 4,
                                background: 'rgba(0, 122, 255, 0.12)',
                                color: 'var(--ios-blue)',
                                letterSpacing: '0.4px',
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                              }}
                            >
                              <Link2 size={10} strokeWidth={2.4} />
                              LINKED
                            </span>
                          )}
                        </div>
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: isPaidOut ? 'var(--ios-green)' : 'var(--ios-orange)',
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}
                          className="tabular-nums"
                        >
                          {isPaidOut ? '− ' : '+ '}{curSym} {formatAmountNumber(amt, settings)}
                        </span>
                      </div>

                      {/* Line 2: Reference Note & Debit/Credit Tag */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, gap: 8 }}>
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--label-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {pay.referenceNote ? pay.referenceNote : (pay.mode === 'bank' ? 'Bank Transfer' : pay.mode === 'cheque' ? 'Cheque Payment' : 'Cash Settlement')}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 650,
                            color: isPaidOut ? 'var(--ios-green)' : 'var(--ios-orange)',
                            background: isPaidOut ? 'rgba(52, 199, 89, 0.1)' : 'rgba(255, 149, 0, 0.1)',
                            padding: '1.5px 6px',
                            borderRadius: 4,
                            textTransform: 'uppercase',
                            letterSpacing: '0.4px',
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isPaidOut ? 'DEBIT' : 'CREDIT'}
                        </span>
                      </div>
                    </div>

                    <ChevronRight className="ios-chevron" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                    {idx < filteredTimeline.length - 1 && <div className="ios-separator with-glyph" style={{ left: 74 }} />}
                  </div>
                );
              }
            })
          )}
        </div>
      </div>

      {/* ── INWARD STOCK SHEET ── */}
      <SupplierInwardSheet
        isOpen={isInwardSheetOpen}
        onClose={() => {
          setIsInwardSheetOpen(false);
          setEditingLot(null);
        }}
        onSave={handleSaveInward}
        party={party}
        existingLot={editingLot}
        settings={settings}
        mines={mines}
      />

      {/* ── SUPPLIER DELIVERY PREVIEW MODAL ── */}
      <SupplierDeliveryPreviewModal
        lot={previewLot}
        onClose={() => setPreviewLot(null)}
        party={party}
        settings={settings}
        onEdit={(lotToEdit) => handleOpenEditInward(lotToEdit)}
        onDelete={async (lotToDelete) => {
          await onDeleteLot(lotToDelete.id);
          await onRefresh();
          setPreviewLot(null);
          showToast('Inward delivery deleted');
        }}
      />

      {/* ── PAYMENT MODAL SHEET ── */}
      {isPaymentModalOpen && (
        <>
          <div className="ios-modal-backdrop" onClick={() => setIsPaymentModalOpen(false)} style={{ zIndex: 99990 }} />
          <div
            className="ios-bottom-sheet"
            style={{
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 99995,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ios-sheet-handle" />

            <div className="ios-sheet-header">
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                className="ios-nav-action"
                style={{ fontWeight: 400 }}
              >
                Cancel
              </button>
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
                {editingPaymentId ? 'Edit Payment' : 'Record Supplier Payment'}
              </span>
              <button
                type="button"
                onClick={() => handleSavePaymentSubmit()}
                disabled={isSavingPayment || !paymentAmount || parseFloat(String(paymentAmount).replace(/,/g, '')) <= 0}
                className="ios-nav-action"
                style={{ fontWeight: 600 }}
              >
                {isSavingPayment ? 'Saving…' : 'Done'}
              </button>
            </div>

            <form onSubmit={handleSavePaymentSubmit} className="ios-sheet-body" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 36px' }}>
              {/* Payment Direction */}
              <div className="ios-group" style={{ marginTop: 0 }}>
                <div className="ios-group-title">Payment Direction</div>
                <div className="ios-card-grouped" style={{ padding: 6 }}>
                  <div className="ios-segmented">
                    <button
                      type="button"
                      className={`ios-segmented-item ${paymentType === 'paid' ? 'active' : ''}`}
                      onClick={() => setPaymentType('paid')}
                    >
                      Payment Paid (Outflow)
                    </button>
                    <button
                      type="button"
                      className={`ios-segmented-item ${paymentType === 'received' ? 'active' : ''}`}
                      onClick={() => setPaymentType('received')}
                    >
                      Payment Rcvd (Refund)
                    </button>
                  </div>
                </div>
              </div>

              {/* Payment Details */}
              <div className="ios-group">
                <div className="ios-group-title">Payment Details</div>
                <div className="ios-card-grouped">
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 16, color: 'var(--label-primary)' }}>Amount ({settings?.currency || 'PKR'}) *</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 16, color: 'var(--label-secondary)' }}>{curSym}</span>
                      <NumericInput
                        required
                        placeholder="0"
                        value={paymentAmount}
                        onChange={(val) => setPaymentAmount(val)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          fontSize: 20,
                          fontWeight: 700,
                          textAlign: 'right',
                          color: paymentType === 'paid' ? 'var(--ios-green)' : '#FF9500',
                          outline: 'none',
                          maxWidth: 160
                        }}
                        className="tabular-nums"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="ios-separator" />
                  <IOSDatePicker
                    label="Payment Date"
                    value={paymentDate}
                    onChange={setPaymentDate}
                    style={{ padding: '12px 16px' }}
                    inputStyle={{ textAlign: 'right', color: 'var(--ios-blue)' }}
                  />
                </div>
              </div>

              {/* Payment Mode */}
              <div className="ios-group">
                <div className="ios-group-title">Payment Mode</div>
                <div className="ios-card-grouped" style={{ padding: 6 }}>
                  <div className="ios-segmented">
                    {(['bank', 'cash', 'cheque', 'online'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`ios-segmented-item ${paymentMode === m ? 'active' : ''}`}
                        onClick={() => setPaymentMode(m)}
                      >
                        {m.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Reference / Notes */}
              <div className="ios-group">
                <div className="ios-group-title">Reference / Note</div>
                <div className="ios-card-grouped">
                  <div style={{ padding: '10px 16px' }}>
                    <input
                      type="text"
                      placeholder="e.g. Meezan Bank FT #884102 or Cheque number"
                      value={paymentNotes}
                      onChange={(e) => setPaymentNotes(e.target.value)}
                      style={{
                        width: '100%',
                        border: 'none',
                        background: 'transparent',
                        fontSize: 15,
                        color: 'var(--label-primary)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
                <div className="ios-group-footnote">
                  Recorded payments update what you owe this supplier and payment receipts instantly.
                </div>
              </div>

              {/* Submit Button */}
              <div style={{ padding: '10px 0 0' }}>
                <button
                  type="submit"
                  disabled={isSavingPayment || !paymentAmount || parseFloat(String(paymentAmount).replace(/,/g, '')) <= 0}
                  className="ios-btn ios-btn-primary"
                  style={{
                    width: '100%',
                    padding: 16,
                    fontSize: 16,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: paymentType === 'paid' ? 'var(--ios-green)' : '#FF9500',
                  }}
                >
                  <CreditCard size={18} />
                  {isSavingPayment
                    ? 'Saving Payment…'
                    : editingPaymentId
                      ? 'Update Payment Record'
                      : paymentType === 'paid'
                        ? 'Disburse Payment to Supplier'
                        : 'Record Refund from Supplier'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* ── SHARE STATEMENT ACTION SHEET WITH DATE RANGE ── */}
      <ExportDateRangeSheet
        isOpen={isShareSheetOpen}
        onClose={() => setIsShareSheetOpen(false)}
        party={party}
        dispatches={dispatches}
        payments={payments}
        pos={[]}
        lots={lots}
        settings={settings || ({} as any)}
        onShowToast={showToast}
      />

      {/* ── PREVIEW: Payment ── */}
      {previewPayment && (
        <>
          <div className="ios-modal-backdrop" onClick={() => setPreviewPayment(null)} style={{ zIndex: 99990 }} />
          <div className="ios-bottom-sheet" style={{ background: 'var(--bg-card)', borderTopLeftRadius: 24, borderTopRightRadius: 24, zIndex: 99995 }}>
            <div className="ios-sheet-handle" />
            <div className="ios-sheet-header" style={{ borderBottom: '0.5px solid var(--separator)', padding: '10px 16px 12px' }}>
              <button onClick={() => setPreviewPayment(null)} className="ios-nav-action" style={{ fontWeight: 400 }}>Close</button>
              <span style={{ fontSize: 17, fontWeight: 700 }}>Payment Preview</span>
              <button onClick={() => handleOpenPaymentEdit(previewPayment)} className="ios-nav-action" style={{ fontWeight: 600 }}>Edit</button>
            </div>
            <div className="ios-sheet-body" style={{ padding: '16px 16px 36px' }}>
              {/* Prominent Share Action */}
              <div style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    playPopSound();
                    setIsPaymentShareSheetOpen(true);
                  }}
                  disabled={isSharingPayment}
                  className="ios-btn ios-btn-primary"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: previewPayment.type === 'paid' ? 'var(--ios-green)' : '#FF9500',
                  }}
                >
                  {isSharingPayment ? (
                    <Loader2 style={{ width: 18, height: 18 }} className="animate-spin" />
                  ) : (
                    <Share2 style={{ width: 18, height: 18 }} strokeWidth={2.4} />
                  )}
                  <span>Share Payment Receipt</span>
                </button>
              </div>

              {/* ── Linked Record Banner if on-the-spot payment ── */}
              {(() => {
                const linkedL = lots.find(
                  (l) => !l.deleted && (l.linkedPaymentId === previewPayment.id || (previewPayment.linkedLotId && l.id === previewPayment.linkedLotId))
                );
                if (!linkedL) return null;

                return (
                  <div
                    style={{
                      background: 'rgba(0, 122, 255, 0.08)',
                      border: '0.5px solid rgba(0, 122, 255, 0.25)',
                      borderRadius: 16,
                      padding: '12px 14px',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'var(--ios-blue)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          flexShrink: 0,
                          boxShadow: '0 2px 6px rgba(0, 122, 255, 0.25)',
                        }}
                      >
                        <Link2 size={18} strokeWidth={2.4} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)' }}>
                          Linked On-the-Spot Payment
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }} className="truncate">
                          Attached to Delivery: <strong style={{ color: 'var(--label-primary)' }}>{linkedL.truckNumber || 'Inward Lot'}</strong>
                          {linkedL.date ? ` • ${formatDisplayDate(linkedL.date)}` : ''}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playPopSound();
                        const target = linkedL;
                        setPreviewPayment(null);
                        setEditingLot(target);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '7px 12px',
                        borderRadius: 999,
                        background: 'var(--ios-blue)',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <span>View Delivery</span>
                      <ChevronRight size={14} strokeWidth={2.4} />
                    </button>
                  </div>
                );
              })()}

              <div style={{ textAlign: 'center', margin: '14px 0 24px' }}>
                <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: '50%', background: previewPayment.type === 'paid' ? 'var(--ios-green)' : '#FF9500', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CreditCard style={{ color: 'white' }} size={32} />
                </div>
                <div style={{ fontSize: 14, color: 'var(--label-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  {previewPayment.type === 'paid' ? 'Payment to Supplier' : 'Supplier Refund'}
                </div>
                <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--label-primary)', margin: '8px 0' }} className="tabular-nums">
                  {curSym} {formatAmountNumber(previewPayment.amount, settings)}
                </div>
                <div style={{ fontSize: 15, color: 'var(--label-secondary)' }}>
                  {formatDisplayDate(previewPayment.date)} • {previewPayment.mode.toUpperCase()}
                </div>
                {previewPayment.referenceNote && (
                  <div style={{ fontSize: 14, color: 'var(--label-primary)', marginTop: 12, background: 'var(--fill-tertiary)', padding: '10px 16px', borderRadius: 12, display: 'inline-block' }}>
                    {previewPayment.referenceNote}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleOpenPaymentEdit(previewPayment)}
                  className="ios-btn ios-btn-primary"
                  style={{
                    width: '100%',
                    padding: 16,
                    fontSize: 16,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Edit2 size={18} /> Edit Full Entry
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const linked = lots.find(
                      (l) => !l.deleted && (l.linkedPaymentId === previewPayment.id || (previewPayment.linkedLotId && l.id === previewPayment.linkedLotId))
                    );
                    if (linked) {
                      setLinkedPaymentNotice({
                        isOpen: true,
                        targetLot: linked,
                        action: 'delete',
                      });
                      return;
                    }
                    if (confirm('Are you sure you want to delete this payment record?')) {
                      await onDeletePayment(previewPayment.id);
                      setPreviewPayment(null);
                      await onRefresh();
                      showToast('Payment deleted');
                    }
                  }}
                  className="ios-btn ios-btn-destructive"
                  style={{
                    width: '100%',
                    padding: 14,
                    fontSize: 15,
                    borderRadius: 14,
                    background: 'var(--ios-red)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <Trash2 size={16} /> Delete Payment
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Apple iOS Action Sheet for Payment Sharing ── */}
      {isPaymentShareSheetOpen && previewPayment && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => setIsPaymentShareSheetOpen(false)}
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
                  Share Payment Receipt
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {curSym} {formatAmountNumber(previewPayment.amount, settings)} · {formatDisplayDate(previewPayment.date)}
                </div>
              </div>

              {/* Option 1: Share as Image */}
              <button
                type="button"
                onClick={() => {
                  setIsPaymentShareSheetOpen(false);
                  handleSharePaymentVoucherImage(previewPayment);
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
                <span>Share as Picture (Official Voucher)</span>
              </button>

              {/* Option 2: Share Detailed WhatsApp Message */}
              <button
                type="button"
                onClick={() => {
                  setIsPaymentShareSheetOpen(false);
                  handleSharePaymentVoucher(previewPayment);
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
              onClick={() => setIsPaymentShareSheetOpen(false)}
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

      {/* Off-screen Payment Receipt for HTML2Canvas */}
      {previewPayment && (
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
          <PaymentReceipt
            ref={paymentReceiptRef}
            payment={previewPayment}
            party={party}
            settings={settings}
            currentBalance={balance.outstandingBalance}
          />
        </div>
      )}

      {/* ── Linked On-the-Spot Payment Interception Modal ── */}
      {linkedPaymentNotice && (
        <IOSConfirmModal
          isOpen={Boolean(linkedPaymentNotice.isOpen)}
          icon="link"
          title="Linked Payment Record"
          message={
            linkedPaymentNotice.action === 'delete'
              ? `This payment is attached to Inward Delivery ${linkedPaymentNotice.targetLot?.truckNumber || 'Inward Lot'}. To remove or adjust this payment, please edit the payment field in the Inward Delivery entry.\n\nSetting the payment amount to 0 or clearing the field will automatically remove this payment and keep receipts, stock lots, and ledger balances in sync.`
              : `This payment was recorded on the spot for Inward Delivery ${linkedPaymentNotice.targetLot?.truckNumber || 'Inward Lot'}. To keep receipts, stock lots, and ledger balances in sync, please update it from the Inward Delivery form.\n\nSetting the payment amount to 0 or clearing the field will remove this payment, or you can adjust the amount as needed.`
          }
          confirmText="Open Inward Delivery"
          cancelText="Cancel"
          destructive={false}
          countdownSeconds={0}
          onConfirm={() => {
            const target = linkedPaymentNotice.targetLot;
            setLinkedPaymentNotice(null);
            setPreviewPayment(null);
            playPopSound();
            setEditingLot(target);
          }}
          onCancel={() => setLinkedPaymentNotice(null)}
        />
      )}
    </div>
  );
}
