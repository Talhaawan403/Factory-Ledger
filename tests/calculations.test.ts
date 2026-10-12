import { describe, it, expect } from 'vitest';
import { calculateSettlement, calculatePartyBalance, calculateTransitLoss, calculateLedgerTotals, isDispatchPending, getEffectiveAdjustments, buildDispatchSlipRows } from '../src/utils/calculations';
import { buildFleetExportData } from '../src/utils/exportSharing';
import type { Dispatch, Payment } from '../src/types';

describe('T1: Settlement and Financial Calculations Golden Values', () => {
  it('matches hand-calculated golden settlement values with 18% sales tax and 5% income tax formula', () => {
    // Scenario from ISSUES_AND_FIXES.md Section 6:
    // loaded 20 t @ 30,000 plus 10 t @ 28,000
    // overheads: loading 3,000 + freight 90,000 + crush 5,000 + royalty 4,000 + other 0 = 102,000
    // base rate: 38,000; manual deduction: 500; commission: 200; received weight: 29.4 t;
    // tax formula: 18% sales / 5% income
    const dispatch: Dispatch = {
      id: 'disp-golden-1',
      date: '2026-10-08',
      partyId: 'party-1',
      truckNumber: 'TK-1234',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      coalInputs: [
        { id: 'c1', sourceName: 'Mine A', weight: 20, purchaseRate: 30000 },
        { id: 'c2', sourceName: 'Mine B', weight: 10, purchaseRate: 28000 },
      ],
      overheads: {
        loading: 3000,
        freight: 90000,
        crush: 5000,
        royalty: 4000,
        other: 0,
      },
      baseRate: 38000,
      manualDeduction: 500,
      manualPremium: 0,
      taxMethod: 'formula_18_5',
      taxSalesPercent: 18,
      taxIncomePercent: 5,
      commissionPerTon: 200,
      labReceivedWeight: 29.4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = calculateSettlement(dispatch);

    // Adjusted rate: 38,000 - 500 = 37,500
    expect(result.adjustedRate).toBe(37500);

    // Tax deduction: 37,500 * 1.18 * 0.05 = 2,212.5
    expect(result.taxDeduction).toBeCloseTo(2212.5, 4);

    // Payable rate: 37,500 - 2,212.5 - 200 = 35,087.5
    expect(result.payableRate).toBeCloseTo(35087.5, 4);

    // Total revenue: 35,087.5 * 29.4 = 1,031,572.5
    expect(result.totalRevenue).toBeCloseTo(1031572.5, 2);

    // Total cost: (20 * 30,000 + 10 * 28,000) + 102,000 = 600,000 + 280,000 + 102,000 = 982,000
    expect(result.totalCost).toBe(982000);

    // Net profit: 1,031,572.5 - 982,000 = 49,572.5
    expect(result.netProfit).toBeCloseTo(49572.5, 2);
  });

  it('calculates party balance accurately with dispatches and payments', () => {
    const dispatch: Dispatch = {
      id: 'disp-1',
      date: '2026-10-08',
      partyId: 'party-1',
      truckNumber: 'TK-1234',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      baseRate: 30000,
      manualDeduction: 0,
      manualPremium: 0,
      manualTax: 0,
      taxMethod: 'manual',
      commissionPerTon: 0,
      labReceivedWeight: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const payments: Payment[] = [
      {
        id: 'pay-1',
        partyId: 'party-1',
        amount: 200000,
        type: 'received',
        date: '2026-10-08',
        mode: 'bank',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'pay-2',
        partyId: 'party-1',
        amount: 50000,
        type: 'paid',
        date: '2026-10-08',
        mode: 'cash',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const balance = calculatePartyBalance([dispatch], payments);

    // Total billed: 30,000 * 10 = 300,000
    expect(balance.totalBilled).toBe(300000);
    // Net payments received: 200,000 (received) - 50,000 (paid) = 150,000
    expect(balance.totalPaymentsReceived).toBe(200000);
    expect(balance.totalPaymentsPaid).toBe(50000);
    expect(balance.netPaymentsReceived).toBe(150000);
    // Outstanding balance: 300,000 - 150,000 = 150,000 receivable
    expect(balance.outstandingBalance).toBe(150000);
    expect(balance.isReceivable).toBe(true);
    expect(balance.isAdvance).toBe(false);
  });

  it('calculates transit loss and percentage correctly', () => {
    const dispatch: Dispatch = {
      id: 'disp-loss',
      date: '2026-10-08',
      partyId: 'party-1',
      truckNumber: 'TK-1234',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 30, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      baseRate: 30000,
      manualDeduction: 0,
      manualPremium: 0,
      manualTax: 0,
      taxMethod: 'manual',
      commissionPerTon: 0,
      labReceivedWeight: 29.4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const loss = calculateTransitLoss(dispatch);
    expect(loss.totalLoadedWeight).toBe(30);
    expect(loss.receivedWeight).toBe(29.4);
    expect(loss.diff).toBeCloseTo(-0.6, 2);
    expect(loss.isLoss).toBe(true);
    expect(loss.isGain).toBe(false);
    expect(loss.lossPercentage).toBeCloseTo(2, 2); // 0.6 / 30 = 2%
  });
});

describe('Issue 20: Unified Aggregation & In-Transit Consistency (T9 & T10)', () => {
  const settledTruck = (receivedWeight = 29.4): Dispatch => ({
    id: 'disp-settled-t9',
    date: '2026-10-08',
    partyId: 'party-1',
    truckNumber: 'TK-111',
    factoryName: 'Settled Factory',
    targetGcv: 6000,
    labActualGcv: 6000,
    labSulphur: 1,
    status: 'settled',
    coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 30, purchaseRate: 30000 }],
    overheads: { loading: 3000, freight: 90000, crush: 0, royalty: 0, other: 0 },
    baseRate: 38000,
    manualDeduction: 0,
    manualPremium: 0,
    manualTax: 0,
    taxMethod: 'manual',
    commissionPerTon: 0,
    labReceivedWeight: receivedWeight,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const pendingTruck = (): Dispatch => ({
    id: 'disp-pending-t9',
    date: '2026-10-08',
    partyId: 'party-1',
    truckNumber: 'TK-222',
    factoryName: 'Pending Factory',
    targetGcv: 6000,
    labActualGcv: 6000,
    labSulphur: 1,
    status: 'pending',
    coalInputs: [{ id: 'c2', sourceName: 'Mine B', weight: 30, purchaseRate: 30000 }],
    overheads: { loading: 3000, freight: 90000, crush: 0, royalty: 0, other: 0 },
    baseRate: 38000,
    manualDeduction: 0,
    manualPremium: 0,
    manualTax: 0,
    taxMethod: 'manual',
    commissionPerTon: 0,
    labReceivedWeight: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('T9: every aggregate agrees when an in-transit truck exists', () => {
    const list = [settledTruck(29.4), pendingTruck()];
    const totals = calculateLedgerTotals(list);
    const partyBal = calculatePartyBalance(list, []);

    expect(totals.settledCount).toBe(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingLoadedTons).toBe(30);
    // Profit must match calculatePartyBalance exactly
    expect(totals.profit).toBeCloseTo(partyBal.totalProfit, 6);
    // Revenue must match totalBilled
    expect(totals.revenue).toBeCloseTo(partyBal.totalBilled, 6);
    // Transit diff must only reflect settled truck (29.4 - 30 = -0.6) and NOT count pending truck as 100% loss
    expect(totals.transitDiffTons).toBeCloseTo(29.4 - 30, 6);
  });

  it('T10: calculateTransitLoss never reports a loss for a pending truck', () => {
    const pending = pendingTruck();
    const transit = calculateTransitLoss(pending);

    expect(isDispatchPending(pending)).toBe(true);
    expect(transit.isPending).toBe(true);
    expect(transit.isLoss).toBe(false);
    expect(transit.isGain).toBe(false);
    expect(transit.diff).toBe(0);
    expect(transit.lossPercentage).toBe(0);
    expect(transit.totalLoadedWeight).toBe(30);
    expect(transit.receivedWeight).toBe(0);
  });
});

describe('Issue 36: Cleanups & Aggregation Resilience (T28 & T29)', () => {
  it('T28: calculatePartyBalance counts and totals ignore soft-deleted dispatches and payments (Issue 36a)', () => {
    const activeDispatch: Dispatch = {
      id: 'd-active',
      date: '2026-10-08',
      partyId: 'p-1',
      truckNumber: 'TK-101',
      factoryName: 'Factory 1',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      status: 'settled',
      coalInputs: [{ id: 'c1', sourceName: 'Mine', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      baseRate: 30000,
      manualDeduction: 0,
      manualPremium: 0,
      manualTax: 0,
      taxMethod: 'manual',
      commissionPerTon: 0,
      labReceivedWeight: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const deletedDispatch: Dispatch = {
      ...activeDispatch,
      id: 'd-deleted',
      deleted: true,
      labReceivedWeight: 50, // Should NOT affect total tons or revenue
    };

    const activePayment: Payment = {
      id: 'pay-active',
      partyId: 'p-1',
      amount: 100000,
      type: 'received',
      date: '2026-10-08',
      mode: 'bank',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const deletedPayment: Payment = {
      ...activePayment,
      id: 'pay-deleted',
      deleted: true,
      amount: 500000, // Should NOT affect received payments
    };

    const balance = calculatePartyBalance([activeDispatch, deletedDispatch], [activePayment, deletedPayment]);

    // Financial calculations ignore deleted
    expect(balance.totalBilled).toBe(300000);
    expect(balance.totalPaymentsReceived).toBe(100000);
    expect(balance.outstandingBalance).toBe(200000);
    expect(balance.totalTons).toBe(10);

    // Counts MUST ignore deleted
    expect(balance.dispatchesCount).toBe(1);
    expect(balance.paymentsCount).toBe(1);
  });

  it('T29: PO progress totals ignore in-transit pending trucks (Issue 36b)', () => {
    const poDispatches: Dispatch[] = [
      {
        id: 'd-settled',
        poId: 'po-1',
        date: '2026-10-08',
        partyId: 'p-1',
        truckNumber: 'TK-101',
        factoryName: 'Factory 1',
        targetGcv: 6000,
        labActualGcv: 6000,
        labSulphur: 1,
        status: 'settled',
        coalInputs: [{ id: 'c1', sourceName: 'Mine', weight: 25, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: 30000,
        manualDeduction: 0,
        manualPremium: 0,
        manualTax: 0,
        taxMethod: 'manual',
        commissionPerTon: 0,
        labReceivedWeight: 24.8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'd-in-transit',
        poId: 'po-1',
        date: '2026-10-08',
        partyId: 'p-1',
        truckNumber: 'TK-102',
        factoryName: 'Factory 1',
        targetGcv: 6000,
        labActualGcv: 6000,
        labSulphur: 1,
        status: 'pending', // in-transit!
        coalInputs: [{ id: 'c2', sourceName: 'Mine', weight: 30, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: 30000,
        manualDeduction: 0,
        manualPremium: 0,
        manualTax: 0,
        taxMethod: 'manual',
        commissionPerTon: 0,
        labReceivedWeight: 30, // Typed in but truck is still in-transit
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const poTotals = calculateLedgerTotals(poDispatches);
    // Only the settled truck's received tons should count
    expect(poTotals.receivedTons).toBeCloseTo(24.8, 2);
    expect(poTotals.pendingCount).toBe(1);
    expect(poTotals.settledCount).toBe(1);
  });
});

describe('Issue 37: Pro-Rata Quality Adjustments Transparency (T30 & T31)', () => {
  it('T30: slip rows and exports show the pro-rata deduction and premium', () => {
    const prorataDeductionDispatch: Dispatch = {
      id: 'disp-prorata-ded',
      date: '2026-10-09',
      partyId: 'party-1',
      truckNumber: 'TK-PRO-1',
      baseRate: 31800,
      targetGcv: 4500,
      labActualGcv: 4300,
      gcvAdjustment: 'prorata',
      gcvAdjustmentRounding: 'paisa',
      labReceivedWeight: 30,
      taxMethod: 'manual',
      manualTax: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      factoryName: '',
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      labSulphur: 0,
      //overheads: undefined
    };

    const adj = getEffectiveAdjustments(prorataDeductionDispatch);
    expect(adj.isProrata).toBe(true);
    expect(adj.deduction).toBeCloseTo(1413.33, 2);
    expect(adj.premium).toBe(0);
    expect(adj.ruleLabel).toContain('lab 4300 / target 4500');

    const slipRows = buildDispatchSlipRows(prorataDeductionDispatch);
    const dedRow = slipRows.find((r) => r.kind === 'gcv-deduction');
    expect(dedRow).toBeDefined();
    expect(dedRow?.amount).toBeCloseTo(1413.33, 2);
    expect(dedRow?.label).toContain('Pro-rata: lab 4300 / target 4500');

    const exportData = buildFleetExportData([prorataDeductionDispatch]);
    expect(exportData.rows[0].deduction).toBeCloseTo(1413.33, 2);

    // Test pro-rata premium
    const prorataPremiumDispatch: Dispatch = {
      ...prorataDeductionDispatch,
      id: 'disp-prorata-prem',
      labActualGcv: 4700,
    };
    const adjPrem = getEffectiveAdjustments(prorataPremiumDispatch);
    expect(adjPrem.premium).toBeCloseTo(1413.33, 2);
    expect(adjPrem.deduction).toBe(0);

    const slipRowsPrem = buildDispatchSlipRows(prorataPremiumDispatch);
    const premRow = slipRowsPrem.find((r) => r.kind === 'gcv-premium');
    expect(premRow).toBeDefined();
    expect(premRow?.amount).toBeCloseTo(1413.33, 2);
    expect(premRow?.label).toContain('Pro-rata: lab 4700 / target 4500');

    const exportPremData = buildFleetExportData([prorataPremiumDispatch]);
    expect(exportPremData.rows[0].premium).toBeCloseTo(1413.33, 2);
  });

  it('T31: manual dispatches still show their typed deduction and premium', () => {
    const manualDispatch: Dispatch = {
      id: 'disp-manual-adj',
      date: '2026-10-09',
      partyId: 'party-1',
      truckNumber: 'TK-MAN-1',
      baseRate: 30000,
      manualDeduction: 500,
      manualPremium: 250,
      gcvAdjustment: 'manual',
      labReceivedWeight: 25,
      taxMethod: 'manual',
      manualTax: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      factoryName: '',
      targetGcv: 0,
      coalInputs: [],
      //overheads: undefined,
      labActualGcv: 0,
      labSulphur: 0,
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 }
    };

    const adj = getEffectiveAdjustments(manualDispatch);
    expect(adj.isProrata).toBe(false);
    expect(adj.deduction).toBe(500);
    expect(adj.premium).toBe(250);
    expect(adj.ruleLabel).toBe('Manual adjustment');

    const slipRows = buildDispatchSlipRows(manualDispatch);
    const dedRow = slipRows.find((r) => r.kind === 'gcv-deduction');
    const premRow = slipRows.find((r) => r.kind === 'gcv-premium');
    expect(dedRow?.amount).toBe(500);
    expect(premRow?.amount).toBe(250);

    const exportData = buildFleetExportData([manualDispatch]);
    expect(exportData.rows[0].deduction).toBe(500);
    expect(exportData.rows[0].premium).toBe(250);
  });
});



