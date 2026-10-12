import type { Dispatch, Payment, TaxMethod, AppSettings, InventoryLot, Mine, GeneralExpense } from "../types";
import { getCachedSettings } from "../lib/db";
import { getCurrencySymbol, formatAmountNumber } from "./currency";

export interface SettlementResult {
  gcvDeduction: number;
  sulphurDeduction: number;
  adjustedRate: number;
  taxDeduction: number;
  netRate: number;
  payableRate: number;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  taxMethod?: TaxMethod;
  gcvPremium?: number;
  isProrata?: boolean;
}

export interface EffectiveAdjustments {
  deduction: number;
  premium: number;
  isProrata: boolean;
  ruleLabel: string;
}

export interface DispatchSlipRow {
  kind: 'base-rate' | 'gcv-deduction' | 'gcv-premium' | 'adjusted-rate' | 'tax' | 'commission' | 'payable-rate' | 'total-revenue';
  label: string;
  amount: number;
  perTon: boolean;
  formattedText: string;
}

export interface LotAvailabilityInfo {
  availableBeforeThis: number;
  draftUse: number;
  remainingAfter: number;
  isOverdraw: boolean;
}

export interface MineAvailabilityInfo {
  availableBeforeThis: number;
  draftUse: number;
  remainingAfter: number;
  isOverdraw: boolean;
}

export interface PartyBalanceResult {
  totalBilled: number;
  totalPaymentsReceived: number;
  totalPaymentsPaid: number;
  netPaymentsReceived: number;
  outstandingBalance: number;
  isReceivable: boolean;
  isAdvance: boolean;
  isCleared: boolean;
  totalTons: number;
  totalProfit: number;
  dispatchesCount: number;
  paymentsCount: number;
}

function cleanNum(val: any, fallback = 0): number {
  if (typeof val === 'number') {
    return isNaN(val) || !isFinite(val) ? fallback : val;
  }
  if (val === null || val === undefined || val === '') {
    return fallback;
  }
  const str = String(val).replace(/,/g, '').trim();
  if (str === '') return fallback;
  const p = Number(str);
  return isNaN(p) || !isFinite(p) ? fallback : p;
}

/**
 * Factory Ledger posts party statements in whole rupees. Apply this at the
 * transaction boundary (each invoice/payment), not only to an aggregate, so
 * a statement's rows, running balance, and totals always reconcile.
 */
export function roundPartyLedgerAmount(amount: unknown): number {
  return Math.round(cleanNum(amount));
}

export function calculateSettlement(dispatch: Dispatch, settings?: AppSettings | null): SettlementResult {
  if (!dispatch) {
    return {
      gcvDeduction: 0,
      sulphurDeduction: 0,
      adjustedRate: 0,
      taxDeduction: 0,
      netRate: 0,
      payableRate: 0,
      totalRevenue: 0,
      totalCost: 0,
      netProfit: 0,
      taxMethod: 'manual',
    };
  }

  const baseRate = cleanNum(dispatch.baseRate);
  const labReceivedWeight = cleanNum(dispatch.labReceivedWeight);
  const manualDeduction = cleanNum(dispatch.manualDeduction);
  const manualPremium = cleanNum(dispatch.manualPremium);
  const manualTax = cleanNum(dispatch.manualTax);
  const commissionPerTon = cleanNum(dispatch.commissionPerTon);
  const overheads = dispatch.overheads || ({} as any);
  const coalInputs = Array.isArray(dispatch.coalInputs) ? dispatch.coalInputs : [];

  // Pro-rata GCV pricing calculation (contract rule on PO / dispatch)
  const isProrata = dispatch.gcvAdjustment === 'prorata';
  let effectiveDeduction = manualDeduction;
  let effectivePremium = manualPremium;

  if (isProrata) {
    const targetGcv = cleanNum(dispatch.targetGcv);
    const labActualGcv = cleanNum(dispatch.labActualGcv);
    const rounding = dispatch.gcvAdjustmentRounding || 'paisa';

    if (targetGcv > 0 && baseRate > 0 && labActualGcv > 0) {
      if (labActualGcv < targetGcv) {
        const raw = baseRate * (1 - (labActualGcv / targetGcv));
        effectiveDeduction = rounding === 'rupee' ? Math.round(raw) : Number(raw.toFixed(2));
        effectivePremium = 0;
      } else if (labActualGcv > targetGcv) {
        const raw = baseRate * ((labActualGcv / targetGcv) - 1);
        effectivePremium = rounding === 'rupee' ? Math.round(raw) : Number(raw.toFixed(2));
        effectiveDeduction = 0;
      } else {
        effectiveDeduction = 0;
        effectivePremium = 0;
      }
    }
  }

  // 1. Calculate Adjusted Rate: Base Rate - GCV Deduction + GCV Premium
  const adjustedRate = baseRate - effectiveDeduction + effectivePremium;

  // 2. Determine Tax Deduction:
  //    - If taxMethod === 'manual', use manualTax.
  //    - If taxMethod === 'formula_18_5', automatically calculate using (Adjusted Rate + salesTax%) * incomeTax%.
  //    - Prioritize the dispatch's own frozen snapshot factors to preserve historical immutability.
  const appSettings = settings || getCachedSettings();
  const isExistingSaved = Boolean(dispatch.id);

  const salesPercent = typeof dispatch.taxSalesPercent === 'number'
    ? dispatch.taxSalesPercent
    : (isExistingSaved
        ? 18
        : (typeof appSettings?.taxFormulaSalesPercent === 'number'
            ? appSettings.taxFormulaSalesPercent
            : 18));

  const incomePercent = typeof dispatch.taxIncomePercent === 'number'
    ? dispatch.taxIncomePercent
    : (isExistingSaved
        ? 5
        : (typeof appSettings?.taxFormulaIncomePercent === 'number'
            ? appSettings.taxFormulaIncomePercent
            : 5));

  const activeTaxMethod: TaxMethod = dispatch.taxMethod || 'manual';
  const taxDeduction =
    activeTaxMethod === 'formula_18_5'
      ? (adjustedRate * (1 + salesPercent / 100)) * (incomePercent / 100)
      : manualTax;

  // 3. Calculate Payable Rate: Adjusted Rate - Tax Deduction - Commission
  const payableRate = adjustedRate - taxDeduction - commissionPerTon;

  // Total Revenue: Final Payable Rate × Received Weight
  const totalRevenue = payableRate * labReceivedWeight;

  // Total Cost: Sum of (Coal Recipe Weights × Buy Prices) + Sum of Expenses (Loading, Transport, Crushing, Royalty, Other)
  const totalCoalCost = coalInputs.reduce((sum, input) => sum + (cleanNum(input?.weight) * cleanNum(input?.purchaseRate)), 0);
  const totalOverheads = cleanNum(overheads.loading) + cleanNum(overheads.freight) + cleanNum(overheads.crush) + cleanNum(overheads.royalty) + cleanNum(overheads.other);
  
  const totalCost = totalCoalCost + totalOverheads;

  // Final Profit/Loss: Total Revenue - Total Cost
  const netProfit = totalRevenue - totalCost;

  return {
    gcvDeduction: cleanNum(effectiveDeduction), 
    sulphurDeduction: 0,
    adjustedRate: cleanNum(adjustedRate),
    taxDeduction: cleanNum(taxDeduction),
    netRate: cleanNum(payableRate + commissionPerTon),
    payableRate: cleanNum(payableRate),
    totalRevenue: cleanNum(totalRevenue),
    totalCost: cleanNum(totalCost),
    netProfit: cleanNum(netProfit),
    taxMethod: activeTaxMethod,
    gcvPremium: cleanNum(effectivePremium),
    isProrata,
  };
}

/**
 * Returns effective quality deduction and premium values for UI display, receipts, and exports.
 * Transparently extracts pro-rata calculated values from calculateSettlement if active,
 * or returns manual adjustment values, ensuring paperwork matches the true settled price.
 */
export function getEffectiveAdjustments(dispatch: Dispatch, settings?: AppSettings | null): EffectiveAdjustments {
  const s = calculateSettlement(dispatch, settings);
  const isProrata = dispatch?.gcvAdjustment === 'prorata';
  const targetGcv = cleanNum(dispatch?.targetGcv);
  const labGcv = cleanNum(dispatch?.labActualGcv);
  return {
    deduction: s.gcvDeduction ?? 0,
    premium: s.gcvPremium ?? 0,
    isProrata,
    ruleLabel: isProrata
      ? `Pro-rata: lab ${labGcv} / target ${targetGcv}`
      : 'Manual adjustment',
  };
}

/**
 * Pure builder that converts a dispatch's rate breakdown into standardized line items
 * for settlement slips, preview modals, receipts, and export verification.
 */
export function buildDispatchSlipRows(dispatch: Dispatch, settings?: AppSettings | null): DispatchSlipRow[] {
  const s = calculateSettlement(dispatch, settings);
  const adj = getEffectiveAdjustments(dispatch, settings);
  const curSym = getCurrencySymbol(settings?.currency);
  const rows: DispatchSlipRow[] = [];

  rows.push({
    kind: 'base-rate',
    label: 'Contract Base Rate',
    amount: cleanNum(dispatch?.baseRate),
    perTon: true,
    formattedText: `${curSym} ${cleanNum(dispatch?.baseRate).toFixed(2)} / ton`,
  });

  if (adj.deduction > 0) {
    const label = adj.isProrata
      ? `GCV Quality Deduction (${adj.ruleLabel})`
      : 'GCV Quality Deduction';
    rows.push({
      kind: 'gcv-deduction',
      label,
      amount: adj.deduction,
      perTon: true,
      formattedText: `- ${curSym} ${adj.deduction.toFixed(2)} / ton`,
    });
  }

  if (adj.premium > 0) {
    const label = adj.isProrata
      ? `Quality Premium (${adj.ruleLabel})`
      : 'Quality Premium';
    rows.push({
      kind: 'gcv-premium',
      label,
      amount: adj.premium,
      perTon: true,
      formattedText: `+ ${curSym} ${adj.premium.toFixed(2)} / ton`,
    });
  }

  rows.push({
    kind: 'adjusted-rate',
    label: 'Adjusted Rate',
    amount: s.adjustedRate,
    perTon: true,
    formattedText: `${curSym} ${s.adjustedRate.toFixed(2)} / ton`,
  });

  if (s.taxDeduction > 0) {
    const taxFormulaLabel = dispatch?.taxMethod === 'formula_18_5'
      ? `Tax Withholding ((Rate + ${dispatch.taxSalesPercent ?? 18}%) × ${dispatch.taxIncomePercent ?? 5}%)`
      : 'Tax Withholding';
    rows.push({
      kind: 'tax',
      label: taxFormulaLabel,
      amount: s.taxDeduction,
      perTon: true,
      formattedText: `- ${curSym} ${s.taxDeduction.toFixed(2)} / ton`,
    });
  }

  const commission = cleanNum(dispatch?.commissionPerTon);
  if (commission > 0) {
    rows.push({
      kind: 'commission',
      label: 'Commission',
      amount: commission,
      perTon: true,
      formattedText: `- ${curSym} ${commission.toFixed(2)} / ton`,
    });
  }

  rows.push({
    kind: 'payable-rate',
    label: 'Final Payable Rate',
    amount: s.payableRate,
    perTon: true,
    formattedText: `${curSym} ${s.payableRate.toFixed(2)} / ton`,
  });

  rows.push({
    kind: 'total-revenue',
    label: 'Total Payable',
    amount: s.totalRevenue,
    perTon: false,
    formattedText: `${curSym} ${formatAmountNumber(s.totalRevenue, settings)}`,
  });

  return rows;
}



/**
 * Checks whether a dispatch is pending (in-transit / unweighed).
 * Dispatches marked 'pending' or with 0 received weight are excluded from aggregate profit
 * to prevent artificial deficits before weighbridge confirmation (Issue 19 / T6).
 */
export function isDispatchPending(dispatch: Dispatch): boolean {
  if (!dispatch) return false;
  if (dispatch.status === 'pending') return true;
  if (dispatch.status === 'settled') return false;
  return cleanNum(dispatch.labReceivedWeight) === 0;
}

export interface LedgerTotals {
  settledCount: number;
  pendingCount: number;
  revenue: number;          // settled only
  cost: number;             // settled only
  profit: number;           // settled only
  receivedTons: number;     // settled only
  loadedTonsSettled: number;
  transitDiffTons: number;  // settled only: received - loaded
  pendingLoadedTons: number; // on the road, shown separately
}

export interface BooksPeriod {
  from?: string;
  to?: string;
}

export interface BooksTotals {
  totalInflow: number;
  totalOutflow: number;
  netEffect: number;
  dispatchCost: number;
  settledDispatchCost: number;
  inTransitCost: number;
  generalExpenses: number;
  settledCount: number;
  pendingCount: number;
}

export function isDateInBooksPeriod(date: string | undefined, period?: BooksPeriod): boolean {
  if (!date) return !period?.from && !period?.to;
  if (period?.from && date < period.from) return false;
  if (period?.to && date > period.to) return false;
  return true;
}

/**
 * Business-level Books view. Dispatch cost is posted on the dispatch date,
 * while revenue is posted only when the factory settlement is final. General
 * expenses are independent operating outflows and never affect party balances.
 */
export function calculateBooksTotals(
  dispatches: Dispatch[],
  expenses: GeneralExpense[] = [],
  settings?: AppSettings | null,
  period?: BooksPeriod,
): BooksTotals {
  const liveDispatches = (dispatches || []).filter((dispatch) => !dispatch?.deleted);
  const liveExpenses = (expenses || []).filter((expense) => !expense?.deleted);

  let totalInflow = 0;
  let dispatchCost = 0;
  let settledDispatchCost = 0;
  let inTransitCost = 0;
  let settledCount = 0;
  let pendingCount = 0;

  for (const dispatch of liveDispatches) {
    const settlement = calculateSettlement(dispatch, settings);
    const pending = isDispatchPending(dispatch);
    const costIsInPeriod = isDateInBooksPeriod(dispatch.date, period);

    if (costIsInPeriod) {
      dispatchCost += settlement.totalCost;
      if (pending) inTransitCost += settlement.totalCost;
      else settledDispatchCost += settlement.totalCost;
    }

    if (pending) {
      if (costIsInPeriod) pendingCount += 1;
      continue;
    }

    const revenueDate = dispatch.settledDate || dispatch.date;
    if (isDateInBooksPeriod(revenueDate, period)) {
      settledCount += 1;
      totalInflow += settlement.totalRevenue;
    }
  }

  const generalExpenses = liveExpenses
    .filter((expense) => isDateInBooksPeriod(expense.date, period))
    .reduce((sum, expense) => sum + Math.max(0, cleanNum(expense.amount)), 0);
  const totalOutflow = dispatchCost + generalExpenses;

  return {
    totalInflow: cleanNum(totalInflow),
    totalOutflow: cleanNum(totalOutflow),
    netEffect: cleanNum(totalInflow - totalOutflow),
    dispatchCost: cleanNum(dispatchCost),
    settledDispatchCost: cleanNum(settledDispatchCost),
    inTransitCost: cleanNum(inTransitCost),
    generalExpenses: cleanNum(generalExpenses),
    settledCount,
    pendingCount,
  };
}

/**
 * Single canonical ledger aggregator for all dispatches across the application (Issue 20).
 * Prevents in-transit / unweighed dispatches from creating artificial revenue deficits or transit losses.
 */
export function calculateLedgerTotals(dispatches: Dispatch[], settings?: AppSettings | null): LedgerTotals {
  const live = (dispatches || []).filter((d) => !d?.deleted);
  const settled = live.filter((d) => !isDispatchPending(d));
  const pending = live.filter((d) => isDispatchPending(d));

  let revenue = 0;
  let cost = 0;
  let profit = 0;
  let receivedTons = 0;
  let loadedTonsSettled = 0;

  for (const d of settled) {
    const s = calculateSettlement(d, settings);
    revenue += s.totalRevenue;
    cost += s.totalCost;
    profit += s.netProfit;
    const t = calculateTransitLoss(d);
    receivedTons += t.receivedWeight;
    loadedTonsSettled += t.totalLoadedWeight;
  }

  const pendingLoadedTons = pending.reduce(
    (sum, d) => sum + (d.coalInputs || []).reduce((cSum, c) => cSum + cleanNum(c?.weight), 0),
    0
  );

  return {
    settledCount: settled.length,
    pendingCount: pending.length,
    revenue: cleanNum(revenue),
    cost: cleanNum(cost),
    profit: cleanNum(profit),
    receivedTons: cleanNum(receivedTons),
    loadedTonsSettled: cleanNum(loadedTonsSettled),
    transitDiffTons: cleanNum(receivedTons - loadedTonsSettled),
    pendingLoadedTons: cleanNum(pendingLoadedTons),
  };
}

/**
 * Canonical unified financial balance calculation for a party account.
 * Follows double-entry business ledger rules:
 * - Dispatches are Debits (invoiced receivables from the party).
 * - Received Payments are Credits (cash/bank received from the party).
 * - Paid Payments are Debits (cash/refunds paid to the party).
 * Net Received = Total Received - Total Paid Out.
 * Outstanding Balance = Total Billed - Net Received.
 */
export function calculatePartyBalance(dispatches: Dispatch[], payments: Payment[]): PartyBalanceResult {
  const safeDispatches = Array.isArray(dispatches) ? dispatches : [];
  const safePayments = Array.isArray(payments) ? payments : [];

  const totals = calculateLedgerTotals(safeDispatches);

  // Party ledgers are posted at whole rupees per document. Do not sum precise
  // fractions and round afterwards: PDF/Excel rows already show posted values.
  const totalBilled = safeDispatches
    .filter((d) => !d?.deleted && !isDispatchPending(d))
    .reduce((sum, d) => sum + roundPartyLedgerAmount(calculateSettlement(d).totalRevenue), 0);
  const totalProfit = totals.profit;
  const totalTons = totals.receivedTons;

  const totalPaymentsReceived = safePayments
    .filter((p) => !p?.deleted && (p.type === 'received' || (p as any).paymentType === 'received'))
    .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);

  const totalPaymentsPaid = safePayments
    .filter((p) => !p?.deleted && (p.type === 'paid' || (p as any).paymentType === 'paid'))
    .reduce((sum, p) => sum + roundPartyLedgerAmount(p.amount), 0);

  const netPaymentsReceived = totalPaymentsReceived - totalPaymentsPaid;
  const outstandingBalance = totalBilled - netPaymentsReceived;

  const nonDeletedDispatches = safeDispatches.filter((d) => !d?.deleted);
  const nonDeletedPayments = safePayments.filter((p) => !p?.deleted);

  const isCleared = nonDeletedDispatches.length > 0 && Math.abs(outstandingBalance) < 50;
  const isReceivable = outstandingBalance > 50;
  const isAdvance = outstandingBalance < -50;

  return {
    totalBilled,
    totalPaymentsReceived,
    totalPaymentsPaid,
    netPaymentsReceived,
    outstandingBalance,
    isReceivable,
    isAdvance,
    isCleared,
    totalTons,
    totalProfit,
    dispatchesCount: nonDeletedDispatches.length,
    paymentsCount: nonDeletedPayments.length,
  };
}

/**
 * Calculates transit loss / shortage between loaded coal recipe weight and factory weighbridge received weight.
 * Handles in-transit (pending) trucks by setting isLoss to false and diff/lossPercentage to 0 (Issue 20).
 */
export function calculateTransitLoss(dispatch: Dispatch): {
  totalLoadedWeight: number;
  receivedWeight: number;
  diff: number;
  isLoss: boolean;
  isGain: boolean;
  lossPercentage: number;
  isPending: boolean;
} {
  const isPending = isDispatchPending(dispatch);
  const totalLoadedWeight = (dispatch?.coalInputs || []).reduce((sum, c) => sum + cleanNum(c?.weight), 0);
  const receivedWeight = isPending ? 0 : cleanNum(dispatch?.labReceivedWeight);
  const diff = isPending ? 0 : (receivedWeight - totalLoadedWeight);
  const isLoss = !isPending && diff < -0.01;
  const isGain = !isPending && diff > 0.01;
  const lossPercentage = (!isPending && totalLoadedWeight > 0) ? (Math.abs(diff) / totalLoadedWeight) * 100 : 0;

  return {
    totalLoadedWeight: cleanNum(totalLoadedWeight),
    receivedWeight: cleanNum(receivedWeight),
    diff: cleanNum(diff),
    isLoss,
    isGain,
    lossPercentage: cleanNum(lossPercentage),
    isPending,
  };
}

export interface LotStockInfo {
  lot: InventoryLot;
  usedWeight: number;
  dispatchedWeight: number;
  remainingWeight: number;
  isOverdrawn: boolean;
  capitalTiedUp: number;
}

/**
 * Calculates purchase total cost and landed cost per received ton.
 * Formula: totalCost = billedWeight * purchaseRate
 * landedRate = receivedWeight > 0 ? totalCost / receivedWeight : purchaseRate
 * (e.g. 30 tons billed @ 20,000, 28.5 tons received -> 600,000 / 28.5 = 21,052.63)
 */
export function calculateLandedCost(billedWeight: number, receivedWeight: number, purchaseRate: number) {
  const bWeight = cleanNum(billedWeight);
  const rWeight = cleanNum(receivedWeight);
  const pRate = cleanNum(purchaseRate);
  const totalCost = bWeight * pRate;
  const landedRate = rWeight > 0 ? totalCost / rWeight : pRate;
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    landedRate: Math.round(landedRate * 100) / 100,
  };
}

/**
 * Derives dynamic inventory stock for a lot based on coal input usages across all non-deleted dispatches.
 * Avoids storing mutable remaining stock in database to prevent multi-device race conditions and double-deductions.
 */
export function calculateLotStock(lot: InventoryLot, dispatches: Dispatch[]): LotStockInfo {
  const safeDispatches = Array.isArray(dispatches) ? dispatches : [];
  let usedWeight = 0;
  for (const d of safeDispatches) {
    if (d?.deleted) continue;
    if (Array.isArray(d?.coalInputs)) {
      for (const input of d.coalInputs) {
        if (input?.lotId === lot.id) {
          usedWeight += cleanNum(input.weight);
        }
      }
    }
  }
  const remainingWeight = cleanNum(lot.receivedWeight) - usedWeight;
  const isOverdrawn = remainingWeight < -0.001;
  const capitalTiedUp = remainingWeight > 0 ? remainingWeight * cleanNum(lot.landedRate) : 0;
  const roundedUsed = Math.round(usedWeight * 100) / 100;
  return {
    lot,
    usedWeight: roundedUsed,
    dispatchedWeight: roundedUsed,
    remainingWeight: Math.round(remainingWeight * 100) / 100,
    isOverdrawn,
    capitalTiedUp: Math.round(capitalTiedUp),
  };
}

/**
 * Calculates stock availability for a lot in the context of creating or editing a dispatch.
 * Correctly accounts for multi-row coal blending (summing all rows in draft that reference this lot)
 * and excludes the draft dispatch itself from 'usedWeight' so that reopening a saved dispatch
 * does not trigger a false overdraw warning.
 */
export function calculateLotAvailabilityForDispatch(
  lot: InventoryLot,
  allDispatches: Dispatch[],
  draft: Partial<Dispatch>,
): LotAvailabilityInfo {
  const others = (allDispatches || []).filter((d) => !d?.deleted && (!draft?.id || d?.id !== draft?.id));
  const availableBeforeThis = calculateLotStock(lot, others).remainingWeight;
  const draftUse = (draft?.coalInputs || [])
    .filter((i) => i?.lotId === lot.id)
    .reduce((sum, i) => sum + cleanNum(i?.weight), 0);
  const remainingAfter = Math.round((availableBeforeThis - draftUse) * 100) / 100;
  return {
    availableBeforeThis: Math.round(availableBeforeThis * 100) / 100,
    draftUse: Math.round(draftUse * 100) / 100,
    remainingAfter,
    isOverdraw: remainingAfter < -0.001,
  };
}

/**
 * Availability for legacy/manual mine-level rows that are not tied to a lot.
 * The dispatch being edited is excluded so reopening it never double-counts
 * its own consumption.
 */
export function calculateMineAvailabilityForDispatch(
  mine: Mine,
  lots: InventoryLot[],
  allDispatches: Dispatch[],
  draft: Partial<Dispatch>,
): MineAvailabilityInfo {
  const others = (allDispatches || []).filter((d) => !d?.deleted && (!draft?.id || d.id !== draft.id));
  const availableBeforeThis = calculateMineStock(mine, lots, others).remainingTons;
  const mineName = mine.name.trim().toLowerCase();
  const draftUse = (draft.coalInputs || [])
    .filter((input) => {
      if (input?.lotId) return false;
      return input?.mineId === mine.id ||
        (Boolean(input?.sourceName) && input.sourceName.trim().toLowerCase() === mineName);
    })
    .reduce((sum, input) => sum + cleanNum(input?.weight), 0);
  const remainingAfter = Math.round((availableBeforeThis - draftUse) * 100) / 100;
  return {
    availableBeforeThis: Math.round(availableBeforeThis * 100) / 100,
    draftUse: Math.round(draftUse * 100) / 100,
    remainingAfter,
    isOverdraw: remainingAfter < -0.001,
  };
}


/**
 * Aggregates overall inventory metrics (stock, capital, supplier breakdown).
 */
export function calculateInventoryTotals(lots: InventoryLot[], dispatches: Dispatch[]) {
  const activeLots = (lots || []).filter((l) => !l.deleted);
  let totalBilledTons = 0;
  let totalReceivedTons = 0;
  let totalUsedTons = 0;
  let totalRemainingTons = 0;
  let totalCapitalTiedUp = 0;
  let overdrawnLotsCount = 0;
  const supplierMap = new Map<string, { tons: number; capital: number; lotsCount: number }>();

  for (const lot of activeLots) {
    totalBilledTons += cleanNum(lot.billedWeight);
    totalReceivedTons += cleanNum(lot.receivedWeight);
    const stock = calculateLotStock(lot, dispatches);
    totalUsedTons += stock.usedWeight;
    totalRemainingTons += stock.remainingWeight;
    totalCapitalTiedUp += stock.capitalTiedUp;
    if (stock.isOverdrawn) {
      overdrawnLotsCount += 1;
    }

    const sName = lot.supplier?.trim() || 'Unknown Supplier';
    const existing = supplierMap.get(sName) || { tons: 0, capital: 0, lotsCount: 0 };
    existing.tons += stock.remainingWeight;
    existing.capital += stock.capitalTiedUp;
    existing.lotsCount += 1;
    supplierMap.set(sName, existing);
  }

  const avgLandedCost = totalRemainingTons > 0 ? totalCapitalTiedUp / totalRemainingTons : 0;
  const roundedRemaining = Math.round(totalRemainingTons * 100) / 100;

  return {
    totalBilledTons: Math.round(totalBilledTons * 100) / 100,
    totalReceivedTons: Math.round(totalReceivedTons * 100) / 100,
    totalUsedTons: Math.round(totalUsedTons * 100) / 100,
    totalRemainingTons: roundedRemaining,
    totalRemainingStock: roundedRemaining,
    totalCapitalTiedUp: Math.round(totalCapitalTiedUp),
    totalActiveLots: activeLots.length,
    overdrawnLotsCount,
    avgLandedCost: Math.round(avgLandedCost * 100) / 100,
    suppliers: Array.from(supplierMap.entries()).map(([name, data]) => ({
      name,
      ...data,
      avgCost: data.tons > 0 ? data.capital / data.tons : 0,
    })),
  };
}

export interface MineStockSummary {
  mine: Mine;
  totalInflowTons: number;
  totalInflowValue: number;
  totalOutflowTons: number;
  totalOutflowValue: number;
  remainingTons: number;
  remainingValue: number;
  isOverdrawn: boolean;
  entriesCount: number;
  dispatchesCount: number;
  status: 'in_stock' | 'low' | 'exhausted' | 'overdrawn';
}

export interface InventoryRelationIssue {
  kind: 'missing_lot' | 'overdrawn' | 'marker_mismatch';
  severity: 'warning' | 'critical';
  lotId?: string;
  dispatchIds: string[];
  message: string;
}

/**
 * Audits denormalized stock/dispatch relationships after restore or cloud sync.
 * Dispatch coalInputs are authoritative; lot marker fields are display helpers.
 */
export function auditInventoryRelations(
  lots: InventoryLot[],
  dispatches: Dispatch[],
): InventoryRelationIssue[] {
  const activeLots = (lots || []).filter((lot) => !lot.deleted);
  const activeDispatches = (dispatches || []).filter((dispatch) => !dispatch.deleted);
  const lotById = new Map(activeLots.map((lot) => [lot.id, lot]));
  const usesByLot = new Map<string, Dispatch[]>();
  const issues: InventoryRelationIssue[] = [];

  for (const dispatch of activeDispatches) {
    for (const input of dispatch.coalInputs || []) {
      if (!input.lotId) continue;
      const lot = lotById.get(input.lotId);
      if (!lot) {
        issues.push({
          kind: 'missing_lot',
          severity: 'critical',
          lotId: input.lotId,
          dispatchIds: [dispatch.id],
          message: `Dispatch #${dispatch.truckNumber || 'N/A'} references a missing stock entry.`,
        });
        continue;
      }
      const uses = usesByLot.get(lot.id) || [];
      if (!uses.some((candidate) => candidate.id === dispatch.id)) uses.push(dispatch);
      usesByLot.set(lot.id, uses);
    }
  }

  for (const lot of activeLots) {
    const uses = usesByLot.get(lot.id) || [];
    const lotLabel = lot.boughtFrom || lot.supplier || lot.mineName || 'Stock entry';
    const stock = calculateLotStock(lot, activeDispatches);
    if (stock.isOverdrawn) {
      issues.push({
        kind: 'overdrawn',
        severity: 'critical',
        lotId: lot.id,
        dispatchIds: uses.map((dispatch) => dispatch.id),
        message: `${lotLabel} is overdrawn by ${Math.abs(stock.remainingWeight).toFixed(2)} tons.`,
      });
    }

    const markerMatchesAuthoritativeUse = lot.usedInDispatchId
      ? uses.some((dispatch) => dispatch.id === lot.usedInDispatchId)
      : uses.length === 0;
    if (!markerMatchesAuthoritativeUse) {
      issues.push({
        kind: 'marker_mismatch',
        severity: 'warning',
        lotId: lot.id,
        dispatchIds: uses.map((dispatch) => dispatch.id),
        message: `${lotLabel} has an out-of-date dispatch status marker.`,
      });
    }
  }

  return issues;
}

/**
 * Calculates stock balance and financials for an individual Mine:
 * Inflow = Sum of all stock entries (lots) linked to this mine.
 * Outflow = Sum of all coal blending recipes consuming coal from this mine.
 * Remaining Stock = Inflow Tons - Outflow Tons.
 * Stock value is derived lot-by-lot from each entry's landed rate. The mine's
 * default rate is only a seed for new entries and must never reprice inventory.
 */
export function calculateMineStock(
  mine: Mine,
  lots: InventoryLot[],
  dispatches: Dispatch[]
): MineStockSummary {
  const activeLots = (lots || []).filter(
    (l) =>
      !l.deleted &&
      (l.mineId === mine.id || (!l.mineId && (l.mineSource || l.mineName || '').trim().toLowerCase() === mine.name.trim().toLowerCase()))
  );

  let totalInflowTons = 0;
  let totalInflowValue = 0;

  for (const lot of activeLots) {
    const receivedTons = cleanNum(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
    const landedRate = cleanNum(lot.landedRate || lot.purchaseRate || lot.ratePerTon || mine.ratePerTon || 0);
    const value = lot.totalValue !== undefined ? cleanNum(lot.totalValue) : receivedTons * landedRate;
    totalInflowTons += receivedTons;
    totalInflowValue += value;
  }

  // Find all dispatches blending coal from this mine
  const activeDispatches = (dispatches || []).filter((d) => !d.deleted);
  const mineLotIds = new Set(activeLots.map((lot) => lot.id));
  let totalOutflowTons = 0;
  let totalOutflowValue = 0;
  let linkedDispatchesCount = 0;
  let directMineOutflowTons = 0;

  for (const d of activeDispatches) {
    let dispatchUsedMine = false;
    if (Array.isArray(d.coalInputs)) {
      for (const ci of d.coalInputs) {
        const matchesMine =
          ci.mineId === mine.id ||
          (Boolean(ci.lotId) && mineLotIds.has(ci.lotId as string)) ||
          (Boolean(ci.sourceName) && ci.sourceName.trim().toLowerCase() === mine.name.trim().toLowerCase());
        if (matchesMine) {
          const weight = cleanNum(ci.weight);
          totalOutflowTons += weight;
          totalOutflowValue += weight * cleanNum(ci.purchaseRate);
          if (!ci.lotId) directMineOutflowTons += weight;
          dispatchUsedMine = true;
        }
      }
    }
    if (dispatchUsedMine) {
      linkedDispatchesCount++;
    }
  }

  const remainingTons = Math.round((totalInflowTons - totalOutflowTons) * 100) / 100;
  const isOverdrawn = remainingTons < -0.001;

  // Value the actual remaining quantities at their own landed rates. Legacy
  // mine-level rows have no lotId, so consume the remaining pool FIFO.
  const remainingLots = activeLots
    .map((lot) => {
      const stock = calculateLotStock(lot, activeDispatches);
      return {
        lot,
        remaining: Math.max(0, stock.remainingWeight),
        landedRate: cleanNum(lot.landedRate || lot.purchaseRate || lot.ratePerTon || mine.ratePerTon || 0),
      };
    })
    .sort((a, b) => {
      const dateCompare = String(a.lot.date || '').localeCompare(String(b.lot.date || ''));
      return dateCompare || cleanNum(a.lot.createdAt) - cleanNum(b.lot.createdAt);
    });

  let unallocatedOutflow = directMineOutflowTons;
  let remainingValue = 0;
  for (const item of remainingLots) {
    const consumed = Math.min(item.remaining, Math.max(0, unallocatedOutflow));
    unallocatedOutflow -= consumed;
    remainingValue += (item.remaining - consumed) * item.landedRate;
  }

  let status: 'in_stock' | 'low' | 'exhausted' | 'overdrawn' = 'in_stock';
  if (isOverdrawn) {
    status = 'overdrawn';
  } else if (remainingTons <= 0) {
    status = 'exhausted';
  } else if (remainingTons < 20) {
    status = 'low';
  }

  return {
    mine,
    totalInflowTons: Math.round(totalInflowTons * 100) / 100,
    totalInflowValue: Math.round(totalInflowValue),
    totalOutflowTons: Math.round(totalOutflowTons * 100) / 100,
    totalOutflowValue: Math.round(totalOutflowValue),
    remainingTons,
    remainingValue: Math.round(Math.max(0, remainingValue)),
    isOverdrawn,
    entriesCount: activeLots.length,
    dispatchesCount: linkedDispatchesCount,
    status,
  };
}

/**
 * Aggregates overall stock metrics across all active mines
 */
export function calculateOverallMinesSummary(
  mines: Mine[],
  lots: InventoryLot[],
  dispatches: Dispatch[]
) {
  const activeMines = (mines || []).filter((m) => !m.deleted);
  let totalYardTons = 0;
  let totalYardValue = 0;
  let totalInflowTons = 0;
  let totalOutflowTons = 0;
  let overdrawnCount = 0;

  for (const mine of activeMines) {
    const summary = calculateMineStock(mine, lots, dispatches);
    totalYardTons += summary.remainingTons;
    totalYardValue += summary.remainingValue;
    totalInflowTons += summary.totalInflowTons;
    totalOutflowTons += summary.totalOutflowTons;
    if (summary.isOverdrawn) overdrawnCount++;
  }

  return {
    totalMines: activeMines.length,
    totalYardTons: Math.round(totalYardTons * 100) / 100,
    totalYardValue: Math.round(totalYardValue),
    totalInflowTons: Math.round(totalInflowTons * 100) / 100,
    totalOutflowTons: Math.round(totalOutflowTons * 100) / 100,
    overdrawnCount,
  };
}
