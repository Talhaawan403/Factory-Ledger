import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateMineStock,
  calculateSupplierStock,
  calculateSupplierFinancials,
  calculateLotStock,
  calculateSettlement,
  calculatePartyBalance,
  calculateMaterialInventorySummary,
} from '../src/utils/calculations';
import {
  saveLot,
  getLots,
  saveMine,
  getMine,
  getMines,
  saveParty,
  getParty,
  getParties,
  saveDispatch,
  getDispatches,
  savePayment,
  getPayments,
  getPartyPayments,
  deleteMine,
  deleteParty,
  deleteLot,
  deleteDispatch,
  clearAllData,
} from '../src/lib/db';
import type { InventoryLot, Dispatch, Mine, Party, Payment } from '../src/types';
import { COAL_ITEM_ID } from '../src/utils/materials';
import { v4 as uuidv4 } from 'uuid';

describe('Supplier & Inventory Linkage (Commodity Trading Workflow)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllData();
  });

  it('correctly separates financials and links origin stock when middleman supplier sells mine coal', async () => {
    // 1. Setup Mines: Mine A (base rate 20,000) and Mine B (base rate 18,000)
    const mineA: Mine = {
      id: 'mine-a',
      name: 'Mine A',
      ratePerTon: 20000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const mineB: Mine = {
      id: 'mine-b',
      name: 'Mine B',
      ratePerTon: 18000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(mineA);
    await saveMine(mineB);

    // 2. Setup Middleman Supplier: James
    const supplierJames: Party = {
      id: 'supplier-james',
      name: 'James Coal Trader',
      type: 'supplier',
      contactPerson: 'James',
      phone: '0300-1234567',
      address: 'Office #4, Coal Market',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(supplierJames);

    // 3. User buys 20 tons of Mine A coal from James @ PKR 22,000/ton (PKR 440,000 total)
    const lotA: InventoryLot = {
      id: 'lot-james-mine-a',
      supplierId: supplierJames.id,
      supplier: supplierJames.name,
      boughtFrom: supplierJames.name,
      mineId: mineA.id,
      mineName: mineA.name,
      mineSource: mineA.name,
      truckNumber: 'TK-4821',
      date: '2026-10-24',
      tonnage: 20,
      billedWeight: 20,
      receivedWeight: 20,
      purchaseRate: 22000,
      ratePerTon: 22000,
      landedRate: 22000,
      totalValue: 440000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lotA);

    // 4. User buys 10 tons of Mine B coal from James @ PKR 19,500/ton (PKR 195,000 total)
    const lotB: InventoryLot = {
      id: 'lot-james-mine-b',
      supplierId: supplierJames.id,
      supplier: supplierJames.name,
      boughtFrom: supplierJames.name,
      mineId: mineB.id,
      mineName: mineB.name,
      mineSource: mineB.name,
      truckNumber: 'TK-9901',
      date: '2026-10-24',
      tonnage: 10,
      billedWeight: 10,
      receivedWeight: 10,
      purchaseRate: 19500,
      ratePerTon: 19500,
      landedRate: 19500,
      totalValue: 195000,
      createdAt: Date.now() + 10,
      updatedAt: Date.now() + 10,
    };
    await saveLot(lotB);

    const allLots = await getLots();
    const allPayments: Payment[] = [];
    const allDispatches: Dispatch[] = [];

    // --- FINANCIAL VERIFICATION ---
    // James should be owed PKR 635,000
    const jamesFinancials = calculateSupplierFinancials(supplierJames.id, allLots, allPayments);
    expect(jamesFinancials.totalPurchases).toBe(635000);
    expect(jamesFinancials.totalPaid).toBe(0);
    expect(jamesFinancials.outstandingBalance).toBe(635000);

    const jamesPartyBalance = calculatePartyBalance([], allPayments, supplierJames, allLots);
    expect(jamesPartyBalance.totalBilled).toBe(635000);
    expect(jamesPartyBalance.isPayable).toBe(true);
    expect(jamesPartyBalance.outstandingBalance).toBe(635000);

    // Mine A should have ZERO financial balance (since the coal was bought from James, not direct Mine A)
    const mineAFinancials = calculateSupplierFinancials(mineA.id, allLots, allPayments);
    expect(mineAFinancials.totalPurchases).toBe(0);
    expect(mineAFinancials.outstandingBalance).toBe(0);

    // Mine B should have ZERO financial balance
    const mineBFinancials = calculateSupplierFinancials(mineB.id, allLots, allPayments);
    expect(mineBFinancials.totalPurchases).toBe(0);
    expect(mineBFinancials.outstandingBalance).toBe(0);

    // --- PHYSICAL INVENTORY STOCK VERIFICATION ---
    // Mine A stock summary should accurately show 20 tons in yard at PKR 22,000 landed rate
    const mineAStock = calculateMineStock(mineA, allLots, allDispatches);
    expect(mineAStock.totalInflowTons).toBe(20);
    expect(mineAStock.totalInflowValue).toBe(440000);
    expect(mineAStock.remainingTons).toBe(20);
    expect(mineAStock.remainingValue).toBe(440000);
    expect(mineAStock.status).toBe('in_stock');

    // Mine B stock summary should show 10 tons in yard at PKR 19,500 landed rate
    const mineBStock = calculateMineStock(mineB, allLots, allDispatches);
    expect(mineBStock.totalInflowTons).toBe(10);
    expect(mineBStock.totalInflowValue).toBe(195000);
    expect(mineBStock.remainingTons).toBe(10);
    expect(mineBStock.remainingValue).toBe(195000);
    expect(mineBStock.status).toBe('low'); // < 20 tons is 'low'

    // Supplier James stock summary should show 30 tons total in yard
    const jamesStock = calculateSupplierStock(supplierJames as any, allLots, allDispatches);
    expect(jamesStock.totalInflowTons).toBe(30);
    expect(jamesStock.totalInflowValue).toBe(635000);
    expect(jamesStock.remainingTons).toBe(30);
    expect(jamesStock.remainingValue).toBe(635000);

    // 5. User dispatches 15 tons of Mine A coal to buyer "Maple Leaf Cement" @ PKR 26,000/ton
    const buyer: Party = {
      id: 'buyer-maple-leaf',
      name: 'Maple Leaf Cement',
      type: 'buyer',
      contactPerson: 'Procurement Officer',
      phone: '0300-9876543',
      address: 'Industrial Area',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(buyer);

    const dispatch1: Dispatch = {
      id: 'disp-001',
      partyId: buyer.id,
      date: '2026-10-25',
      truckNumber: 'TK-7700',
      factoryName: buyer.name,
      baseRate: 26000,
      targetGcv: 5000,
      labActualGcv: 5000,
      labSulphur: 1,
      labReceivedWeight: 15,
      coalInputs: [
        {
          id: 'ci-1',
          mineId: mineA.id,
          supplierId: supplierJames.id,
          lotId: lotA.id,
          sourceName: `${mineA.name} - ${lotA.truckNumber} (via ${supplierJames.name})`,
          weight: 15,
          purchaseRate: 22000, // Landed cost from James
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(dispatch1);

    const currentDispatches = await getDispatches();

    // 6. Verify Settlement & Profitability
    const settlement = calculateSettlement(dispatch1);
    expect(settlement.totalRevenue).toBe(15 * 26000); // 390,000 revenue
    expect(settlement.totalCost).toBe(15 * 22000); // 330,000 cost (from James's landed rate!)
    expect(settlement.netProfit).toBe(390000 - 330000); // 60,000 net profit

    // 7. Verify remaining stock after 15t dispatch
    // Mine A should now have 5 tons remaining @ 22,000 = 110,000 yard value
    const mineAStockAfter = calculateMineStock(mineA, allLots, currentDispatches);
    expect(mineAStockAfter.remainingTons).toBe(5);
    expect(mineAStockAfter.totalOutflowTons).toBe(15);
    expect(mineAStockAfter.remainingValue).toBe(5 * 22000); // 110,000

    // James's lot stock should reflect 15t used and 5t remaining
    const lotStockA = calculateLotStock(lotA, currentDispatches);
    expect(lotStockA.usedWeight).toBe(15);
    expect(lotStockA.remainingWeight).toBe(5);
    expect(lotStockA.isOverdrawn).toBe(false);
    expect(lotStockA.capitalTiedUp).toBe(5 * 22000);

    // James's overall stock should show 15t remaining (5t from Mine A lot + 10t from Mine B lot)
    const jamesStockAfter = calculateSupplierStock(supplierJames as any, allLots, currentDispatches);
    expect(jamesStockAfter.remainingTons).toBe(15);
    expect(jamesStockAfter.totalOutflowTons).toBe(15);
    expect(jamesStockAfter.remainingValue).toBe((5 * 22000) + (10 * 19500));

    // 8. Financial balances should remain constant despite dispatch
    // James is STILL owed 635,000 (dispatches do not reduce supplier payables!)
    const jamesFinancialsAfterDispatch = calculateSupplierFinancials(supplierJames.id, allLots, allPayments);
    expect(jamesFinancialsAfterDispatch.outstandingBalance).toBe(635000);

    // Mine A financial balance is STILL 0
    const mineAFinancialsAfterDispatch = calculateSupplierFinancials(mineA.id, allLots, allPayments);
    expect(mineAFinancialsAfterDispatch.outstandingBalance).toBe(0);

    // 9. Now make a partial payment of PKR 300,000 to James
    const paymentToJames: Payment = {
      id: 'pay-james-1',
      partyId: supplierJames.id,
      supplierId: supplierJames.id,
      type: 'paid',
      amount: 300000,
      mode: 'bank',
      date: '2026-10-25',
      referenceNote: 'Advance against TK-4821',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePayment(paymentToJames);

    const updatedPayments = await getPartyPayments(supplierJames.id);
    const jamesFinalFinancials = calculateSupplierFinancials(supplierJames.id, allLots, updatedPayments);
    expect(jamesFinalFinancials.totalPaid).toBe(300000);
    expect(jamesFinalFinancials.outstandingBalance).toBe(335000); // 635,000 - 300,000

    // Mine A financials still 0
    const mineAFinalFinancials = calculateSupplierFinancials(mineA.id, allLots, updatedPayments);
    expect(mineAFinalFinancials.outstandingBalance).toBe(0);

    // 10. Exhaust the remaining 5 tons of Mine A lot in a second dispatch
    const dispatch2: Dispatch = {
      id: 'disp-002',
      partyId: buyer.id,
      date: '2026-10-26',
      truckNumber: 'TK-8811',
      factoryName: buyer.name,
      baseRate: 27000,
      targetGcv: 5000,
      labActualGcv: 5000,
      labSulphur: 1,
      labReceivedWeight: 5,
      coalInputs: [
        {
          id: 'ci-2',
          mineId: mineA.id,
          supplierId: supplierJames.id,
          lotId: lotA.id,
          sourceName: `${mineA.name} - ${lotA.truckNumber} (via ${supplierJames.name})`,
          weight: 5,
          purchaseRate: 22000,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(dispatch2);

    const finalDispatches = await getDispatches();
    const lotStockAFinal = calculateLotStock(lotA, finalDispatches);
    expect(lotStockAFinal.usedWeight).toBe(20);
    expect(lotStockAFinal.remainingWeight).toBe(0);
    expect(lotStockAFinal.capitalTiedUp).toBe(0);

    const mineAStockFinal = calculateMineStock(mineA, allLots, finalDispatches);
    expect(mineAStockFinal.remainingTons).toBe(0);
    expect(mineAStockFinal.remainingValue).toBe(0);
    expect(mineAStockFinal.status).toBe('exhausted');
  });

  it('handles multi-source blending with direct mine lot and middleman supplier lot correctly', async () => {
    // Mine A
    const mineA: Mine = {
      id: 'mine-a',
      name: 'Mine A',
      ratePerTon: 20000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(mineA);

    // Middleman Supplier James
    const supplierJames: Party = {
      id: 'supplier-james',
      name: 'James Coal Trader',
      type: 'supplier',
      contactPerson: 'James',
      phone: '0300-1234567',
      address: 'Office #4, Coal Market',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(supplierJames);

    // 1. Direct lot from Mine A: 50 tons @ 20,000/ton (Mine's own production)
    const directMineLot: InventoryLot = {
      id: 'lot-direct-mine-a',
      mineId: mineA.id,
      mineName: mineA.name,
      mineSource: mineA.name,
      supplier: mineA.name,
      boughtFrom: mineA.name,
      truckNumber: 'MINE-01',
      date: '2026-10-24',
      tonnage: 50,
      billedWeight: 50,
      receivedWeight: 50,
      purchaseRate: 20000,
      ratePerTon: 20000,
      landedRate: 20000,
      totalValue: 1000000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(directMineLot);

    // 2. Middleman lot: James delivers 20 tons of Mine A coal @ 22,000/ton
    const supplierLot: InventoryLot = {
      id: 'lot-james-mine-a',
      supplierId: supplierJames.id,
      supplier: supplierJames.name,
      boughtFrom: supplierJames.name,
      mineId: mineA.id,
      mineName: mineA.name,
      mineSource: mineA.name,
      truckNumber: 'JAMES-01',
      date: '2026-10-24',
      tonnage: 20,
      billedWeight: 20,
      receivedWeight: 20,
      purchaseRate: 22000,
      ratePerTon: 22000,
      landedRate: 22000,
      totalValue: 440000,
      createdAt: Date.now() + 5,
      updatedAt: Date.now() + 5,
    };
    await saveLot(supplierLot);

    const lots = await getLots();

    // Mine A physical yard stock: 50t + 20t = 70 tons total. Total value = 1,440,000
    const mineAStock = calculateMineStock(mineA, lots, []);
    expect(mineAStock.totalInflowTons).toBe(70);
    expect(mineAStock.remainingTons).toBe(70);
    expect(mineAStock.totalInflowValue).toBe(1440000);
    expect(mineAStock.remainingValue).toBe(1440000);

    // James's stock: only the 20 tons he supplied
    const jamesStock = calculateSupplierStock(supplierJames as any, lots, []);
    expect(jamesStock.totalInflowTons).toBe(20);
    expect(jamesStock.remainingTons).toBe(20);
    expect(jamesStock.remainingValue).toBe(440000);

    // James's financial payable: only 440,000 (NOT the 1,000,000 from direct mine lot)
    const jamesFinancials = calculateSupplierFinancials(supplierJames.id, lots, []);
    expect(jamesFinancials.totalPurchases).toBe(440000);
    expect(jamesFinancials.outstandingBalance).toBe(440000);

    // Now dispatch a blend: 10 tons from direct Mine A lot + 10 tons from James's lot
    const blendDispatch: Dispatch = {
      id: 'disp-blend-1',
      partyId: 'buyer-1',
      date: '2026-10-25',
      truckNumber: 'TK-BLEND',
      factoryName: 'Bestway Cement',
      baseRate: 25000,
      targetGcv: 5000,
      labActualGcv: 5000,
      labSulphur: 1,
      labReceivedWeight: 20,
      coalInputs: [
        {
          id: 'ci-direct',
          mineId: mineA.id,
          lotId: directMineLot.id,
          sourceName: `${mineA.name} - Direct`,
          weight: 10,
          purchaseRate: 20000,
        },
        {
          id: 'ci-james',
          mineId: mineA.id,
          supplierId: supplierJames.id,
          lotId: supplierLot.id,
          sourceName: `${mineA.name} (via ${supplierJames.name})`,
          weight: 10,
          purchaseRate: 22000,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(blendDispatch);

    const dispatches = await getDispatches();

    // Verify blended settlement
    const blendSettlement = calculateSettlement(blendDispatch);
    expect(blendSettlement.totalRevenue).toBe(20 * 25000); // 500,000 revenue
    // Cost = (10 * 20000) + (10 * 22000) = 200000 + 220000 = 420000
    expect(blendSettlement.totalCost).toBe(420000);
    expect(blendSettlement.netProfit).toBe(500000 - 420000); // 80,000 profit

    // Verify individual lot stock decrements
    const directStock = calculateLotStock(directMineLot, dispatches);
    expect(directStock.usedWeight).toBe(10);
    expect(directStock.remainingWeight).toBe(40);

    const jamesLotStock = calculateLotStock(supplierLot, dispatches);
    expect(jamesLotStock.usedWeight).toBe(10);
    expect(jamesLotStock.remainingWeight).toBe(10);

    // Overall Mine A remaining stock: 40 + 10 = 50 tons
    const mineAStockAfter = calculateMineStock(mineA, lots, dispatches);
    expect(mineAStockAfter.remainingTons).toBe(50);
    expect(mineAStockAfter.remainingValue).toBe((40 * 20000) + (10 * 22000)); // 800,000 + 220,000 = 1,020,000
  });

  it('seamlessly auto-creates new Mine when supplier delivers from an unlisted mine origin (Option 1)', async () => {
    // 1. Initial registered mines: only Makerwal and Mach
    const makerwal: Mine = {
      id: 'mine-makerwal',
      name: 'Makerwal',
      ratePerTon: 24000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(makerwal);

    // 2. Setup Supplier: Test Supplier
    const testSupplier: Party = {
      id: 'supp-test',
      name: 'Test Supplier',
      type: 'supplier',
      contactPerson: 'Ali',
      phone: '0300-1112233',
      address: 'Main Truck Stand',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(testSupplier);

    // 3. Supplier delivers 20 tons from "Islam C" (which is NOT in registered mines!)
    const unlistedOriginName = 'Islam C';
    const initialMines = await getMines();
    let matchedMine = initialMines.find(
      (m) => m.name.toLowerCase() === unlistedOriginName.toLowerCase()
    );
    expect(matchedMine).toBeUndefined(); // Verify it does not exist yet

    // Auto-create logic as executed in SupplierInwardSheet
    let resolvedMineId: string | undefined = undefined;
    let resolvedMineName: string | undefined = unlistedOriginName;

    const purchaseRate = 22300;
    const freightCost = 20000;
    const weight = 20;
    const materialCost = weight * purchaseRate; // 446,000
    const totalValue = materialCost + freightCost; // 466,000
    const landedRate = totalValue / weight; // 23,300

    if (!matchedMine) {
      const newMine: Mine = {
        id: uuidv4(),
        name: unlistedOriginName,
        ratePerTon: purchaseRate,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveMine(newMine);
      resolvedMineId = newMine.id;
      resolvedMineName = newMine.name;
    }

    // 4. Save the inward delivery lot with the newly resolved mine
    const newLot: InventoryLot = {
      id: 'lot-islam-c-01',
      supplierId: testSupplier.id,
      supplier: testSupplier.name,
      boughtFrom: testSupplier.name,
      mineId: resolvedMineId,
      mineName: resolvedMineName,
      mineSource: resolvedMineName,
      truckNumber: '6477',
      date: '2026-10-26',
      tonnage: weight,
      billedWeight: weight,
      receivedWeight: weight,
      purchaseRate,
      ratePerTon: purchaseRate,
      freightCost,
      totalValue,
      landedRate,
      storedAt: 'Lahore',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(newLot);

    // 5. Verify Database State
    const updatedMines = await getMines();
    const createdIslamCMine = updatedMines.find((m) => m.name === 'Islam C');
    expect(createdIslamCMine).toBeDefined();
    expect(createdIslamCMine!.id).toBe(resolvedMineId);
    expect(createdIslamCMine!.ratePerTon).toBe(22300);

    const allLots = await getLots();

    // 6. Verify Physical Mine Yard Stock for "Islam C"
    const islamCStock = calculateMineStock(createdIslamCMine!, allLots, []);
    expect(islamCStock.totalInflowTons).toBe(20);
    expect(islamCStock.remainingTons).toBe(20);
    expect(islamCStock.totalInflowValue).toBe(466000);
    expect(islamCStock.remainingValue).toBe(466000);
    expect(islamCStock.status).toBe('in_stock');

    // 7. Verify Financial Separation
    // Test Supplier gets the full liability (466,000)
    const supplierFinancials = calculateSupplierFinancials(testSupplier.id, allLots, []);
    expect(supplierFinancials.totalPurchases).toBe(466000);
    expect(supplierFinancials.outstandingBalance).toBe(466000);

    // Auto-created Islam C mine gets 0 payable balance (bought through supplier)
    const mineFinancials = calculateSupplierFinancials(createdIslamCMine!.id, allLots, []);
    expect(mineFinancials.totalPurchases).toBe(0);
    expect(mineFinancials.outstandingBalance).toBe(0);

    // 8. Dispatch 10 tons of Islam C
    const testBuyer: Party = {
      id: 'buyer-cement-1',
      name: 'Pioneer Cement',
      type: 'buyer',
      contactPerson: 'Manager',
      phone: '0300-4445566',
      address: 'Factory Gate 2',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(testBuyer);

    const dispatchIslamC: Dispatch = {
      id: 'disp-islam-c-1',
      partyId: testBuyer.id,
      date: '2026-10-26',
      truckNumber: 'TK-DISP-01',
      factoryName: testBuyer.name,
      baseRate: 26500,
      targetGcv: 5000,
      labActualGcv: 5000,
      labSulphur: 1,
      labReceivedWeight: 10,
      coalInputs: [
        {
          id: 'ci-islam-c',
          mineId: createdIslamCMine!.id,
          supplierId: testSupplier.id,
          lotId: newLot.id,
          sourceName: `${createdIslamCMine!.name} - ${newLot.truckNumber} (via ${testSupplier.name})`,
          weight: 10,
          purchaseRate: landedRate, // 23,300
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(dispatchIslamC);

    const allDispatches = await getDispatches();

    // Verify Islam C remaining yard stock is now 10 tons @ 23,300 = 233,000
    const islamCStockAfter = calculateMineStock(createdIslamCMine!, allLots, allDispatches);
    expect(islamCStockAfter.remainingTons).toBe(10);
    expect(islamCStockAfter.remainingValue).toBe(10 * 23300);

    // Verify Dispatch Net Profit
    const settlement = calculateSettlement(dispatchIslamC);
    expect(settlement.totalRevenue).toBe(10 * 26500); // 265,000
    expect(settlement.totalCost).toBe(10 * 23300); // 233,000
    expect(settlement.netProfit).toBe(265000 - 233000); // 32,000
  });

  it('auto-creates [Mine Name] Direct Ledger supplier party and synchronizes payables and yard stock', async () => {
    // 1. Setup Mine: "Makerwal" without any existing direct supplier party
    const makerwalMine: Mine = {
      id: 'mine-makerwal-' + uuidv4().slice(0, 8),
      name: 'Makerwal',
      location: 'Mianwali',
      phone: '0300-1122334',
      ratePerTon: 21000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(makerwalMine);

    // Initial check: saveMine automatically and bulletproof-links Makerwal Direct Ledger
    let allParties = await getParties();
    expect(allParties.some((p) => p.name === 'Makerwal Direct Ledger')).toBe(true);

    // 2. Simulate Mine Ledger inflow entry where user leaves supplier as direct mine (default)
    const directPartyName = `${makerwalMine.name} Direct Ledger`;
    let directParty = allParties.find(
      (p) =>
        p.type === 'supplier' &&
        (p.id === makerwalMine.defaultSupplierId ||
          p.linkedMineId === makerwalMine.id ||
          p.name.toLowerCase() === directPartyName.toLowerCase())
    );

    // Auto-create direct supplier party as done in MineLedger.tsx
    if (!directParty) {
      const newDirectParty: Party = {
        id: uuidv4(),
        name: directPartyName,
        type: 'supplier',
        contactPerson: '',
        phone: makerwalMine.phone || '',
        address: makerwalMine.location || '',
        notes: `Direct ledger for ${makerwalMine.name} mine owner purchases and payments.`,
        isDirectMine: true,
        linkedMineId: makerwalMine.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveParty(newDirectParty);
      directParty = newDirectParty;

      const updatedMine: Mine = {
        ...makerwalMine,
        defaultSupplierId: newDirectParty.id,
        updatedAt: Date.now(),
      };
      await saveMine(updatedMine);
    }
    expect(directParty).toBeDefined();

    // Save 50 Tons of coal directly from mine @ 21,000/ton = 1,050,000
    const lot1: InventoryLot = {
      id: 'lot-makerwal-1',
      mineId: makerwalMine.id,
      mineName: makerwalMine.name,
      supplierId: directParty.id,
      supplier: directParty.name,
      boughtFrom: directParty.name,
      itemId: COAL_ITEM_ID,
      itemName: 'Coal',
      tonnage: 50,
      billedWeight: 50,
      receivedWeight: 50,
      ratePerTon: 21000,
      purchaseRate: 21000,
      totalValue: 50 * 21000, // 1,050,000
      landedRate: 21000,
      date: '2026-10-26',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lot1);

    // 3. Verify party and mine linkage
    allParties = await getParties();
    const createdSupplier = allParties.find((p) => p.id === directParty!.id);
    expect(createdSupplier).toBeDefined();
    expect(createdSupplier?.isDirectMine).toBe(true);
    expect(createdSupplier?.linkedMineId).toBe(makerwalMine.id);

    const savedMine = await getMine(makerwalMine.id);
    expect(savedMine?.defaultSupplierId).toBe(directParty.id);

    // 4. Record a payment to the mine owner from Mine Ledger: 500,000
    const payment1: Payment = {
      id: 'pay-makerwal-1',
      partyId: directParty.id,
      supplierId: directParty.id,
      mineId: makerwalMine.id,
      type: 'paid',
      amount: 500000,
      date: '2026-10-26',
      mode: 'bank',
      referenceNote: 'Advance bank transfer to mine owner',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePayment(payment1);

    const allLots = await getLots();
    const allPayments = await getPayments();

    // 5. Verify Supplier Party Ledger financials:
    // Purchases = 1,050,000; Paid = 500,000; Balance payable = 550,000
    const supplierFinancials = calculateSupplierFinancials(directParty.id, allLots, allPayments);
    expect(supplierFinancials.totalPurchases).toBe(1050000);
    expect(supplierFinancials.totalPaid).toBe(500000);
    expect(supplierFinancials.outstandingBalance).toBe(550000);

    // 6. Verify Mine Yard Inventory Stock:
    const mineStock = calculateMineStock(makerwalMine, allLots, []);
    expect(mineStock.totalInflowTons).toBe(50);
    expect(mineStock.remainingTons).toBe(50);
    expect(mineStock.remainingValue).toBe(1050000);

    // 7. Verify Future Entry Deduplication:
    // When adding a 2nd lot, it should reuse the existing directParty without re-creating
    const initialPartiesCount = (await getParties()).length;
    let reusedDirect = (await getParties()).find(
      (p) =>
        p.type === 'supplier' &&
        (p.id === savedMine?.defaultSupplierId ||
          p.linkedMineId === savedMine?.id ||
          p.name.toLowerCase() === directPartyName.toLowerCase())
    );
    expect(reusedDirect?.id).toBe(directParty.id);

    // Save 2nd lot: 30 tons @ 21,000 = 630,000
    const lot2: InventoryLot = {
      id: 'lot-makerwal-2',
      mineId: makerwalMine.id,
      mineName: makerwalMine.name,
      supplierId: reusedDirect!.id,
      supplier: reusedDirect!.name,
      boughtFrom: reusedDirect!.name,
      itemId: COAL_ITEM_ID,
      itemName: 'Coal',
      tonnage: 30,
      billedWeight: 30,
      receivedWeight: 30,
      ratePerTon: 21000,
      purchaseRate: 21000,
      totalValue: 30 * 21000, // 630,000
      landedRate: 21000,
      date: '2026-10-26',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lot2);

    // Verify no duplicate party was created
    const finalPartiesCount = (await getParties()).length;
    expect(finalPartiesCount).toBe(initialPartiesCount);

    // Verify updated cumulative financials:
    // Total Purchases = 1,050,000 + 630,000 = 1,680,000; Outstanding = 1,680,000 - 500,000 = 1,180,000
    const updatedLots = await getLots();
    const updatedFinancials = calculateSupplierFinancials(directParty.id, updatedLots, allPayments);
    expect(updatedFinancials.totalPurchases).toBe(1680000);
    expect(updatedFinancials.outstandingBalance).toBe(1180000);
  });

  it('correctly handles multi-material (Laterite with purity pricing and Bauxite) supplier inward deliveries and stock integration', async () => {
    // 1. Setup Laterite Supplier with materialIds: ['material-laterite']
    const lateriteSupplier: Party = {
      id: 'supp-laterite-1',
      name: 'Al-Madina Laterite Co',
      type: 'supplier',
      contactPerson: 'Haji Aslam',
      phone: '0300-9876543',
      address: 'Khushab Depot',
      materialIds: ['material-laterite'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(lateriteSupplier);

    // 2. Setup Bauxite Supplier with materialIds: ['material-bauxite']
    const bauxiteSupplier: Party = {
      id: 'supp-bauxite-1',
      name: 'Punjab Bauxite Minerals',
      type: 'supplier',
      contactPerson: 'Tariq Mehmood',
      phone: '0321-5551234',
      address: 'Peshawar Road Depot',
      materialIds: ['material-bauxite'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveParty(bauxiteSupplier);

    // 3. User records Laterite Inward Delivery using Purity Pricing:
    // Purity = 32%, Rate/point = 116 -> Rate/ton = 32 * 116 = 3,712
    // Weight = 25 tons, Freight = 20,000
    // Material Cost = 25 * 3,712 = 92,800. Total Value = 92,800 + 20,000 = 112,800. Landed Rate = 112,800 / 25 = 4,512/ton
    const lateriteLot: InventoryLot = {
      id: 'lot-laterite-inward-1',
      supplierId: lateriteSupplier.id,
      supplier: lateriteSupplier.name,
      boughtFrom: lateriteSupplier.name,
      itemId: 'material-laterite',
      itemName: 'Laterite',
      truckNumber: 'TK-8812',
      date: '2026-10-26',
      tonnage: 25,
      billedWeight: 25,
      receivedWeight: 25,
      purchaseRate: 3712,
      ratePerTon: 3712,
      freightCost: 20000,
      totalValue: 112800,
      landedRate: 4512,
      grade: '32% Fe2O3',
      storedAt: 'Laterite Storage Yard',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lateriteLot);

    // 4. User records Bauxite Inward Delivery using Flat Rate:
    // Weight = 15 tons @ 8,000/ton = 120,000, freight = 15,000 -> Total = 135,000, Landed = 9,000/ton
    const bauxiteLot: InventoryLot = {
      id: 'lot-bauxite-inward-1',
      supplierId: bauxiteSupplier.id,
      supplier: bauxiteSupplier.name,
      boughtFrom: bauxiteSupplier.name,
      itemId: 'material-bauxite',
      itemName: 'Bauxite',
      truckNumber: 'TK-7744',
      date: '2026-10-26',
      tonnage: 15,
      billedWeight: 15,
      receivedWeight: 15,
      purchaseRate: 8000,
      ratePerTon: 8000,
      freightCost: 15000,
      totalValue: 135000,
      landedRate: 9000,
      storedAt: 'Bauxite Storage Yard',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(bauxiteLot);

    // 5. Verify Supplier Financials for Laterite Supplier:
    // Total purchases = 112,800 (Material + Freight)
    const allLots = await getLots();
    const latFinancials = calculateSupplierFinancials(lateriteSupplier.id, allLots, []);
    expect(latFinancials.totalPurchases).toBe(112800);
    expect(latFinancials.outstandingBalance).toBe(112800);

    // 6. Record partial payment of 50,000 to Laterite Supplier:
    const paymentLat: Payment = {
      id: 'pay-lat-1',
      partyId: lateriteSupplier.id,
      supplierId: lateriteSupplier.id,
      amount: 50000,
      type: 'paid',
      mode: 'bank',
      date: '2026-10-26',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePayment(paymentLat);

    const allPayments = await getPayments();
    const updatedLatFin = calculateSupplierFinancials(lateriteSupplier.id, allLots, allPayments);
    expect(updatedLatFin.totalPaid).toBe(50000);
    expect(updatedLatFin.outstandingBalance).toBe(62800); // 112,800 - 50,000

    // 7. Verify Inventory segregation by Material:
    const suppliers = [
      { id: lateriteSupplier.id, name: lateriteSupplier.name, materialIds: ['material-laterite'] },
      { id: bauxiteSupplier.id, name: bauxiteSupplier.name, materialIds: ['material-bauxite'] },
    ];
    const lateriteSummary = calculateMaterialInventorySummary('material-laterite', [], suppliers, allLots, []);
    expect(lateriteSummary.totalYardTons).toBe(25);
    expect(lateriteSummary.totalYardValue).toBe(112800);
    expect(lateriteSummary.totalSources).toBe(1);

    const bauxiteSummary = calculateMaterialInventorySummary('material-bauxite', [], suppliers, allLots, []);
    expect(bauxiteSummary.totalYardTons).toBe(15);
    expect(bauxiteSummary.totalYardValue).toBe(135000);
    expect(bauxiteSummary.totalSources).toBe(1);

    const coalSummary = calculateMaterialInventorySummary(COAL_ITEM_ID, [], suppliers, allLots, []);
    expect(coalSummary.totalYardTons).toBe(0);

    // 8. Allocate 10 tons of Laterite in a factory dispatch:
    const lateriteDispatch: Dispatch = {
      id: 'disp-laterite-1',
      partyId: 'factory-cement-1',
      factoryName: 'Maple Leaf Cement',
      date: '2026-10-26',
      truckNumber: 'TK-8812',
      itemId: 'material-laterite',
      itemName: 'Laterite',
      pricingModel: 'purity',
      targetGcv: 0,
      baseRate: 0,
      labActualGcv: 0,
      labSulphur: 0,
      ratePerQualityUnit: 150, // Factory contract: 150 per purity point
      receivedQuality: 32, // Factory lab received 32% purity -> Rate = 150 * 32 = 4,800/ton
      labReceivedWeight: 10,
      coalInputs: [
        {
          id: 'inp-1',
          sourceName: lateriteSupplier.name,
          supplierId: lateriteSupplier.id,
          lotId: lateriteLot.id,
          weight: 10,
          purchaseRate: 4512, // Landed cost frozen
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      status: 'settled',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(lateriteDispatch);

    // 9. Verify Laterite Lot Remaining Balance & FIFO Landed Valuation:
    const allDispatches = await getDispatches();
    const lotStock = calculateLotStock(lateriteLot, allDispatches);
    expect(lotStock.usedWeight).toBe(10);
    expect(lotStock.remainingWeight).toBe(15); // 25 - 10
    expect(lotStock.capitalTiedUp).toBe(15 * 4512); // Landed rate preserved
  });

  it('preserves selected material across commodity switching and assigns appropriate yard & purity pricing', async () => {
    // Multi-commodity supplier onboarding
    const multiSupplier: Party = {
      id: 'sup-multi-1',
      name: 'Indus Multi-Commodity Mines',
      type: 'supplier',
      materialIds: [COAL_ITEM_ID, 'material-laterite', 'material-bauxite', 'material-gypsum'],
      createdAt: Date.now(),
      contactPerson: '',
      phone: '',
      address: ''
    };
    await saveParty(multiSupplier);

    // Simulate switching to Laterite and saving an inward delivery
    const lateriteDelivery: InventoryLot = {
      id: 'lot-switch-laterite',
      supplierId: multiSupplier.id,
      supplier: multiSupplier.name,
      boughtFrom: multiSupplier.name,
      date: '2026-10-26',
      truckNumber: 'LHR-7721',
      itemId: 'material-laterite',
      itemName: 'Laterite',
      mineSource: 'Pabbi Laterite Quarry',
      storedAt: 'Laterite Storage Yard',
      billedWeight: 40,
      receivedWeight: 40,
      tonnage: 40,
      purchaseRate: 30 * 116, // 30% * 116/point = 3,480
      ratePerTon: 3480,
      grade: '30% Fe2O3',
      freightCost: 20000,
      totalValue: 40 * 3480 + 20000,
      landedRate: (40 * 3480 + 20000) / 40,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lateriteDelivery);

    // Simulate switching to Gypsum and saving another inward delivery
    const gypsumDelivery: InventoryLot = {
      id: 'lot-switch-gypsum',
      supplierId: multiSupplier.id,
      supplier: multiSupplier.name,
      boughtFrom: multiSupplier.name,
      date: '2026-10-26',
      truckNumber: 'RWP-9901',
      itemId: 'material-gypsum',
      itemName: 'Gypsum',
      mineSource: 'Salt Range Gypsum Pit',
      storedAt: 'Gypsum Storage Yard',
      billedWeight: 50,
      receivedWeight: 50,
      tonnage: 50,
      purchaseRate: 4200,
      ratePerTon: 4200,
      freightCost: 25000,
      totalValue: 50 * 4200 + 25000,
      landedRate: (50 * 4200 + 25000) / 50,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(gypsumDelivery);

    const savedLots = await getLots();
    const foundLaterite = savedLots.find((l) => l.id === 'lot-switch-laterite');
    const foundGypsum = savedLots.find((l) => l.id === 'lot-switch-gypsum');

    expect(foundLaterite).toBeDefined();
    expect(foundLaterite?.itemId).toBe('material-laterite');
    expect(foundLaterite?.storedAt).toBe('Laterite Storage Yard');
    expect(foundLaterite?.grade).toBe('30% Fe2O3');
    expect(foundLaterite?.purchaseRate).toBe(3480);

    expect(foundGypsum).toBeDefined();
    expect(foundGypsum?.itemId).toBe('material-gypsum');
    expect(foundGypsum?.storedAt).toBe('Gypsum Storage Yard');
    expect(foundGypsum?.purchaseRate).toBe(4200);
  });

  it('bulletproofs mine renaming: automatically cascades updates to direct supplier party, lots, dispatches, and payments, while protecting deletion and financial records', async () => {
    // 1. Create a Mine "Chakwal Mine"
    const chakwalMine: Mine = {
      id: 'mine-chakwal-1',
      name: 'Chakwal Mine',
      location: 'Chakwal Coal Range',
      phone: '0311-5551234',
      ratePerTon: 22000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(chakwalMine);

    // Verify Direct Mine supplier party was automatically created and linked
    const allParties = await getParties();
    const directParty = allParties.find((p) => p.linkedMineId === chakwalMine.id);
    expect(directParty).toBeDefined();
    expect(directParty?.name).toBe('Chakwal Mine Direct Ledger');
    expect(directParty?.isDirectMine).toBe(true);
    expect(directParty?.address).toBe('Chakwal Coal Range');
    expect(directParty?.phone).toBe('0311-5551234');

    const loadedMine = await getMine(chakwalMine.id);
    expect(loadedMine?.defaultSupplierId).toBe(directParty?.id);

    // 2. Create an inward stock lot from this mine
    const lot: InventoryLot = {
      id: 'lot-chakwal-01',
      mineId: chakwalMine.id,
      mineName: chakwalMine.name,
      mineSource: chakwalMine.name,
      supplierId: directParty!.id,
      supplier: directParty!.name,
      boughtFrom: directParty!.name,
      itemId: COAL_ITEM_ID,
      itemName: 'Coal',
      date: '2026-10-25',
      truckNumber: 'CK-900',
      tonnage: 40,
      billedWeight: 40,
      receivedWeight: 40,
      ratePerTon: 22000,
      purchaseRate: 22000,
      totalValue: 880000,
      landedRate: 22000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lot);

    // 3. Create a buyer dispatch consuming 20 tons from this lot
    const dispatch: Dispatch = {
      id: 'disp-chakwal-01',
      partyId: 'buyer-01',
      factoryName: 'Maple Leaf Cement',
      date: '2026-10-26',
      truckNumber: 'TRK-5544',
      targetGcv: 6000,
      baseRate: 28000,
      labActualGcv: 6000,
      labSulphur: 1.5,
      labReceivedWeight: 20,
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      coalInputs: [
        {
          id: 'ci-1',
          lotId: lot.id,
          mineId: chakwalMine.id,
          sourceName: directParty!.name,
          weight: 20,
          purchaseRate: 22000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveDispatch(dispatch);

    // 4. Record a payment to the direct mine supplier
    const payment: Payment = {
      id: 'pay-chakwal-01',
      partyId: directParty!.id,
      supplierId: directParty!.id,
      mineId: chakwalMine.id,
      type: 'paid',
      amount: 400000,
      date: '2026-10-26',
      mode: 'bank',
      referenceNote: 'Bank transfer for Chakwal Mine',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await savePayment(payment);

    // 5. RENAME THE MINE: "Chakwal Mine" -> "Salt Range Pit 4"
    const renamedMine: Mine = {
      ...loadedMine!,
      name: 'Salt Range Pit 4',
      location: 'Salt Range Sector 4',
      phone: '0311-9998888',
      updatedAt: Date.now(),
    };
    await saveMine(renamedMine);

    // Verify Mine was updated
    const refreshedMine = await getMine(chakwalMine.id);
    expect(refreshedMine?.name).toBe('Salt Range Pit 4');
    expect(refreshedMine?.defaultSupplierId).toBe(directParty!.id);

    // Verify Linked Direct Party was automatically renamed and synchronized
    const refreshedParty = await getParty(directParty!.id);
    expect(refreshedParty).toBeDefined();
    expect(refreshedParty?.name).toBe('Salt Range Pit 4 Direct Ledger');
    expect(refreshedParty?.linkedMineId).toBe(chakwalMine.id);
    expect(refreshedParty?.isDirectMine).toBe(true);
    expect(refreshedParty?.notes).toContain('Salt Range Pit 4');
    expect(refreshedParty?.address).toBe('Salt Range Sector 4');
    expect(refreshedParty?.phone).toBe('0311-9998888');

    // Verify Stock Lot was automatically updated
    const refreshedLots = await getLots();
    const updatedLot = refreshedLots.find((l) => l.id === lot.id);
    expect(updatedLot?.mineName).toBe('Salt Range Pit 4');
    expect(updatedLot?.mineSource).toBe('Salt Range Pit 4');
    expect(updatedLot?.boughtFrom).toBe('Salt Range Pit 4 Direct Ledger');
    expect(updatedLot?.supplier).toBe('Salt Range Pit 4 Direct Ledger');
    expect(updatedLot?.supplierId).toBe(directParty!.id);

    // Verify Dispatch coalInputs was automatically updated
    const refreshedDispatches = await getDispatches();
    const updatedDispatch = refreshedDispatches.find((d) => d.id === dispatch.id);
    expect(updatedDispatch?.coalInputs?.[0].sourceName).toBe('Salt Range Pit 4 Direct Ledger');
    expect(updatedDispatch?.coalInputs?.[0].mineId).toBe(chakwalMine.id);

    // Verify Payments maintain correct party link
    const refreshedPayments = await getPayments();
    const updatedPayment = refreshedPayments.find((p) => p.id === payment.id);
    expect(updatedPayment?.partyId).toBe(directParty!.id);
    expect(updatedPayment?.supplierId).toBe(directParty!.id);

    // 6. Test Deletion Guards:
    // A. Cannot delete mine while stock entries exist
    await expect(deleteMine(chakwalMine.id)).rejects.toThrow(
      /Cannot delete mine with existing stock entries/
    );

    // B. Cannot delete direct supplier party while linked mine has stock entries
    await expect(deleteParty(directParty!.id)).rejects.toThrow(
      /Cannot delete direct mine supplier party/
    );

    // C. Clean up dispatch and stock lot and verify graceful party preservation on mine deletion
    await deleteDispatch(dispatch.id);
    await deleteLot(lot.id);
    // Now delete mine:
    await deleteMine(chakwalMine.id);

    // Verify mine is deleted
    const deletedMine = await getMine(chakwalMine.id);
    expect(deletedMine).toBeNull();

    // Because payments exist, directParty should NOT be hard-deleted or lost; it should be archived!
    const preservedParty = await getParty(directParty!.id);
    expect(preservedParty).toBeDefined();
    expect(preservedParty?.isArchived).toBe(true);
    expect(preservedParty?.notes).toContain('[Archived: Linked mine was deleted]');

    // 7. Verify Clean Deletion for an unused mine without payments
    const cleanMine: Mine = {
      id: 'mine-clean-01',
      name: 'Unused Mine',
      ratePerTon: 15000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveMine(cleanMine);
    const cleanMineParty = (await getParties()).find((p) => p.linkedMineId === cleanMine.id);
    expect(cleanMineParty).toBeDefined();

    // Delete unused mine: both mine and companion party are cleanly soft-deleted
    await deleteMine(cleanMine.id);
    expect(await getMine(cleanMine.id)).toBeNull();
    expect(await getParty(cleanMineParty!.id)).toBeNull();
  });
});



