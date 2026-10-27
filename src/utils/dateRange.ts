/**
 * dateRange.ts
 * Unified date range calculation and ledger filtering utility for statement exports.
 * Supports All Time, This Month, Last Month, Last 30 Days, and Custom ranges with
 * correct accounting Opening Balance (Brought Forward) and Closing Balance.
 */

import type { Dispatch, Payment, Party, InventoryLot } from '../types';
import { formatDisplayDate, toLocalDateString } from './dateUtils';
import { calculatePartyBalance, roundPartyLedgerAmount, calculateSettlement, isDispatchPending, type PartyBalanceResult } from './calculations';

export type ExportDatePreset = 'all' | 'this_month' | 'last_month' | 'last_30_days' | 'custom';

export interface DateRangeResult {
  preset: ExportDatePreset;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  label: string; // e.g. "OCT 01, 2026 – OCT 31, 2026" or "All Time"
}

export interface FilteredLedgerResult {
  openingBalance: number;
  periodDispatches: Dispatch[];
  periodPayments: Payment[];
  periodLots: InventoryLot[];
  dateRangeLabel: string;
  from?: string;
  to?: string;
  periodBalance: PartyBalanceResult;
  closingBalance: number;
  trucksCount: number;
  paymentsCount: number;
}

/**
 * Resolves start/end dates and a human-friendly label for any preset.
 */
export function getDateRangeForPreset(
  preset: ExportDatePreset,
  customFrom?: string,
  customTo?: string,
  referenceDate: Date = new Date()
): DateRangeResult {
  if (preset === 'all') {
    return { preset: 'all', from: undefined, to: undefined, label: 'All Time' };
  }

  if (preset === 'this_month') {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${monthStr}-01`;
    const to = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    return {
      preset: 'this_month',
      from,
      to,
      label: `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`,
    };
  }

  if (preset === 'last_month') {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const from = `${year}-${monthStr}-01`;
    const to = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    return {
      preset: 'last_month',
      from,
      to,
      label: `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`,
    };
  }

  if (preset === 'last_30_days') {
    const to = toLocalDateString(referenceDate);
    const past = new Date(referenceDate.getTime() - 29 * 24 * 60 * 60 * 1000);
    const from = toLocalDateString(past);
    return {
      preset: 'last_30_days',
      from,
      to,
      label: `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`,
    };
  }

  // Custom
  const from = customFrom?.trim() || undefined;
  const to = customTo?.trim() || undefined;
  let label = 'All Time';
  if (from && to) {
    label = `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
  } else if (from) {
    label = `From ${formatDisplayDate(from)}`;
  } else if (to) {
    label = `Through ${formatDisplayDate(to)}`;
  }

  return {
    preset: 'custom',
    from,
    to,
    label,
  };
}

/**
 * Filters dispatches and payments by a date range, computing the exact
 * Opening Balance (B/F) for all prior activity, and Closing Balance at period end.
 */
export function filterLedgerByDateRange(
  dispatches: Dispatch[] = [],
  payments: Payment[] = [],
  range: { from?: string; to?: string; label?: string },
  party?: Party | null,
  lots: InventoryLot[] = []
): FilteredLedgerResult {
  const isSupplier = party?.type === 'supplier';
  const { from, to, label } = range;
  const dateRangeLabel = label || (from && to ? `${formatDisplayDate(from)} – ${formatDisplayDate(to)}` : 'All Time');

  const safeDispatches = (dispatches || []).filter((d) => !d?.deleted);
  const safePayments = (payments || []).filter((p) => !p?.deleted);
  const safeLots = (lots || []).filter((l) => !l?.deleted);

  let openingBalance = 0;

  if (from) {
    if (isSupplier) {
      // Prior supplier purchases
      const priorLots = safeLots.filter((l) => (l.date || '') < from);
      let priorPurchases = 0;
      for (const l of priorLots) {
        const tons = Number(l.receivedWeight || l.billedWeight || l.tonnage || 0);
        const rate = Number(l.purchaseRate || l.ratePerTon || l.landedRate || 0);
        priorPurchases += l.totalValue !== undefined ? Number(l.totalValue) : tons * rate;
      }

      // Prior supplier payments
      const priorPayments = safePayments.filter((p) => (p.date || '') < from);
      const priorPaid = priorPayments
        .filter((p) => p.type === 'paid' || (p as any).paymentType === 'paid' || !p.type)
        .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);
      const priorReceived = priorPayments
        .filter((p) => p.type === 'received' || (p as any).paymentType === 'received')
        .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);

      const netPriorPaid = priorPaid - priorReceived;
      openingBalance = Math.round(priorPurchases) - netPriorPaid;
    } else {
      // Prior buyer dispatches
      const priorDispatches = safeDispatches.filter((d) => !isDispatchPending(d) && (d.date || '') < from);
      const priorBilled = priorDispatches.reduce(
        (sum, d) => sum + roundPartyLedgerAmount(calculateSettlement(d).totalRevenue),
        0
      );

      // Prior buyer payments
      const priorPayments = safePayments.filter((p) => (p.date || '') < from);
      const priorReceived = priorPayments
        .filter((p) => p.type === 'received' || (p as any).paymentType === 'received')
        .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);
      const priorPaid = priorPayments
        .filter((p) => p.type === 'paid' || (p as any).paymentType === 'paid')
        .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);

      const netPriorReceived = priorReceived - priorPaid;
      openingBalance = priorBilled - netPriorReceived;
    }
  }

  // Filter items in active date window
  const periodDispatches = safeDispatches.filter((d) => {
    if (from && (d.date || '') < from) return false;
    if (to && (d.date || '') > to) return false;
    return true;
  });

  const periodPayments = safePayments.filter((p) => {
    if (from && (p.date || '') < from) return false;
    if (to && (p.date || '') > to) return false;
    return true;
  });

  const periodLots = safeLots.filter((l) => {
    if (from && (l.date || '') < from) return false;
    if (to && (l.date || '') > to) return false;
    return true;
  });

  // Calculate metrics for current period
  const periodBalance = calculatePartyBalance(periodDispatches, periodPayments, party, periodLots);

  const closingBalance = isSupplier
    ? openingBalance + (periodBalance.totalPurchases || 0) - (periodBalance.netPaymentsPaid || 0)
    : openingBalance + periodBalance.totalBilled - periodBalance.netPaymentsReceived;

  return {
    openingBalance,
    periodDispatches,
    periodPayments,
    periodLots,
    dateRangeLabel,
    from,
    to,
    periodBalance,
    closingBalance,
    trucksCount: isSupplier ? periodLots.length : periodDispatches.length,
    paymentsCount: periodPayments.length,
  };
}
