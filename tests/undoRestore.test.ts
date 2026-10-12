import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearAllData,
  saveParty,
  saveDispatch,
  getParties,
  getDispatches,
  restoreBackup,
  getPreRestoreSnapshot,
  getPreRestoreSnapshotMeta,
  rollbackToPreRestoreSnapshot,
  type BackupPayload,
} from '../src/lib/db';
import { idb } from '../src/lib/dexieDb';
import type { Party, Dispatch } from '../src/types';

function makeParty(id: string, name: string): Party {
  return {
    id,
    name,
    contactPerson: 'Manager',
    phone: '03001234567',
    address: 'Quetta',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeDispatch(id: string, truckNumber: string, partyId: string): Dispatch {
  return {
    id,
    partyId,
    truckNumber,
    factoryName: 'Alpha Factory',
    targetGcv: 5500,
    labSulphur: 1,
    date: '2026-10-08',
    coalInputs: [{ id: 'c1', sourceName: 'Mine A', weight: 25, purchaseRate: 20000 }],
    overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
    labActualGcv: 5500,
    labReceivedWeight: 25,
    baseRate: 35000,
    status: 'settled',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Issue 24: Pre-Restore Snapshot & Reversible Undo', () => {
  beforeEach(async () => {
    await clearAllData();
    await idb.meta.delete('last_pre_restore_snapshot');
  });

  it('rollbackToPreRestoreSnapshot returns clear failure without crashing when no snapshot exists', async () => {
    const res = await rollbackToPreRestoreSnapshot();
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/No pre-restore snapshot/i);
    expect(await getPreRestoreSnapshot()).toBeNull();
    expect(await getPreRestoreSnapshotMeta()).toBeNull();
  });

  it('restores backup, creates pre-restore snapshot, rolls back to original state, and supports reversible two-way undo', async () => {
    // 1. Initial State A: 1 party, 1 dispatch
    const partyA = makeParty('party-a', 'Factory Alpha');
    const dispatchA = makeDispatch('disp-a', 'TRK-001', 'party-a');
    await saveParty(partyA);
    await saveDispatch(dispatchA);

    expect((await getParties()).length).toBe(1);
    expect((await getDispatches()).length).toBe(1);

    // 2. Perform restore of Backup B: 2 parties, 2 dispatches
    const backupB: Partial<BackupPayload> = {
      exportDate: new Date().toISOString(),
      parties: [
        makeParty('party-b1', 'Factory Beta 1'),
        makeParty('party-b2', 'Factory Beta 2'),
      ],
      dispatches: [
        makeDispatch('disp-b1', 'TRK-901', 'party-b1'),
        makeDispatch('disp-b2', 'TRK-902', 'party-b2'),
      ],
      payments: [],
      expenses: [],
      pos: [],
      lots: [],
      mines: [],
      settings: {} as BackupPayload['settings'],
    };

    const restoreRes = await restoreBackup(backupB);
    expect(restoreRes.success).toBe(true);

    // Verify current state is now Backup B
    const postRestoreParties = await getParties();
    const postRestoreDispatches = await getDispatches();
    expect(postRestoreParties.length).toBe(2);
    expect(postRestoreDispatches.length).toBe(2);
    expect(postRestoreParties.map(p => p.id)).toEqual(['party-b1', 'party-b2']);

    // 3. Inspect Pre-Restore Snapshot & Metadata (State A)
    const snapshotA = await getPreRestoreSnapshot();
    expect(snapshotA).not.toBeNull();
    expect(snapshotA?.parties.length).toBe(1);
    expect(snapshotA?.parties[0].id).toBe('party-a');
    expect(snapshotA?.dispatches.length).toBe(1);

    const meta = await getPreRestoreSnapshotMeta();
    expect(meta).not.toBeNull();
    expect(meta?.partyCount).toBe(1);
    expect(meta?.dispatchCount).toBe(1);
    expect(typeof meta?.dateStr).toBe('string');

    // 4. Rollback: should return cleanly to State A
    const rollbackRes = await rollbackToPreRestoreSnapshot();
    expect(rollbackRes.success).toBe(true);

    const rolledBackParties = await getParties();
    const rolledBackDispatches = await getDispatches();
    expect(rolledBackParties.length).toBe(1);
    expect(rolledBackParties[0].id).toBe('party-a');
    expect(rolledBackDispatches.length).toBe(1);
    expect(rolledBackDispatches[0].id).toBe('disp-a');

    // 5. Reversible Two-Way Undo:
    // The rollback itself took a snapshot of State B before restoring State A!
    const updatedMeta = await getPreRestoreSnapshotMeta();
    expect(updatedMeta).not.toBeNull();
    expect(updatedMeta?.partyCount).toBe(2);
    expect(updatedMeta?.dispatchCount).toBe(2);

    // Rolling back again restores State B!
    const redoRes = await rollbackToPreRestoreSnapshot();
    expect(redoRes.success).toBe(true);

    const redoneParties = await getParties();
    const redoneDispatches = await getDispatches();
    expect(redoneParties.length).toBe(2);
    expect(redoneDispatches.length).toBe(2);
    expect(redoneParties.map(p => p.id)).toEqual(['party-b1', 'party-b2']);
  });

  it('expires and purges snapshots older than 7 days', async () => {
    const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
    const stalePayload: BackupPayload = {
      exportDate: new Date(eightDaysAgo).toISOString(),
      parties: [makeParty('p-old', 'Old Plant')],
      dispatches: [],
      payments: [],
      pos: [],
      settings: {} as any,
    };

    await idb.meta.put({
      key: 'last_pre_restore_snapshot',
      value: stalePayload,
      updatedAt: eightDaysAgo,
    });

    // Should detect expiration, delete from idb.meta, and return null
    expect(await getPreRestoreSnapshot()).toBeNull();
    expect(await getPreRestoreSnapshotMeta()).toBeNull();

    const stored = await idb.meta.get('last_pre_restore_snapshot');
    expect(stored).toBeUndefined();
  });
});
