import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INITIAL_SETTINGS,
  clearAllData,
  getParties,
  getPayments,
  restoreBackup,
  saveParty,
  validateBackupPayload,
  type BackupPayload,
} from '../src/lib/db';
import { idb } from '../src/lib/dexieDb';
import type { Party } from '../src/types';

const now = 1_760_000_000_000;

function party(id: string, name = 'Alpha Coal Co'): Party {
  return {
    id,
    name,
    contactPerson: '',
    phone: '',
    address: '',
    createdAt: now,
    updatedAt: now,
  };
}

function fullBackup(overrides: Partial<BackupPayload> = {}): BackupPayload {
  return {
    version: '2026.10_books_v3',
    exportDate: '2026-10-12T00:00:00.000Z',
    parties: [],
    dispatches: [],
    payments: [],
    expenses: [],
    pos: [],
    lots: [],
    mines: [],
    settings: { ...INITIAL_SETTINGS, updatedAt: now },
    ...overrides,
  };
}

describe('Integrity & Validation: Backup Payload & Restore Hardening', () => {
  beforeEach(async () => {
    await clearAllData({ resetSettings: true, resetOwner: true });
    await idb.meta.delete('last_pre_restore_snapshot');
  });

  it('rejects empty and partial replacement payloads instead of treating missing collections as empty', async () => {
    expect(validateBackupPayload({}).error).toMatch(/export date/i);
    expect(validateBackupPayload({ exportDate: '2026-10-12T00:00:00.000Z', settings: {}, parties: [] }).error)
      .toMatch(/required dispatches collection/i);

    await saveParty(party('existing'));
    const result = await restoreBackup({} as BackupPayload);
    expect(result.success).toBe(false);
    expect((await getParties()).map((record) => record.id)).toEqual(['existing']);
  });

  it('rejects an empty party ID or name and duplicate IDs', () => {
    const invalidId = fullBackup({ parties: [{ ...party('valid'), id: '' }] });
    expect(validateBackupPayload(invalidId).error).toMatch(/empty or invalid ID/i);

    const invalidName = fullBackup({ parties: [party('p-1', '   ')] });
    expect(validateBackupPayload(invalidName).error).toMatch(/empty or invalid name/i);

    const duplicate = fullBackup({ parties: [party('p-dup', 'Alpha'), party('p-dup', 'Beta')] });
    expect(validateBackupPayload(duplicate).error).toMatch(/duplicate party id "p-dup"/i);
  });

  it('rejects invalid payment values and orphan references even when the party list is empty', () => {
    const validPayment = {
      id: 'pay-1',
      partyId: 'p-1',
      amount: 500,
      date: '2026-10-10',
      type: 'received' as const,
      mode: 'bank' as const,
      createdAt: now,
      updatedAt: now,
    };

    expect(validateBackupPayload(fullBackup({ payments: [validPayment] })).error)
      .toMatch(/references non-existent party/i);
    expect(validateBackupPayload(fullBackup({ parties: [party('p-1')], payments: [{ ...validPayment, amount: -100 }] })).error)
      .toMatch(/amount greater than zero/i);
    expect(validateBackupPayload(fullBackup({ parties: [party('p-1')], payments: [{ ...validPayment, date: '2026-02-30' }] })).error)
      .toMatch(/invalid date/i);
    expect(validateBackupPayload(fullBackup({ parties: [party('p-1')], payments: [{ ...validPayment, type: 'refund' as any }] })).error)
      .toMatch(/invalid payment type/i);
  });

  it('rejects orphan dispatches and purchase orders plus malformed domain values', () => {
    const baseDispatch = {
      id: 'dispatch-1',
      partyId: 'missing-party',
      date: '2026-10-12',
      truckNumber: 'TK-1',
      factoryName: 'Factory',
      targetGcv: 4500,
      baseRate: 30000,
      coalInputs: [{ id: 'coal-1', sourceName: 'Mine', weight: 10, purchaseRate: 20000 }],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      labActualGcv: 0,
      labSulphur: 0,
      labReceivedWeight: 0,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    };
    expect(validateBackupPayload(fullBackup({ dispatches: [baseDispatch] })).error)
      .toMatch(/references non-existent party/i);

    const po = {
      id: 'po-1',
      partyId: 'missing-party',
      poNumber: 'PO-1',
      targetGcv: 4500,
      baseRate: 30000,
      commissionPerTon: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    expect(validateBackupPayload(fullBackup({ pos: [po] })).error)
      .toMatch(/references non-existent party/i);
    expect(validateBackupPayload(fullBackup({ parties: [party('p-1')], dispatches: [{ ...baseDispatch, partyId: 'p-1', baseRate: 'bad' as any }] })).error)
      .toMatch(/invalid baseRate/i);
  });

  it('aborts before writes when validation or the required safety snapshot fails', async () => {
    await saveParty(party('existing-p1', 'Safe Party'));
    const validationFailure = await restoreBackup(fullBackup({ parties: [{ ...party('bad'), id: '' }] }));
    expect(validationFailure.success).toBe(false);
    expect((await getParties()).map((record) => record.id)).toEqual(['existing-p1']);

    const snapshotSpy = vi.spyOn(idb.meta, 'put').mockRejectedValueOnce(new Error('disk full'));
    const snapshotFailure = await restoreBackup(fullBackup({ parties: [party('replacement')] }));
    expect(snapshotFailure.success).toBe(false);
    expect(snapshotFailure.message).toMatch(/safety snapshot/i);
    expect((await getParties()).map((record) => record.id)).toEqual(['existing-p1']);
    snapshotSpy.mockRestore();
  });

  it('rolls back all table writes when in-transaction readback verification fails', async () => {
    await saveParty(party('existing-p1', 'Safe Party'));
    const countSpy = vi.spyOn(idb.parties, 'count').mockResolvedValueOnce(99);

    const result = await restoreBackup(fullBackup({ parties: [party('replacement')] }), { skipSnapshot: true });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/post-write verification mismatch/i);
    expect((await getParties()).map((record) => record.id)).toEqual(['existing-p1']);
    countSpy.mockRestore();
  });

  it('restores a valid full backup and returns verified IndexedDB counts', async () => {
    const backup = fullBackup({
      parties: [party('p-1'), party('p-2', 'Beta Power Plant')],
      payments: [{
        id: 'pay-1',
        partyId: 'p-1',
        amount: 250000,
        date: '2026-10-10',
        type: 'received',
        mode: 'bank',
        createdAt: now,
        updatedAt: now,
      }],
    });

    const result = await restoreBackup(backup);
    expect(result.success).toBe(true);
    expect(result.counts).toMatchObject({ parties: 2, payments: 1 });
    expect(await getParties()).toHaveLength(2);
    expect(await getPayments()).toHaveLength(1);
  });
});
