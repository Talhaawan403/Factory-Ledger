import { describe, it, expect, beforeEach } from 'vitest';
import {
  mergeLedgerData,
  recordSyncConflicts,
  getSyncConflictHistory,
  clearSyncConflictHistory,
  type ConflictAuditEntry,
} from '../src/lib/db';
import type { Party, Dispatch } from '../src/types';

describe('Integrity & Audit: Conflict Snapshot Retention & History Capacity', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearSyncConflictHistory();
  });

  it('captures full losing and winning snapshots when cloud wins', () => {
    const localParty: Party = {
      id: 'party-c1',
      name: 'Local Version Party',
      contactPerson: 'Local Contact',
      phone: '03001111111',
      address: 'Local Address',
      updatedAt: 1000,
      createdAt: 500,
    };

    const cloudParty: Party = {
      id: 'party-c1',
      name: 'Cloud Version Party',
      contactPerson: 'Cloud Contact',
      phone: '03002222222',
      address: 'Cloud Address',
      updatedAt: 2000,
      createdAt: 500,
    };

    const { merged, conflicts } = mergeLedgerData(
      { parties: [localParty], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
      { parties: [cloudParty], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any
    );

    expect(merged.parties[0].name).toBe('Cloud Version Party');
    expect(conflicts.length).toBe(1);

    const conflict = conflicts[0];
    expect(conflict.entityId).toBe('party-c1');
    expect(conflict.collection).toBe('parties');
    expect(conflict.winner).toBe('cloud');
    expect(conflict.winningSnapshot).toEqual(cloudParty);
    expect(conflict.losingSnapshot).toEqual(localParty);
    expect((conflict.losingSnapshot as Party).name).toBe('Local Version Party');
  });

  it('captures full losing and winning snapshots when local wins', () => {
    const localDispatch: Partial<Dispatch> = {
      id: 'disp-c2',
      truckNumber: 'TRK-LOCAL-999',
      baseRate: 40000,
      updatedAt: 3000,
      createdAt: 1000,
    };

    const cloudDispatch: Partial<Dispatch> = {
      id: 'disp-c2',
      truckNumber: 'TRK-CLOUD-888',
      baseRate: 35000,
      updatedAt: 2000,
      createdAt: 1000,
    };

    const { merged, conflicts } = mergeLedgerData(
      { parties: [], dispatches: [localDispatch], payments: [], pos: [], lots: [], mines: [] } as any,
      { parties: [], dispatches: [cloudDispatch], payments: [], pos: [], lots: [], mines: [] } as any
    );

    expect(merged.dispatches[0].truckNumber).toBe('TRK-LOCAL-999');
    expect(conflicts.length).toBe(1);

    const conflict = conflicts[0];
    expect(conflict.entityId).toBe('disp-c2');
    expect(conflict.winner).toBe('local');
    expect(conflict.winningSnapshot).toEqual(localDispatch);
    expect(conflict.losingSnapshot).toEqual(cloudDispatch);
    expect((conflict.losingSnapshot as Partial<Dispatch>).truckNumber).toBe('TRK-CLOUD-888');
  });

  it('captures delete-versus-edit and equal-timestamp conflicts', () => {
    const localDeleted = {
      id: 'party-delete',
      deleted: true,
      deletedAt: 3000,
      updatedAt: 3000,
    } as Party;
    const cloudEdited = {
      id: 'party-delete',
      name: 'Cloud Edit',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 1000,
      updatedAt: 2000,
    };
    const deletedResult = mergeLedgerData(
      { parties: [localDeleted], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
      { parties: [cloudEdited], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
    );
    expect(deletedResult.conflicts[0]).toMatchObject({
      conflictType: 'delete-vs-edit',
      winner: 'local',
      winningSnapshot: expect.objectContaining({ deleted: true }),
      losingSnapshot: expect.objectContaining({ name: 'Cloud Edit' }),
    });

    const localEqual = { ...cloudEdited, id: 'party-equal', name: 'Local Equal', updatedAt: 4000 };
    const cloudEqual = { ...cloudEdited, id: 'party-equal', name: 'Cloud Equal', updatedAt: 4000 };
    const equalResult = mergeLedgerData(
      { parties: [localEqual], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
      { parties: [cloudEqual], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
    );
    expect(equalResult.hasCloudChanges).toBe(true);
    expect(equalResult.conflicts[0]).toMatchObject({ conflictType: 'equal-timestamp', winner: 'local' });
  });

  it('records conflict snapshots into IndexedDB and retains the newest 200 entries', async () => {
    // Generate 250 conflict entries
    const entries: ConflictAuditEntry[] = Array.from({ length: 250 }, (_, i) => ({
      entityId: `id-${i}`,
      id: `conflict-${i}`,
      collection: 'parties',
      localUpdatedAt: 1000 + i,
      cloudUpdatedAt: 2000 + i,
      winner: 'cloud' as const,
      timestamp: 1000 + i,
      winningSnapshot: { id: `id-${i}`, version: 'cloud' },
      losingSnapshot: { id: `id-${i}`, version: 'local' },
      conflictType: 'update-vs-update' as const,
    }));

    await recordSyncConflicts(entries);

    const history = await getSyncConflictHistory();
    expect(history.length).toBe(200);
    expect(history[0].entityId).toBe('id-249');
    expect(history[199].entityId).toBe('id-50');
    expect(history[0].losingSnapshot).toEqual({ id: 'id-249', version: 'local' });
    expect(history[0].winningSnapshot).toEqual({ id: 'id-249', version: 'cloud' });
  });
});
