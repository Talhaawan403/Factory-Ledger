import {
  auth,
  isFirebaseConfigured,
  syncLedgerToCloud,
  fetchLedgerFromCloud,
  deleteSingleEntityFromCloud,
  subscribeToAuth,
  logoutUser,
  purgeLegacySecurityFieldsFromCloud,
  type GoogleUserData,
  type CloudSyncResult,
} from './firebase';
import {
  getAllBackupData,
  getLedgerForSync,
  restoreBackup,
  clearAllData,
  mergeLedgerData,
  getTombstones,
  getLedgerOwner,
  setLedgerOwner,
  getLocalRecordCounts,
  recordSyncConflicts,
  type LedgerMutationDetail,
} from './db';
import {
  disableAppLock,
} from '../utils/securityLock';
import { useState, useEffect } from 'react';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error';

export interface SyncState {
  status: SyncStatus;
  lastSyncTime: string | null;
  lastError: string | null;
  isOnline: boolean;
  hasPendingChanges: boolean;
  isAutoSyncEnabled: boolean;
  currentUser: GoogleUserData | null;
  unresolvedCount?: number;
}

export type LoginScenarioType =
  | 'ready'
  | 'anonymous_conflict'
  | 'account_switch'
  | 'restore_confirmation'
  | 'error';

export interface LoginScenarioResult {
  type: LoginScenarioType;
  message?: string;
  cloudCount?: number;
  localCount?: number;
  previousEmail?: string | null;
  newEmail?: string;
  user: GoogleUserData;
  cloudData?: any;
}

const STORAGE_KEY_LAST_SYNC = 'coal_last_cloud_sync';
const STORAGE_KEY_AUTO_SYNC = 'coal_auto_sync_cloud';
const STORAGE_KEY_RESTORE_CONFIRMED = 'coal_restore_confirmed';

/**
 * A device-local restore acknowledgement. It only prevents accidental ledger
 * download on a shared browser; it is never used as cloud authorization.
 */
export function isRestoreConfirmed(uid?: string): boolean {
  if (typeof localStorage === 'undefined') return true;
  if (!uid) return true;
  return localStorage.getItem(`${STORAGE_KEY_RESTORE_CONFIRMED}_${uid}`) === 'true';
}

export function setRestoreConfirmed(uid: string, confirmed: boolean = true): void {
  if (typeof localStorage === 'undefined' || !uid) return;
  if (confirmed) {
    localStorage.setItem(`${STORAGE_KEY_RESTORE_CONFIRMED}_${uid}`, 'true');
  } else {
    localStorage.removeItem(`${STORAGE_KEY_RESTORE_CONFIRMED}_${uid}`);
  }
}

const CLOUD_RECORD_COLLECTIONS = ['parties', 'dispatches', 'payments', 'expenses', 'pos', 'lots', 'mines'] as const;

/**
 * Counts every synced record type. Keep this in one place: using a partial
 * count can treat an inventory-only cloud account as empty during login or
 * restoration and take the wrong account-resolution path.
 */
export function getCloudRecordCount(cloudData: Record<string, unknown> | null | undefined): number {
  return CLOUD_RECORD_COLLECTIONS.reduce((count, collectionName) => {
    const records = cloudData?.[collectionName];
    return count + (Array.isArray(records)
      ? records.filter((record) => !record || typeof record !== 'object' || !(record as { deleted?: boolean }).deleted).length
      : 0);
  }, 0);
}

function hasLedgerEntityRecords(data: {
  parties?: unknown[];
  dispatches?: unknown[];
  payments?: unknown[];
  expenses?: unknown[];
  pos?: unknown[];
  lots?: unknown[];
  mines?: unknown[];
}): boolean {
  return CLOUD_RECORD_COLLECTIONS.some((collectionName) => {
    const records = data[collectionName];
    return Array.isArray(records) && records.length > 0;
  });
}

export class SyncManager {
  private state: SyncState;
  private listeners: Set<(state: SyncState) => void> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private readonly BACKOFF_DELAYS = [5000, 30000, 120000]; // 5s, 30s, 2min
  private isSyncingBusy = false;
  private queuedSyncRequested = false;
  private initialized = false;

  constructor() {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const lastSync = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_LAST_SYNC) : null;
    const autoSync = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_AUTO_SYNC) !== 'false' : true;

    this.state = {
      status: 'idle',
      lastSyncTime: lastSync,
      lastError: null,
      isOnline,
      hasPendingChanges: false,
      isAutoSyncEnabled: autoSync,
      currentUser: null,
    };
  }

  public init() {
    if (this.initialized) return;
    this.initialized = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
      window.addEventListener('ledger_data_changed', (e) => {
        const detail = (e as CustomEvent<LedgerMutationDetail>).detail;
        this.handleLocalDataChanged(detail);
      });
    }

    // Subscribe to Firebase Auth state
    subscribeToAuth((user) => {
      this.state.currentUser = user;
      this.broadcast();

      if (user) {
        this.handleAuthenticatedUser(user).catch((err) => {
          console.warn('[SyncManager] Authenticated cloud-access check warning:', err);
          this.updateState({
            status: 'error',
            lastError: err?.message || 'Could not verify cloud account security.',
          });
        });
      } else {
        this.updateState({ status: 'idle' });
      }
    });
  }

  private async handleAuthenticatedUser(user: GoogleUserData): Promise<void> {
    purgeLegacySecurityFieldsFromCloud(user.uid).catch((err) => {
      console.warn('[SyncManager] Legacy PIN security purge warning:', err);
    });

    const owner = getLedgerOwner();
    // Only reconcile automatically for an owner that was already established.
    // A newly authenticated account must pass checkLoginScenario first so the
    // auth observer cannot race ahead of the account-switch/merge decision.
    if (owner.uid === user.uid) {
      this.reconcileWithCloud(user.uid).catch((err) => {
        console.warn('[SyncManager] Startup reconciliation warning:', err);
      });
    }
  }

  public getState(): SyncState {
    return { ...this.state };
  }

  public subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private broadcast() {
    const currentState = this.getState();
    this.listeners.forEach((l) => {
      try {
        l(currentState);
      } catch (err) {
        console.error('[SyncManager] Listener error:', err);
      }
    });
  }

  private updateState(partial: Partial<SyncState>) {
    this.state = { ...this.state, ...partial };
    this.broadcast();
  }

  public setAutoSyncEnabled(enabled: boolean) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_AUTO_SYNC, String(enabled));
    }
    this.updateState({ isAutoSyncEnabled: enabled });
    if (enabled && this.state.hasPendingChanges && this.state.currentUser) {
      this.queueSync(500);
    }
  }

  private handleNetworkChange(isOnline: boolean) {
    this.updateState({ isOnline });
    if (isOnline) {
      if (this.state.hasPendingChanges && this.state.currentUser && this.state.isAutoSyncEnabled) {
        console.log('[SyncManager] Network restored. Flushing pending changes to cloud...');
        this.queueSync(800);
      }
    } else {
      if (this.state.hasPendingChanges) {
        this.updateState({ status: 'offline' });
      }
    }
  }

  private handleLocalDataChanged(detail?: LedgerMutationDetail) {
    // If this mutation was a restore from cloud, do not re-trigger sync back to cloud
    if (detail?.action === 'restore') {
      return;
    }

    this.updateState({ hasPendingChanges: true });

    if (!this.state.currentUser || !this.state.isAutoSyncEnabled) {
      return;
    }

    if (!this.state.isOnline) {
      this.updateState({ status: 'offline' });
      return;
    }

    // Immediate write-through for deletions from Firestore subcollections
    if (detail?.action === 'delete' && detail?.id && detail?.entityType !== 'all' && detail?.entityType !== 'settings') {
      deleteSingleEntityFromCloud(this.state.currentUser.uid, detail.entityType, detail.id).catch((err) => {
        console.warn('[SyncManager] Granular deletion write-through warning:', err);
      });
    }

    // Debounce writes by 1.8 seconds to batch rapid form entries into the subcollections
    this.queueSync(1800);
  }

  public queueSync(delayMs = 2000) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.updateState({ status: 'pending' });

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.executeSync().catch((err) => {
        console.error('[SyncManager] Background sync execution failed:', err);
      });
    }, delayMs);
  }

  /**
   * Execute an immediate sync to Cloud Firestore subcollections
   */
  public async executeSync(forceOverwrite = false): Promise<CloudSyncResult> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (!isFirebaseConfigured) {
      this.updateState({ status: 'idle', lastError: null });
      return { success: false, timestamp: new Date().toISOString(), message: 'Offline mode: Firebase cloud sync not configured.' };
    }

    const user = this.state.currentUser || (auth.currentUser ? {
      uid: auth.currentUser.uid,
      displayName: auth.currentUser.displayName || '',
      email: auth.currentUser.email || '',
      photoUrl: auth.currentUser.photoURL || '',
    } : null);

    if (!user) {
      this.updateState({ status: 'idle', lastError: 'Not signed in with Google' });
      return { success: false, timestamp: new Date().toISOString(), message: 'User is not signed in.' };
    }

    const owner = getLedgerOwner();
    if (owner.uid !== user.uid) {
      const message = owner.uid
        ? 'Resolve the Google account switch before syncing this device ledger.'
        : 'Finish Google account setup before syncing this device ledger.';
      this.updateState({ status: 'error', hasPendingChanges: true, lastError: message });
      return { success: false, timestamp: new Date().toISOString(), message };
    }

    if (!this.state.isOnline) {
      this.updateState({ status: 'offline', hasPendingChanges: true });
      return { success: false, timestamp: new Date().toISOString(), message: 'Device is offline. Changes saved locally.' };
    }

    if (this.isSyncingBusy) {
      this.queuedSyncRequested = true;
      return { success: true, timestamp: new Date().toISOString(), message: 'Sync queued behind current operation.' };
    }

    this.isSyncingBusy = true;
    this.updateState({ status: 'syncing', lastError: null });

    try {
      const localData = await getLedgerForSync();
      const result = await syncLedgerToCloud(user.uid, localData, {
        forceEmptyOverwrite: forceOverwrite,
        deltaOnly: !forceOverwrite,
      });

      if (result.success) {
        this.consecutiveFailures = 0;
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, result.timestamp);
        }
        this.updateState({
          status: 'synced',
          lastSyncTime: result.timestamp,
          hasPendingChanges: false,
          lastError: null,
          unresolvedCount: 0,
        });
      } else if (result.unresolvedCount && result.unresolvedCount > 0) {
        // Issue 34: Unresolved rejections - do NOT mask as synced, keep hasPendingChanges: true
        this.consecutiveFailures = 0;
        this.updateState({
          status: 'error',
          lastSyncTime: result.timestamp,
          hasPendingChanges: true,
          lastError: result.message || `${result.unresolvedCount} record(s) rejected by cloud security rules.`,
          unresolvedCount: result.unresolvedCount,
        });
      } else if (result.protected) {
        this.consecutiveFailures = 0;
        console.warn('[SyncManager] Empty local storage detected while remote has data. Auto-restoring from cloud...');
        await this.reconcileWithCloud(user.uid);
      } else {
        this.scheduleBackoffRetry();
        this.updateState({ status: 'error', lastError: result.message || 'Sync failed' });
      }

      return result;
    } catch (err: any) {
      console.error('[SyncManager] Sync error:', err);
      const errorMsg = err?.message || 'Network or permissions error';
      this.scheduleBackoffRetry();
      this.updateState({ status: 'error', lastError: errorMsg });
      return { success: false, timestamp: new Date().toISOString(), message: errorMsg };
    } finally {
      this.isSyncingBusy = false;
      if (this.queuedSyncRequested) {
        this.queuedSyncRequested = false;
        setTimeout(() => this.executeSync(), 500);
      }
    }
  }

  private scheduleBackoffRetry() {
    if (!this.state.isOnline || !this.state.isAutoSyncEnabled) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = this.BACKOFF_DELAYS[Math.min(this.consecutiveFailures, this.BACKOFF_DELAYS.length - 1)];
    this.consecutiveFailures++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.executeSync().catch((e) => console.warn('[SyncManager] Backoff retry error:', e));
    }, delay);
  }

  /**
   * Reconcile local and cloud datasets on startup or login
   */
  public async reconcileWithCloud(uid: string): Promise<void> {
    if (!isFirebaseConfigured || !this.state.isOnline) return;

    const owner = getLedgerOwner();
    if (owner.uid !== uid) {
      const message = owner.uid
        ? 'Resolve the Google account switch before reconciling this device ledger.'
        : 'Finish Google account setup before reconciling this device ledger.';
      this.updateState({ status: 'error', hasPendingChanges: true, lastError: message });
      return;
    }

    try {
      this.updateState({ status: 'syncing' });
      let cloudData = await fetchLedgerFromCloud(uid);

      if (!cloudData) {
        // Cloud is empty. If local has data, upload it as initial backup.
        const local = await getLedgerForSync();

        if (hasLedgerEntityRecords(local)) {
          const syncRes = await syncLedgerToCloud(uid, local);
          if (syncRes.success) {
            localStorage.setItem(STORAGE_KEY_LAST_SYNC, syncRes.timestamp);
            this.updateState({
              status: 'synced',
              lastSyncTime: syncRes.timestamp,
              hasPendingChanges: false,
            });
          } else {
            this.updateState({
              status: 'error',
              hasPendingChanges: true,
              lastError: syncRes.message || 'Initial cloud backup failed',
              unresolvedCount: syncRes.unresolvedCount || 0,
            });
          }
        } else {
          this.updateState({ status: 'synced' });
        }
        return;
      }

      // A startup/login merge must never discard local dirty records or soft
      // deletes. Push the dirty queue first, then fetch the resulting remote
      // state for reconciliation. In particular, getAllBackupData() omits
      // soft-deleted rows, so it is only safe after this flush has succeeded.
      const pendingLocal = await getLedgerForSync(true);
      if (hasLedgerEntityRecords(pendingLocal)) {
        const syncRes = await syncLedgerToCloud(uid, pendingLocal, { deltaOnly: true });
        if (!syncRes.success) {
          this.updateState({
            status: 'error',
            hasPendingChanges: true,
            lastError: syncRes.message || 'Pending local changes could not sync before reconciliation.',
            unresolvedCount: syncRes.unresolvedCount || 0,
          });
          return;
        }
        cloudData = await fetchLedgerFromCloud(uid);
        if (!cloudData) {
          this.updateState({
            status: 'error',
            hasPendingChanges: true,
            lastError: 'Cloud data could not be reloaded after syncing pending local changes.',
          });
          return;
        }
      }

      // Cloud document exists. Check local counts.
      const local = await getAllBackupData();
      const localCounts = await getLocalRecordCounts();
      const localCount = localCounts.total;

      const cloudCount = getCloudRecordCount(cloudData);

      if (localCount === 0 && cloudCount > 0) {
        if (!isRestoreConfirmed(uid)) {
          console.warn('[SyncManager] Fresh device has not confirmed the local restore action. Skipping auto-restore.');
          this.updateState({ status: 'idle' });
          return;
        }
        // This local confirmation prevents an accidental restore on a shared
        // browser. It is not an account-authorization factor.
        console.log(`[SyncManager] Empty local database on confirmed device. Restoring ${cloudCount} records from cloud...`);
        const restoreRes = await restoreBackup(cloudData);
        if (restoreRes.success) {
          const timestamp = cloudData.lastCloudSync || new Date().toISOString();
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, timestamp);
          this.updateState({
            status: 'synced',
            lastSyncTime: timestamp,
            hasPendingChanges: false,
          });
        } else {
          this.updateState({
            status: 'error',
            hasPendingChanges: false,
            lastError: restoreRes.message,
          });
        }
        return;
      }

      // Both local and cloud have entries: Smart 2-way merge
      const tombstones = getTombstones();
      const { merged, hasLocalChanges, hasCloudChanges, conflicts } = mergeLedgerData(local, cloudData, tombstones);

      if (conflicts && conflicts.length > 0) {
        await recordSyncConflicts(conflicts);
      }

      if (hasLocalChanges) {
        console.log('[SyncManager] Applying cloud updates to local storage...');
        const restoreRes = await restoreBackup(merged, { silent: false });
        if (!restoreRes.success) {
          this.updateState({
            status: 'error',
            hasPendingChanges: hasCloudChanges,
            lastError: restoreRes.message,
          });
          return;
        }
      }

      if (hasCloudChanges) {
        console.log('[SyncManager] Uploading merged local records to Cloud Firestore subcollections...');
        const syncRes = await syncLedgerToCloud(uid, merged);
        if (syncRes.success) {
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, syncRes.timestamp);
          this.updateState({
            status: 'synced',
            lastSyncTime: syncRes.timestamp,
            hasPendingChanges: false,
            unresolvedCount: 0,
          });
        } else if (syncRes.unresolvedCount && syncRes.unresolvedCount > 0) {
          this.updateState({
            status: 'error',
            lastSyncTime: syncRes.timestamp,
            hasPendingChanges: true,
            lastError: syncRes.message || `${syncRes.unresolvedCount} record(s) rejected by cloud rules.`,
            unresolvedCount: syncRes.unresolvedCount,
          });
        }
      } else {
        const timestamp = cloudData.lastCloudSync || new Date().toISOString();
        this.updateState({
          status: 'synced',
          lastSyncTime: timestamp,
          hasPendingChanges: false,
          unresolvedCount: 0,
        });
      }
    } catch (err: any) {
      console.warn('[SyncManager] Reconcile error:', err);
      this.updateState({
        status: this.state.isOnline ? 'error' : 'offline',
        lastError: err?.message || 'Reconciliation failed',
      });
    }
  }

  /**
   * Evaluates the real-world login scenario before any writes occur:
   * 1. Empty device -> auto restore
   * 2. Same user -> auto reconcile
   * 3. Anonymous offline user with empty cloud -> auto claim & initial backup
   * 4. Anonymous offline user with existing cloud -> prompts merge or use cloud
  * 5. Different Google account (e.g. Brother logs in) -> prompts safe account switch
  */
  public async checkLoginScenario(user: GoogleUserData): Promise<LoginScenarioResult> {
    purgeLegacySecurityFieldsFromCloud(user.uid).catch(() => {});
    const owner = getLedgerOwner();
    const localCounts = await getLocalRecordCounts();
    const localCount = localCounts.total;

    let cloudData: any = null;
    let cloudCount = 0;
    let cloudFetchFailed = false;
    let cloudFetchError: any = null;

    try {
      cloudData = await fetchLedgerFromCloud(user.uid);
      if (cloudData) {
        cloudCount = getCloudRecordCount(cloudData);
      }
    } catch (err) {
      cloudFetchFailed = true;
      cloudFetchError = err;
      console.warn('[SyncManager] Error fetching cloud data during login check:', err);
    }

    // Fail closed: Never assume 0 cloud records if the cloud read actually threw an error
    if (cloudFetchFailed) {
      return {
        type: 'error',
        message: `Failed to verify cloud ledger (${cloudFetchError?.message || 'Network error'}). Cloud setup was halted to prevent overwriting records. Please try again when online.`,
        user,
      };
    }

    // Scenario 1: Clean local storage (0 records)
    if (localCount === 0) {
      if (cloudCount > 0 && cloudData) {
        // Keep one local acknowledgement to avoid an accidental restore on a
        // shared browser. Google ownership remains the cloud auth boundary.
        if (!isRestoreConfirmed(user.uid)) {
          return {
            type: 'restore_confirmation',
            cloudCount,
            user,
            cloudData,
            message: `Google Account connected with ${cloudCount} cloud records. Confirm this browser should restore your ledger.`,
          };
        }
        const restoreRes = await restoreBackup(cloudData, { silent: false });
        if (!restoreRes.success) {
          this.updateState({ status: 'error', lastError: restoreRes.message });
          return {
            type: 'error',
            message: `Cloud ledger could not be restored safely: ${restoreRes.message}`,
            user,
          };
        }
        const timestamp = cloudData.lastCloudSync || new Date().toISOString();
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, timestamp);
        }
      }
      setLedgerOwner(user.uid, user.email);
      this.updateState({ status: 'synced', currentUser: user });
      return {
        type: 'ready',
        message: cloudCount > 0 ? `Restored ${cloudCount} records from Google Cloud.` : 'Connected to Google Account.',
        user,
      };
    }

    // Scenario 2: Same user re-authenticating
    if (owner.uid === user.uid) {
      setLedgerOwner(user.uid, user.email);
      await this.reconcileWithCloud(user.uid);
      if (this.state.status === 'error') {
        return {
          type: 'error',
          message: this.state.lastError || 'Cloud reconciliation failed. Local records remain available.',
          user,
        };
      }
      return {
        type: 'ready',
        message: 'Reconnected and synchronized with your Google Cloud backup.',
        user,
      };
    }

    // Scenario 3: Anonymous local user connects for the first time with NO existing cloud data
    if (!owner.uid && cloudCount === 0) {
      // Claim local data for this new account and back it up
      setLedgerOwner(user.uid, user.email);
      const local = await getAllBackupData();
      const syncRes = await syncLedgerToCloud(user.uid, local, { tombstones: getTombstones() });
      if (!syncRes.success) {
        this.updateState({
          status: 'error',
          currentUser: user,
          hasPendingChanges: true,
          lastError: syncRes.message || 'Cloud backup failed.',
          unresolvedCount: syncRes.unresolvedCount || 0,
        });
        return {
          type: 'error',
          message: `Signed in, but cloud backup failed: ${syncRes.message || 'Check connection'}. Offline records are preserved locally and will retry syncing.`,
          user,
        };
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_LAST_SYNC, syncRes.timestamp);
      this.updateState({ status: 'synced', currentUser: user, lastSyncTime: syncRes.timestamp, hasPendingChanges: false });
      return {
        type: 'ready',
        message: 'Connected! Your offline records were backed up to your Google account.',
        user,
      };
    }

    // Scenario 4: Anonymous local user connects to an account that ALREADY has cloud data
    if (!owner.uid && cloudCount > 0) {
      return {
        type: 'anonymous_conflict',
        cloudCount,
        localCount,
        newEmail: user.email,
        user,
        cloudData,
      };
    }

    // Scenario 5: Account switch detected (e.g. Brother logs in with a different Google account)
    if (owner.uid && owner.uid !== user.uid) {
      return {
        type: 'account_switch',
        previousEmail: owner.email || 'previous account',
        newEmail: user.email,
        cloudCount,
        localCount,
        user,
        cloudData,
      };
    }

    // Default safe fallback
    setLedgerOwner(user.uid, user.email);
    await this.reconcileWithCloud(user.uid);
    return { type: 'ready', user };
  }

  /**
   * Resolves the user's explicit decision for an account switch or offline conflict
   */
  public async resolveLoginDecision(
    decision: 'use_cloud' | 'merge' | 'cancel',
    scenario: LoginScenarioResult
  ): Promise<{ success: boolean; message: string }> {
    const { user, cloudData } = scenario;

    if (decision === 'cancel') {
      await logoutUser();
      this.updateState({ currentUser: null, status: 'idle' });
      return { success: true, message: 'Sign-in cancelled. Local records preserved.' };
    }

    if (decision === 'use_cloud') {
      if (cloudData) {
        const restoreRes = await restoreBackup(cloudData, { silent: false });
        if (!restoreRes.success) {
          return { success: false, message: `Could not load cloud ledger: ${restoreRes.message}` };
        }
        const timestamp = cloudData.lastCloudSync || new Date().toISOString();
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY_LAST_SYNC, timestamp);
        }
      } else {
        await clearAllData({ resetSettings: true });
        disableAppLock();
      }
      setLedgerOwner(user.uid, user.email);
      this.updateState({ currentUser: user, status: 'synced' });
      return {
        success: true,
        message: `Switched to ${user.email}'s cloud ledger.`,
      };
    }

    if (decision === 'merge') {
      // Merge local records with new account's cloud records
      const local = await getAllBackupData();
      const tombstones = getTombstones();
      const { merged, conflicts } = mergeLedgerData(
        local,
        cloudData || { parties: [], dispatches: [], payments: [], pos: [], settings: {} as any, exportDate: '' },
        tombstones
      );
      if (conflicts.length > 0) await recordSyncConflicts(conflicts);
      const restoreRes = await restoreBackup(merged, { silent: false });
      if (!restoreRes.success) {
        return { success: false, message: `Could not restore merged records: ${restoreRes.message}` };
      }
      setLedgerOwner(user.uid, user.email);
      const syncRes = await syncLedgerToCloud(user.uid, merged, { tombstones });
      if (!syncRes.success) {
        this.updateState({
          currentUser: user,
          status: 'error',
          hasPendingChanges: true,
          lastError: syncRes.message || 'Cloud sync failed.',
          unresolvedCount: syncRes.unresolvedCount || 0,
        });
        return {
          success: false,
          message: `Records merged locally, but cloud sync failed: ${syncRes.message || 'Network error'}. Please use Sync Now to upload.`,
        };
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_LAST_SYNC, syncRes.timestamp);
      this.updateState({ currentUser: user, status: 'synced', lastSyncTime: syncRes.timestamp, hasPendingChanges: false });
      return {
        success: true,
        message: `Merged records successfully with ${user.email}'s cloud ledger.`,
      };
    }

    return { success: false, message: 'Invalid decision' };
  }

  /**
   * Explicit user-triggered restore from cloud (merges safely with local records)
   */
  public async restoreFromCloud(): Promise<{ success: boolean; message: string; counts?: any }> {
    if (!isFirebaseConfigured) {
      return { success: false, message: 'Offline mode: Firebase cloud synchronization is not configured.' };
    }
    const user = this.state.currentUser;
    if (!user) {
      return { success: false, message: 'Please sign in with Google first' };
    }

    try {
      this.updateState({ status: 'syncing' });
      const cloudData = await fetchLedgerFromCloud(user.uid);
      if (!cloudData) {
        this.updateState({ status: 'idle' });
        return { success: false, message: 'No existing cloud backup found for this Google account' };
      }

      // Merge local records with cloud data to ensure no unsynced local data is lost
      const currentLocal = await getAllBackupData();
      const tombstones = getTombstones();
      const { merged } = mergeLedgerData(currentLocal, cloudData, tombstones);

      const res = await restoreBackup(merged);
      if (res.success) {
        const timestamp = cloudData.lastCloudSync || new Date().toISOString();
        localStorage.setItem(STORAGE_KEY_LAST_SYNC, timestamp);
        this.updateState({
          status: 'synced',
          lastSyncTime: timestamp,
          hasPendingChanges: false,
        });
      }
      return res;
    } catch (err: any) {
      this.updateState({ status: 'error', lastError: err?.message });
      return { success: false, message: err?.message || 'Failed to restore from cloud' };
    }
  }

  /**
   * Real-world sign-out handler:
   * - Flushes any pending unsynced changes to cloud first if online
   * - 'keep_data': keeps device data intact for offline usage
   * - 'clear_data': wipes device cleanly for shared device / privacy (cloud remains safe)
   */
  public async handleSignOut(mode: 'keep_data' | 'clear_data'): Promise<{ success: boolean; message: string }> {
    try {
      if (mode === 'clear_data') {
        // If device is offline, cannot safely verify cloud backup
        if (!this.state.isOnline) {
          return {
            success: false,
            message: 'Device is offline. Cannot clear device data without verifying your cloud backup. Please reconnect to internet or sign out with "Keep Data".',
          };
        }

        // Wait for any active sync to finish first
        while (this.isSyncingBusy) {
          await new Promise((r) => setTimeout(r, 200));
        }

        // Run a real sync before clearing
        if (this.state.currentUser) {
          const syncResult = await this.executeSync();
          if (!syncResult.success) {
            return {
              success: false,
              message: `Cannot clear device data: Final cloud sync failed (${syncResult.message || 'Unknown network error'}). Your unsynced records would be lost. Please select "Keep Data" or try again.`,
            };
          }
        }
      } else {
        // Mode is keep_data: attempt best-effort sync if online
        if (this.state.isOnline && this.state.currentUser && this.state.hasPendingChanges) {
          try {
            await this.executeSync();
          } catch (e) {
            console.warn('[SyncManager] Best-effort final sync warning:', e);
          }
        }
      }

      await logoutUser();
      this.updateState({ currentUser: null, status: 'idle', lastError: null });

      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('coal_google_user');
      }

      if (mode === 'clear_data') {
        disableAppLock();
        await clearAllData({ resetSettings: true, resetOwner: true });
        return {
          success: true,
          message: 'Signed out. Device data and passcode cleared. Cloud backup remains secure.',
        };
      } else {
        return {
          success: true,
          message: 'Signed out. Your records remain available offline on this device.',
        };
      }
    } catch (err: any) {
      console.error('[SyncManager] Sign-out error:', err);
      return { success: false, message: err?.message || 'Failed to sign out' };
    }
  }
}

// Global Singleton Instance
export const syncManager = new SyncManager();

/**
 * React Hook for consuming live sync status and triggers
 */
export function useSyncStatus() {
  const [syncState, setSyncState] = useState<SyncState>(() => syncManager.getState());

  useEffect(() => {
    return syncManager.subscribe(setSyncState);
  }, []);

  return {
    ...syncState,
    syncNow: (force = false) => syncManager.executeSync(force),
    reconcileNow: () => {
      if (syncState.currentUser) {
        return syncManager.reconcileWithCloud(syncState.currentUser.uid);
      }
      return Promise.resolve();
    },
    restoreFromCloud: () => syncManager.restoreFromCloud(),
    setAutoSyncEnabled: (enabled: boolean) => syncManager.setAutoSyncEnabled(enabled),
    checkLoginScenario: (user: GoogleUserData) => syncManager.checkLoginScenario(user),
    resolveLoginDecision: (decision: 'use_cloud' | 'merge' | 'cancel', scenario: LoginScenarioResult) =>
      syncManager.resolveLoginDecision(decision, scenario),
    handleSignOut: (mode: 'keep_data' | 'clear_data') => syncManager.handleSignOut(mode),
  };
}
