import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  fetchLedgerFromCloud: vi.fn(),
  syncLedgerToCloud: vi.fn(),
}));

vi.mock('../src/lib/firebase', () => ({
  auth: { currentUser: null },
  isFirebaseConfigured: true,
  fetchLedgerFromCloud: firebaseMocks.fetchLedgerFromCloud,
  syncLedgerToCloud: firebaseMocks.syncLedgerToCloud,
  deleteSingleEntityFromCloud: vi.fn(),
  subscribeToAuth: vi.fn(),
  logoutUser: vi.fn(),
  purgeLegacySecurityFieldsFromCloud: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/securityLock', () => ({
  disableAppLock: vi.fn(),
}));

import { SyncManager, getCloudRecordCount, setRestoreConfirmed } from '../src/lib/syncManager';
import { clearAllData, deleteParty, getLedgerForSync, getLedgerOwner, saveParty, setLedgerOwner } from '../src/lib/db';

const emptyCloud = () => ({
  exportDate: '2026-10-12T00:00:00.000Z',
  parties: [],
  dispatches: [],
  payments: [],
  expenses: [],
  pos: [],
  lots: [],
  mines: [],
  settings: {},
});

const user = {
  uid: 'user-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  photoUrl: '',
};

describe('startup reconciliation', () => {
  beforeEach(async () => {
    await clearAllData({ resetOwner: true, resetSettings: true });
    setLedgerOwner(user.uid, user.email);
    firebaseMocks.fetchLedgerFromCloud.mockReset();
    firebaseMocks.syncLedgerToCloud.mockReset();
    firebaseMocks.syncLedgerToCloud.mockResolvedValue({
      success: true,
      timestamp: '2026-10-10T00:00:00.000Z',
      message: 'Synced',
    });
  });

  it('does not count soft-deleted cloud documents as restorable ledger records', () => {
    expect(getCloudRecordCount({
      ...emptyCloud(),
      parties: [{ id: 'deleted-party', deleted: true }],
      lots: [{ id: 'active-lot' }],
    })).toBe(1);
  });

  it('flushes an offline-created record before merging cloud data at startup', async () => {
    await saveParty({
      id: 'party-offline-create',
      name: 'Offline Factory',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    const [localParty] = (await getLedgerForSync(true)).parties;
    const cloudBeforeFlush = {
      ...emptyCloud(),
      parties: [{ id: 'party-cloud', name: 'Cloud Factory', updatedAt: 50, createdAt: 50 }],
    };
    const cloudAfterFlush = {
      ...cloudBeforeFlush,
      parties: [...cloudBeforeFlush.parties, { ...localParty, dirty: false }],
    };
    firebaseMocks.fetchLedgerFromCloud
      .mockResolvedValueOnce(cloudBeforeFlush)
      .mockResolvedValueOnce(cloudAfterFlush);

    const manager = new SyncManager();
    await manager.reconcileWithCloud('user-1');

    expect(firebaseMocks.syncLedgerToCloud).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ parties: [expect.objectContaining({ id: 'party-offline-create', dirty: true })] }),
      { deltaOnly: true },
    );
    expect(firebaseMocks.fetchLedgerFromCloud).toHaveBeenCalledTimes(2);
    expect(manager.getState()).toMatchObject({ status: 'synced', hasPendingChanges: false });
  });

  it('flushes an offline soft delete before it can be restored from cloud', async () => {
    await saveParty({
      id: 'party-offline-delete',
      name: 'Deleted Factory',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    await deleteParty('party-offline-delete');
    const [deletedParty] = (await getLedgerForSync(true)).parties;
    const cloudBeforeFlush = {
      ...emptyCloud(),
      parties: [{ id: 'party-offline-delete', name: 'Deleted Factory', updatedAt: 100, createdAt: 100 }],
    };
    const cloudAfterFlush = {
      ...emptyCloud(),
      parties: [{ ...deletedParty, dirty: false }],
    };
    firebaseMocks.fetchLedgerFromCloud
      .mockResolvedValueOnce(cloudBeforeFlush)
      .mockResolvedValueOnce(cloudAfterFlush);

    const manager = new SyncManager();
    await manager.reconcileWithCloud('user-1');

    expect(firebaseMocks.syncLedgerToCloud).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ parties: [expect.objectContaining({ id: 'party-offline-delete', deleted: true, dirty: true })] }),
      { deltaOnly: true },
    );
    expect(manager.getState()).toMatchObject({ status: 'synced', hasPendingChanges: false });
  });

  it('keeps local changes pending when the pre-merge cloud flush fails', async () => {
    await saveParty({
      id: 'party-push-fails',
      name: 'Pending Factory',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    firebaseMocks.fetchLedgerFromCloud.mockResolvedValue({
      ...emptyCloud(),
      parties: [{ id: 'party-cloud', name: 'Cloud Factory', updatedAt: 50, createdAt: 50 }],
    });
    firebaseMocks.syncLedgerToCloud.mockResolvedValue({
      success: false,
      timestamp: '2026-10-10T00:00:00.000Z',
      message: 'Permission denied',
      unresolvedCount: 1,
    });

    const manager = new SyncManager();
    await manager.reconcileWithCloud('user-1');

    expect(firebaseMocks.fetchLedgerFromCloud).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'error',
      hasPendingChanges: true,
      unresolvedCount: 1,
      lastError: 'Permission denied',
    });
  });

  it('reconciles cloud data for an authenticated Google user without an app-specific MFA gate', async () => {
    firebaseMocks.fetchLedgerFromCloud.mockResolvedValue(emptyCloud());
    const manager = new SyncManager();
    await manager.reconcileWithCloud('user-1');

    expect(firebaseMocks.fetchLedgerFromCloud).toHaveBeenCalledWith('user-1');
    expect(manager.getState()).toMatchObject({ status: 'synced' });
  });
});

describe('login and account-resolution failure safety', () => {
  beforeEach(async () => {
    await clearAllData({ resetOwner: true, resetSettings: true });
    localStorage.removeItem('coal_last_cloud_sync');
    setRestoreConfirmed(user.uid, false);
    firebaseMocks.fetchLedgerFromCloud.mockReset();
    firebaseMocks.syncLedgerToCloud.mockReset();
  });

  it('fails closed when the cloud ledger cannot be read', async () => {
    firebaseMocks.fetchLedgerFromCloud.mockRejectedValue(new Error('network unavailable'));
    const manager = new SyncManager();

    const scenario = await manager.checkLoginScenario(user);

    expect(scenario.type).toBe('error');
    expect(scenario.message).toMatch(/failed to verify cloud ledger/i);
    expect(firebaseMocks.syncLedgerToCloud).not.toHaveBeenCalled();
  });

  it('does not mark a failed first backup as synced or advance last-sync time', async () => {
    await saveParty({
      id: 'local-party',
      name: 'Local Party',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    firebaseMocks.fetchLedgerFromCloud.mockResolvedValue(emptyCloud());
    firebaseMocks.syncLedgerToCloud.mockResolvedValue({
      success: false,
      timestamp: '2026-10-12T01:00:00.000Z',
      message: 'permission denied',
      unresolvedCount: 1,
    });
    const manager = new SyncManager();

    const scenario = await manager.checkLoginScenario(user);

    expect(scenario.type).toBe('error');
    expect(localStorage.getItem('coal_last_cloud_sync')).toBeNull();
    expect(manager.getState()).toMatchObject({ status: 'error', hasPendingChanges: true });
  });

  it('does not let the auth observer claim an unowned local ledger before account resolution', async () => {
    await saveParty({
      id: 'unowned-party',
      name: 'Unowned Party',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    const manager = new SyncManager();

    await (manager as any).handleAuthenticatedUser(user);

    expect(getLedgerOwner().uid).toBeNull();
    expect(firebaseMocks.fetchLedgerFromCloud).not.toHaveBeenCalled();
    expect(firebaseMocks.syncLedgerToCloud).not.toHaveBeenCalled();
  });

  it('blocks automatic and manual sync until the authenticated account owns the local ledger', async () => {
    const manager = new SyncManager();
    (manager as any).state.currentUser = user;

    const result = await manager.executeSync();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/finish google account setup/i);
    expect(firebaseMocks.syncLedgerToCloud).not.toHaveBeenCalled();
  });

  it('blocks direct reconciliation until account ownership is resolved', async () => {
    firebaseMocks.fetchLedgerFromCloud.mockResolvedValue(emptyCloud());
    const manager = new SyncManager();

    await manager.reconcileWithCloud(user.uid);

    expect(firebaseMocks.fetchLedgerFromCloud).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({
      status: 'error',
      hasPendingChanges: true,
      lastError: expect.stringMatching(/finish google account setup/i),
    });
  });

  it('rejects a malformed confirmed cloud restore instead of announcing success', async () => {
    setRestoreConfirmed(user.uid, true);
    firebaseMocks.fetchLedgerFromCloud.mockResolvedValue({
      ...emptyCloud(),
      parties: [{ id: '', name: '', createdAt: 1, updatedAt: 1 }],
    });
    const manager = new SyncManager();

    const scenario = await manager.checkLoginScenario(user);

    expect(scenario.type).toBe('error');
    expect(scenario.message).toMatch(/could not be restored safely/i);
    expect(getLedgerOwner().uid).toBeNull();
  });

  it('keeps the last successful sync marker unchanged when account merge upload fails', async () => {
    await saveParty({
      id: 'local-party',
      name: 'Local Party',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: 100,
      updatedAt: 100,
    });
    localStorage.setItem('coal_last_cloud_sync', '2026-10-11T00:00:00.000Z');
    firebaseMocks.syncLedgerToCloud.mockResolvedValue({
      success: false,
      timestamp: '2026-10-12T01:00:00.000Z',
      message: 'write rejected',
    });
    const manager = new SyncManager();

    const result = await manager.resolveLoginDecision('merge', {
      type: 'account_switch',
      user,
      cloudData: emptyCloud(),
    });

    expect(result.success).toBe(false);
    expect(localStorage.getItem('coal_last_cloud_sync')).toBe('2026-10-11T00:00:00.000Z');
    expect(manager.getState()).toMatchObject({ status: 'error', hasPendingChanges: true });
  });
});
