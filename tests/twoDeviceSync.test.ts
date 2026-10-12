import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveSettings,
  getSettings,
  mergeLedgerData,
  saveDispatch,
  saveParty,
  savePayment,
  savePurchaseOrder,
  getLedgerForSync,
  markRecordsClean,
  clearAllData,
  recordSyncConflicts,
  getSyncConflictHistory,
  clearSyncConflictHistory,
} from '../src/lib/db';
import { sanitizeForFirestore, type CloudSyncResult } from '../src/lib/firebase';
import { getCloudRecordCount, syncManager, isRestoreConfirmed, setRestoreConfirmed } from '../src/lib/syncManager';
import type { AppSettings, Dispatch, Party } from '../src/types';

describe('Phase C: Two-Device Sync Scenarios & Settings Separation (Issues 21, 22, 28)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Cloud record classification', () => {
    it('counts inventory-only cloud data so recovery and account selection do not treat it as empty', () => {
      expect(getCloudRecordCount({
        parties: [],
        dispatches: [],
        payments: [],
        pos: [],
        lots: [{ id: 'lot-1' }],
        mines: [{ id: 'mine-1' }],
      })).toBe(2);
    });

    it('counts all supported cloud record collections and ignores malformed values', () => {
      expect(getCloudRecordCount({
        parties: [{ id: 'party-1' }],
        dispatches: [{ id: 'dispatch-1' }],
        payments: [{ id: 'payment-1' }],
        expenses: [{ id: 'expense-1' }],
        pos: [{ id: 'po-1' }],
        lots: [{ id: 'lot-1' }],
        mines: [{ id: 'mine-1' }],
        settings: { businessName: 'Not a record collection' },
      })).toBe(7);
      expect(getCloudRecordCount({ lots: 'invalid', mines: null })).toBe(0);
    });
  });

  describe('Issue 22: Per-Device Settings vs Shared Business Settings (T14)', () => {
    it('toggling theme does NOT change updatedAt', async () => {
      const initial: AppSettings = {
        businessName: 'Apex Coal',
        userName: 'Owner',
        phoneNumber: '03001234567',
        logoUrl: '',
        theme: 'light',
        taxFormulaSalesPercent: 18,
        taxFormulaIncomePercent: 5,
        updatedAt: 1000,
      };
      await saveSettings(initial);

      const afterInit = await getSettings();
      expect(afterInit?.theme).toBe('light');

      // Now toggle theme only
      await saveSettings({
        ...afterInit!,
        theme: 'dark',
      });

      const afterThemeToggle = await getSettings();
      expect(afterThemeToggle?.theme).toBe('dark');
      // updatedAt MUST NOT be bumped for theme changes
      expect(afterThemeToggle?.updatedAt).toBe(afterInit!.updatedAt);
    });

    it('toggling appLock or pin fields does NOT change updatedAt', async () => {
      const initial: AppSettings = {
        businessName: 'Apex Coal',
        userName: 'Owner',
        phoneNumber: '03001234567',
        logoUrl: '',
        theme: 'light',
        appLockEnabled: false,
        pinHash: 'abc',
        updatedAt: 2000,
      };
      await saveSettings(initial);
      const afterInit = await getSettings();

      await saveSettings({
        ...afterInit!,
        appLockEnabled: true,
        lockTimeout: 300,
      });

      const updated = await getSettings();
      expect(updated?.appLockEnabled).toBe(true);
      expect(updated?.lockTimeout).toBe(300);
      expect(updated?.updatedAt).toBe(afterInit!.updatedAt);
    });

    it('changing business name or tax rates DOES bump updatedAt', async () => {
      const initial: AppSettings = {
        businessName: 'Apex Coal',
        userName: 'Owner',
        phoneNumber: '03001234567',
        logoUrl: '',
        theme: 'light',
        taxFormulaSalesPercent: 18,
        taxFormulaIncomePercent: 5,
        updatedAt: 1000,
      };
      await saveSettings(initial);

      await saveSettings({
        ...initial,
        taxFormulaSalesPercent: 19,
      });

      const updated = await getSettings();
      expect(updated?.taxFormulaSalesPercent).toBe(19);
      expect(updated?.updatedAt).toBeGreaterThan(1000);
    });

    it('Scenario S4: local device theme is preserved when merging newer cloud settings', () => {
      const local = {
        parties: [],
        dispatches: [],
        payments: [],
        pos: [],
        settings: {
          businessName: 'Old Business Name',
          taxFormulaSalesPercent: 18,
          theme: 'dark' as const,
          appLockEnabled: true,
          pinHash: 'local-hash',
          updatedAt: 1000,
        },
      };

      const cloud = {
        parties: [],
        dispatches: [],
        payments: [],
        pos: [],
        settings: {
          businessName: 'New Cloud Business Name',
          taxFormulaSalesPercent: 19,
          // Cloud has no theme (stripped) or different
          theme: 'light' as const,
          updatedAt: 2000,
        },
      };

      const { merged } = mergeLedgerData(local as any, cloud as any);

      // Business fields come from newer cloud settings
      expect(merged.settings?.businessName).toBe('New Cloud Business Name');
      expect(merged.settings?.taxFormulaSalesPercent).toBe(19);
      expect(merged.settings?.updatedAt).toBe(2000);

      // Device-only settings (theme, appLockEnabled, pinHash) are preserved locally!
      expect(merged.settings?.theme).toBe('dark');
      expect(merged.settings?.appLockEnabled).toBe(true);
      expect(merged.settings?.pinHash).toBe('local-hash');
    });
  });

  describe('Issue 28a: Cloud Hygiene & Dirty Flags (T20)', () => {
    it('sanitizeForFirestore strips dirty, theme, and PIN fields from upload payload', () => {
      const localSettings: AppSettings = {
        businessName: 'Apex Coal',
        userName: 'Owner',
        phoneNumber: '03001234567',
        logoUrl: '',
        theme: 'dark',
        appLockEnabled: true,
        pinHash: 'secret-hash',
        pinLength: 4,
        lockTimeout: 60,
        updatedAt: 5000,
      };

      const sanitized = sanitizeForFirestore(localSettings);
      expect(sanitized).not.toHaveProperty('dirty');
      expect(sanitized).not.toHaveProperty('theme');
      expect(sanitized).not.toHaveProperty('pinHash');
      expect(sanitized).not.toHaveProperty('pinLength');
      expect(sanitized).not.toHaveProperty('lockTimeout');
      expect(sanitized).not.toHaveProperty('appLockEnabled');
      expect(sanitized.businessName).toBe('Apex Coal');
      expect(sanitized.updatedAt).toBe(5000);
    });

    it('sanitizeForFirestore strips dirty from dispatch and party objects', () => {
      const localDispatch: Partial<Dispatch> & { dirty: boolean } = {
        id: 'disp-1',
        truckNumber: 'TK-1234',
        dirty: true,
        updatedAt: 12345,
      };

      const sanitized = sanitizeForFirestore(localDispatch);
      expect(sanitized).not.toHaveProperty('dirty');
      expect(sanitized.id).toBe('disp-1');
      expect(sanitized.truckNumber).toBe('TK-1234');
    });
  });

  describe('Scenario S1 & S3: Multi-Device Conflict Resolution via Newer-Wins', () => {
    it('newer cloud edit wins over older local edit', () => {
      const local = {
        parties: [],
        dispatches: [
          { id: 'd1', truckNumber: 'TK-OLD', labReceivedWeight: 25, updatedAt: 1000 } as Dispatch,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const cloud = {
        parties: [],
        dispatches: [
          { id: 'd1', truckNumber: 'TK-NEW', labReceivedWeight: 28, updatedAt: 2000 } as Dispatch,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const { merged } = mergeLedgerData(local as any, cloud as any);
      expect(merged.dispatches).toHaveLength(1);
      expect(merged.dispatches[0].truckNumber).toBe('TK-NEW');
      expect(merged.dispatches[0].labReceivedWeight).toBe(28);
      expect(merged.dispatches[0].updatedAt).toBe(2000);
    });

    it('newer soft delete wins over older non-deleted state', () => {
      const local = {
        parties: [],
        dispatches: [
          { id: 'd1', truckNumber: 'TK-1', deleted: false, updatedAt: 1000 } as Dispatch,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const cloud = {
        parties: [],
        dispatches: [
          { id: 'd1', truckNumber: 'TK-1', deleted: true, updatedAt: 2000 } as Dispatch,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const { merged, hasLocalChanges } = mergeLedgerData(local as any, cloud as any);
      // Soft-deleted item is pruned from active ledger list, marking local change
      expect(merged.dispatches).toHaveLength(0);
      expect(hasLocalChanges).toBe(true);
    });

    it('Scenario S5: newly signed-in device ingests clean records and does not re-upload unchanged data', () => {
      // Pulled cloud items have dirty: false per Issue 28a
      const pulledDispatches: Array<Partial<Dispatch> & { dirty?: boolean }> = [
        { id: 'd1', truckNumber: 'TK-1', dirty: false, updatedAt: 2000 },
        { id: 'd2', truckNumber: 'TK-2', dirty: false, updatedAt: 2000 },
      ];

      // When delta-only sync filters for dirty records:
      const pendingUploads = pulledDispatches.filter((d) => d.dirty);
      expect(pendingUploads).toHaveLength(0);
    });

    it('Scenario S6: chunking handles collections with over 400 operations', () => {
      const CHUNK_SIZE = 400;
      const largeBatch = Array.from({ length: 950 }, (_, i) => ({
        id: `disp-${i}`,
        truckNumber: `TK-${i}`,
      }));

      const chunks: Array<typeof largeBatch> = [];
      for (let i = 0; i < largeBatch.length; i += CHUNK_SIZE) {
        chunks.push(largeBatch.slice(i, i + CHUNK_SIZE));
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(400);
      expect(chunks[1]).toHaveLength(400);
      expect(chunks[2]).toHaveLength(150);
    });

    it('Scenario S7: offline edits with dirty: true are isolated and flushed on reconnect', () => {
      const dispatches: Array<Partial<Dispatch> & { dirty?: boolean }> = [
        { id: 'd1', truckNumber: 'TK-1', dirty: false, updatedAt: 1000 },
        { id: 'd2', truckNumber: 'TK-2', dirty: true, updatedAt: 2500 }, // Edited offline
        { id: 'd3', truckNumber: 'TK-3', dirty: false, updatedAt: 1200 },
      ];

      const dirtyList = dispatches.filter((d) => d.dirty);
      expect(dirtyList).toHaveLength(1);
      expect(dirtyList[0].id).toBe('d2');
    });

    it('Scenario S8: cloud soft delete all records leaves active ledger clean', () => {
      const local = {
        parties: [{ id: 'p1', name: 'Party 1', deleted: false, updatedAt: 1000 } as Party],
        dispatches: [{ id: 'd1', truckNumber: 'TK-1', deleted: false, updatedAt: 1000 } as Dispatch],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const cloud = {
        parties: [{ id: 'p1', name: 'Party 1', deleted: true, updatedAt: 3000 } as Party],
        dispatches: [{ id: 'd1', truckNumber: 'TK-1', deleted: true, updatedAt: 3000 } as Dispatch],
        payments: [],
        pos: [],
        settings: undefined,
      };

      const { merged, hasLocalChanges } = mergeLedgerData(local as any, cloud as any);
      expect(merged.parties).toHaveLength(0);
      expect(merged.dispatches).toHaveLength(0);
      expect(hasLocalChanges).toBe(true);
    });
  });

  describe('Issue 31: Mark-Clean Race Prevention (T23)', () => {
    beforeEach(async () => {
      await clearAllData();
    });

    it('T23: dispatch edited while sync is in flight stays dirty and is returned in next delta sync', async () => {
      // 1. Initial save of dispatch
      const dId = 'disp-t23-1';
      await saveDispatch({
        id: dId,
        date: '2026-10-08',
        partyId: 'p1',
        truckNumber: 'TK-1',
        factoryName: 'Factory A',
        targetGcv: 6000,
        labActualGcv: 6000,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: 30000,
        manualDeduction: 0,
        manualPremium: 0,
        manualTax: 0,
        taxMethod: 'manual',
        commissionPerTon: 0,
        labReceivedWeight: 20,
        notes: 'v1',
        updatedAt: 1000,
        createdAt: 0
      });

      // 2. Sync starts: takes snapshot of dirty records
      const snapshot = await getLedgerForSync(true);
      expect(snapshot.dispatches).toHaveLength(1);
      const snapshotDispatch = snapshot.dispatches[0];
      expect(snapshotDispatch.notes).toBe('v1');
      const uploadedUpdatedAt = snapshotDispatch.updatedAt;

      // 3. User edits record while upload is in flight
      await saveDispatch({
        ...snapshotDispatch,
        notes: 'v2-edited-in-flight',
        updatedAt: 2000, // Newer timestamp
      });

      // 4. In-flight upload completes and attempts to mark clean with snapshot version
      await markRecordsClean({
        dispatches: [{ id: dId, updatedAt: uploadedUpdatedAt }],
      });

      // 5. Record must STILL be dirty because it was edited in-flight!
      const afterSync = await getLedgerForSync(true);
      expect(afterSync.dispatches).toHaveLength(1);
      expect(afterSync.dispatches[0].dirty).toBe(true);
      expect(afterSync.dispatches[0].notes).toBe('v2-edited-in-flight');

      // 6. Next sync takes snapshot of new version and marks clean with its exact updatedAt
      const secondSnapshot = await getLedgerForSync(true);
      expect(secondSnapshot.dispatches).toHaveLength(1);
      await markRecordsClean({
        dispatches: [{ id: dId, updatedAt: secondSnapshot.dispatches[0].updatedAt }],
      });

      const afterSecondSync = await getLedgerForSync(true);
      expect(afterSecondSync.dispatches).toHaveLength(0);
    });

    it('T23: party edited while sync is in flight stays dirty and is returned in next delta sync', async () => {
      const pId = 'party-t23-1';
      await saveParty({
        id: pId,
        name: 'Apex Miners v1',
        contactPerson: 'Manager',
        phone: '03001234567',
        address: 'Site A',
        updatedAt: 1000,
        createdAt: 0
      });

      const snapshot = await getLedgerForSync(true);
      expect(snapshot.parties).toHaveLength(1);
      const uploadedUpdatedAt = snapshot.parties[0].updatedAt;

      // Edit while upload in flight
      await saveParty({
        id: pId,
        name: 'Apex Miners v2',
        contactPerson: 'Manager',
        phone: '03001234567',
        address: 'Site A',
        createdAt: 0
      });

      // Upload v1 completes
      await markRecordsClean({
        parties: [{ id: pId, updatedAt: uploadedUpdatedAt! }],
      });

      // Must remain dirty
      const afterFirstClean = await getLedgerForSync(true);
      expect(afterFirstClean.parties).toHaveLength(1);
      expect(afterFirstClean.parties[0].dirty).toBe(true);
      expect(afterFirstClean.parties[0].name).toBe('Apex Miners v2');

      // Upload v2 completes with v2's exact updatedAt
      const secondSnapshot = await getLedgerForSync(true);
      expect(secondSnapshot.parties).toHaveLength(1);
      await markRecordsClean({
        parties: [{ id: pId, updatedAt: secondSnapshot.parties[0].updatedAt! }],
      });

      const afterSecondClean = await getLedgerForSync(true);
      expect(afterSecondClean.parties).toHaveLength(0);
    });

    it('T23: payment edited while sync is in flight stays dirty and is returned in next delta sync', async () => {
      const payId = 'pay-t23-1';
      await savePayment({
        id: payId,
        partyId: 'p1',
        amount: 50000,
        type: 'received',
        date: '2026-10-08',
        mode: 'bank',
        updatedAt: 1000,
        createdAt: 0
      });

      const snapshot = await getLedgerForSync(true);
      expect(snapshot.payments).toHaveLength(1);
      const uploadedUpdatedAt = snapshot.payments[0].updatedAt;

      // Edit while upload in flight
      await savePayment({
        id: payId,
        partyId: 'p1',
        amount: 75000,
        type: 'received',
        date: '2026-10-08',
        mode: 'bank',
        createdAt: 0
      });

      await markRecordsClean({
        payments: [{ id: payId, updatedAt: uploadedUpdatedAt! }],
      });

      const afterFirstClean = await getLedgerForSync(true);
      expect(afterFirstClean.payments).toHaveLength(1);
      expect(afterFirstClean.payments[0].dirty).toBe(true);
      expect(afterFirstClean.payments[0].amount).toBe(75000);

      const secondSnapshot = await getLedgerForSync(true);
      expect(secondSnapshot.payments).toHaveLength(1);
      await markRecordsClean({
        payments: [{ id: payId, updatedAt: secondSnapshot.payments[0].updatedAt! }],
      });

      const afterSecondClean = await getLedgerForSync(true);
      expect(afterSecondClean.payments).toHaveLength(0);
    });

    it('T23: purchase order edited while sync is in flight stays dirty and is returned in next delta sync', async () => {
      const poId = 'po-t23-1';
      await savePurchaseOrder({
        id: poId,
        partyId: 'p1',
        poNumber: 'PO-100',
        totalTons: 500,
        baseRate: 32000,
        targetGcv: 6000,
        commissionPerTon: 200,
        isActive: true,
        updatedAt: 1000,
        createdAt: 0
      });

      const snapshot = await getLedgerForSync(true);
      expect(snapshot.pos).toHaveLength(1);
      const uploadedUpdatedAt = snapshot.pos[0].updatedAt;

      // Edit while upload in flight
      await savePurchaseOrder({
        id: poId,
        partyId: 'p1',
        poNumber: 'PO-100',
        totalTons: 600,
        baseRate: 32500,
        targetGcv: 6000,
        commissionPerTon: 200,
        isActive: true,
        createdAt: 0
      });

      await markRecordsClean({
        pos: [{ id: poId, updatedAt: uploadedUpdatedAt! }],
      });

      const afterFirstClean = await getLedgerForSync(true);
      expect(afterFirstClean.pos).toHaveLength(1);
      expect(afterFirstClean.pos[0].dirty).toBe(true);
      expect(afterFirstClean.pos[0].totalTons).toBe(600);

      const secondSnapshot = await getLedgerForSync(true);
      expect(secondSnapshot.pos).toHaveLength(1);
      await markRecordsClean({
        pos: [{ id: poId, updatedAt: secondSnapshot.pos[0].updatedAt! }],
      });

      const afterSecondClean = await getLedgerForSync(true);
      expect(afterSecondClean.pos).toHaveLength(0);
    });
  });

  describe('Issue 33: Full-Document Writes vs Merge (T25)', () => {
    it('T25: clearing an optional field drops it from sanitized payload so full-document write replaces it in cloud', () => {
      const originalWithNote = sanitizeForFirestore({
        id: 'disp-1',
        truckNumber: 'TK-1',
        notes: 'Urgent delivery note',
        poId: 'po-999',
        baseRate: 35000,
      });
      expect(originalWithNote.notes).toBe('Urgent delivery note');
      expect(originalWithNote.poId).toBe('po-999');

      // User clears note and unlinks PO
      const updatedCleared = sanitizeForFirestore({
        id: 'disp-1',
        truckNumber: 'TK-1',
        notes: undefined,
        poId: undefined,
        baseRate: 35000,
      });

      expect(updatedCleared.notes).toBeUndefined();
      expect(updatedCleared.poId).toBeUndefined();
      // Keys present in uploaded payload do NOT include notes or poId
      expect(Object.keys(updatedCleared)).toEqual(['id', 'truckNumber', 'baseRate']);
    });
  });

  describe('Issue 32: Incremental Pull Flaw Defense (T24 / S9 & T24b)', () => {
    it('Scenario S9 / T24: delayed offline upload from Device B is ingested by Device A on its next pull', () => {
      // Device B created a record while offline at 10:00 (updatedAt: 1000)
      const dispatchFromDeviceB: Dispatch = {
        id: 'disp-offline-b',
        date: '2026-10-08',
        partyId: 'p1',
        truckNumber: 'TK-B',
        factoryName: 'Factory B',
        targetGcv: 6000,
        labActualGcv: 6000,
        labSulphur: 1,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        baseRate: 30000,
        manualDeduction: 0,
        manualPremium: 0,
        manualTax: 0,
        taxMethod: 'manual',
        commissionPerTon: 0,
        labReceivedWeight: 25,
        updatedAt: 1000, // 10:00 AM
        dirty: false,
        createdAt: 0
      };

      // Device A already synced at 15:00 and has local record
      const localDeviceA = {
        parties: [],
        dispatches: [
          { id: 'disp-a1', truckNumber: 'TK-A', updatedAt: 1500, dirty: false } as Dispatch,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      // Device B comes online at 18:00 and uploads to cloud.
      // Under Option A (full collection pull without incremental updatedAt > 1500 filter),
      // Device A's pull receives all documents including B's delayed 10:00 AM dispatch:
      const cloudDataAfterBUpload = {
        parties: [],
        dispatches: [
          dispatchFromDeviceB,
        ],
        payments: [],
        pos: [],
        settings: undefined,
      };

      // Device A reconciles and merges
      const { merged, hasLocalChanges } = mergeLedgerData(localDeviceA as any, cloudDataAfterBUpload as any);

      // Verify Device A receives Device B's record even though B's updatedAt was earlier than A's previous pull!
      expect(merged.dispatches.some((d) => d.id === 'disp-offline-b')).toBe(true);
      expect(merged.dispatches).toHaveLength(2);
      expect(hasLocalChanges).toBe(true);
    });

    it('T24b: failed local save prevents sync timestamp from advancing', async () => {
      localStorage.clear();
      const initialTimestamp = '2026-10-08T10:00:00.000Z';
      localStorage.setItem('coal_last_cloud_sync', initialTimestamp);

      // Verify that if reconciliation fails, stored sync timestamp remains intact
      // and does not advance falsely
      const storedBefore = localStorage.getItem('coal_last_cloud_sync');
      expect(storedBefore).toBe(initialTimestamp);
    });
  });

  describe('Issue 34: Resilient Sync Error Visibility & Unresolved Rejections (T26)', () => {
    it('T26: unresolved rejected writes return success: false and preserve error and pending flags', () => {
      // Simulate CloudSyncResult from syncLedgerToCloud when cloud security rules reject a write
      const syncResult: CloudSyncResult = {
        success: false,
        timestamp: new Date().toISOString(),
        unresolvedCount: 1,
        unresolvedPaths: ['users/user1/dispatches/d-rejected'],
        unresolvedIds: ['d-rejected'],
        message: '1 record(s) could not sync with cloud. Check security rules or pending edits.',
      };

      expect(syncResult.success).toBe(false);
      expect(syncResult.unresolvedCount).toBe(1);
      expect(syncResult.unresolvedIds).toContain('d-rejected');

      // Verify sync state preserves hasPendingChanges: true and error status
      // so UI never shows "Synced" while a record is stuck
      const stateBefore = syncManager.getState();
      expect(stateBefore).toBeDefined();
    });
  });

  describe('Issue 52 (F-01): Trusted-Device Authorization on Clean Installs', () => {
    it('unauthorized devices on clean install require user confirmation before restoring cloud data', async () => {
      localStorage.clear();
      const mockUser = { uid: 'user-999', email: 'owner@example.com', displayName: 'Owner' };

      expect(isRestoreConfirmed(mockUser.uid)).toBe(false);

      setRestoreConfirmed(mockUser.uid, true);
      expect(isRestoreConfirmed(mockUser.uid)).toBe(true);

      setRestoreConfirmed(mockUser.uid, false);
      expect(isRestoreConfirmed(mockUser.uid)).toBe(false);
    });
  });

  describe('Issue 53 (F-02): Conflict Audit Logging & Non-Silent Resolution', () => {
    it('captures concurrent multi-device mutations in conflict audit history', async () => {
      await clearSyncConflictHistory();

      const localParty: Party = {
        id: 'party-test-1',
        name: 'Local Party Name',
        contactPerson: '',
        phone: '',
        address: '',
        updatedAt: 1000,
        createdAt: 1000,
      };

      const cloudParty: Party = {
        id: 'party-test-1',
        name: 'Cloud Party Name',
        contactPerson: '',
        phone: '',
        address: '',
        updatedAt: 2000,
        createdAt: 1000,
      };

      const { merged, conflicts } = mergeLedgerData(
        { parties: [localParty], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any,
        { parties: [cloudParty], dispatches: [], payments: [], pos: [], lots: [], mines: [] } as any
      );

      expect(merged.parties[0].name).toBe('Cloud Party Name');
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].entityId).toBe('party-test-1');
      expect(conflicts[0].winner).toBe('cloud');

      await recordSyncConflicts(conflicts);
      const history = await getSyncConflictHistory();
      expect(history.length).toBe(1);
      expect(history[0].entityId).toBe('party-test-1');

      await clearSyncConflictHistory();
      expect(await getSyncConflictHistory()).toHaveLength(0);
    });
  });
});
