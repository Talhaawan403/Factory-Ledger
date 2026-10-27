import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, seedTestData } from '../src/lib/devSeed';
import {
  getDispatches,
  getLots,
  getMines,
  getParties,
  getPayments,
  getPurchaseOrders,
  getGeneralExpenses,
  getSettings,
} from '../src/lib/db';
import { calculatePartyBalance } from '../src/utils/calculations';

describe('Development Seed Data (Rich & Concise)', () => {
  beforeEach(async () => {
    await clearAllData({ reload: false });
  });

  it('loads rich dataset with concise names and proper buyer/supplier separation', async () => {
    await seedTestData({ reload: false });

    const [parties, dispatches, payments, pos, lots, mines, expenses, settings] = await Promise.all([
      getParties(),
      getDispatches(),
      getPayments(),
      getPurchaseOrders(),
      getLots(),
      getMines(),
      getGeneralExpenses(),
      getSettings(),
    ]);

    // 1. Parties Verification (Buyers + Suppliers + Direct Mine auto-ledgers)
    expect(parties).toHaveLength(20);
    const buyers = parties.filter((p) => p.type === 'buyer');
    const suppliers = parties.filter((p) => p.type === 'supplier');
    expect(buyers).toHaveLength(7);
    expect(suppliers).toHaveLength(13);
    const directSuppliers = suppliers.filter((s) => s.isDirectMine);
    expect(directSuppliers).toHaveLength(5);

    // Verify small, concise names
    for (const p of parties) {
      expect(p.name.length).toBeLessThanOrEqual(30);
      expect(p.name.trim()).not.toBe('');
    }

    // 2. Mines Verification
    expect(mines).toHaveLength(5);
    for (const m of mines) {
      expect(m.name.length).toBeLessThanOrEqual(15);
      expect(m.ratePerTon).toBeGreaterThan(0);
    }

    // 3. Inventory Stock Lots Verification
    expect(lots).toHaveLength(21);
    for (const lot of lots) {
      expect(lot.supplier.length).toBeLessThanOrEqual(20);
      expect(lot.receivedWeight).toBeGreaterThan(0);
      expect(lot.purchaseRate).toBeGreaterThan(0);
      expect(lot.landedRate).toBeGreaterThan(0);
      expect(lot.totalValue).toBeGreaterThan(0);
      expect(lot.storedAt).toBeDefined();
    }

    // 4. Dispatches Verification
    expect(dispatches).toHaveLength(16);
    const settledDispatches = dispatches.filter((d) => d.status === 'settled');
    const pendingDispatches = dispatches.filter((d) => d.status === 'pending');
    expect(settledDispatches).toHaveLength(14);
    expect(pendingDispatches).toHaveLength(2);

    for (const d of dispatches) {
      expect(d.truckNumber.length).toBeLessThanOrEqual(10);
      expect(d.coalInputs && d.coalInputs.length).toBeGreaterThan(0);
    }

    // 5. Payments Verification (Buyer Receipts & Supplier Disbursements)
    expect(payments).toHaveLength(19);
    const receivedPayments = payments.filter((p) => p.type === 'received');
    const paidPayments = payments.filter((p) => p.type === 'paid');
    expect(receivedPayments).toHaveLength(12);
    expect(paidPayments).toHaveLength(7);

    // Verify all paid payments have supplierId
    for (const p of paidPayments) {
      expect(p.supplierId).toBeDefined();
      expect(p.amount).toBeGreaterThan(0);
    }

    // 6. Purchase Orders Verification
    expect(pos).toHaveLength(7);
    for (const po of pos) {
      expect(po.poNumber.length).toBeLessThanOrEqual(12);
      expect(po.partyId).toBeDefined();
    }

    // 7. General Expenses Verification
    expect(expenses).toHaveLength(12);
    for (const exp of expenses) {
      expect(exp.description.length).toBeLessThanOrEqual(30);
      expect(exp.amount).toBeGreaterThan(0);
    }

    // 8. Multi-Material & Quality Models Verification
    expect(settings?.materialItems).toHaveLength(4);
    expect(settings?.suppliers).toHaveLength(6);

    const lateriteDispatch = dispatches.find((d) => d.itemId === 'material-laterite' && d.status === 'settled');
    expect(lateriteDispatch).toBeDefined();
    expect(lateriteDispatch?.pricingModel).toBe('purity');
    expect(lateriteDispatch?.ratePerQualityUnit).toBe(125);
    expect(lateriteDispatch?.receivedQuality).toBe(32.5);

    const bauxiteDispatch = dispatches.find((d) => d.itemId === 'material-bauxite' && d.status === 'settled');
    expect(bauxiteDispatch).toBeDefined();
    expect(bauxiteDispatch?.pricingModel).toBe('flat');
    expect(bauxiteDispatch?.baseRate).toBe(9200);

    // 9. Balance Calculation Logic: Buyer vs Supplier
    const mapleLeaf = parties.find((p) => p.id === 'party-maple');
    expect(mapleLeaf).toBeDefined();
    const buyerDispatches = dispatches.filter((d) => d.partyId === mapleLeaf!.id);
    const buyerPayments = payments.filter((p) => p.partyId === mapleLeaf!.id);
    const buyerBalance = calculatePartyBalance(buyerDispatches, buyerPayments, mapleLeaf!, lots);
    expect(buyerBalance.partyType).toBe('buyer');
    expect(buyerBalance.totalBilled).toBeGreaterThan(0);
    expect(buyerBalance.totalPaymentsReceived).toBe(1600000); // 600k + 550k + 450k

    const khanPit = parties.find((p) => p.id === 'supp-khan-pit');
    expect(khanPit).toBeDefined();
    const supplierLots = lots.filter((l) => l.supplierId === khanPit!.id);
    const supplierPayments = payments.filter((p) => p.supplierId === khanPit!.id);
    const supplierBalance = calculatePartyBalance([], supplierPayments, khanPit!, supplierLots);
    expect(supplierBalance.partyType).toBe('supplier');
    expect(supplierBalance.totalPurchases).toBeGreaterThan(0);
    expect(supplierBalance.totalPaymentsPaid).toBe(1300000); // 700k + 600k
    expect(supplierBalance.outstandingBalance).toBeGreaterThan(0);
  });
});
