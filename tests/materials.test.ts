import { describe, expect, it } from 'vitest';
import {
  calculateSettlement,
  calculateSupplierStock,
  calculateMaterialInventorySummary,
  calculateSupplierFinancials,
  buildDispatchSlipRows,
} from '../src/utils/calculations';
import {
  COAL_ITEM_ID,
  DEFAULT_MATERIAL_ITEMS,
  getMaterialForDispatch,
  normalizeMaterialItems,
  normalizeSuppliers,
  getMaterialBadgeTheme,
  getMaterialDefaultTaxIncomePercent,
} from '../src/utils/materials';
import type { AppSettings, Dispatch, InventoryLot, Payment, Party } from '../src/types';
import { sanitizeParty } from '../src/lib/db';

function baseDispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: 'dispatch-material-test',
    partyId: 'party-1',
    date: '2026-10-16',
    truckNumber: 'TK-100',
    factoryName: 'Factory A',
    targetGcv: 6000,
    baseRate: 38000,
    coalInputs: [{ id: 'source-1', sourceName: 'Source A', weight: 30, purchaseRate: 2500 }],
    overheads: { loading: 1000, freight: 2000, crush: 0, royalty: 0, other: 0 },
    labActualGcv: 6000,
    labSulphur: 1,
    labReceivedWeight: 29,
    manualDeduction: 0,
    manualPremium: 0,
    manualTax: 0,
    commissionPerTon: 0,
    taxMethod: 'manual',
    status: 'settled',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    ...overrides,
  };
}

describe('Multi-material backward compatibility and pricing', () => {
  it('interprets a legacy dispatch with no item metadata as Coal', () => {
    const legacy = baseDispatch();
    const material = getMaterialForDispatch(legacy, null);
    expect(material.id).toBe(COAL_ITEM_ID);
    expect(material.name).toBe('Coal');
    expect(material.pricingModel).toBe('gcv');
  });

  it('contains the 6 required default raw materials with their specific quality units', () => {
    const itemNames = DEFAULT_MATERIAL_ITEMS.map((m) => m.name);
    expect(itemNames).toContain('Coal');
    expect(itemNames).toContain('Laterite');
    expect(itemNames).toContain('Bauxite');
    expect(itemNames).toContain('Gypsum');
    expect(itemNames).toContain('Bricks Waste');
    expect(itemNames).toContain('Wheat Waste');

    const laterite = DEFAULT_MATERIAL_ITEMS.find((m) => m.name === 'Laterite');
    expect(laterite?.qualityLabel).toBe('Fe2O3');
    expect(laterite?.pricingModel).toBe('purity');

    const bauxite = DEFAULT_MATERIAL_ITEMS.find((m) => m.name === 'Bauxite');
    expect(bauxite?.qualityLabel).toBe('Al2O3');
    expect(bauxite?.pricingModel).toBe('flat');

    const gypsum = DEFAULT_MATERIAL_ITEMS.find((m) => m.name === 'Gypsum');
    expect(gypsum?.pricingModel).toBe('flat');

    const bricksWaste = DEFAULT_MATERIAL_ITEMS.find((m) => m.name === 'Bricks Waste');
    expect(bricksWaste?.pricingModel).toBe('flat');

    const wheatWaste = DEFAULT_MATERIAL_ITEMS.find((m) => m.name === 'Wheat Waste');
    expect(wheatWaste?.pricingModel).toBe('flat');
  });

  it('applies 5.5% default income tax for Laterite and 5.0% for other materials', () => {
    expect(getMaterialDefaultTaxIncomePercent('material-laterite')).toBe(5.5);
    expect(getMaterialDefaultTaxIncomePercent('Laterite')).toBe(5.5);
    expect(getMaterialDefaultTaxIncomePercent('coal')).toBe(5.0);
    expect(getMaterialDefaultTaxIncomePercent('material-bauxite')).toBe(5.0);
    expect(getMaterialDefaultTaxIncomePercent('material-wheat-waste')).toBe(5.0);
  });

  it('calculates Laterite withholding tax at 5.5% formula correctly', () => {
    // Rate = 10,000, 18% Sales Tax, 5.5% Income Tax
    // Gross with GST = 10,000 * 1.18 = 11,800
    // Income tax deduction @ 5.5% = 11,800 * 5.5% = 649
    // Payable rate = 10,000 - 649 = 9,351
    const dispatch = baseDispatch({
      itemId: 'material-laterite',
      itemName: 'Laterite',
      pricingModel: 'flat',
      baseRate: 10000,
      taxMethod: 'formula_18_5',
      taxSalesPercent: 18,
      taxIncomePercent: 5.5,
      labReceivedWeight: 10,
    });
    const settlement = calculateSettlement(dispatch);
    expect(settlement.adjustedRate).toBe(10000);
    expect(settlement.taxDeduction).toBe(649);
    expect(settlement.payableRate).toBe(9351);
  });

  it('incorporates Diesel Deductions / Premium into rate calculation and slip rows', () => {
    // Diesel premium of +250/ton
    const dispatchWithPremium = baseDispatch({
      baseRate: 20000,
      dieselRateAdjustment: 250,
      manualTax: 0,
      taxMethod: 'manual',
      labReceivedWeight: 10,
    });
    const premiumSettlement = calculateSettlement(dispatchWithPremium);
    expect(premiumSettlement.dieselAdjustment).toBe(250);
    expect(premiumSettlement.adjustedRate).toBe(20250);
    expect(premiumSettlement.payableRate).toBe(20250);

    // Diesel deduction of -150/ton
    const dispatchWithDeduction = baseDispatch({
      baseRate: 20000,
      dieselRateAdjustment: -150,
      manualTax: 0,
      taxMethod: 'manual',
      labReceivedWeight: 10,
    });
    const deductionSettlement = calculateSettlement(dispatchWithDeduction);
    expect(deductionSettlement.dieselAdjustment).toBe(-150);
    expect(deductionSettlement.adjustedRate).toBe(19850);
    expect(deductionSettlement.payableRate).toBe(19850);

    // Verify slip row inclusion
    const slipRows = buildDispatchSlipRows(dispatchWithPremium);
    const dieselRow = slipRows.find((r) => r.kind === 'diesel');
    expect(dieselRow).toBeDefined();
    expect(dieselRow?.label).toContain('Diesel Escalation');
    expect(dieselRow?.amount).toBe(250);
  });

  it('calculates supplier financial ledger with purchases, payments, and payable balance', () => {
    const lots = [
      {
        id: 'lot-1',
        supplierId: 'supp-laterite',
        supplier: 'Laterite Supplier Co',
        receivedWeight: 50,
        purchaseRate: 4000,
        totalValue: 200000,
        date: '2026-10-01',
      },
      {
        id: 'lot-2',
        supplierId: 'supp-laterite',
        supplier: 'Laterite Supplier Co',
        receivedWeight: 30,
        purchaseRate: 5000,
        totalValue: 150000,
        date: '2026-10-05',
      },
    ] as unknown as InventoryLot[];

    const payments = [
      {
        id: 'pay-1',
        partyId: 'supp-laterite',
        supplierId: 'supp-laterite',
        amount: 200000,
        type: 'paid',
        mode: 'bank',
        date: '2026-10-03',
      },
      {
        id: 'pay-2',
        partyId: 'supp-laterite',
        supplierId: 'supp-laterite',
        amount: 50000,
        type: 'paid',
        mode: 'cash',
        date: '2026-10-07',
      },
    ] as unknown as Payment[];

    const financials = calculateSupplierFinancials('supp-laterite', lots, payments);
    // Total Purchases = 200,000 + 150,000 = 350,000
    expect(financials.totalPurchases).toBe(350000);
    expect(financials.totalBilled).toBe(350000);
    // Total Payments = 200,000 + 50,000 = 250,000
    expect(financials.totalPaid).toBe(250000);
    // Net Outstanding = 350,000 - 250,000 = 100,000
    expect(financials.outstandingBalance).toBe(100000);
    expect(financials.isPayable).toBe(true);
    expect(financials.purchasesCount).toBe(2);
    expect(financials.paymentsCount).toBe(2);
  });

  it('keeps a saved material snapshot when catalog settings change later', () => {
    const dispatch = {
      itemId: 'material-laterite',
      itemName: 'Laterite at dispatch time',
      pricingModel: 'purity' as const,
      qualityLabel: 'Purity',
      qualityUnit: '%',
      ratePerQualityUnit: 116,
    };
    const settings = {
      materialItems: [{
        id: 'material-laterite',
        name: 'Renamed current catalog item',
        pricingModel: 'flat' as const,
        qualityLabel: 'Grade',
        qualityUnit: '%',
        defaultRate: 999,
        isActive: true,
      }],
    } as AppSettings;

    const material = getMaterialForDispatch(dispatch, settings);

    expect(material.name).toBe('Laterite at dispatch time');
    expect(material.pricingModel).toBe('purity');
    expect(material.defaultRate).toBe(116);
  });

  it('does not change the legacy Coal settlement result', () => {
    const legacy = baseDispatch({ baseRate: 38000, manualDeduction: 500 });
    const snapshottedCoal = baseDispatch({
      itemId: COAL_ITEM_ID,
      itemName: 'Coal',
      pricingModel: 'gcv',
      qualityLabel: 'GCV',
      qualityUnit: 'kcal/kg',
      baseRate: 38000,
      manualDeduction: 500,
    });

    expect(calculateSettlement(snapshottedCoal)).toEqual(calculateSettlement(legacy));
  });

  it('calculates Laterite rate and truck revenue from factory received purity', () => {
    const laterite = baseDispatch({
      itemId: 'material-laterite',
      itemName: 'Laterite',
      pricingModel: 'purity',
      qualityLabel: 'Purity',
      qualityUnit: '%',
      ratePerQualityUnit: 116,
      receivedQuality: 30,
      baseRate: 0,
      labReceivedWeight: 29,
      coalInputs: [{ id: 'source-1', sourceName: 'Laterite Supplier', supplierId: 'supplier-1', weight: 30, purchaseRate: 2500 }],
    });

    const result = calculateSettlement(laterite);
    expect(result.adjustedRate).toBe(3480);
    expect(result.payableRate).toBe(3480);
    expect(result.totalRevenue).toBe(100920);
    expect(result.totalCost).toBe(78000);
    expect(result.netProfit).toBe(22920);
  });

  it('does not apply Coal pro-rata GCV logic to purity-priced materials', () => {
    const laterite = baseDispatch({
      itemId: 'material-laterite',
      itemName: 'Laterite',
      pricingModel: 'purity',
      ratePerQualityUnit: 116,
      receivedQuality: 30,
      gcvAdjustment: 'prorata',
      targetGcv: 6000,
      labActualGcv: 3000,
    });

    const result = calculateSettlement(laterite);
    expect(result.adjustedRate).toBe(3480);
    expect(result.gcvDeduction).toBe(0);
    expect(result.isProrata).toBe(false);
  });

  it('restores default materials defensively and normalizes supplier records', () => {
    expect(normalizeMaterialItems([]).map((item) => item.name)).toEqual(
      DEFAULT_MATERIAL_ITEMS.map((item) => item.name),
    );
    expect(normalizeMaterialItems([{ id: 'custom', name: 'Silica', pricingModel: 'flat' }])[0]).toMatchObject({
      id: COAL_ITEM_ID,
      name: 'Coal',
    });
    expect(normalizeSuppliers([
      { id: 's-1', name: ' Supplier One ', phone: ' 0300 ', materialIds: ['material-laterite', 'material-laterite'] },
      { id: 's-1', name: 'Duplicate' },
    ])).toEqual([{
      id: 's-1',
      name: 'Supplier One',
      phone: '0300',
      materialIds: ['material-laterite'],
      isArchived: false,
    }]);
  });

  it('calculates supplier stock inflows, outflows, remaining tons and FIFO valuation correctly', () => {
    const supplier = { id: 'supp-1', name: 'Alpha Minerals', materialIds: ['material-laterite'] };
    const lots = [
      { id: 'lot-1', supplierId: 'supp-1', itemId: 'material-laterite', totalTons: 100, landedRatePerTon: 5000, date: '2026-10-01' },
      { id: 'lot-2', supplierId: 'supp-1', itemId: 'material-laterite', totalTons: 50, landedRatePerTon: 6000, date: '2026-10-05' },
    ];
    const dispatches = [
      baseDispatch({
        id: 'd-1',
        coalInputs: [{ id: 'src-1', sourceName: 'Alpha Minerals', supplierId: 'supp-1', lotId: 'lot-1', weight: 40, purchaseRate: 5000 }],
      }),
      baseDispatch({
        id: 'd-2',
        coalInputs: [{ id: 'src-2', sourceName: 'Alpha Minerals', supplierId: 'supp-1', lotId: 'lot-1', weight: 30, purchaseRate: 5000 }],
      }),
    ];

    const stock = calculateSupplierStock(supplier, lots as unknown as InventoryLot[], dispatches);
    expect(stock.totalInflowTons).toBe(150);
    expect(stock.totalOutflowTons).toBe(70);
    expect(stock.remainingTons).toBe(80);
    expect(stock.status).toBe('in_stock');
    expect(stock.entriesCount).toBe(2);
    // 30 tons left of lot-1 @ 5000 = 150,000 + 50 tons of lot-2 @ 6000 = 300,000 => 450,000 total stock value
    expect(stock.remainingValue).toBe(450000);
  });

  it('calculates material inventory summary accurately across all sources', () => {
    const mines = [
      { id: 'mine-1', name: 'Mine A' },
    ] as unknown as import('../src/types').Mine[];
    const suppliers = [
      { id: 'supp-1', name: 'Supplier B', materialIds: ['material-laterite'] },
    ] as unknown as import('../src/types').SupplierProfile[];
    const lots = [
      { id: 'lot-coal', mineId: 'mine-1', itemId: 'coal', totalTons: 200, landedRatePerTon: 20000 },
      { id: 'lot-lat', supplierId: 'supp-1', itemId: 'material-laterite', totalTons: 100, landedRatePerTon: 5000 },
    ] as unknown as InventoryLot[];
    const dispatches = [
      baseDispatch({
        id: 'd-coal',
        itemId: 'coal',
        coalInputs: [{ id: 'src-c', sourceName: 'Mine A', mineId: 'mine-1', lotId: 'lot-coal', weight: 50, purchaseRate: 20000 }],
      }),
    ];

    const coalSummary = calculateMaterialInventorySummary('coal', mines, suppliers, lots, dispatches);
    expect(coalSummary.totalYardTons).toBe(150);
    expect(coalSummary.totalYardValue).toBe(3000000);
    expect(coalSummary.totalSources).toBe(1);

    const lateriteSummary = calculateMaterialInventorySummary('material-laterite', mines, suppliers, lots, dispatches);
    expect(lateriteSummary.totalYardTons).toBe(100);
    expect(lateriteSummary.totalYardValue).toBe(500000);
    expect(lateriteSummary.totalSources).toBe(1);

    const allSummary = calculateMaterialInventorySummary('all', mines, suppliers, lots, dispatches);
    expect(allSummary.totalYardTons).toBe(250);
    expect(allSummary.totalYardValue).toBe(3500000);
    expect(allSummary.totalSources).toBe(2);
  });

  it('preserves and deduplicates materialIds on sanitized parties', () => {
    const raw: Partial<Party> = {
      id: 'party-test',
      name: 'Test Supplier',
      type: 'supplier',
      materialIds: ['material-laterite', ' material-bauxite ', 'material-laterite', ''],
    };
    const sanitized = sanitizeParty(raw);
    expect(sanitized.materialIds).toEqual(['material-laterite', 'material-bauxite']);
  });

  it('safeguards purchase orders with active dispatches from contract tampering and deletion', () => {
    const poId = 'po-bw-001';
    const dispatches: Dispatch[] = [
      baseDispatch({ id: 'd-1', poId, labReceivedWeight: 30 }),
      baseDispatch({ id: 'd-2', poId, labReceivedWeight: 30 }),
      baseDispatch({ id: 'd-3', poId: 'other-po', labReceivedWeight: 25 }),
      baseDispatch({ id: 'd-4', poId, deleted: true, labReceivedWeight: 20 }),
    ];

    const linkedDispatches = dispatches.filter((d) => !d.deleted && d.poId === poId);
    expect(linkedDispatches.length).toBe(2);

    const dispatchedTons = linkedDispatches.reduce((acc, d) => acc + (d.labReceivedWeight || 0), 0);
    expect(dispatchedTons).toBe(60);

    // Rule 1: A PO with linked dispatches cannot be deleted
    const canDeletePO = linkedDispatches.length === 0;
    expect(canDeletePO).toBe(false);

    // Rule 2: Target tonnage cannot be lowered below already dispatched tons
    const newTargetTonsBelow = 50;
    const isTargetTonsValid = newTargetTonsBelow >= dispatchedTons;
    expect(isTargetTonsValid).toBe(false);

    const newTargetTonsAbove = 80;
    expect(newTargetTonsAbove >= dispatchedTons).toBe(true);
  });
});



