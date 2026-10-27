import { describe, it, expect, beforeEach } from 'vitest';
import type { Dispatch, Party, Payment, PurchaseOrder, InventoryLot, Mine, GeneralExpense, AppSettings } from '../src/types';
import {
  calculateSettlement,
  calculateLedgerTotals,
  calculateBooksTotals,
  calculatePartyBalance,
  calculateLotStock,
  calculateLotAvailabilityForDispatch,
  calculateTransitLoss,
  roundPartyLedgerAmount,
  isDispatchPending,
} from '../src/utils/calculations';
import {
  buildPartyStatementData,
  buildFleetExportData,
  generateSupplierDeliveryWhatsappText,
} from '../src/utils/exportSharing';
import {
  saveParty,
  getParties,
  getParty,
  deleteParty,
  deletePartyWithRecords,
  saveDispatch,
  getDispatches,
  getDispatch,
  deleteDispatch,
  savePayment,
  getPayments,
  deletePayment,
  saveMine,
  getMines,
  deleteMine,
  saveLot,
  getLots,
  deleteLot,
  saveGeneralExpense,
  getGeneralExpenses,
  saveSettings,
  getSettings,
  clearAllData,
  getAllBackupData,
  getExportBackupData,
  restoreBackup,
  validateBackupPayload,
  rollbackToPreRestoreSnapshot,
  getPreRestoreSnapshot,
  getLedgerForSync,
  markRecordsClean,
} from '../src/lib/db';
import { idb } from '../src/lib/dexieDb';

describe('Real-World Readiness: Factory Ledger End-to-End Linkages & Stress Tests', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  // =========================================================================
  // SCENARIO 1: Dispatch Truck Lifecycle (Pending In-Transit -> Lab Result -> Settlement)
  // =========================================================================
  describe('Scenario 1: Dispatch Truck Lifecycle & Accounting Recognition', () => {
    it('handles in-transit dispatch correctly without premature revenue recognition or artificial transit loss', async () => {
      const party: Party = {
        id: 'buyer-maple-leaf',
        name: 'Maple Leaf Cement',
        contactPerson: 'Procurement Head',
        phone: '0300-1112233',
        address: 'Daud Khel',
        type: 'buyer',
        createdAt: Date.now(),
      };
      await saveParty(party);

      // In-transit truck dispatched on 2026-10-15
      const pendingDispatch: Dispatch = {
        id: 'disp-truck-101',
        partyId: party.id,
        date: '2026-10-15',
        truckNumber: 'TK-ML-101',
        factoryName: party.name,
        targetGcv: 6000,
        baseRate: 35000,
        coalInputs: [
          { id: 'input-1', sourceName: 'Degari Mine', weight: 30.0, purchaseRate: 24000 },
        ],
        overheads: { loading: 3000, freight: 45000, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 0,
        labReceivedWeight: 0, // Unweighed yet
        labSulphur: 0,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(pendingDispatch);

      // 1. Verify settlement returns cost immediately, but revenue is ZERO
      const pendingSettlement = calculateSettlement(pendingDispatch);
      expect(pendingSettlement.totalCost).toBe(30.0 * 24000 + 48000); // 720,000 + 48,000 = 768,000
      expect(pendingSettlement.totalRevenue).toBe(0); // 0 received weight

      // 2. Verify Ledger Totals ignores pending trucks for revenue & transit difference
      const ledgerTotals = calculateLedgerTotals([pendingDispatch]);
      expect(ledgerTotals.pendingCount).toBe(1);
      expect(ledgerTotals.settledCount).toBe(0);
      expect(ledgerTotals.revenue).toBe(0);
      expect(ledgerTotals.cost).toBe(0); // Settled cost only
      expect(ledgerTotals.transitDiffTons).toBe(0); // No artificial -30.0 ton loss!
      expect(ledgerTotals.pendingLoadedTons).toBe(30.0);

      // 3. Verify Books view recognizes capital outflow immediately, with revenue pending
      const booksTotals = calculateBooksTotals([pendingDispatch]);
      expect(booksTotals.pendingCount).toBe(1);
      expect(booksTotals.settledCount).toBe(0);
      expect(booksTotals.totalInflow).toBe(0);
      expect(booksTotals.dispatchCost).toBe(768000);
      expect(booksTotals.inTransitCost).toBe(768000);
      expect(booksTotals.totalOutflow).toBe(768000);
      expect(booksTotals.netEffect).toBe(-768000); // Outflow invested while revenue pending

      // 4. Verify Buyer Party balance does not invoice unweighed truck
      const partyBalance = calculatePartyBalance([pendingDispatch], [], party);
      expect(partyBalance.totalBilled).toBe(0);
      expect(partyBalance.outstandingBalance).toBe(0);

      // --- Factory passes truck 5 days later with lab test results ---
      const settledDispatch: Dispatch = {
        ...pendingDispatch,
        status: 'settled',
        labReceivedWeight: 29.2, // 800 kg moisture/transit loss
        labActualGcv: 5850, // Slight deduction under 6000 target
        manualDeduction: 875, // Rs. 875/ton quality cut
        settledDate: '2026-10-20',
        settledAt: Date.now(),
        updatedAt: Date.now() + 5000,
      };
      await saveDispatch(settledDispatch);

      // 5. Verify settled settlement calculations
      const settledSettlement = calculateSettlement(settledDispatch);
      expect(settledSettlement.adjustedRate).toBe(35000 - 875); // 34,125
      expect(settledSettlement.payableRate).toBe(34125);
      const expectedRevenue = 34125 * 29.2; // 996,450
      expect(settledSettlement.totalRevenue).toBe(expectedRevenue);
      expect(settledSettlement.totalCost).toBe(768000);
      expect(settledSettlement.netProfit).toBe(expectedRevenue - 768000); // 228,450

      // 6. Verify Ledger Totals now recognizes settled revenue and real transit loss
      const settledLedgerTotals = calculateLedgerTotals([settledDispatch]);
      expect(settledLedgerTotals.settledCount).toBe(1);
      expect(settledLedgerTotals.pendingCount).toBe(0);
      expect(settledLedgerTotals.revenue).toBe(expectedRevenue);
      expect(settledLedgerTotals.transitDiffTons).toBeCloseTo(-0.8, 2); // 29.2 - 30.0 = -0.8 tons

      // 7. Verify Party Ledger now reflects whole-rupee invoice debit
      const settledPartyBalance = calculatePartyBalance([settledDispatch], [], party);
      expect(settledPartyBalance.totalBilled).toBe(Math.round(expectedRevenue));
      expect(settledPartyBalance.outstandingBalance).toBe(Math.round(expectedRevenue));
      expect(settledPartyBalance.isReceivable).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 2: Editing, Deleting, and Back-Dating Entries
  // =========================================================================
  describe('Scenario 2: Editing, Deleting, and Running Balances Integrity', () => {
    it('maintains strict chronological running balance when back-dating payments', async () => {
      const party: Party = {
        id: 'party-lucky-cement',
        name: 'Lucky Cement Ltd',
        contactPerson: 'Finance Director',
        phone: '0321-9988776',
        address: 'Karachi',
        type: 'buyer',
        createdAt: Date.now(),
      };
      await saveParty(party);

      const d1: Dispatch = {
        id: 'disp-oct-01',
        partyId: party.id,
        date: '2026-10-01',
        truckNumber: 'TK-1',
        factoryName: party.name,
        targetGcv: 6000,
        baseRate: 30000,
        coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 20, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 6000,
        labReceivedWeight: 20,
        labSulphur: 0,
        status: 'settled',
        createdAt: 1000,
        updatedAt: 1000,
      };

      const d2: Dispatch = {
        id: 'disp-oct-10',
        partyId: party.id,
        date: '2026-10-10',
        truckNumber: 'TK-2',
        factoryName: party.name,
        targetGcv: 6000,
        baseRate: 30000,
        coalInputs: [{ id: 'c2', sourceName: 'Mine A', weight: 20, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 6000,
        labReceivedWeight: 20,
        labSulphur: 0,
        status: 'settled',
        createdAt: 2000,
        updatedAt: 2000,
      };

      // User enters a payment received on Oct 05 (in between Oct 01 and Oct 10)
      const p1: Payment = {
        id: 'pay-oct-05',
        partyId: party.id,
        date: '2026-10-05',
        amount: 400000,
        type: 'received',
        mode: 'bank',
        createdAt: 3000, // Created today, but back-dated to Oct 05
      };

      await saveDispatch(d1);
      await saveDispatch(d2);
      await savePayment(p1);

      // Each dispatch invoice = 20 * 30000 = 600,000
      const statement = buildPartyStatementData([d1, d2], [p1]);
      expect(statement.rows.length).toBe(3);

      // Verify row 1: Dispatch Oct 01 -> Debit 600,000 -> Running Balance 600,000
      expect(statement.rows[0].date).toBe('OCT 01, 2026');
      expect(statement.rows[0].debit).toBe(600000);
      expect(statement.rows[0].credit).toBe(0);
      expect(statement.rows[0].runningBalance).toBe(600000);

      // Verify row 2: Payment Oct 05 -> Credit 400,000 -> Running Balance drops to 200,000
      expect(statement.rows[1].date).toBe('OCT 05, 2026');
      expect(statement.rows[1].debit).toBe(0);
      expect(statement.rows[1].credit).toBe(400000);
      expect(statement.rows[1].runningBalance).toBe(200000);

      // Verify row 3: Dispatch Oct 10 -> Debit 600,000 -> Running Balance rises to 800,000
      expect(statement.rows[2].date).toBe('OCT 10, 2026');
      expect(statement.rows[2].debit).toBe(600000);
      expect(statement.rows[2].credit).toBe(0);
      expect(statement.rows[2].runningBalance).toBe(800000);

      // Final running balance MUST match statement.outstandingBalance
      expect(statement.rows[2].runningBalance).toBe(statement.outstandingBalance);
      expect(statement.outstandingBalance).toBe(800000);
    });

    it('prevents accidental deletion of a party with active transactions unless cascade is used', async () => {
      const party: Party = {
        id: 'party-guarded',
        name: 'Cherat Cement',
        contactPerson: 'Site Manager',
        phone: '0333-5554433',
        address: 'Nowshera',
        createdAt: Date.now(),
      };
      await saveParty(party);

      const pay: Payment = {
        id: 'pay-guarded-1',
        partyId: party.id,
        date: '2026-10-12',
        amount: 250000,
        type: 'received',
        mode: 'cheque',
        createdAt: Date.now(),
      };
      await savePayment(pay);

      // Guarded deleteParty must throw
      await expect(deleteParty(party.id)).rejects.toThrow(/Cannot delete party with existing financial records/);

      // Explicit cascade deletion removes party and child records safely with soft-deletes
      const result = await deletePartyWithRecords(party.id);
      expect(result.deletedDispatches).toBe(0);
      expect(result.deletedPayments).toBe(1);

      const activeParties = await getParties();
      expect(activeParties.find((p) => p.id === party.id)).toBeUndefined();

      const activePayments = await getPayments();
      expect(activePayments.find((p) => p.id === pay.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // SCENARIO 3: Direct Mine Ledger & Companion Supplier Party Coordination
  // =========================================================================
  describe('Scenario 3: Mine Ledger, Inventory Lots & Companion Supplier Coordination', () => {
    it('creates companion supplier party when mine is added and tracks purchases and stock', async () => {
      const mine: Mine = {
        id: 'mine-chamalang-01',
        name: 'Chamalang Pit #4',
        ratePerTon: 21500,
        location: 'Loralai',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveMine(mine);

      // Verify companion supplier party was automatically created
      const allParties = await idb.parties.toArray();
      const companion = allParties.find((p) => !p.deleted && p.linkedMineId === mine.id);
      expect(companion).toBeDefined();
      expect(companion?.type).toBe('supplier');
      expect(companion?.name).toContain('Chamalang Pit #4');

      // Add inward stock lot from this mine
      const lot: InventoryLot = {
        id: 'lot-ch-101',
        mineId: mine.id,
        mineName: mine.name,
        supplierId: companion!.id,
        supplier: companion!.name,
        date: '2026-10-18',
        billedWeight: 50.0,
        receivedWeight: 48.5,
        purchaseRate: 21500,
        landedRate: 23000,
        loadingCost: 5000,
        freightCost: 65000,
        totalValue: 48.5 * 21500, // 1,042,750
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveLot(lot);

      // Verify supplier party balance accounts for the coal purchase
      const supplierBalance = calculatePartyBalance([], [], companion, [lot]);
      expect(supplierBalance.totalPurchases).toBe(1042750);
      expect(supplierBalance.outstandingBalance).toBe(1042750);
      expect(supplierBalance.isPayable).toBe(true);

      // Make a partial payment of Rs. 600,000 to the mine
      const minePayment: Payment = {
        id: 'pay-mine-1',
        partyId: companion!.id,
        supplierId: companion!.id,
        mineId: mine.id,
        date: '2026-10-19',
        amount: 600000,
        type: 'paid',
        mode: 'bank',
        createdAt: Date.now(),
      };
      await savePayment(minePayment);

      const updatedSupplierBalance = calculatePartyBalance([], [minePayment], companion, [lot]);
      expect(updatedSupplierBalance.totalPaymentsPaid).toBe(600000);
      expect(updatedSupplierBalance.outstandingBalance).toBe(1042750 - 600000); // 442,750

      // If user tries to delete mine while lot stock exists, it must reject
      await expect(deleteMine(mine.id)).rejects.toThrow(/Cannot delete mine with existing stock entries/);

      // Delete the lot first
      await deleteLot(lot.id);

      // Now deleting the mine archives the companion party rather than deleting it because payments exist!
      await deleteMine(mine.id);
      const recheckedCompanion = await idb.parties.get(companion!.id);
      expect(recheckedCompanion?.isArchived).toBe(true);
      expect(recheckedCompanion?.deleted).toBeFalsy(); // Financial payment history protected!
    });
  });

  // =========================================================================
  // SCENARIO 4: Multi-Lot / Blending Recipe & Overdraw Detection
  // =========================================================================
  describe('Scenario 4: Inventory Depletion, Partial Lots, and Overdraw Guard', () => {
    it('accurately tracks lot depletion across multiple dispatches and flags overdraws', async () => {
      const lotA: InventoryLot = {
        id: 'lot-depot-a',
        supplier: 'Quetta Depot',
        date: '2026-10-01',
        billedWeight: 50.0,
        receivedWeight: 50.0,
        purchaseRate: 22000,
        landedRate: 22000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveLot(lotA);

      // Dispatch 1 consumes 30 tons from Lot A
      const d1: Dispatch = {
        id: 'disp-blend-1',
        partyId: 'party-x',
        date: '2026-10-05',
        truckNumber: 'TK-B1',
        factoryName: 'Bestway',
        targetGcv: 6000,
        baseRate: 32000,
        coalInputs: [
          { id: 'in-1', lotId: lotA.id, sourceName: 'Quetta Depot', weight: 30.0, purchaseRate: 22000 },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 6000,
        labReceivedWeight: 30.0,
        labSulphur: 0,
        status: 'settled',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(d1);

      // Verify stock remaining is 20 tons
      const stockInfo = calculateLotStock(lotA, [d1]);
      expect(stockInfo.usedWeight).toBe(30.0);
      expect(stockInfo.remainingWeight).toBe(20.0);
      expect(stockInfo.isOverdrawn).toBe(false);

      // Dispatch 2 drafts an allocation of 25 tons (5 tons more than remaining)
      const availabilityOverdraw = calculateLotAvailabilityForDispatch(
        lotA,
        [d1],
        { coalInputs: [{ id: 'draft-1', lotId: lotA.id, weight: 25.0, sourceName: 'Quetta Depot', purchaseRate: 22000 }] }
      );
      expect(availabilityOverdraw.availableBeforeThis).toBe(20.0);
      expect(availabilityOverdraw.draftUse).toBe(25.0);
      expect(availabilityOverdraw.remainingAfter).toBe(-5.0);
      expect(availabilityOverdraw.isOverdraw).toBe(true); // Flagged!

      // Dispatch 2 corrects allocation to 18 tons
      const availabilityValid = calculateLotAvailabilityForDispatch(
        lotA,
        [d1],
        { coalInputs: [{ id: 'draft-2', lotId: lotA.id, weight: 18.0, sourceName: 'Quetta Depot', purchaseRate: 22000 }] }
      );
      expect(availabilityValid.availableBeforeThis).toBe(20.0);
      expect(availabilityValid.remainingAfter).toBe(2.0);
      expect(availabilityValid.isOverdraw).toBe(false);
    });
  });

  // =========================================================================
  // SCENARIO 5: Multi-Material Pricing Models (GCV, Purity, Flat) & Rounding
  // =========================================================================
  describe('Scenario 5: Multi-Material Pricing Models & GCV Rounding', () => {
    it('correctly calculates purity-based pricing (ratePerPoint * receivedQuality)', () => {
      const dispatch: Dispatch = {
        id: 'disp-purity-1',
        partyId: 'buyer-iron',
        date: '2026-10-20',
        truckNumber: 'TK-FE-01',
        factoryName: 'Pakistan Steel Mills',
        itemId: 'material-iron-ore',
        itemName: 'Iron Ore Fe 60%',
        pricingModel: 'purity',
        ratePerQualityUnit: 150, // Rs. 150 per % point
        receivedQuality: 62.4, // Lab found 62.4% Fe
        targetGcv: 0,
        baseRate: 0, // In purity model, base rate is derived
        labActualGcv: 0,
        labReceivedWeight: 35.0,
        labSulphur: 0,
        coalInputs: [{ id: 'in-fe', sourceName: 'Chagai Mine', weight: 35.0, purchaseRate: 6000 }],
        overheads: { loading: 2000, freight: 40000, crush: 0, royalty: 0, other: 0 },
        status: 'settled',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const s = calculateSettlement(dispatch);
      const expectedRate = 150 * 62.4; // 9,360 Rs/ton
      expect(s.adjustedRate).toBe(expectedRate);
      expect(s.payableRate).toBe(expectedRate);
      expect(s.totalRevenue).toBe(expectedRate * 35.0); // 327,600
    });

    it('enforces pro-rata GCV adjustment with rupee vs paisa rounding rules', () => {
      const baseDispatch: Dispatch = {
        id: 'disp-gcv-prorata',
        partyId: 'buyer-power',
        date: '2026-10-21',
        truckNumber: 'TK-PW-02',
        factoryName: 'Hubco Power',
        pricingModel: 'gcv',
        targetGcv: 6000,
        baseRate: 33450,
        labActualGcv: 5820, // 5820/6000 = 0.97 -> 3% cut
        // 33450 * (1 - 5820/6000) = 33450 * 0.03 = 1003.50
        gcvAdjustment: 'prorata',
        gcvAdjustmentRounding: 'rupee',
        labReceivedWeight: 25.0,
        labSulphur: 1.0,
        coalInputs: [{ id: 'in-c', sourceName: 'Duki Yard', weight: 25.0, purchaseRate: 22000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        status: 'settled',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Rupee rounding rounds 1003.50 to 1004
      const sRupee = calculateSettlement(baseDispatch);
      expect(sRupee.gcvDeduction).toBe(1004);
      expect(sRupee.adjustedRate).toBe(33450 - 1004);

      // Paisa rounding keeps exact 1003.50
      const sPaisa = calculateSettlement({ ...baseDispatch, gcvAdjustmentRounding: 'paisa' });
      expect(sPaisa.gcvDeduction).toBe(1003.5);
      expect(sPaisa.adjustedRate).toBe(33450 - 1003.5);
    });

    it('preserves historical frozen tax snapshots even when global settings change', () => {
      const dispatch: Dispatch = {
        id: 'disp-frozen-tax',
        partyId: 'buyer-cement',
        date: '2026-09-01',
        truckNumber: 'TK-FROZEN',
        factoryName: 'Fauji Cement',
        targetGcv: 6000,
        baseRate: 30000,
        labActualGcv: 6000,
        labReceivedWeight: 20.0,
        labSulphur: 1.0,
        taxMethod: 'formula_18_5',
        taxSalesPercent: 18,
        taxIncomePercent: 5,
        coalInputs: [{ id: 'in-1', sourceName: 'Mine', weight: 20, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        status: 'settled',
        createdAt: 1000,
        updatedAt: 1000,
      };

      // Global settings are updated to 15% sales tax and 4% income tax
      const newSettings: AppSettings = {
        userName: 'Admin',
        businessName: 'Coal Co',
        phoneNumber: '0300',
        logoUrl: '',
        theme: 'light',
        taxFormulaSalesPercent: 15,
        taxFormulaIncomePercent: 4,
      };

      const s = calculateSettlement(dispatch, newSettings);
      // Tax deduction MUST use frozen 18% and 5%:
      // (30000 * 1.18) * 0.05 = 35400 * 0.05 = 1770
      expect(s.taxDeduction).toBe(1770);
      expect(s.payableRate).toBe(30000 - 1770);
    });
  });

  // =========================================================================
  // SCENARIO 6: Full Backup, Export & Restore Round-Trip with Two-Way Undo
  // =========================================================================
  describe('Scenario 6: Database Backup, Restore & Safety Snapshot Rollback', () => {
    it('strips sensitive local PIN credentials during backup export and verifies full restore roundtrip', async () => {
      // Configure app settings with local PIN lock
      await saveSettings({
        userName: 'Owner Admin',
        businessName: 'Indus Coal Traders',
        phoneNumber: '03001234567',
        logoUrl: '',
        theme: 'dark',
        appLockEnabled: true,
        pinHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        pinLength: 5,
        lockTimeout: 60,
      });

      const party: Party = {
        id: 'p-backup-1',
        name: 'Attock Cement',
        contactPerson: 'Accounts',
        phone: '0300-9988776',
        address: 'Hub',
        createdAt: Date.now(),
      };
      await saveParty(party);

      const expense: GeneralExpense = {
        id: 'exp-backup-1',
        date: '2026-10-15',
        category: 'warehouse_rent',
        amount: 85000,
        description: 'Hub depot warehouse lease',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveGeneralExpense(expense);

      // 1. Get export backup payload
      const exportBackup = await getExportBackupData();
      expect(exportBackup.parties.length).toBe(1);
      expect(exportBackup.expenses?.length).toBe(1);
      // Sensitive PIN and device lock settings MUST be stripped
      expect(exportBackup.settings.appLockEnabled).toBe(false);
      expect((exportBackup.settings as any).pinHash).toBeUndefined();
      expect((exportBackup.settings as any).lockTimeout).toBeUndefined();

      // 2. Clear all data to simulate fresh install
      await clearAllData();
      const emptyParties = await getParties();
      expect(emptyParties.length).toBe(0);

      // 3. Restore backup
      const restoreResult = await restoreBackup(exportBackup);
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.counts?.parties).toBe(1);
      expect(restoreResult.counts?.expenses).toBe(1);

      // Verify records are restored in IndexedDB
      const restoredParties = await getParties();
      expect(restoredParties[0].name).toBe('Attock Cement');
      const restoredExpenses = await getGeneralExpenses();
      expect(restoredExpenses[0].amount).toBe(85000);

      // 4. Verify safety snapshot was created and allows two-way undo rollback
      const snapshot = await getPreRestoreSnapshot();
      expect(snapshot).toBeDefined();

      const rollbackResult = await rollbackToPreRestoreSnapshot();
      expect(rollbackResult.success).toBe(true);
      // Pre-restore state was empty, so rollback restores to empty cleanly
      const rolledBackParties = await getParties();
      expect(rolledBackParties.length).toBe(0);
    });

    it('rejects corrupted or malicious backup JSON payloads before touching local storage', () => {
      // Negative amounts, invalid dates, and non-array collections must be rejected
      const maliciousPayload = {
        exportDate: '2026-10-27',
        settings: {},
        parties: [{ id: 'p1', name: 'Corrupted Party', createdAt: 100 }],
        dispatches: [],
        payments: [
          {
            id: 'pay-bad',
            partyId: 'p1',
            date: '2026-10-27',
            amount: -50000, // Negative amount!
            type: 'received',
            mode: 'bank',
            createdAt: 100,
          },
        ],
        pos: [],
      };

      const validation = validateBackupPayload(maliciousPayload);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('greater than zero');
    });
  });

  // =========================================================================
  // SCENARIO 7: Cloud Sync Delta Tracking, Deletions, and Race Conditions
  // =========================================================================
  describe('Scenario 7: Cloud Sync Delta Tracking and Conflict Resilience', () => {
    it('marks records clean only if local updatedAt matches uploaded version', async () => {
      const party: Party = {
        id: 'party-sync-race',
        name: 'Kohat Cement',
        contactPerson: 'Director',
        phone: '0300-1234567',
        address: 'Kohat',
        createdAt: 1000,
        updatedAt: 1000,
        dirty: true,
      };
      await saveParty(party);

      const syncBatch = await getLedgerForSync(true);
      expect(syncBatch.parties.length).toBe(1);

      // Simulate user editing the record WHILE upload is in flight (updatedAt advances)
      await idb.parties.update(party.id, {
        phone: '0300-7777777',
        updatedAt: 2000,
        dirty: true,
      });

      // Background cloud upload completes for version 1000
      await markRecordsClean({
        parties: [{ id: party.id, updatedAt: 1000 }],
      });

      // The dirty flag MUST REMAIN TRUE because the user made a newer edit (2000)
      const afterSync = await idb.parties.get(party.id);
      expect(afterSync?.dirty).toBe(true);
      expect(afterSync?.updatedAt).toBe(2000);
    });

    it('auto-repairs dispatches with missing factory name before sync to prevent Firestore rejection', async () => {
      const party: Party = {
        id: 'party-repair',
        name: 'Askari Cement',
        contactPerson: 'Manager',
        phone: '0300',
        address: 'Nizampur',
        createdAt: 1000,
      };
      await saveParty(party);

      const brokenDispatch: Dispatch = {
        id: 'disp-needs-repair',
        partyId: party.id,
        date: '2026-10-25',
        truckNumber: 'TK-REPAIR',
        factoryName: '', // Blank factory name!
        targetGcv: 6000,
        baseRate: 30000,
        coalInputs: [{ id: 'c1', sourceName: 'Yard', weight: 10, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 0,
        labReceivedWeight: 0,
        labSulphur: 0,
        status: 'pending',
        createdAt: 1000,
        updatedAt: 1000,
        dirty: true,
      };
      await idb.dispatches.put(brokenDispatch);

      // getLedgerForSync automatically repairs factory name from linked party
      const syncData = await getLedgerForSync(true);
      const repaired = syncData.dispatches.find((d) => d.id === 'disp-needs-repair');
      expect(repaired?.factoryName).toBe('Askari Cement');
      expect(repaired?.dirty).toBe(true);
    });
  });

  // =========================================================================
  // SCENARIO 8: Exporting & WhatsApp Sharing with Real-World Text/Unicode
  // =========================================================================
  describe('Scenario 8: Exporting & WhatsApp Sharing with Real-World Text', () => {
    it('generates WhatsApp delivery text with Urdu / special characters and accurate totals', () => {
      const lot: InventoryLot = {
        id: 'lot-inward-wa',
        supplier: 'حاجی محمد خان اینڈ سنز (Duki Pit #3)',
        date: '2026-10-26',
        truckNumber: 'TK-DUKI-786',
        billedWeight: 35.5,
        receivedWeight: 34.8,
        purchaseRate: 23500,
        landedRate: 24500,
        loadingCost: 5000,
        freightCost: 45000,
        totalValue: 34.8 * 23500,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const waText = generateSupplierDeliveryWhatsappText(
        lot,
        { id: 'p1', name: lot.supplier } as Party,
        { businessName: 'AWAN COAL TRADERS', currency: 'PKR (Rs.)' } as AppSettings
      );

      expect(waText).toContain('AWAN COAL TRADERS');
      expect(waText).toContain('TK-DUKI-786');
      expect(waText).toContain('34.80');
      expect(waText).toContain('حاجی محمد خان اینڈ سنز');
      expect(waText).toContain('Rs.');
    });

    it('builds fleet transit analysis without division-by-zero or NaN when weight is 0', () => {
      const zeroTruck: Dispatch = {
        id: 'disp-zero',
        partyId: 'party-1',
        date: '2026-10-26',
        truckNumber: 'TK-EMPTY',
        factoryName: 'Test Factory',
        targetGcv: 6000,
        baseRate: 30000,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 0,
        labReceivedWeight: 0,
        labSulphur: 0,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const fleetData = buildFleetExportData([zeroTruck], [{ id: 'party-1', name: 'Test Factory' } as any]);
      expect(fleetData.rows.length).toBe(1);
      expect(fleetData.rows[0].transitDiff).toBe(0);
      expect(fleetData.rows[0].transitLossPercentage).toBe(0);
      expect(Number.isFinite(fleetData.rows[0].transitLossPercentage)).toBe(true);
    });
  });
});
