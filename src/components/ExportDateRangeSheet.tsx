import { useState, useMemo } from 'react';
import { FileText, FileSpreadsheet, X, Calendar, Loader2 } from 'lucide-react';
import type { Dispatch, Payment, Party, PurchaseOrder, AppSettings, InventoryLot } from '../types';
import { exportDispatchesPdf, exportDispatchesExcel } from '../utils/exportSharing';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { formatAmountNumber, getCurrencySymbol } from '../utils/currency';
import { formatDisplayDate, getTodayDateString } from '../utils/dateUtils';
import { getDateRangeForPreset, filterLedgerByDateRange, type ExportDatePreset } from '../utils/dateRange';
import IOSDatePicker from './IOSDatePicker';

interface ExportDateRangeSheetProps {
  isOpen: boolean;
  onClose: () => void;
  party: Party;
  dispatches: Dispatch[];
  payments: Payment[];
  pos?: PurchaseOrder[];
  lots?: InventoryLot[];
  settings?: AppSettings;
  onShowToast: (msg: string) => void;
}

export default function ExportDateRangeSheet({
  isOpen,
  onClose,
  party,
  dispatches,
  payments,
  pos = [],
  lots = [],
  settings,
  onShowToast,
}: ExportDateRangeSheetProps) {
  const [preset, setPreset] = useState<ExportDatePreset>('all');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    // Default custom to 1st of current month
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  });
  const [customTo, setCustomTo] = useState<string>(() => getTodayDateString());
  const [loadingType, setLoadingType] = useState<'pdf' | 'excel' | 'copy' | null>(null);

  const safeSettings = settings || ({ currency: 'PKR', numberFormat: 'lakh' } as AppSettings);
  const curSym = getCurrencySymbol(safeSettings.currency);
  const isSupplier = party.type === 'supplier';

  // 1. Resolve current date range
  const dateRange = useMemo(() => {
    return getDateRangeForPreset(preset, customFrom, customTo);
  }, [preset, customFrom, customTo]);

  // 2. Filter transactions and compute Opening/Closing balances
  const filteredData = useMemo(() => {
    return filterLedgerByDateRange(dispatches, payments, dateRange, party, lots);
  }, [dispatches, payments, dateRange, party, lots]);

  if (!isOpen) return null;

  const {
    openingBalance,
    periodDispatches,
    periodPayments,
    dateRangeLabel,
    periodBalance,
    closingBalance,
    trucksCount,
    paymentsCount,
  } = filteredData;

  const periodBilledOrPurchased = (isSupplier ? periodBalance.totalPurchases : periodBalance.totalBilled) || 0;
  const periodPaidOrReceived = (isSupplier ? periodBalance.netPaymentsPaid : periodBalance.netPaymentsReceived) || 0;

  // ── Handlers ──
  const handleExportPdf = async () => {
    if (loadingType) return;
    try {
      setLoadingType('pdf');
      playPopSound();

      await exportDispatchesPdf({
        party,
        partyName: party.name,
        title: `${party.name.toUpperCase()} - STATEMENT OF ACCOUNT`,
        dateRange: dateRangeLabel,
        startDate: dateRange.from,
        endDate: dateRange.to,
        openingBalance,
        dispatches: periodDispatches,
        payments: periodPayments,
        parties: [party],
        pos,
        settings: safeSettings,
      });

      playSuccessSound();
      onShowToast(`PDF Statement for ${dateRangeLabel} ready to share!`);
      onClose();
    } catch (err) {
      console.error('PDF export error:', err);
      onShowToast('Failed to generate PDF statement.');
    } finally {
      setLoadingType(null);
    }
  };

  const handleExportExcel = async () => {
    if (loadingType) return;
    try {
      setLoadingType('excel');
      playPopSound();

      await exportDispatchesExcel({
        party,
        partyName: party.name,
        dateRange: dateRangeLabel,
        startDate: dateRange.from,
        endDate: dateRange.to,
        openingBalance,
        dispatches: periodDispatches,
        payments: periodPayments,
        parties: [party],
        pos,
        settings: safeSettings,
      });

      playSuccessSound();
      onShowToast(`Excel Spreadsheet for ${dateRangeLabel} ready to share!`);
      onClose();
    } catch (err) {
      console.error('Excel export error:', err);
      onShowToast('Failed to generate Excel spreadsheet.');
    } finally {
      setLoadingType(null);
    }
  };

  const handleCopyWhatsapp = () => {
    try {
      setLoadingType('copy');
      playPopSound();

      const balanceLabel = isSupplier
        ? (closingBalance > 50 ? 'PAYABLE TO SUPPLIER' : closingBalance < -50 ? 'ADVANCE PAID' : 'ACCOUNT SETTLED')
        : (closingBalance > 0 ? 'PAYABLE BY CLIENT' : closingBalance < 0 ? 'ADVANCE CREDIT' : 'ACCOUNT SETTLED');

      const lines = [
        `*ACCOUNT STATEMENT: ${party.name.toUpperCase()}*`,
        `*Period:* ${dateRangeLabel}`,
        `*Issue Date:* ${formatDisplayDate(new Date())}`,
        party.phone ? `*Phone:* ${party.phone}` : '',
        '----------------------------------------',
        openingBalance !== 0 ? `*Opening Balance (B/F):* ${curSym} ${formatAmountNumber(Math.abs(openingBalance), safeSettings)} (${openingBalance > 0 ? 'Debit' : 'Credit'})` : '',
        `*Total Deliveries:* ${trucksCount} trucks (${periodBalance.totalTons.toFixed(2)} tons)`,
        isSupplier
          ? `*Purchases (Period):* ${curSym} ${formatAmountNumber(periodBilledOrPurchased, safeSettings)}`
          : `*Total Invoiced (Period):* ${curSym} ${formatAmountNumber(periodBilledOrPurchased, safeSettings)}`,
        isSupplier
          ? `*Payments Paid (Period):* ${curSym} ${formatAmountNumber(periodPaidOrReceived, safeSettings)}`
          : `*Payments Received (Period):* ${curSym} ${formatAmountNumber(periodPaidOrReceived, safeSettings)}`,
        '----------------------------------------',
        `*CLOSING BALANCE DUE:*`,
        `*${curSym} ${formatAmountNumber(Math.abs(closingBalance), safeSettings)}* (${balanceLabel})`,
        '----------------------------------------',
        `*Generated by ${safeSettings.businessName || 'Factory Ledger'}*`,
      ].filter(Boolean);

      const text = lines.join('\n');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        playSuccessSound();
        onShowToast(`Statement for ${dateRangeLabel} copied to clipboard!`);
        onClose();
      }
    } catch (err) {
      console.error('Copy WhatsApp statement error:', err);
      onShowToast('Failed to copy statement text.');
    } finally {
      setLoadingType(null);
    }
  };

  const presetsList: Array<{ id: ExportDatePreset; label: string }> = [
    { id: 'all', label: 'All Time' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'last_30_days', label: 'Last 30 Days' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <>
      <div className="ios-modal-backdrop" onClick={onClose} style={{ zIndex: 99998 }} />
      <div
        className="ios-bottom-sheet"
        style={{
          zIndex: 99999,
          background: 'var(--bg-grouped)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="ios-sheet-handle" />

        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            borderBottom: '0.5px solid var(--separator)',
            background: 'var(--bg-grouped)',
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
              Export Account Ledger
            </div>
            <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
              {party.name} • {isSupplier ? 'Supplier' : 'Client Factory'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ios-icon-circle-btn"
            style={{ width: 30, height: 30, background: 'var(--fill-tertiary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Scrollable Body ── */}
        <div
          style={{
            padding: '16px 16px 36px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* 1. Date Range Presets Segment */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--label-secondary)',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 8,
                paddingLeft: 4,
              }}
            >
              Statement Period
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 6,
                background: 'var(--fill-quaternary)',
                padding: 4,
                borderRadius: 12,
              }}
            >
              {presetsList.map((item) => {
                const isActive = preset === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setPreset(item.id);
                    }}
                    style={{
                      padding: '8px 4px',
                      fontSize: 11.5,
                      fontWeight: isActive ? 700 : 500,
                      borderRadius: 8,
                      border: 'none',
                      background: isActive ? 'var(--bg-card)' : 'transparent',
                      color: isActive ? 'var(--ios-blue)' : 'var(--label-secondary)',
                      boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Custom Date Range Pickers (Revealed if custom) */}
          {preset === 'custom' && (
            <div
              style={{
                background: 'var(--bg-card)',
                borderRadius: 14,
                border: '0.5px solid var(--separator)',
                overflow: 'hidden',
                animation: 'fadeIn 0.2s ease',
              }}
            >
              <IOSDatePicker
                label="Date From"
                value={customFrom}
                onChange={(d) => setCustomFrom(d)}
                style={{ padding: '13px 16px' }}
                inputStyle={{ textAlign: 'right', color: 'var(--ios-blue)', fontWeight: 500, fontSize: 16 }}
              />
              <div style={{ height: '0.5px', background: 'var(--separator)', marginLeft: 16 }} />
              <IOSDatePicker
                label="To Date"
                value={customTo}
                onChange={(d) => setCustomTo(d)}
                style={{ padding: '13px 16px' }}
                inputStyle={{ textAlign: 'right', color: 'var(--ios-blue)', fontWeight: 500, fontSize: 16 }}
              />
            </div>
          )}

          {/* 3. Period Summary Snapshot Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 16,
              border: '0.5px solid var(--separator)',
              padding: '14px 16px',
            }}
          >
            {/* Range Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '0.5px solid var(--separator)',
                paddingBottom: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} style={{ color: 'var(--ios-blue)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)' }}>
                  {dateRangeLabel}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--label-secondary)',
                  background: 'var(--fill-quaternary)',
                  padding: '2px 8px',
                  borderRadius: 10,
                }}
              >
                {trucksCount} Deliveries • {paymentsCount} Payments
              </span>
            </div>

            {/* Financial Figures Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: openingBalance !== 0 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
                gap: 10,
                marginBottom: 12,
              }}
            >
              {openingBalance !== 0 && (
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>
                    Opening (B/F)
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                    {curSym} {formatAmountNumber(Math.abs(openingBalance), safeSettings)}
                  </div>
                  <div style={{ fontSize: 10, color: openingBalance > 0 ? 'var(--ios-red)' : 'var(--ios-green)' }}>
                    {openingBalance > 0 ? 'Due Prior' : 'Credit Prior'}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>
                  {isSupplier ? 'Purchases' : 'Invoiced'}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {curSym} {formatAmountNumber(periodBilledOrPurchased, safeSettings)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--label-secondary)' }}>
                  {periodBalance.totalTons.toFixed(1)} metric tons
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>
                  {isSupplier ? 'Paid Out' : 'Received'}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ios-green)', marginTop: 2 }}>
                  {curSym} {formatAmountNumber(periodPaidOrReceived, safeSettings)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--label-secondary)' }}>
                  {paymentsCount} transactions
                </div>
              </div>
            </div>

            {/* Closing Balance Highlight */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 10,
                borderTop: '0.5px solid var(--separator)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)' }}>
                Closing Balance Due:
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: closingBalance > 0 ? 'var(--label-primary)' : 'var(--ios-green)',
                }}
              >
                {curSym} {formatAmountNumber(Math.abs(closingBalance), safeSettings)}{' '}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-tertiary)' }}>
                  ({closingBalance > 0 ? 'Receivable' : closingBalance < 0 ? 'Advance' : 'Settled'})
                </span>
              </span>
            </div>
          </div>

          {/* 4. Action Export Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 4 }}>
            {/* PDF Statement */}
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={Boolean(loadingType)}
              className="ios-btn"
              style={{
                width: '100%',
                minHeight: 50,
                padding: '14px 20px',
                fontSize: 15.5,
                fontWeight: 600,
                letterSpacing: '-0.2px',
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                background: 'var(--ios-blue)',
                color: '#FFFFFF',
                boxShadow: '0 4px 14px rgba(225, 29, 72, 0.28)',
                border: 'none',
                opacity: loadingType ? 0.7 : 1,
                cursor: loadingType ? 'wait' : 'pointer',
              }}
            >
              {loadingType === 'pdf' ? (
                <Loader2 size={19} className="animate-spin" />
              ) : (
                <FileText size={19} strokeWidth={2.2} />
              )}
              <span>Export as PDF Statement</span>
            </button>

            {/* Excel Spreadsheet */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={Boolean(loadingType)}
              className="ios-btn"
              style={{
                width: '100%',
                minHeight: 50,
                padding: '14px 20px',
                fontSize: 15.5,
                fontWeight: 600,
                letterSpacing: '-0.2px',
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                background: '#10B981',
                color: '#FFFFFF',
                boxShadow: '0 4px 14px rgba(5, 150, 105, 0.28)',
                border: 'none',
                opacity: loadingType ? 0.7 : 1,
                cursor: loadingType ? 'wait' : 'pointer',
              }}
            >
              {loadingType === 'excel' ? (
                <Loader2 size={19} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={19} strokeWidth={2.2} />
              )}
              <span>Export as Excel (.xlsx)</span>
            </button>

            {/* WhatsApp Statement */}
            <button
              type="button"
              onClick={handleCopyWhatsapp}
              disabled={Boolean(loadingType)}
              className="ios-btn"
              style={{
                width: '100%',
                minHeight: 50,
                padding: '14px 20px',
                fontSize: 15.5,
                fontWeight: 600,
                letterSpacing: '-0.2px',
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                background: 'var(--ios-green)',
                color: '#FFFFFF',
                boxShadow: '0 4px 14px rgba(37, 211, 102, 0.28)',
                border: 'none',
                opacity: loadingType ? 0.7 : 1,
                cursor: loadingType ? 'wait' : 'pointer',
              }}
            >
              {loadingType === 'copy' ? (
                <Loader2 size={19} className="animate-spin" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                  <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2zm.01 1.67c4.54 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.28-2.42 5.84a8.18 8.18 0 0 1-5.82 2.41h-.01c-1.49 0-2.95-.4-4.23-1.16l-.3-.18-3.12.82.83-3.04-.2-.31a8.188 8.188 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24h.02zm4.52 11.64c-.25-.12-1.47-.72-1.7-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.39-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.17-.48-.29z" />
                </svg>
              )}
              <span>Copy WhatsApp Statement</span>
            </button>

            {/* Cancel */}
            <button
              type="button"
              onClick={onClose}
              disabled={Boolean(loadingType)}
              className="ios-btn"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '12px',
                fontSize: 15,
                fontWeight: 500,
                borderRadius: 14,
                background: 'red',
                color: 'white',
                marginTop: 2,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
