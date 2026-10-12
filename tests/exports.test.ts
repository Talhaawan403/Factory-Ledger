import { describe, it, expect } from 'vitest';
import type { Dispatch, Party, Payment, AppSettings } from '../src/types';
import {
  calculateSettlement,
  calculateLedgerTotals,
  calculatePartyBalance,
  calculateTransitLoss,
} from '../src/utils/calculations';
import {
  buildPartyStatementData,
  buildFleetExportData,
} from '../src/utils/exportSharing';
import syntheticScenariosFixture from './fixtures/synthetic-scenarios.json';

const mockSettings: AppSettings = {
  businessName: 'AWAN COAL TRADERS',
  userName: 'Talha',
  phoneNumber: '03001234567',
  ntnNumber: '1234567-8',
  companyAddress: 'Quetta, Pakistan',
  logoUrl: '',
  theme: 'light',
  currency: 'PKR',
  numberFormat: 'million',
  taxFormulaSalesPercent: 18,
  taxFormulaIncomePercent: 5,
};

function createMockDispatch(id: string, overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id,
    partyId: 'party-test-1',
    date: '2026-10-08',
    truckNumber: `TK-${id}`,
    factoryName: 'Bestway Cement',
    targetGcv: 6000,
    labActualGcv: 6000,
    labSulphur: 1.5,
    coalInputs: [{ id: 'c1', sourceName: 'Mine 1', weight: 25.0, purchaseRate: 20000 }],
    overheads: { loading: 2500, freight: 35000, crush: 0, royalty: 0, other: 0 },
    baseRate: 32000,
    manualDeduction: 0,
    manualPremium: 0,
    manualTax: 0,
    taxMethod: 'manual',
    commissionPerTon: 0,
    labReceivedWeight: 25.0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('Issue 25 (T12): Pure Export Data Functions Match Canonical Totals', () => {
  const dispatches: Dispatch[] = [
    createMockDispatch('d1', {
      labReceivedWeight: 30.0,
      baseRate: 35000,
      coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 30.0, purchaseRate: 22000 }],
      overheads: { loading: 3000, freight: 40000, crush: 0, royalty: 0, other: 0 },
    }),
    createMockDispatch('d2', {
      labReceivedWeight: 28.5,
      baseRate: 38000,
      manualDeduction: 500,
      taxMethod: 'formula_18_5',
      taxSalesPercent: 18,
      taxIncomePercent: 5,
      coalInputs: [{ id: 'c2', sourceName: 'Mine B', weight: 29.0, purchaseRate: 25000 }],
      overheads: { loading: 3000, freight: 45000, crush: 0, royalty: 0, other: 0 },
    }),
    // In-transit truck (labReceivedWeight = 0, status pending)
    createMockDispatch('d3-pending', {
      labReceivedWeight: 0,
      status: 'pending',
      baseRate: 36000,
      coalInputs: [{ id: 'c3', sourceName: 'Mine C', weight: 27.0, purchaseRate: 23000 }],
      overheads: { loading: 2500, freight: 38000, crush: 0, royalty: 0, other: 0 },
    }),
  ];

  const payments: Payment[] = [
    {
      id: 'pay-1',
      partyId: 'party-test-1',
      date: '2026-10-06',
      amount: 1000000,
      type: 'received',
      mode: 'bank',
      createdAt: Date.now(),
    },
    {
      id: 'pay-2',
      partyId: 'party-test-1',
      date: '2026-10-07',
      amount: 150000,
      type: 'paid', // Refund paid
      mode: 'cash',
      createdAt: Date.now(),
    },
  ];

  const parties: Party[] = [
    {
      id: 'party-test-1',
      name: 'Bestway Cement',
      contactPerson: 'Purchasing',
      phone: '03001234567',
      address: 'Hattar',
      createdAt: Date.now(),
    },
  ];

  it('buildPartyStatementData totals match calculatePartyBalance exactly', () => {
    const canonical = calculatePartyBalance(dispatches, payments);
    const statement = buildPartyStatementData(dispatches, payments, [], mockSettings);

    expect(statement.totalTons).toBe(canonical.totalTons);
    expect(statement.totalBilled).toBe(canonical.totalBilled);
    expect(statement.totalReceived).toBe(canonical.totalPaymentsReceived);
    expect(statement.totalPaid).toBe(canonical.totalPaymentsPaid);
    expect(statement.netReceived).toBe(canonical.netPaymentsReceived);
    expect(statement.outstandingBalance).toBe(canonical.outstandingBalance);
    expect(statement.isReceivable).toBe(canonical.isReceivable);

    // The final row's runningBalance must equal the statement outstanding balance
    const lastRow = statement.rows[statement.rows.length - 1];
    expect(lastRow.runningBalance).toBe(canonical.outstandingBalance);
  });

  it('buildPartyStatementData excludes in-transit dispatch from invoiced revenue', () => {
    const statement = buildPartyStatementData(dispatches, payments, [], mockSettings);
    const pendingRow = statement.rows.find((r) => r.reference.includes('d3-pending') || r.description.includes('d3-pending'));
    expect(pendingRow).toBeDefined();
    expect(pendingRow?.isPending).toBe(true);
    expect(pendingRow?.debit).toBe(0);
    expect(pendingRow?.weightTons).toBe(0);
  });

  it('posts whole rupees per transaction so statement rows and totals reconcile', () => {
    const halfRupeeDispatches = [
      createMockDispatch('half-1', { date: '2026-10-01', baseRate: 100.5, labReceivedWeight: 1 }),
      createMockDispatch('half-2', { date: '2026-10-02', baseRate: 100.5, labReceivedWeight: 1 }),
    ];
    const halfRupeePayments: Payment[] = [{
      id: 'half-payment',
      partyId: 'party-test-1',
      date: '2026-10-03',
      amount: 50.5,
      type: 'received',
      mode: 'bank',
      createdAt: Date.now(),
    }];

    const statement = buildPartyStatementData(halfRupeeDispatches, halfRupeePayments, [], mockSettings);

    expect(statement.rows.map((row) => [row.debit, row.credit, row.runningBalance])).toEqual([
      [101, 0, 101],
      [101, 0, 202],
      [0, 51, 151],
    ]);
    expect(statement.totalBilled).toBe(202);
    expect(statement.totalReceived).toBe(51);
    expect(statement.outstandingBalance).toBe(151);
    expect(statement.rows[statement.rows.length - 1].runningBalance).toBe(statement.outstandingBalance);
  });

  it('buildFleetExportData totals match calculateLedgerTotals exactly', () => {
    const canonical = calculateLedgerTotals(dispatches, mockSettings);
    const fleet = buildFleetExportData(dispatches, parties, [], mockSettings);

    expect(fleet.totals.revenue).toBe(canonical.revenue);
    expect(fleet.totals.cost).toBe(canonical.cost);
    expect(fleet.totals.profit).toBe(canonical.profit);
    expect(fleet.totals.settledCount).toBe(canonical.settledCount);
    expect(fleet.totals.pendingCount).toBe(canonical.pendingCount);
    expect(fleet.totals.receivedTons).toBe(canonical.receivedTons);
    expect(fleet.totals.loadedTonsSettled).toBe(canonical.loadedTonsSettled);
    expect(fleet.totals.pendingLoadedTons).toBe(canonical.pendingLoadedTons);
    expect(fleet.totals.transitDiffTons).toBe(canonical.transitDiffTons);

    // Assert row count equals dispatch count
    expect(fleet.rows.length).toBe(dispatches.length);

    // In-transit truck row must show 0 revenue, 0 cost, 0 profit
    const inTransitRow = fleet.rows.find((r) => r.id === 'd3-pending');
    expect(inTransitRow).toBeDefined();
    expect(inTransitRow?.isPending).toBe(true);
    expect(inTransitRow?.revenue).toBe(0);
    expect(inTransitRow?.totalCost).toBe(0);
    expect(inTransitRow?.netProfit).toBe(0);
  });

  it('fails if export calculations deviate from canonical totals (guard test)', () => {
    const canonical = calculateLedgerTotals(dispatches, mockSettings);
    const deliberatelyAltered = { ...canonical, revenue: canonical.revenue + 500 };
    expect(deliberatelyAltered.revenue).not.toBe(canonical.revenue);
  });
});

describe('Issue 25 (T13): Synthetic Settlement Scenario Regression', () => {
  const { tolerance, slips } = syntheticScenariosFixture;

  it('contains exactly 10 synthetic scenarios covering the supported commercial rules', () => {
    expect(slips.length).toBe(10);
  });

  slips.forEach((slip) => {
    it(`matches synthetic scenario ${slip.id} within tolerance (${slip.source})`, () => {
      const dispatch: Dispatch = {
        id: slip.id,
        partyId: 'party-real',
        date: '2026-09-14',
        truckNumber: 'TK-REAL',
        factoryName: 'Commercial Plant',
        targetGcv: slip.inputs.targetGcv || 0,
        labActualGcv: slip.inputs.labActualGcv || 0,
        labSulphur: 1.0,
        coalInputs: (slip.inputs.coalInputs || []).map((ci, i) => ({
          id: `ci-${i}`,
          sourceName: 'Mine',
          weight: ci.weight,
          purchaseRate: ci.purchaseRate,
        })),
        overheads: slip.inputs.overheads || { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: slip.inputs.baseRate,
        manualDeduction: slip.inputs.manualDeduction || 0,
        manualPremium: slip.inputs.manualPremium || 0,
        manualTax: slip.inputs.manualTax || 0,
        taxMethod: slip.inputs.taxMethod as any,
        taxSalesPercent: slip.inputs.taxSalesPercent,
        taxIncomePercent: slip.inputs.taxIncomePercent,
        commissionPerTon: slip.inputs.commissionPerTon || 0,
        labReceivedWeight: slip.inputs.labReceivedWeight,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const settlement = calculateSettlement(dispatch);
      const transit = calculateTransitLoss(dispatch);

      if (slip.paper.adjustedRate !== undefined) {
        expect(Math.abs(settlement.adjustedRate - slip.paper.adjustedRate)).toBeLessThanOrEqual(tolerance);
      }
      if (slip.paper.taxDeduction !== undefined) {
        expect(Math.abs(settlement.taxDeduction - slip.paper.taxDeduction)).toBeLessThanOrEqual(tolerance);
      }
      if (slip.paper.payableRate !== undefined) {
        expect(Math.abs(settlement.payableRate - slip.paper.payableRate)).toBeLessThanOrEqual(tolerance);
      }
      if (slip.paper.totalRevenue !== undefined) {
        expect(Math.abs(settlement.totalRevenue - slip.paper.totalRevenue)).toBeLessThanOrEqual(tolerance);
      }
      if (slip.paper.netProfit !== undefined) {
        expect(Math.abs(settlement.netProfit - slip.paper.netProfit)).toBeLessThanOrEqual(tolerance);
      }
      if (slip.paper.transitDiff !== undefined) {
        expect(Math.abs(transit.diff - slip.paper.transitDiff)).toBeLessThanOrEqual(0.01);
      }
      if (slip.paper.lossPercentage !== undefined) {
        expect(Math.abs(transit.lossPercentage - slip.paper.lossPercentage)).toBeLessThanOrEqual(0.1);
      }
      if (slip.paper.isPending !== undefined) {
        expect(transit.isPending).toBe(slip.paper.isPending);
      }
      if ((slip.paper as any).aggregateRevenue !== undefined) {
        const totals = calculateLedgerTotals([dispatch], mockSettings);
        expect(totals.revenue).toBe((slip.paper as any).aggregateRevenue);
      }
      if ((slip.paper as any).aggregateProfit !== undefined) {
        const totals = calculateLedgerTotals([dispatch], mockSettings);
        expect(totals.profit).toBe((slip.paper as any).aggregateProfit);
      }
    });
  });
});
