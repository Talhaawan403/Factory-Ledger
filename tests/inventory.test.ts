import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSettlement,
  calculateLandedCost,
  calculateLotStock,
  calculateInventoryTotals,
  calculateMineStock,
  calculateMineAvailabilityForDispatch,
  auditInventoryRelations,
} from '../src/utils/calculations';
import {
  saveLot,
  getLots,
  getLot,
  deleteLot,
  saveMine,
  getMines,
  getMine,
  getMineLots,
  saveDispatch,
  deleteDispatch,
  getDispatch,
  clearAllData,
  getAllBackupData,
  restoreBackup,
  getLedgerForSync,
  markRecordsClean,
  mergeLedgerData,
} from '../src/lib/db';
import type { InventoryLot, Dispatch, Mine } from '../src/types';

describe('New Features: Pro-Rata GCV & Inventory with Landed Cost', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllData();
  });

  describe('Feature 1: Pro-Rata GCV Dynamic Pricing & Rounding', () => {
    it('calculates exact pro-rata deduction for 4,300 lab GCV with 31,800 base rate at 4,500 target', () => {
      // Reviewer Example: 31,800 at 4,500 target, lab GCV 4,300
      // Exact: 31,800 * (1 - 4300 / 4500) = 1,413.3333...
      const dispatchPaisa: Dispatch = {
        id: 'disp-prorata-1',
        partyId: 'party-1',
        date: '2026-10-08',
        truckNumber: 'TK-101',
        factoryName: 'Maple Leaf Cement',
        targetGcv: 4500,
        labActualGcv: 4300,
        baseRate: 31800,
        labReceivedWeight: 25,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        gcvAdjustment: 'prorata',
        gcvAdjustmentRounding: 'paisa',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const resultPaisa = calculateSettlement(dispatchPaisa);
      expect(resultPaisa.gcvDeduction).toBe(1413.33);
      expect(resultPaisa.adjustedRate).toBe(31800 - 1413.33);
      expect(resultPaisa.isProrata).toBe(true);

      // Whole Rupee Rounding
      const dispatchRupee: Dispatch = {
        ...dispatchPaisa,
        gcvAdjustmentRounding: 'rupee',
      };
      const resultRupee = calculateSettlement(dispatchRupee);
      expect(resultRupee.gcvDeduction).toBe(1413);
      expect(resultRupee.adjustedRate).toBe(31800 - 1413);
    });

    it('calculates pro-rata deduction for 4,200 and 4,100 lab GCV matches reviewer spec', () => {
      // 4,200: exact 2,120
      const d4200: Dispatch = {
        id: 'disp-4200',
        partyId: 'party-1',
        date: '2026-10-08',
        truckNumber: 'TK-102',
        factoryName: 'Bestway',
        targetGcv: 4500,
        labActualGcv: 4200,
        baseRate: 31800,
        labReceivedWeight: 20,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        gcvAdjustment: 'prorata',
        gcvAdjustmentRounding: 'paisa',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      expect(calculateSettlement(d4200).gcvDeduction).toBe(2120);

      // 4,100: exact 2,826.67 (paisa) or 2,827 (rupee)
      const d4100Paisa: Dispatch = {
        ...d4200,
        labActualGcv: 4100,
        gcvAdjustmentRounding: 'paisa',
      };
      expect(calculateSettlement(d4100Paisa).gcvDeduction).toBe(2826.67);

      const d4100Rupee: Dispatch = {
        ...d4200,
        labActualGcv: 4100,
        gcvAdjustmentRounding: 'rupee',
      };
      expect(calculateSettlement(d4100Rupee).gcvDeduction).toBe(2827);
    });

    it('calculates pro-rata premium when lab GCV exceeds target GCV', () => {
      const dispatchPremium: Dispatch = {
        id: 'disp-prem',
        partyId: 'party-1',
        date: '2026-10-08',
        truckNumber: 'TK-103',
        factoryName: 'Factory High GCV',
        targetGcv: 4500,
        labActualGcv: 4700,
        baseRate: 31800,
        labReceivedWeight: 30,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        gcvAdjustment: 'prorata',
        gcvAdjustmentRounding: 'paisa',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Premium = 31,800 * (4,700 / 4,500 - 1) = 31,800 * (200 / 4,500) = 1,413.33
      const result = calculateSettlement(dispatchPremium);
      expect(result.gcvDeduction).toBe(0);
      expect(result.gcvPremium).toBe(1413.33);
      expect(result.adjustedRate).toBe(31800 + 1413.33);
    });

    it('preserves backward compatibility: old dispatches without gcvAdjustment use manual adjustments', () => {
      const oldDispatch: Dispatch = {
        id: 'disp-old',
        partyId: 'party-1',
        date: '2026-10-08',
        truckNumber: 'TK-OLD',
        factoryName: 'Legacy Factory',
        targetGcv: 5000,
        labActualGcv: 4800,
        baseRate: 30000,
        manualDeduction: 500,
        manualPremium: 100,
        labReceivedWeight: 25,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = calculateSettlement(oldDispatch);
      expect(result.gcvDeduction).toBe(500);
      expect(result.adjustedRate).toBe(30000 - 500 + 100);
      expect(result.isProrata).toBe(false);
    });
  });

  describe('Feature 2: Two Weights & Landed Cost Formula', () => {
    it('calculates landed rate matching reviewer formula: (30t billed @ 20,000, 28.5t received = 21,052.63/t)', () => {
      const landed = calculateLandedCost(30, 28.5, 20000);
      expect(landed.totalCost).toBe(600000);
      expect(landed.landedRate).toBe(21052.63);
    });

    it('handles zero or equal received weights safely', () => {
      const zeroRec = calculateLandedCost(30, 0, 20000);
      expect(zeroRec.landedRate).toBe(20000);

      const exactRec = calculateLandedCost(30, 30, 20000);
      expect(exactRec.landedRate).toBe(20000);
    });
  });

  describe('Feature 3: Inventory Stock Derivation & Multi-Device Safety', () => {
    const testLot: InventoryLot = {
      id: 'lot-hashim-1',
      supplier: 'Hashim Coal Mines',
      date: '2026-10-08',
      billedWeight: 30,
      receivedWeight: 28.5,
      purchaseRate: 20000,
      landedRate: 21052.63,
      truckNumber: 'TK-SUP-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dirty: true,
    };

    it('derives initial remaining stock equal to received weight with no dispatches', () => {
      const stock = calculateLotStock(testLot, []);
      expect(stock.usedWeight).toBe(0);
      expect(stock.remainingWeight).toBe(28.5);
      expect(stock.isOverdrawn).toBe(false);
      expect(stock.capitalTiedUp).toBe(Math.round(28.5 * 21052.63));
    });

    it('automatically deducts stock dynamically when non-deleted dispatches reference lotId', () => {
      const dispatch1: Dispatch = {
        id: 'd-use-1',
        partyId: 'p-1',
        date: '2026-10-08',
        truckNumber: 'TK-OUT-1',
        factoryName: 'Maple Leaf',
        targetGcv: 5000,
        baseRate: 32000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 15,
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        coalInputs: [
          { id: 'c-1', sourceName: 'Hashim Coal', weight: 12.5, purchaseRate: 21052.63, lotId: 'lot-hashim-1' },
          { id: 'c-2', sourceName: 'Other Coal', weight: 2.5, purchaseRate: 15000 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const dispatch2: Dispatch = {
        ...dispatch1,
        id: 'd-use-2',
        coalInputs: [
          { id: 'c-3', sourceName: 'Hashim Coal', weight: 10, purchaseRate: 21052.63, lotId: 'lot-hashim-1' },
        ],
      };

      // Dispatches used: 12.5 + 10 = 22.5 tons
      const stock = calculateLotStock(testLot, [dispatch1, dispatch2]);
      expect(stock.usedWeight).toBe(22.5);
      expect(stock.remainingWeight).toBe(6); // 28.5 - 22.5 = 6.0
      expect(stock.isOverdrawn).toBe(false);
    });

    it('restores stock automatically when a dispatch is soft-deleted', () => {
      const dispatchActive: Dispatch = {
        id: 'd-act',
        partyId: 'p-1',
        date: '2026-10-08',
        truckNumber: 'TK-1',
        factoryName: 'Factory A',
        targetGcv: 5000,
        baseRate: 30000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 10,
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        coalInputs: [
          { id: 'ci-1', sourceName: 'Hashim', weight: 10, purchaseRate: 21052.63, lotId: 'lot-hashim-1' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const dispatchDeleted: Dispatch = {
        ...dispatchActive,
        id: 'd-del',
        deleted: true,
        coalInputs: [
          { id: 'ci-2', sourceName: 'Hashim', weight: 15, purchaseRate: 21052.63, lotId: 'lot-hashim-1' },
        ],
      };

      // Deleted dispatch weight (15t) is ignored
      const stock = calculateLotStock(testLot, [dispatchActive, dispatchDeleted]);
      expect(stock.usedWeight).toBe(10);
      expect(stock.remainingWeight).toBe(18.5);
    });

    it('flags overdrawn stock when dispatches exceed received lot weight', () => {
      const heavyDispatch: Dispatch = {
        id: 'd-heavy',
        partyId: 'p-1',
        date: '2026-10-08',
        truckNumber: 'TK-HEAVY',
        factoryName: 'Factory Heavy',
        targetGcv: 5000,
        baseRate: 30000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 35,
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        coalInputs: [
          { id: 'ci-over', sourceName: 'Hashim', weight: 32, purchaseRate: 21052.63, lotId: 'lot-hashim-1' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 28.5 - 32 = -3.5 tons
      const stock = calculateLotStock(testLot, [heavyDispatch]);
      expect(stock.usedWeight).toBe(32);
      expect(stock.remainingWeight).toBe(-3.5);
      expect(stock.isOverdrawn).toBe(true);
      expect(stock.capitalTiedUp).toBe(0);
    });

    it('calculates inventory totals across multiple lots and suppliers', () => {
      const lotA = { ...testLot, id: 'lot-a', receivedWeight: 20, landedRate: 20000 };
      const lotB = { ...testLot, id: 'lot-b', supplier: 'Quetta Mines', receivedWeight: 30, landedRate: 25000 };

      const totals = calculateInventoryTotals([lotA, lotB], []);
      expect(totals.totalReceivedTons).toBe(50);
      expect(totals.totalRemainingTons).toBe(50);
      expect(totals.totalCapitalTiedUp).toBe(20 * 20000 + 30 * 25000);
      expect(totals.suppliers).toHaveLength(2);
    });
  });

  describe('Feature 4: IndexedDB CRUD, Backup & Cloud Sync Integration for Lots', () => {
    it('saves, retrieves, and soft-deletes lots in IndexedDB with dirty flag', async () => {
      const lot: InventoryLot = {
        id: 'lot-idb-1',
        supplier: 'Balochistan Minerals',
        date: '2026-10-08',
        billedWeight: 50,
        receivedWeight: 48,
        purchaseRate: 22000,
        landedRate: 22916.67,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveLot(lot);
      const all = await getLots();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('lot-idb-1');
      expect(all[0].dirty).toBe(true);

      const single = await getLot('lot-idb-1');
      expect(single?.supplier).toBe('Balochistan Minerals');

      // Soft delete
      await deleteLot('lot-idb-1');
      const afterDel = await getLots();
      expect(afterDel).toHaveLength(0);

      // Verify dirty tombstoned record is queued for cloud sync
      const syncQueue = await getLedgerForSync(true);
      expect(syncQueue.lots.some((l) => l.id === 'lot-idb-1' && l.deleted)).toBe(true);
    });

    it('marks synced lots clean only if updatedAt matches (Issue 31 guard)', async () => {
      const lot: InventoryLot = {
        id: 'lot-sync-1',
        supplier: 'Thar Lignite',
        date: '2026-10-08',
        billedWeight: 40,
        receivedWeight: 39,
        purchaseRate: 18000,
        landedRate: 18461.54,
        createdAt: 1000,
        updatedAt: 1000,
      };

      await saveLot(lot);
      const dirtyBefore = await getLedgerForSync(true);
      const savedUpdatedAt = dirtyBefore.lots[0].updatedAt;

      // Mark clean with matching timestamp
      await markRecordsClean({ lots: [{ id: 'lot-sync-1', updatedAt: savedUpdatedAt }] });
      const dirtyAfter = await getLedgerForSync(true);
      expect(dirtyAfter.lots).toHaveLength(0);
    });

    it('includes lots in backup payload and restores lots atomically', async () => {
      const lot: InventoryLot = {
        id: 'lot-bak-1',
        supplier: 'Frontier Coal',
        date: '2026-10-08',
        billedWeight: 35,
        receivedWeight: 34,
        purchaseRate: 25000,
        landedRate: 25735.29,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await saveLot(lot);
      const backup = await getAllBackupData();
      expect(backup.lots).toHaveLength(1);

      await clearAllData();
      const empty = await getLots();
      expect(empty).toHaveLength(0);

      const restoreRes = await restoreBackup(backup);
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.counts?.lots).toBe(1);

      const restored = await getLots();
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe('lot-bak-1');
    });

    it('merges lots bidirectionally with Last-Write-Wins and tombstones', () => {
      const localLots: InventoryLot[] = [
        {
          id: 'lot-merge-1',
          supplier: 'Supplier Local',
          date: '2026-10-08',
          billedWeight: 20,
          receivedWeight: 19,
          purchaseRate: 20000,
          landedRate: 21052.63,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];

      const cloudLots: InventoryLot[] = [
        {
          id: 'lot-merge-1',
          supplier: 'Supplier Remote (Newer)',
          date: '2026-10-08',
          billedWeight: 20,
          receivedWeight: 19,
          purchaseRate: 20000,
          landedRate: 21052.63,
          createdAt: 1000,
          updatedAt: 2000,
        },
        {
          id: 'lot-merge-2',
          supplier: 'Supplier Only On Cloud',
          date: '2026-10-08',
          billedWeight: 15,
          receivedWeight: 15,
          purchaseRate: 19000,
          landedRate: 19000,
          createdAt: 1500,
          updatedAt: 1500,
        },
      ];

      const { merged, hasLocalChanges } = mergeLedgerData(
        {
          parties: [], dispatches: [], payments: [], pos: [], lots: localLots, settings: {} as any,
          exportDate: ''
        },
        {
          parties: [], dispatches: [], payments: [], pos: [], lots: cloudLots, settings: {} as any,
          exportDate: ''
        }
      );

      expect(hasLocalChanges).toBe(true);
      expect(merged.lots).toHaveLength(2);
      const mergedL1 = merged.lots?.find((l) => l.id === 'lot-merge-1');
      expect(mergedL1?.supplier).toBe('Supplier Remote (Newer)');
    });
  });

  describe('Feature 3: Mine Ledgers, Stock Entries & Blending Integration', () => {
    it('creates and retrieves a mine ledger with per-ton rate', async () => {
      const mine: Mine = {
        id: 'mine-1',
        name: 'Duki Coal Mine',
        ratePerTon: 21000,
        location: 'Yard 2 - Plot B',
        createdAt: 0,
        updatedAt: 0
      };
      await saveMine(mine);

      const retrieved = await getMine('mine-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Duki Coal Mine');
      expect(retrieved?.ratePerTon).toBe(21000);
      expect(retrieved?.location).toBe('Yard 2 - Plot B');

      const allMines = await getMines();
      expect(allMines).toHaveLength(1);
    });

    it('adds stock entries to mine with auto-calculated total value (tons * rate)', async () => {
      const mine: Mine = {
        id: 'mine-duki',
        name: 'Duki Mine',
        ratePerTon: 22000,
        createdAt: 0,
        updatedAt: 0
      };
      await saveMine(mine);

      // Entry 1: 10 tons -> 10 * 22,000 = 220,000
      const stockEntry1: InventoryLot = {
        id: 'stock-1',
        mineId: 'mine-duki',
        mineName: 'Duki Mine',
        boughtFrom: 'Chakwal Traders',
        storedAt: 'Yard A',
        tonnage: 10,
        ratePerTon: 22000,
        totalValue: 10 * 22000,
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 22000,
        landedRate: 22000,
        supplier: 'Chakwal Traders',
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(stockEntry1);

      // Entry 2: 25 tons -> 25 * 22,000 = 550,000
      const stockEntry2: InventoryLot = {
        id: 'stock-2',
        mineId: 'mine-duki',
        mineName: 'Duki Mine',
        boughtFrom: 'Pit Contractor',
        storedAt: 'Yard B',
        tonnage: 25,
        ratePerTon: 22000,
        totalValue: 25 * 22000,
        billedWeight: 25,
        receivedWeight: 25,
        purchaseRate: 22000,
        landedRate: 22000,
        supplier: 'Pit Contractor',
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(stockEntry2);

      const mineLots = await getMineLots('mine-duki');
      expect(mineLots).toHaveLength(2);

      // Verify stock calculation without dispatches
      const stock = calculateMineStock(mine, mineLots, []);
      expect(stock.totalInflowTons).toBe(35);
      expect(stock.totalInflowValue).toBe(770000);
      expect(stock.totalOutflowTons).toBe(0);
      expect(stock.remainingTons).toBe(35);
      expect(stock.remainingValue).toBe(35 * 22000);
      expect(stock.status).toBe('in_stock');
    });

    it('calculates yard stock remaining and value when blended into dispatches', async () => {
      const mine: Mine = {
        id: 'mine-khost',
        name: 'Khost Pit 4',
        ratePerTon: 20000,
        createdAt: 0,
        updatedAt: 0
      };
      await saveMine(mine);

      const lot: InventoryLot = {
        id: 'lot-khost-1',
        mineId: 'mine-khost',
        tonnage: 50,
        ratePerTon: 20000,
        totalValue: 1000000,
        billedWeight: 50,
        receivedWeight: 50,
        purchaseRate: 20000,
        landedRate: 20000,
        supplier: 'Khost Pit 4',
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      // Dispatch consuming 18.5 tons from this mine
      const dispatch: Dispatch = {
        id: 'disp-blend-1',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'TK-889',
        targetGcv: 6000,
        baseRate: 30000,
        coalInputs: [
          {
            id: 'ci-1',
            mineId: 'mine-khost',
            sourceName: 'Khost Pit 4',
            weight: 18.5,
            purchaseRate: 20000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        factoryName: '',
        labActualGcv: 0,
        labSulphur: 0,
        labReceivedWeight: 0,
        createdAt: 0,
        updatedAt: 0
      };

      const stock = calculateMineStock(mine, [lot], [dispatch]);
      expect(stock.totalInflowTons).toBe(50);
      expect(stock.totalOutflowTons).toBe(18.5);
      expect(stock.remainingTons).toBe(31.5);
      expect(stock.remainingValue).toBe(31.5 * 20000);
      expect(stock.dispatchesCount).toBe(1);
    });

    it('calculates total value and landed rate with loading charges and freight fare', async () => {
      // User Example: 10 tons @ 25,000/ton, loading 5,000, fare 20,000
      // Coal cost = 250,000. Total = 250,000 + 5,000 + 20,000 = 275,000.
      // Landed rate for 10 tons = 27,500/ton.
      const lot: InventoryLot = {
        id: 'lot-loading-fare',
        mineId: 'mine-1',
        mineName: 'Islam C',
        boughtFrom: 'Talha',
        supplier: 'Talha',
        tonnage: 10,
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 25000,
        loadingCost: 5000,
        freightCost: 20000,
        date: '2026-10-09',
        landedRate: 0,
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      const saved = await getLot('lot-loading-fare');
      expect(saved).toBeDefined();
      expect(saved?.totalValue).toBe(275000);
      expect(saved?.landedRate).toBe(27500);
      expect(saved?.boughtFrom).toBe('Talha');

      // Test with received quantity shortage (e.g. 9.8 tons received)
      const lotShortage: InventoryLot = {
        ...lot,
        id: 'lot-shortage',
        receivedWeight: 9.8,
      };
      await saveLot(lotShortage);
      const savedShortage = await getLot('lot-shortage');
      expect(savedShortage?.totalValue).toBe(275000);
      // 275000 / 9.8 = 28061.22
      expect(savedShortage?.landedRate).toBeCloseTo(28061.22, 1);
    });

    it('values mine inventory from received tons and each entry landed rate, not the mine default', () => {
      const mine: Mine = {
        id: 'mine-landed-value',
        name: 'Landed Value Mine',
        ratePerTon: 25000,
        createdAt: 1,
        updatedAt: 1,
      };
      const lot: InventoryLot = {
        id: 'lot-landed-value',
        mineId: mine.id,
        supplier: 'Supplier A',
        date: '2026-10-09',
        tonnage: 10,
        billedWeight: 10,
        receivedWeight: 9.8,
        purchaseRate: 25000,
        loadingCost: 5000,
        freightCost: 20000,
        totalValue: 275000,
        landedRate: 28061.22,
        createdAt: 1,
        updatedAt: 1,
      };

      const stock = calculateMineStock(mine, [lot], []);
      expect(stock.totalInflowTons).toBe(9.8);
      expect(stock.remainingTons).toBe(9.8);
      expect(stock.totalInflowValue).toBe(275000);
      expect(stock.remainingValue).toBe(275000);
    });

    it('allocates one stock entry across dispatches until its received weight is exhausted', async () => {
      const lot: InventoryLot = {
        id: 'lot-partial-allocation',
        mineId: 'mine-partial',
        supplier: 'Partial Supplier',
        date: '2026-10-09',
        billedWeight: 20,
        receivedWeight: 20,
        purchaseRate: 25000,
        landedRate: 25000,
        createdAt: 1,
        updatedAt: 1,
      };
      await saveLot(lot);

      const first: Dispatch = {
        id: 'dispatch-partial-1',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'EX-101',
        factoryName: 'Factory One',
        targetGcv: 5000,
        baseRate: 35000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 15,
        coalInputs: [{ id: 'ci-partial-1', lotId: lot.id, mineId: lot.mineId, sourceName: 'Partial', weight: 15, purchaseRate: 25000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: 1,
        updatedAt: 1,
      };
      await saveDispatch(first);

      const second: Dispatch = {
        ...first,
        id: 'dispatch-partial-2',
        truckNumber: 'EX-202',
        labReceivedWeight: 5,
        coalInputs: [{ ...first.coalInputs[0], id: 'ci-partial-2', weight: 5 }],
      };
      await saveDispatch(second);

      const savedLot = await getLot(lot.id);
      const stock = calculateLotStock(savedLot!, [first, second]);
      expect(stock.usedWeight).toBe(20);
      expect(stock.remainingWeight).toBe(0);
      expect(savedLot?.usedInDispatchId).toBe(second.id);

      const third: Dispatch = {
        ...first,
        id: 'dispatch-partial-3',
        truckNumber: 'EX-303',
        labReceivedWeight: 1,
        coalInputs: [{ ...first.coalInputs[0], id: 'ci-partial-3', weight: 1 }],
      };
      await expect(saveDispatch(third)).rejects.toThrow(/only 0.00 tons available/);
      expect(await getDispatch(third.id)).toBeNull();

      await deleteDispatch(second.id);
      const reopenedLot = await getLot(lot.id);
      expect(reopenedLot?.usedInDispatchId).toBe(first.id);
      expect(calculateLotStock(reopenedLot!, [first]).remainingWeight).toBe(5);
    });

    it('allows partial weight edits while keeping the landed-rate snapshot locked', async () => {
      const lot: InventoryLot = {
        id: 'lot-snapshot-guard',
        supplier: 'Snapshot Supplier',
        date: '2026-10-09',
        billedWeight: 10,
        receivedWeight: 9.8,
        purchaseRate: 31000,
        loadingCost: 5000,
        freightCost: 20000,
        landedRate: 34183.67,
        createdAt: 1,
        updatedAt: 1,
      };
      await saveLot(lot);

      const dispatch: Dispatch = {
        id: 'dispatch-snapshot-guard',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'SG-101',
        factoryName: 'Factory One',
        targetGcv: 5000,
        baseRate: 40000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 9.8,
        coalInputs: [{
          id: 'ci-snapshot-guard',
          lotId: lot.id,
          sourceName: 'Snapshot Supplier',
          weight: 9,
          purchaseRate: 34183.67,
        }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: 1,
        updatedAt: 1,
      };

      dispatch.coalInputs[0].purchaseRate = 31000;
      await expect(saveDispatch(dispatch)).rejects.toThrow(/rate has changed/);

      dispatch.coalInputs[0].purchaseRate = 34183.67;
      await saveDispatch(dispatch);

      dispatch.coalInputs[0].weight = 9.5;
      await expect(saveDispatch(dispatch)).resolves.not.toThrow();

      dispatch.coalInputs[0].purchaseRate = 35000;
      await expect(saveDispatch(dispatch)).rejects.toThrow(/landed-rate snapshot.*locked/i);

      dispatch.coalInputs[0].purchaseRate = 34183.67;
      dispatch.coalInputs[0].weight = 10;
      await expect(saveDispatch(dispatch)).rejects.toThrow(/only 9.80 tons available/);
    });

    it('rejects negative loading or freight amounts before persistence', async () => {
      const invalidLot: InventoryLot = {
        id: 'lot-negative-cost',
        supplier: 'Supplier A',
        date: '2026-10-09',
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 25000,
        loadingCost: -5000,
        landedRate: 24500,
        createdAt: 1,
        updatedAt: 1,
      };
      await expect(saveLot(invalidLot)).rejects.toThrow(/cannot be negative/);
      expect(await getLot(invalidLot.id)).toBeNull();
    });

    it('allows multiple allocations but reports their combined overdraw', () => {
      const lot: InventoryLot = {
        id: 'lot-conflict-audit',
        supplier: 'Conflict Supplier',
        date: '2026-10-09',
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 20000,
        landedRate: 20000,
        usedInDispatchId: 'dispatch-conflict-a',
        createdAt: 1,
        updatedAt: 1,
      };
      const makeConflictDispatch = (id: string, truckNumber: string, weight: number): Dispatch => ({
        id,
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber,
        factoryName: 'Factory',
        targetGcv: 5000,
        baseRate: 30000,
        labActualGcv: 5000,
        labSulphur: 1,
        labReceivedWeight: 10,
        coalInputs: [{ id: `ci-${id}`, lotId: lot.id, sourceName: 'Conflict Supplier', weight, purchaseRate: 20000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: 1,
        updatedAt: 1,
      });

      const validIssues = auditInventoryRelations(
        [lot],
        [makeConflictDispatch('dispatch-conflict-a', 'CF-A', 4), makeConflictDispatch('dispatch-conflict-b', 'CF-B', 6)]
      );
      expect(validIssues).toHaveLength(0);

      const overdrawnIssues = auditInventoryRelations(
        [lot],
        [makeConflictDispatch('dispatch-conflict-a', 'CF-A', 6), makeConflictDispatch('dispatch-conflict-b', 'CF-B', 6)]
      );
      expect(overdrawnIssues.some((issue) => issue.kind === 'overdrawn')).toBe(true);
    });

    it('tracks linked dispatch and preserves usedInDispatch metadata', async () => {
      const lot: InventoryLot = {
        id: 'lot-dispatch-linked',
        mineId: 'mine-1',
        boughtFrom: 'Inam Shb',
        supplier: 'Inam Shb',
        tonnage: 15,
        billedWeight: 15,
        receivedWeight: 15,
        purchaseRate: 20000,
        usedInDispatchId: 'disp-tkx-418',
        usedInDispatchTruck: 'TKX-418',
        usedInPartyName: 'Maple Leaf Cement',
        usedInDate: '2026-10-09',
        date: '2026-10-09',
        landedRate: 0,
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      const saved = await getLot('lot-dispatch-linked');
      expect(saved?.usedInDispatchId).toBe('disp-tkx-418');
      expect(saved?.usedInDispatchTruck).toBe('TKX-418');
      expect(saved?.usedInPartyName).toBe('Maple Leaf Cement');
    });

    it('preserves mines during backup and restore', async () => {
      const mine: Mine = {
        id: 'mine-backup',
        name: 'Chamalang Mine',
        ratePerTon: 25000,
        location: 'Plot 7',
        createdAt: 0,
        updatedAt: 0
      };
      await saveMine(mine);

      const backup = await getAllBackupData();
      expect(backup.mines).toBeDefined();
      expect(backup.mines?.some((m) => m.id === 'mine-backup')).toBe(true);

      await clearAllData();
      const emptyMines = await getMines();
      expect(emptyMines).toHaveLength(0);

      await restoreBackup(backup);
      const restoredMines = await getMines();
      expect(restoredMines).toHaveLength(1);
      expect(restoredMines[0].name).toBe('Chamalang Mine');
      expect(restoredMines[0].ratePerTon).toBe(25000);
    });

    it('locks used stock-entry financials and preserves the historical dispatch snapshot', async () => {
      const lot: InventoryLot = {
        id: 'lot-cascade-test',
        mineId: 'mine-1',
        mineName: 'Islam C',
        boughtFrom: 'Hamza',
        supplier: 'Hamza',
        tonnage: 10,
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 30000,
        landedRate: 30000,
        totalValue: 300000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      const dispatch: Dispatch = {
        id: 'disp-cascade-test',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'TKX-999',
        factoryName: 'Maple Leaf Cement',
        targetGcv: 4500,
        baseRate: 40000,
        labActualGcv: 4500,
        labReceivedWeight: 10,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-1',
            lotId: 'lot-cascade-test',
            mineId: 'mine-1',
            sourceName: 'Islam C - Hamza',
            weight: 10,
            purchaseRate: 30000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(dispatch);

      const initialSettlement = calculateSettlement(dispatch);
      expect(initialSettlement.totalCost).toBe(300000); // 10t * 30000
      expect(initialSettlement.netProfit).toBe(100000); // 400000 revenue - 300000 cost

      // Repricing the source voucher would silently rewrite historical profit.
      const updatedLot: InventoryLot = {
        ...lot,
        purchaseRate: 31000,
        landedRate: 31000,
        totalValue: 310000,
      };
      await expect(saveLot(updatedLot)).rejects.toThrow(/locked by Dispatch #TKX-999/);

      // The linked dispatch retains the cost snapshot captured when it was saved.
      const syncedDispatch = await getDispatch('disp-cascade-test');
      expect(syncedDispatch).not.toBeNull();
      expect(syncedDispatch?.coalInputs[0].purchaseRate).toBe(30000);

      const syncedSettlement = calculateSettlement(syncedDispatch!);
      expect(syncedSettlement.totalCost).toBe(300000);
      expect(syncedSettlement.netProfit).toBe(100000);
    });

    it('prevents deleting lot if it is actively used in a dispatch', async () => {
      const lot: InventoryLot = {
        id: 'lot-delete-protect',
        mineId: 'mine-1',
        supplier: 'Vendor A',
        tonnage: 20,
        billedWeight: 20,
        receivedWeight: 20,
        purchaseRate: 25000,
        landedRate: 25000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      const dispatch: Dispatch = {
        id: 'disp-delete-protect',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'LES-777',
        factoryName: 'Bestway',
        targetGcv: 4500,
        baseRate: 35000,
        labActualGcv: 4500,
        labReceivedWeight: 20,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-protect',
            lotId: 'lot-delete-protect',
            sourceName: 'Mine - Vendor A',
            weight: 20,
            purchaseRate: 25000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(dispatch);

      await expect(deleteLot('lot-delete-protect')).rejects.toThrow(
        /Cannot delete this stock entry because it is actively used in Dispatch #LES-777/
      );
    });

    it('automatically links lot on saveDispatch and updates metadata when dispatch truck changes', async () => {
      const lot: InventoryLot = {
        id: 'lot-auto-link',
        mineId: 'mine-1',
        supplier: 'Kamran',
        tonnage: 30,
        billedWeight: 30,
        receivedWeight: 30,
        purchaseRate: 21000,
        landedRate: 21000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      // Save dispatch using lot-auto-link
      const dispatch: Dispatch = {
        id: 'disp-auto-link',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'TK-100',
        factoryName: 'Maple Leaf Cement',
        targetGcv: 5000,
        baseRate: 30000,
        labActualGcv: 5000,
        labReceivedWeight: 30,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-auto',
            lotId: 'lot-auto-link',
            sourceName: 'Mine - Kamran',
            weight: 30,
            purchaseRate: 21000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(dispatch);

      let savedLot = await getLot('lot-auto-link');
      expect(savedLot?.usedInDispatchId).toBe('disp-auto-link');
      expect(savedLot?.usedInDispatchTruck).toBe('TK-100');
      expect(savedLot?.usedInPartyName).toBe('Maple Leaf Cement');

      // Edit dispatch: user changes truck from TK-100 to TK-999
      await saveDispatch({
        ...dispatch,
        truckNumber: 'TK-999',
      });

      savedLot = await getLot('lot-auto-link');
      expect(savedLot?.usedInDispatchTruck).toBe('TK-999');
    });

    it('unlinks lot when dispatch is deleted via deleteDispatch', async () => {
      const lot: InventoryLot = {
        id: 'lot-unlink-delete',
        mineId: 'mine-1',
        supplier: 'Subhan',
        tonnage: 25,
        billedWeight: 25,
        receivedWeight: 25,
        purchaseRate: 22000,
        landedRate: 22000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot);

      const dispatch: Dispatch = {
        id: 'disp-to-be-deleted',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'FD-555',
        factoryName: 'Pioneer Cement',
        targetGcv: 5000,
        baseRate: 32000,
        labActualGcv: 5000,
        labReceivedWeight: 25,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-del',
            lotId: 'lot-unlink-delete',
            sourceName: 'Mine - Subhan',
            weight: 25,
            purchaseRate: 22000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(dispatch);

      let linkedLot = await getLot('lot-unlink-delete');
      expect(linkedLot?.usedInDispatchId).toBe('disp-to-be-deleted');

      // Delete the dispatch
      await deleteDispatch('disp-to-be-deleted');

      // Lot must be cleanly unlinked!
      linkedLot = await getLot('lot-unlink-delete');
      expect(linkedLot?.usedInDispatchId).toBeUndefined();
      expect(linkedLot?.usedInDispatchTruck).toBeUndefined();

      // Now deleting lot should succeed without errors
      await expect(deleteLot('lot-unlink-delete')).resolves.not.toThrow();
    });

    it('unlinks old lot and links new lot when dispatch recipe switches lots', async () => {
      const lotA: InventoryLot = {
        id: 'lot-switch-a',
        mineId: 'mine-1',
        supplier: 'Source A',
        tonnage: 20,
        billedWeight: 20,
        receivedWeight: 20,
        purchaseRate: 20000,
        landedRate: 20000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      const lotB: InventoryLot = {
        id: 'lot-switch-b',
        mineId: 'mine-2',
        supplier: 'Source B',
        tonnage: 20,
        billedWeight: 20,
        receivedWeight: 20,
        purchaseRate: 24000,
        landedRate: 24000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lotA);
      await saveLot(lotB);

      // Create dispatch with lotA
      const dispatch: Dispatch = {
        id: 'disp-switch-test',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'LHR-888',
        factoryName: 'Fauji Cement',
        targetGcv: 4500,
        baseRate: 35000,
        labActualGcv: 4500,
        labReceivedWeight: 20,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-a',
            lotId: 'lot-switch-a',
            sourceName: 'Mine - Source A',
            weight: 20,
            purchaseRate: 20000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(dispatch);

      expect((await getLot('lot-switch-a'))?.usedInDispatchId).toBe('disp-switch-test');
      expect((await getLot('lot-switch-b'))?.usedInDispatchId).toBeUndefined();

      // User edits dispatch, removes lotA and uses lotB instead
      await saveDispatch({
        ...dispatch,
        coalInputs: [
          {
            id: 'ci-b',
            lotId: 'lot-switch-b',
            sourceName: 'Mine - Source B',
            weight: 20,
            purchaseRate: 24000,
          },
        ],
      });

      // lotA is now unlinked, lotB is linked
      expect((await getLot('lot-switch-a'))?.usedInDispatchId).toBeUndefined();
      expect((await getLot('lot-switch-b'))?.usedInDispatchId).toBe('disp-switch-test');
      expect((await getLot('lot-switch-b'))?.usedInDispatchTruck).toBe('LHR-888');
    });

    it('handles multi-source blending with multiple linked lots cleanly', async () => {
      const lot1: InventoryLot = {
        id: 'lot-multi-1',
        mineId: 'mine-1',
        supplier: 'Pit 1',
        tonnage: 15,
        billedWeight: 15,
        receivedWeight: 15,
        purchaseRate: 20000,
        landedRate: 20000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      const lot2: InventoryLot = {
        id: 'lot-multi-2',
        mineId: 'mine-2',
        supplier: 'Pit 2',
        tonnage: 10,
        billedWeight: 10,
        receivedWeight: 10,
        purchaseRate: 25000,
        landedRate: 25000,
        date: '2026-10-09',
        createdAt: 0,
        updatedAt: 0
      };
      await saveLot(lot1);
      await saveLot(lot2);

      const blendedDispatch: Dispatch = {
        id: 'disp-multi-blend',
        partyId: 'party-1',
        date: '2026-10-09',
        truckNumber: 'ML-700',
        factoryName: 'Attock Cement',
        targetGcv: 5500,
        baseRate: 40000,
        labActualGcv: 5500,
        labReceivedWeight: 25,
        labSulphur: 1,
        coalInputs: [
          {
            id: 'ci-m1',
            lotId: 'lot-multi-1',
            sourceName: 'Mine 1 - Pit 1',
            weight: 15,
            purchaseRate: 20000,
          },
          {
            id: 'ci-m2',
            lotId: 'lot-multi-2',
            sourceName: 'Mine 2 - Pit 2',
            weight: 10,
            purchaseRate: 25000,
          },
        ],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveDispatch(blendedDispatch);

      // Both lots must be linked
      expect((await getLot('lot-multi-1'))?.usedInDispatchId).toBe('disp-multi-blend');
      expect((await getLot('lot-multi-2'))?.usedInDispatchId).toBe('disp-multi-blend');

      // Linked vouchers remain immutable until their dispatch relationship is removed.
      const repricedLot1: InventoryLot = {
        ...lot1,
        purchaseRate: 22000,
        landedRate: 22000,
      };
      await expect(saveLot(repricedLot1)).rejects.toThrow(/locked by Dispatch #ML-700/);

      const updatedDispatch = await getDispatch('disp-multi-blend');
      expect(updatedDispatch?.coalInputs[0].purchaseRate).toBe(20000);
      expect(updatedDispatch?.coalInputs[1].purchaseRate).toBe(25000);

      // Total remains (15 * 20,000) + (10 * 25,000) = 550,000.
      const settlement = calculateSettlement(updatedDispatch!);
      expect(settlement.totalCost).toBe(550000);

      // Delete dispatch -> both lots unlinked
      await deleteDispatch('disp-multi-blend');
      expect((await getLot('lot-multi-1'))?.usedInDispatchId).toBeUndefined();
      expect((await getLot('lot-multi-2'))?.usedInDispatchId).toBeUndefined();

      // Once unlinked, correcting the stock voucher is allowed.
      await expect(saveLot(repricedLot1)).resolves.not.toThrow();
      expect((await getLot('lot-multi-1'))?.purchaseRate).toBe(22000);
    });
  });
});

// ---------------------------------------------------------------------------
// Issue 38 + 39: Lot Availability for Edit vs New Dispatch (T32 + T33)
// ---------------------------------------------------------------------------
import { calculateLotAvailabilityForDispatch } from '../src/utils/calculations';

describe('Issues 38 & 39: Lot Availability in Dispatch Context (T32 & T33)', () => {
  const makeLot = (id: string, receivedWeight: number): InventoryLot => ({
    id,
    mineId: 'mine-avail',
    supplier: 'Test Supplier',
    date: '2026-10-01',
    billedWeight: receivedWeight,
    receivedWeight,
    purchaseRate: 20000,
    landedRate: 20000,
    createdAt: 1000,
    updatedAt: 1000,
  });

  const makeDispatch = (id: string, lotId: string, weight: number): Dispatch => ({
    id,
    partyId: 'party-avail',
    date: '2026-10-09',
    truckNumber: `TK-${id}`,
    baseRate: 30000,
    labReceivedWeight: weight,
    taxMethod: 'manual' as const,
    manualTax: 0,
    coalInputs: [{ id: `ci-${id}`, lotId, sourceName: 'Test', weight, purchaseRate: 20000 }],
    overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    factoryName: '',
    targetGcv: 0,
    labActualGcv: 0,
    labSulphur: 0
  });

  it('T32a: unchanged edit — opening saved dispatch (10t from 15t lot) shows 15t available, no warning', () => {
    const lot = makeLot('lot-avail-a', 15);
    // The saved dispatch uses 10t; it's the same dispatch being "edited"
    const savedDispatch = makeDispatch('disp-saved', 'lot-avail-a', 10);
    const allDispatches = [savedDispatch];

    const avail = calculateLotAvailabilityForDispatch(lot, allDispatches, savedDispatch);
    expect(avail.availableBeforeThis).toBeCloseTo(15, 2);
    expect(avail.remainingAfter).toBeCloseTo(5, 2);
    expect(avail.isOverdraw).toBe(false);
  });

  it('T32b: edit within lot — raising weight to 12t from 15t lot should not warn', () => {
    const lot = makeLot('lot-avail-b', 15);
    const savedDispatch = makeDispatch('disp-saved-b', 'lot-avail-b', 10);
    // editing: weight changed to 12
    const editedDraft: Dispatch = {
      ...savedDispatch,
      labReceivedWeight: 12,
      coalInputs: [{ id: 'ci-b', lotId: 'lot-avail-b', sourceName: 'Test', weight: 12, purchaseRate: 20000 }],
    };
    const avail = calculateLotAvailabilityForDispatch(lot, [savedDispatch], editedDraft);
    expect(avail.availableBeforeThis).toBeCloseTo(15, 2);
    expect(avail.remainingAfter).toBeCloseTo(3, 2);
    expect(avail.isOverdraw).toBe(false);
  });

  it('T32c: real overdraw — other dispatch uses 8t, draft uses 10t from 15t lot → overdrawn by 3t', () => {
    const lot = makeLot('lot-avail-c', 15);
    const otherDispatch = makeDispatch('disp-other', 'lot-avail-c', 8);
    const draft = makeDispatch('disp-new', 'lot-avail-c', 10);
    draft.id = 'disp-new'; // different from otherDispatch

    const avail = calculateLotAvailabilityForDispatch(lot, [otherDispatch, draft], draft);
    expect(avail.availableBeforeThis).toBeCloseTo(7, 2); // 15 - 8
    expect(avail.remainingAfter).toBeCloseTo(-3, 2); // 7 - 10
    expect(avail.isOverdraw).toBe(true);
  });

  it('T32d: new dispatch — other uses 10t, new draft uses 6t from 15t lot → overdrawn by 1t', () => {
    const lot = makeLot('lot-avail-d', 15);
    const otherDispatch = makeDispatch('disp-other-d', 'lot-avail-d', 10);
    const draft = makeDispatch('disp-new-d', 'lot-avail-d', 6);

    const avail = calculateLotAvailabilityForDispatch(lot, [otherDispatch], draft);
    expect(avail.availableBeforeThis).toBeCloseTo(5, 2); // 15 - 10
    expect(avail.remainingAfter).toBeCloseTo(-1, 2); // 5 - 6
    expect(avail.isOverdraw).toBe(true);
  });

  it('T33: two rows from the same 10t lot (8t + 8t) are summed → overdrawn by 6t', () => {
    const lot = makeLot('lot-avail-e', 10);
    const draft: Dispatch = {
      id: 'disp-two-rows',
      partyId: 'party-avail',
      date: '2026-10-09',
      truckNumber: 'TK-TWO',
      baseRate: 30000,
      labReceivedWeight: 16,
      taxMethod: 'manual' as const,
      manualTax: 0,
      coalInputs: [
        { id: 'ci-row1', lotId: 'lot-avail-e', sourceName: 'Row 1', weight: 8, purchaseRate: 20000 },
        { id: 'ci-row2', lotId: 'lot-avail-e', sourceName: 'Row 2', weight: 8, purchaseRate: 20000 },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      factoryName: '',
      targetGcv: 0,
      labActualGcv: 0,
      labSulphur: 0
    };

    const avail = calculateLotAvailabilityForDispatch(lot, [], draft);
    expect(avail.availableBeforeThis).toBeCloseTo(10, 2);
    expect(avail.draftUse).toBeCloseTo(16, 2); // both rows summed
    expect(avail.remainingAfter).toBeCloseTo(-6, 2);
    expect(avail.isOverdraw).toBe(true);
  });

  it('excludes the current dispatch from legacy direct-mine availability', () => {
    const mine: Mine = {
      id: 'mine-direct-edit',
      name: 'Direct Mine',
      ratePerTon: 20000,
      createdAt: 1,
      updatedAt: 1,
    };
    const lot = makeLot('lot-direct-edit', 15);
    lot.mineId = mine.id;
    const saved: Dispatch = {
      ...makeDispatch('dispatch-direct-edit', '', 10),
      coalInputs: [{ id: 'ci-direct', mineId: mine.id, sourceName: mine.name, weight: 10, purchaseRate: 20000 }],
    };

    const availability = calculateMineAvailabilityForDispatch(mine, [lot], [saved], saved);
    expect(availability.availableBeforeThis).toBe(15);
    expect(availability.remainingAfter).toBe(5);
    expect(availability.isOverdraw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Issue 40: Local Timezone Date Guard (T34)
// ---------------------------------------------------------------------------
import { toLocalDateString, getTodayDateString } from '../src/utils/dateUtils';

describe('Issue 40: Local Timezone Date Guard (T34)', () => {
  it('T34: a date created at 02:00 Asia/Karachi (UTC+5) gets the local day, not the UTC previous day', () => {
    // 2026-10-09 02:00 PKT = 2026-10-08 21:00 UTC
    // Using toISOString().split('T')[0] on this timestamp gives '2026-10-08' (wrong)
    // toLocalDateString must give '2026-10-09' when running in Asia/Karachi
    //
    // We simulate this by constructing a Date at 2am of a known day via explicit
    // local-time constructor (year, month, day, hour) which is tz-agnostic in Node.
    // Then we check toLocalDateString gives the same local day as getFullYear etc.
    const targetDay = new Date(2026, 9, 9, 2, 0, 0); // Oct 9, 02:00 local time
    const result = toLocalDateString(targetDay);
    const expected = `${targetDay.getFullYear()}-${String(targetDay.getMonth() + 1).padStart(2, '0')}-${String(targetDay.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);

    // Also verify that toISOString approach gives a different (wrong) result when
    // the machine is running in UTC+5 and time is before 05:00
    // (We can't force TZ in vitest without extra config, so we at minimum verify
    //  that toLocalDateString always produces the local date string, not UTC)
    const todayLocal = getTodayDateString();
    const todayDate = new Date();
    const expectedToday = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    expect(todayLocal).toBe(expectedToday);
  });
});
