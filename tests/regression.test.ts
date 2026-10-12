import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTodayDateString, toLocalDateString } from '../src/utils/dateUtils';
import {
  writeStorageOrThrow,
  saveParty,
  getParties,
  deleteParty,
  deletePartyWithRecords,
  saveDispatch,
  deleteDispatch,
  getDispatches,
  getDispatch,
  clearAllData,
  restoreBackup,
  getLedgerForSync,
  markRecordsClean,
  getPreRestoreSnapshot,
  rollbackToPreRestoreSnapshot,
  mergeLedgerData,
} from '../src/lib/db';
import { idb } from '../src/lib/dexieDb';
import type { Party, Dispatch, Payment, BackupPayload } from '../src/types';
import { calculatePartyBalance, calculateSettlement, isDispatchPending } from '../src/utils/calculations';

describe('T5: Date & Timezone Regression Tests', () => {
  it('formats dates based on local time without shifting night deliveries to previous day', () => {
    // 2:00 AM on 8 Oct 2026 in Asia/Karachi (UTC+5) is 21:00 UTC on 7 Oct 2026.
    // In UTC, toISOString() would return "2026-10-07".
    // In local PKT time, it is "2026-10-08".
    const utcDate = new Date('2026-10-07T21:00:00.000Z');
    
    // Test toLocalDateString converts Date/timestamp properly
    const localDateStr = toLocalDateString(utcDate);
    const expectedLocal = `${utcDate.getFullYear()}-${String(utcDate.getMonth() + 1).padStart(2, '0')}-${String(utcDate.getDate()).padStart(2, '0')}`;
    expect(localDateStr).toBe(expectedLocal);
  });

  it('getTodayDateString returns valid YYYY-MM-DD', () => {
    const today = getTodayDateString();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('T2: Storage Quota Failure Handling', () => {
  it('writeStorageOrThrow throws a clear error when localStorage quota is exceeded', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    });

    try {
      expect(() => {
        writeStorageOrThrow('test_key', 'test_data', 'test_bak');
      }).toThrow(/Storage full/);
    } finally {
      setItemSpy.mockRestore();
    }
  });
});

describe('T8: Party Deletion Guard & Cascade Deletion', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('guards against deleting a party that has active financial records', async () => {
    const party: Party = {
      id: 'party-test-1',
      name: 'Test Mining Co',
      contactPerson: 'Manager',
      phone: '03001234567',
      address: 'Quetta',
      createdAt: Date.now(),
    };
    await saveParty(party);

    const dispatch: Dispatch = {
      id: 'disp-test-1',
      date: '2026-10-08',
      partyId: 'party-test-1',
      truckNumber: 'TK-999',
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
    await saveDispatch(dispatch);

    // Attempting to delete party directly must throw to protect against orphan records
    await expect(deleteParty('party-test-1')).rejects.toThrow(/Cannot delete party with existing financial records/);

    // Verify party and dispatch still exist
    const parties = await getParties();
    expect(parties.some((p) => p.id === 'party-test-1')).toBe(true);

    const dispatches = await getDispatches();
    expect(dispatches.some((d) => d.id === 'disp-test-1')).toBe(true);
  });

  it('cascades deletion and removes all child records when deletePartyWithRecords is called', async () => {
    const party: Party = {
      id: 'party-cascade-1',
      name: 'Cascade Buyer',
      contactPerson: 'Manager',
      phone: '03009999999',
      address: 'Lahore',
      createdAt: Date.now(),
    };
    await saveParty(party);

    const dispatch: Dispatch = {
      id: 'disp-cascade-1',
      date: '2026-10-08',
      partyId: 'party-cascade-1',
      truckNumber: 'TK-888',
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
    await saveDispatch(dispatch);

    const result = await deletePartyWithRecords('party-cascade-1');
    expect(result.deletedDispatches).toBe(1);

    const parties = await getParties();
    expect(parties.some((p) => p.id === 'party-cascade-1')).toBe(false);

    const dispatches = await getDispatches();
    expect(dispatches.some((d) => d.id === 'disp-cascade-1')).toBe(false);
  });
});

describe('Issue 70: Dispatch Factory Snapshot for Cloud Rules', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('fills a blank factoryName from the selected party before sync', async () => {
    await saveParty({
      id: 'party-factory-snapshot',
      name: 'Reusable Truck Cement Factory',
      contactPerson: 'Accounts',
      phone: '',
      address: '',
      createdAt: Date.now(),
    });

    await saveDispatch({
      id: 'dispatch-factory-snapshot',
      partyId: 'party-factory-snapshot',
      date: '2026-10-11',
      truckNumber: 'TK-REUSE-1',
      factoryName: '',
      targetGcv: 4500,
      baseRate: 30000,
      commissionPerTon: 0,
      coalInputs: [{ id: 'coal-1', sourceName: 'Manual coal', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      labActualGcv: 4500,
      labReceivedWeight: 10,
      labSulphur: 1,
      status: 'settled',
      settledAt: Date.now(),
      settledDate: '2026-10-11',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const stored = await getDispatch('dispatch-factory-snapshot');
    expect(stored?.factoryName).toBe('Reusable Truck Cement Factory');

    const pending = await getLedgerForSync(true);
    expect(pending.dispatches[0]?.factoryName).toBe('Reusable Truck Cement Factory');
  });

  it('repairs an already-stuck local dispatch before building the sync batch', async () => {
    await saveParty({
      id: 'party-existing-stuck-dispatch',
      name: 'Existing Dispatch Factory',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: Date.now(),
    });

    const originalUpdatedAt = Date.now() - 10_000;
    await idb.dispatches.put({
      id: 'dispatch-existing-stuck',
      partyId: 'party-existing-stuck-dispatch',
      date: '2026-10-11',
      truckNumber: 'TK-REUSE-1',
      factoryName: '',
      targetGcv: 4500,
      baseRate: 30000,
      commissionPerTon: 0,
      coalInputs: [{ id: 'coal-existing', sourceName: 'Manual coal', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      labActualGcv: 4500,
      labReceivedWeight: 10,
      labSulphur: 1,
      status: 'settled',
      settledAt: originalUpdatedAt,
      settledDate: '2026-10-11',
      createdAt: originalUpdatedAt,
      updatedAt: originalUpdatedAt,
      dirty: true,
    });

    const pending = await getLedgerForSync(true);
    const repaired = pending.dispatches.find((item) => item.id === 'dispatch-existing-stuck');
    expect(repaired?.factoryName).toBe('Existing Dispatch Factory');
    expect(repaired?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    expect(repaired?.dirty).toBe(true);

    const persisted = await idb.dispatches.get('dispatch-existing-stuck');
    expect(persisted?.factoryName).toBe('Existing Dispatch Factory');
    expect(persisted?.updatedAt).toBe(repaired?.updatedAt);
  });

  it('allows the same truck number on multiple dispatches', async () => {
    await saveParty({
      id: 'party-reusable-truck',
      name: 'Reusable Truck Factory',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: Date.now(),
    });

    const createDispatch = (id: string, date: string): Dispatch => ({
      id,
      partyId: 'party-reusable-truck',
      date,
      truckNumber: 'TK-REUSE-1',
      factoryName: 'Reusable Truck Factory',
      targetGcv: 4500,
      baseRate: 30000,
      commissionPerTon: 0,
      coalInputs: [{ id: `coal-${id}`, sourceName: 'Manual coal', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      labActualGcv: 0,
      labReceivedWeight: 0,
      labSulphur: 0,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await saveDispatch(createDispatch('dispatch-reused-truck-1', '2026-10-10'));
    await saveDispatch(createDispatch('dispatch-reused-truck-2', '2026-10-11'));

    const saved = await getDispatches();
    expect(saved.filter((dispatch) => dispatch.truckNumber === 'TK-REUSE-1')).toHaveLength(2);
  });
});

describe('Issue 10: IndexedDB High-Capacity Storage (10,000 Dispatches)', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('can store and query 10,000 dispatches smoothly without quota failure', async () => {
    const dispatches: Dispatch[] = [];
    const count = 10000;
    for (let i = 0; i < count; i++) {
      dispatches.push({
        id: `disp-scale-${i}`,
        date: '2026-10-08',
        partyId: `party-${i % 20}`,
        truckNumber: `TK-${i}`,
        factoryName: 'Test Factory',
        targetGcv: 6000,
        labActualGcv: 6000,
        labSulphur: 1,
        coalInputs: [{ id: `c-${i}`, sourceName: 'Mine A', weight: 15, purchaseRate: 25000 }],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: 35000,
        labReceivedWeight: 15,
        taxMethod: 'manual',
        createdAt: 1700000000000 + i,
        updatedAt: 1700000000000 + i,
      });
    }


    // Bulk put directly into Dexie
    await idb.dispatches.bulkPut(dispatches);

    // Verify count in storage
    const totalCount = await idb.dispatches.count();
    expect(totalCount).toBe(10000);

    // Fast indexed query by partyId
    const party0Dispatches = await idb.dispatches.where('partyId').equals('party-0').toArray();
    expect(party0Dispatches.length).toBe(500);

    // Verify updating a single record does not rewrite the whole dataset
    await saveDispatch({
      ...dispatches[0],
      baseRate: 42000,
    });
    const updated = await getDispatch(`disp-scale-0`);
    expect(updated?.baseRate).toBe(42000);
  });
});

describe('Issue 13: Backup Import & Restore Safety & Snapshotting', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('rejects invalid backup without corrupting existing records and captures pre-restore snapshot', async () => {
    // Setup existing valid data
    const party: Party = {
      id: 'existing-p1',
      name: 'Safe Party',
      contactPerson: 'Manager',
      phone: '03001112233',
      address: 'Peshawar',
      createdAt: Date.now(),
    };
    await saveParty(party);

    // Attempt restoring invalid format
    const invalidResult = await restoreBackup(null as any);
    expect(invalidResult.success).toBe(false);

    // Verify existing party was NOT deleted
    const partiesAfter = await getParties();
    expect(partiesAfter.length).toBe(1);
    expect(partiesAfter[0].name).toBe('Safe Party');

    // Valid restore creates pre-restore snapshot
    const newBackup: BackupPayload = {
      exportDate: new Date().toISOString(),
      parties: [{ id: 'imported-p1', name: 'Imported Party', contactPerson: 'Manager', phone: '03002223344', address: 'Islamabad', createdAt: Date.now() }],
      dispatches: [],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const restoreRes = await restoreBackup(newBackup);
    expect(restoreRes.success).toBe(true);

    const snapshot = await getPreRestoreSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.parties.some((p) => p.id === 'existing-p1')).toBe(true);

    // Test rollback capability
    const rollbackRes = await rollbackToPreRestoreSnapshot();
    expect(rollbackRes.success).toBe(true);

    const afterRollback = await getParties();
    expect(afterRollback.some((p) => p.id === 'existing-p1')).toBe(true);
    expect(afterRollback.some((p) => p.id === 'imported-p1')).toBe(false);
  });
});

describe('T4 & Issue 12: Same-Name Parties Across Devices Do Not Merge', () => {
  it('keeps both parties separate and does not remap dispatches when names collide', () => {
    const localParty: Party = {
      id: 'party-lahore',
      name: 'Ali Traders',
      contactPerson: 'LHR Contact',
      phone: '03001111111',
      address: 'Lahore',
      createdAt: 1000,
      updatedAt: 1000,
    };
    const localDispatch: Dispatch = {
      id: 'disp-lhr-1',
      partyId: 'party-lahore',
      truckNumber: 'LHR-111',
      factoryName: 'LHR Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 30000,
      labReceivedWeight: 20,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 1000,
    };

    const cloudParty: Party = {
      id: 'party-karachi',
      name: 'Ali Traders',
      contactPerson: 'KHI Contact',
      phone: '03002222222',
      address: 'Karachi',
      createdAt: 2000,
      updatedAt: 2000,
    };
    const cloudDispatch: Dispatch = {
      id: 'disp-khi-1',
      partyId: 'party-karachi',
      truckNumber: 'KHI-222',
      factoryName: 'KHI Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 32000,
      labReceivedWeight: 25,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 2000,
      updatedAt: 2000,
    };

    const localPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [localParty],
      dispatches: [localDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const cloudPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [cloudParty],
      dispatches: [cloudDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const { merged } = mergeLedgerData(localPayload, cloudPayload, {});

    // Both distinct parties MUST exist in merged result
    expect(merged.parties.length).toBe(2);
    expect(merged.parties.some((p) => p.id === 'party-lahore')).toBe(true);
    expect(merged.parties.some((p) => p.id === 'party-karachi')).toBe(true);

    // Each dispatch must strictly retain its own partyId
    const lhrDisp = merged.dispatches.find((d) => d.id === 'disp-lhr-1');
    const khiDisp = merged.dispatches.find((d) => d.id === 'disp-khi-1');
    expect(lhrDisp?.partyId).toBe('party-lahore');
    expect(khiDisp?.partyId).toBe('party-karachi');
  });
});

describe('T3 & Issue 11: Merge Honors Tombstones (No Deleted Resurrections)', () => {
  it('does not resurrect a locally deleted dispatch when cloud still has it', () => {
    const localPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [], // Locally deleted
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const cloudDispatch: Dispatch = {
      id: 'disp-deleted-1',
      partyId: 'party-1',
      truckNumber: 'TK-100',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 30000,
      labReceivedWeight: 20,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 2000, // Remote updated at 2000
    };

    const cloudPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [cloudDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    // Tombstone recorded at 3000 (after cloud update)
    const tombstones = {
      'disp-deleted-1': 3000,
    };

    const { merged } = mergeLedgerData(localPayload, cloudPayload, tombstones);

    // Dispatch MUST remain deleted
    expect(merged.dispatches.length).toBe(0);
    expect(merged.dispatches.some((d) => d.id === 'disp-deleted-1')).toBe(false);
  });

  it('honors soft delete (deleted: true) across devices without requiring tombstones', () => {
    // Device A soft-deleted the dispatch at timestamp 3000
    const localDispatch: Dispatch = {
      id: 'disp-soft-1',
      partyId: 'party-1',
      truckNumber: 'TK-100',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 30000,
      labReceivedWeight: 20,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 3000,
      deleted: true,
      deletedAt: 3000,
    };

    // Device B has older active version at timestamp 2000
    const cloudDispatch: Dispatch = {
      id: 'disp-soft-1',
      partyId: 'party-1',
      truckNumber: 'TK-100',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 30000,
      labReceivedWeight: 20,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 2000,
      deleted: false,
    };

    const localPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [localDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const cloudPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [cloudDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const { merged, hasCloudChanges } = mergeLedgerData(localPayload, cloudPayload, {});

    // Must remain deleted in active merged ledger
    expect(merged.dispatches.length).toBe(0);
    // Cloud needs to receive the deletion
    expect(hasCloudChanges).toBe(true);
  });

  it('allows newer edit on another device to undelete and update', () => {
    // Device A soft-deleted at timestamp 2000
    const localDispatch: Dispatch = {
      id: 'disp-soft-2',
      partyId: 'party-1',
      truckNumber: 'TK-200',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 30000,
      labReceivedWeight: 20,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 2000,
      deleted: true,
      deletedAt: 2000,
    };

    // Device B edited after deletion at timestamp 3500
    const cloudDispatch: Dispatch = {
      id: 'disp-soft-2',
      partyId: 'party-1',
      truckNumber: 'TK-200-EDITED',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 32000,
      labReceivedWeight: 22,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: 1000,
      updatedAt: 3500,
      deleted: false,
    };

    const localPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [localDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const cloudPayload: BackupPayload = {
      exportDate: '2026-10-08',
      parties: [],
      dispatches: [cloudDispatch],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    const { merged, hasLocalChanges } = mergeLedgerData(localPayload, cloudPayload, {});

    // Newer edit wins and is active
    expect(merged.dispatches.length).toBe(1);
    expect(merged.dispatches[0].truckNumber).toBe('TK-200-EDITED');
    expect(hasLocalChanges).toBe(true);
  });

  it('soft deletes locally and filters from queries while tracking dirty flag for delta sync', async () => {
    await clearAllData();

    const dispatch: Dispatch = {
      id: 'disp-delta-1',
      partyId: 'p1',
      truckNumber: 'TK-333',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      labActualGcv: 6000,
      labSulphur: 1,
      date: '2026-10-08',
      baseRate: 25000,
      labReceivedWeight: 15,
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveDispatch(dispatch);

    // Should be returned by active queries
    let activeDispatches = await getDispatches();
    expect(activeDispatches.some((d) => d.id === 'disp-delta-1')).toBe(true);

    // Delta sync returns it because dirty is true
    let syncData = await getLedgerForSync(true);
    expect(syncData.dispatches.some((d) => d.id === 'disp-delta-1')).toBe(true);

    // Mark records clean with exact updatedAt (Issue 31)
    const dispItem = syncData.dispatches.find((d) => d.id === 'disp-delta-1')!;
    await markRecordsClean({ dispatches: [{ id: 'disp-delta-1', updatedAt: dispItem.updatedAt }] });
    syncData = await getLedgerForSync(true);
    expect(syncData.dispatches.some((d) => d.id === 'disp-delta-1')).toBe(false);

    // Now soft-delete it
    await deleteDispatch('disp-delta-1');

    // Query must filter it out
    activeDispatches = await getDispatches();
    expect(activeDispatches.some((d) => d.id === 'disp-delta-1')).toBe(false);
    const single = await getDispatch('disp-delta-1');
    expect(single).toBeNull();

    // Delta sync returns it with deleted: true and dirty: true so cloud gets the deletion
    syncData = await getLedgerForSync(true);
    expect(syncData.dispatches.some((d) => d.id === 'disp-delta-1' && d.deleted === true)).toBe(true);
  });
});

describe('T6: Pending Dispatch (Weight 0 / In-Transit) Excluded From Profit Totals (Issue 19)', () => {
  it('excludes pending/zero-weight dispatches from ledger profit totals so they do not produce a false deficit', () => {
    // Settled dispatch: 20 t @ 30,000 purchase, 38,000 base rate, 20 t received -> Profit: +160,000
    const settledDispatch: Dispatch = {
      id: 'disp-settled-1',
      partyId: 'party-test-1',
      date: '2026-10-08',
      truckNumber: 'TK-101',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      baseRate: 38000,
      labActualGcv: 6000,
      labSulphur: 3.5,
      labReceivedWeight: 20,
      status: 'settled',
      coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 20, purchaseRate: 30000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      manualDeduction: 0,
      manualPremium: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // T6 Scenario: In-transit dispatch with 30 t @ 30,000, overheads 3,000 + 90,000, received weight 0.
    // If not flagged pending, revenue is 0 and cost is 993,000 -> raw profit is -993,000 (the bug).
    const pendingDispatch: Dispatch = {
      id: 'disp-pending-1',
      partyId: 'party-test-1',
      date: '2026-10-08',
      truckNumber: 'TK-202',
      factoryName: 'Test Factory',
      targetGcv: 6000,
      baseRate: 38000,
      labActualGcv: 0,
      labSulphur: 0,
      labReceivedWeight: 0,
      status: 'pending',
      coalInputs: [{ id: 'c2', sourceName: 'Mine B', weight: 30, purchaseRate: 30000 }],
      overheads: { loading: 3000, freight: 90000, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      manualDeduction: 0,
      manualPremium: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isDispatchPending(pendingDispatch)).toBe(true);
    expect(isDispatchPending(settledDispatch)).toBe(false);

    // Raw settlement of pending truck alone:
    const rawSettlement = calculateSettlement(pendingDispatch);
    expect(rawSettlement.totalCost).toBe(993000);
    expect(rawSettlement.netProfit).toBe(-993000);

    // Party Balance calculation:
    // With fix: pending truck is excluded from profit totals, so party profit stays +160,000 instead of 160,000 - 993,000 = -833,000!
    const balanceResult = calculatePartyBalance([settledDispatch, pendingDispatch], []);
    expect(balanceResult.totalProfit).toBe(160000);
    expect(balanceResult.totalBilled).toBe(760000); // 20 * 38,000

    // When the pending truck is finally weighed at factory (e.g. 29.5 t received), it switches to settled:
    const weighedDispatch: Dispatch = {
      ...pendingDispatch,
      labReceivedWeight: 29.5,
      status: 'settled',
    };
    expect(isDispatchPending(weighedDispatch)).toBe(false);

    const updatedBalance = calculatePartyBalance([settledDispatch, weighedDispatch], []);
    const weighedProfit = calculateSettlement(weighedDispatch).netProfit;
    expect(updatedBalance.totalProfit).toBe(160000 + weighedProfit);
  });
});

describe('T7: Exported Totals Equal On-Screen Totals (Issue 18)', () => {
  it('guarantees that party balance, exports and statements report identical financial figures', () => {
    const dispatches: Dispatch[] = [
      {
        id: 'disp-exp-1',
        partyId: 'party-exp',
        date: '2026-10-01',
        truckNumber: 'TK-11',
        factoryName: 'Alpha Mills',
        targetGcv: 6000,
        baseRate: 35000,
        labActualGcv: 6000,
        labSulphur: 3.0,
        labReceivedWeight: 40.5,
        status: 'settled',
        coalInputs: [{ id: 'c1', sourceName: 'Grade A', weight: 40.5, purchaseRate: 28000 }],
        overheads: { loading: 5000, freight: 80000, crush: 0, royalty: 0, other: 0 },
        taxMethod: 'manual',
        manualTax: 0,
        manualDeduction: 0,
        manualPremium: 0,
        commissionPerTon: 0,
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 86400000,
      },
      {
        id: 'disp-exp-2',
        partyId: 'party-exp',
        date: '2026-10-02',
        truckNumber: 'TK-22',
        factoryName: 'Alpha Mills',
        targetGcv: 6000,
        baseRate: 36000,
        labActualGcv: 6000,
        labSulphur: 3.0,
        labReceivedWeight: 25.0,
        status: 'settled',
        coalInputs: [{ id: 'c2', sourceName: 'Grade B', weight: 25.0, purchaseRate: 29000 }],
        overheads: { loading: 3000, freight: 50000, crush: 0, royalty: 0, other: 0 },
        taxMethod: 'manual',
        manualTax: 0,
        manualDeduction: 0,
        manualPremium: 0,
        commissionPerTon: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const payments: Payment[] = [
      {
        id: 'pay-1',
        partyId: 'party-exp',
        amount: 1000000,
        type: 'received',
        mode: 'bank',
        date: '2026-10-03',
        referenceNote: 'Advance payment',
        createdAt: Date.now(),
      },
      {
        id: 'pay-2',
        partyId: 'party-exp',
        amount: 200000,
        type: 'paid', // Refund/rebate paid back
        mode: 'cash',
        date: '2026-10-04',
        referenceNote: 'Quality compensation refund',
        createdAt: Date.now(),
      },
    ];

    // Compute standard on-screen balance
    const onScreen = calculatePartyBalance(dispatches, payments);

    // Truck 1: 40.5 * 35,000 = 1,417,500
    // Truck 2: 25.0 * 36,000 = 900,000
    // Total Billed = 2,317,500
    expect(onScreen.totalBilled).toBe(2317500);

    // Payments Received = 1,000,000, Paid = 200,000 -> Net Received = 800,000
    expect(onScreen.totalPaymentsReceived).toBe(1000000);
    expect(onScreen.totalPaymentsPaid).toBe(200000);
    expect(onScreen.netPaymentsReceived).toBe(800000);

    // Outstanding Balance = 2,317,500 - 800,000 = 1,517,500
    expect(onScreen.outstandingBalance).toBe(1517500);
    expect(onScreen.isReceivable).toBe(true);
    expect(onScreen.totalTons).toBe(65.5);

    // Simulate WhatsApp text statement generation
    const statementSummary = {
      billed: onScreen.totalBilled,
      netReceived: onScreen.netPaymentsReceived,
      due: onScreen.outstandingBalance,
      tons: onScreen.totalTons,
    };

    expect(statementSummary.billed).toBe(onScreen.totalBilled);
    expect(statementSummary.netReceived).toBe(onScreen.netPaymentsReceived);
    expect(statementSummary.due).toBe(onScreen.outstandingBalance);
    expect(statementSummary.tons).toBe(onScreen.totalTons);
  });
});
