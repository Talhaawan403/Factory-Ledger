import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { idb } from '../src/lib/dexieDb';
import {
  saveDispatch,
  getDispatches,
  deleteDispatch,
  saveParty,
  getParties,
  deleteParty,
  savePayment,
  getPayments,
  deletePayment,
  savePurchaseOrder,
  getPurchaseOrders,
  deletePurchaseOrder,
  saveLot,
  getLot,
  clearAllData,
} from '../src/lib/db';
import type { Dispatch, Party, Payment, PurchaseOrder, InventoryLot } from '../src/types';

function makeDispatch(id = 'fail-disp-1', partyId = 'fail-party-1'): Dispatch {
  return {
    id,
    partyId,
    date: '2026-10-08',
    truckNumber: 'TK-FAIL-1',
    factoryName: 'Test Factory',
    targetGcv: 6000,
    labActualGcv: 6000,
    labSulphur: 1,
    coalInputs: [{ id: 'c1', sourceName: 'Source 1', weight: 10, purchaseRate: 20000 }],
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
}

function makeParty(id = 'fail-party-1', name = 'Fail Party Co'): Party {
  return {
    id,
    name,
    contactPerson: 'Lead',
    phone: '03001234567',
    address: 'Mining District',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makePayment(id = 'fail-pay-1', partyId = 'fail-party-1'): Payment {
  return {
    id,
    partyId,
    date: '2026-10-08',
    amount: 50000,
    type: 'received',
    mode: 'bank',
    referenceNote: 'Bank Transfer',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makePO(id = 'fail-po-1', partyId = 'fail-party-1'): PurchaseOrder {
  return {
    id,
    partyId,
    poNumber: 'PO-FAIL-100',
    targetGcv: 6000,
    baseRate: 32000,
    commissionPerTon: 0,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Issue 25: IndexedDB Dexie Storage Quota Failure Handling', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saveDispatch rejects and stores nothing when idb.dispatches.put throws QuotaExceededError', async () => {
    const d = makeDispatch('disp-quota-test');
    const spy = vi.spyOn(idb.dispatches, 'put').mockRejectedValue(
      Object.assign(new Error('Quota exceeded on device'), { name: 'QuotaExceededError' })
    );

    const beforeCount = (await getDispatches()).length;
    await expect(saveDispatch(d)).rejects.toThrow(/Quota exceeded/);
    spy.mockRestore();

    const afterCount = (await getDispatches()).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('rolls back the dispatch when its linked stock marker cannot be written', async () => {
    const lot: InventoryLot = {
      id: 'lot-atomic-failure',
      supplier: 'Atomic Supplier',
      date: '2026-10-09',
      billedWeight: 10,
      receivedWeight: 10,
      purchaseRate: 20000,
      landedRate: 20000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveLot(lot);

    const dispatch = makeDispatch('dispatch-atomic-failure');
    dispatch.coalInputs = [{
      id: 'ci-atomic-failure',
      lotId: lot.id,
      sourceName: 'Atomic Supplier',
      weight: 10,
      purchaseRate: 20000,
    }];

    const spy = vi.spyOn(idb.lots, 'put').mockRejectedValue(
      Object.assign(new Error('Lot marker write failed'), { name: 'QuotaExceededError' })
    );
    await expect(saveDispatch(dispatch)).rejects.toThrow(/Lot marker write failed/);
    spy.mockRestore();

    expect((await getDispatches()).some((item) => item.id === dispatch.id)).toBe(false);
    expect((await getLot(lot.id))?.usedInDispatchId).toBeUndefined();
  });

  it('deleteDispatch rejects when idb.dispatches.put throws QuotaExceededError', async () => {
    const d = makeDispatch('disp-del-quota');
    await saveDispatch(d);

    const spy = vi.spyOn(idb.dispatches, 'put').mockRejectedValue(
      Object.assign(new Error('Disk write error'), { name: 'QuotaExceededError' })
    );

    await expect(deleteDispatch(d.id)).rejects.toThrow();
    spy.mockRestore();

    // Verify dispatch was not deleted
    const dispatches = await getDispatches();
    expect(dispatches.some((item) => item.id === d.id)).toBe(true);
  });

  it('saveParty rejects and stores nothing when idb.parties.put throws QuotaExceededError', async () => {
    const p = makeParty('party-quota-test');
    const spy = vi.spyOn(idb.parties, 'put').mockRejectedValue(
      Object.assign(new Error('Quota exceeded for table parties'), { name: 'QuotaExceededError' })
    );

    const beforeCount = (await getParties()).length;
    await expect(saveParty(p)).rejects.toThrow(/Quota exceeded/);
    spy.mockRestore();

    const afterCount = (await getParties()).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('deleteParty rejects when idb.parties.put throws QuotaExceededError', async () => {
    const p = makeParty('party-del-quota');
    await saveParty(p);

    const spy = vi.spyOn(idb.parties, 'put').mockRejectedValue(
      Object.assign(new Error('Storage failure'), { name: 'QuotaExceededError' })
    );

    await expect(deleteParty(p.id)).rejects.toThrow();
    spy.mockRestore();

    const parties = await getParties();
    expect(parties.some((item) => item.id === p.id)).toBe(true);
  });

  it('savePayment rejects and stores nothing when idb.payments.put throws QuotaExceededError', async () => {
    const pay = makePayment('pay-quota-test');
    const spy = vi.spyOn(idb.payments, 'put').mockRejectedValue(
      Object.assign(new Error('Quota exceeded for payments'), { name: 'QuotaExceededError' })
    );

    const beforeCount = (await getPayments()).length;
    await expect(savePayment(pay)).rejects.toThrow(/Quota exceeded/);
    spy.mockRestore();

    const afterCount = (await getPayments()).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('deletePayment rejects when idb.payments.put throws QuotaExceededError', async () => {
    const pay = makePayment('pay-del-quota');
    await savePayment(pay);

    const spy = vi.spyOn(idb.payments, 'put').mockRejectedValue(
      Object.assign(new Error('Payment write error'), { name: 'QuotaExceededError' })
    );

    await expect(deletePayment(pay.id)).rejects.toThrow();
    spy.mockRestore();

    const payments = await getPayments();
    expect(payments.some((item) => item.id === pay.id)).toBe(true);
  });

  it('savePurchaseOrder rejects and stores nothing when idb.pos.put throws QuotaExceededError', async () => {
    const po = makePO('po-quota-test');
    const spy = vi.spyOn(idb.pos, 'put').mockRejectedValue(
      Object.assign(new Error('Quota exceeded for purchase orders'), { name: 'QuotaExceededError' })
    );

    const beforeCount = (await getPurchaseOrders()).length;
    await expect(savePurchaseOrder(po)).rejects.toThrow(/Quota exceeded/);
    spy.mockRestore();

    const afterCount = (await getPurchaseOrders()).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('deletePurchaseOrder rejects when idb.pos.put throws QuotaExceededError', async () => {
    const po = makePO('po-del-quota');
    await savePurchaseOrder(po);

    const spy = vi.spyOn(idb.pos, 'put').mockRejectedValue(
      Object.assign(new Error('Purchase order write error'), { name: 'QuotaExceededError' })
    );

    await expect(deletePurchaseOrder(po.id)).rejects.toThrow();
    spy.mockRestore();

    const pos = await getPurchaseOrders();
    expect(pos.some((item) => item.id === po.id)).toBe(true);
  });
});
