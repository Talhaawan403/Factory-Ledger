import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
  type MultiFactorResolver,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  updateDoc,
  deleteField,
  type DocumentReference,
} from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { markRecordsClean, getSettings, saveSettings } from './db';
import { idb } from './dexieDb';
import type { Party, Dispatch, Payment, PurchaseOrder, InventoryLot, Mine, AppSettings, GeneralExpense } from '../types';

// Web app's Firebase configuration read from environment variables (.env)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ""
};

/**
 * Validates whether valid Firebase environment credentials are configured.
 * If false, app seamlessly falls back to offline-only local storage mode.
 */
export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey.trim().length > 0 &&
  firebaseConfig.apiKey !== 'your-firebase-api-key' &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId.trim().length > 0
);

// Initialize Firebase App singleton safely
export const firebaseApp = isFirebaseConfigured
  ? (!getApps().length ? initializeApp(firebaseConfig) : getApp())
  : (null as any);

// Initialize Firebase Services with offline IndexedDB persistent cache
function initFirestore() {
  if (!isFirebaseConfigured || !firebaseApp) return null as any;
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  } catch {
    return getFirestore(firebaseApp);
  }
}

export const auth = isFirebaseConfigured && firebaseApp ? getAuth(firebaseApp) : ({ currentUser: null } as any);
export const db = initFirestore();

export const googleProvider = isFirebaseConfigured ? (() => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  return provider;
})() : (null as any);

export interface GoogleUserData {
  displayName: string;
  email: string;
  photoUrl: string;
  uid: string;
}

export interface TotpSignInChallenge {
  enrollmentId: string;
  displayName: string;
}

/** Raised when Firebase has accepted the first factor and now requires TOTP. */
export class TotpSignInRequiredError extends Error {
  readonly challenge: TotpSignInChallenge;

  constructor(challenge: TotpSignInChallenge) {
    super('Your Factory Ledger authenticator code is required to continue.');
    this.name = 'TotpSignInRequiredError';
    this.challenge = challenge;
  }
}

let pendingTotpSignIn: { resolver: MultiFactorResolver; enrollmentId: string } | null = null;

function toGoogleUserData(user: FirebaseUser): GoogleUserData {
  return {
    displayName: user.displayName || user.email?.split('@')[0] || 'Google User',
    email: user.email || '',
    photoUrl: user.photoURL || '',
    uid: user.uid,
  };
}

function toTotpSignInRequiredError(error: any): TotpSignInRequiredError | null {
  if (!error) return null;

  const isMfaCode =
    error.code === 'auth/multi-factor-auth-required' ||
    error.code === 'auth/mfa-required';
  const isMfaMessage =
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('second factor challenge');

  if (!isMfaCode && !isMfaMessage) return null;

  try {
    const resolver = getMultiFactorResolver(auth, error);
    const factor = resolver.hints.find(
      (hint) => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID,
    );
    if (!factor?.uid) {
      throw new Error('This Firebase account requires an unsupported second factor. Contact the account administrator to remove it before using Factory Ledger.');
    }

    pendingTotpSignIn = { resolver, enrollmentId: factor.uid };
    return new TotpSignInRequiredError({
      enrollmentId: factor.uid,
      displayName: factor.displayName || 'Factory Ledger authenticator',
    });
  } catch (resolverErr) {
    if (resolverErr instanceof TotpSignInRequiredError) throw resolverErr;
    console.warn('Could not extract multi-factor resolver from error:', resolverErr);
    return null;
  }
}

/** Transitional helpers for removing factors enrolled by older app releases. */
export function getFactoryLedgerTotpFactorCount(): number {
  const user = isFirebaseConfigured ? auth.currentUser as FirebaseUser | null : null;
  if (!user) return 0;
  return multiFactor(user).enrolledFactors.filter((factor) =>
    factor.factorId === TotpMultiFactorGenerator.FACTOR_ID &&
    factor.displayName === 'Factory Ledger authenticator'
  ).length;
}

export async function removeFactoryLedgerTotpFactors(): Promise<number> {
  const user = isFirebaseConfigured ? auth.currentUser as FirebaseUser | null : null;
  if (!user) throw new Error('Sign in with Google before removing the old authenticator.');
  const factors = multiFactor(user).enrolledFactors.filter((factor) =>
    factor.factorId === TotpMultiFactorGenerator.FACTOR_ID &&
    factor.displayName === 'Factory Ledger authenticator'
  );
  for (const factor of factors) {
    await multiFactor(user).unenroll(factor);
  }
  if (factors.length > 0) await user.getIdToken(true);
  return factors.length;
}

export async function completeTotpSignIn(code: string): Promise<GoogleUserData> {
  const normalizedCode = code.replace(/\s/g, '');
  if (!pendingTotpSignIn) {
    throw new Error('Authenticator sign-in expired. Start Google sign-in again.');
  }
  if (!/^\d{6,10}$/.test(normalizedCode)) {
    throw new Error('Enter the current numeric code from your authenticator app.');
  }

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    pendingTotpSignIn.enrollmentId,
    normalizedCode,
  );
  const result = await pendingTotpSignIn.resolver.resolveSignIn(assertion);
  pendingTotpSignIn = null;
  return toGoogleUserData(result.user);
}

export function cancelTotpSignIn(): void {
  pendingTotpSignIn = null;
}

/**
 * Friendly error parser for Firebase Auth error codes
 */
export function getFriendlyAuthErrorMessage(error: any): string {
  if (!error) return 'An unexpected error occurred.';
  const code = error.code || '';
  const msg = error.message || String(error);

  if (msg.includes('10:') || msg.includes('DEVELOPER_ERROR')) {
    return 'Google Sign-In configuration error (Code 10). Please ensure your Android app (com.factoryledger.app) and SHA-1 fingerprint are added in Firebase Console.';
  }
  if (msg.includes('12501') || code === 'auth/popup-closed-by-user' || msg.includes('cancel')) {
    return 'Sign-in was cancelled.';
  }
  if (
    error instanceof TotpSignInRequiredError ||
    code === 'auth/multi-factor-auth-required' ||
    code === 'auth/mfa-required' ||
    msg.toLowerCase().includes('second factor challenge')
  ) {
    return 'Enter the current code from your Factory Ledger authenticator to finish sign-in.';
  }
  switch (code) {
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return 'Google Sign-In is not enabled for this Firebase project.';
    case 'auth/unauthorized-domain':
      return 'Domain not authorized. Please add this domain or localhost in Firebase Console > Authentication > Settings > Authorized domains.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in attempt was replaced by another attempt.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection.';
    default:
      return error.message || 'Failed to sign in with Google.';
  }
}

/**
 * Trigger Google Sign In
 * - On Native Android: Uses Native Google Play Services account picker with skipNativeAuth: true
 *   so the Firebase Web JS SDK receives the credential used by Firestore.
 * - On Web / Desktop: Opens the standard popup
 */
export async function loginWithGoogle(): Promise<GoogleUserData> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase configuration missing. The app is running in offline-only mode. Set up your Firebase project in .env to enable Google Sign-In.');
  }

  if (Capacitor.isNativePlatform()) {
    try {
      // Native Android Google Play Services account picker
      const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });

      const idToken = result.credential?.idToken || (result as any).idToken;
      if (!idToken) {
        throw new Error('Google sign-in was cancelled or did not provide an identity token.');
      }

      // Bridge native credential to Firebase Web JS SDK for Firestore access.
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);

      return toGoogleUserData(userCredential.user);
    } catch (err: any) {
      const mfaError = toTotpSignInRequiredError(err);
      if (mfaError) throw mfaError;
      console.error('Native Google Sign-In error:', err);
      if (err.message && (err.message.includes('12501') || err.message.includes('cancel'))) {
        throw new Error('Sign-in cancelled.');
      }
      throw err;
    }
  }

  // Web browser fallback
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return toGoogleUserData(result.user);
  } catch (error: any) {
    const mfaError = toTotpSignInRequiredError(error);
    if (mfaError) throw mfaError;
    if (error.code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, googleProvider);
      throw new Error('Redirecting to Google sign in...');
    }
    throw error;
  }
}

/**
 * Handle initial/redirect auth check across both native and web
 */
export async function checkRedirectAuth(): Promise<GoogleUserData | null> {
  if (!isFirebaseConfigured) return null;

  if (auth.currentUser) {
    return toGoogleUserData(auth.currentUser);
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const current = await FirebaseAuthentication.getCurrentUser();
      if (current.user) {
        const idTokenRes = await FirebaseAuthentication.getIdToken();
        if (idTokenRes.token) {
          const credential = GoogleAuthProvider.credential(idTokenRes.token);
          const userCredential = await signInWithCredential(auth, credential);
          return toGoogleUserData(userCredential.user);
        }
      }
    } catch (err) {
      const mfaError = toTotpSignInRequiredError(err);
      if (mfaError) throw mfaError;
      console.warn('Native initial auth check error:', err);
    }
    return null;
  }

  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      const user = result.user;
      return {
        displayName: user.displayName || user.email?.split('@')[0] || 'Google User',
        email: user.email || '',
        photoUrl: user.photoURL || '',
        uid: user.uid,
      };
    }
    return null;
  } catch (error) {
    const mfaError = toTotpSignInRequiredError(error);
    if (mfaError) throw mfaError;
    console.error('Redirect sign-in error:', error);
    return null;
  }
}

/**
 * Sign out current Firebase user
 */
export async function logoutUser(): Promise<void> {
  if (!isFirebaseConfigured) return;

  if (Capacitor.isNativePlatform()) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (err) {
      console.warn('Native sign out error:', err);
    }
  }
  await signOut(auth);
}

/**
 * Listen to real-time auth changes
 */
export function subscribeToAuth(callback: (user: GoogleUserData | null) => void) {
  if (!isFirebaseConfigured || !auth || typeof auth.onAuthStateChanged !== 'function') {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user: FirebaseUser | null) => {
    if (user) {
      callback({
        displayName: user.displayName || user.email?.split('@')[0] || 'Google User',
        email: user.email || '',
        photoUrl: user.photoURL || '',
        uid: user.uid,
      });
    } else {
      callback(null);
    }
  });
}

export interface CloudSyncOptions {
  forceEmptyOverwrite?: boolean;
  tombstones?: Record<string, number>;
  deltaOnly?: boolean;
  forceSettingsSync?: boolean;
}

export interface CloudSyncResult {
  success: boolean;
  timestamp: string;
  protected?: boolean;
  message?: string;
  mergedCount?: number;
  unresolvedCount?: number;
  unresolvedPaths?: string[];
  unresolvedIds?: string[];
}

export interface CloudWipeResult {
  success: boolean;
  message: string;
  failedPaths?: string[];
}

export interface FirestoreBatchOp {
  type: 'set' | 'delete';
  ref: DocumentReference;
  data?: any;
  collectionName?: 'parties' | 'dispatches' | 'payments' | 'expenses' | 'pos' | 'settings' | 'meta' | 'lots' | 'mines';
  id?: string;
  uploadedUpdatedAt?: number;
  merge?: boolean;
}

/**
 * Strips undefined values, converts NaN/Infinity to 0, deletes local dirty flags,
 * and deep clones so Firestore never rejects document fields (Issue 28a).
 */
export function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (typeof obj === 'number') {
    return isNaN(obj) || !isFinite(obj) ? 0 : obj;
  }
  if (typeof obj === 'string') {
    const lower = obj.trim().toLowerCase();
    if (lower === 'nan' || lower === 'infinity' || lower === '-infinity') {
      return 0;
    }
    return obj;
  }
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  const result: Record<string, any> = {};
  const strippedKeys = new Set(['dirty', 'theme', 'pinHash', 'pinLength', 'lockTimeout', 'appLockEnabled']);
  for (const key of Object.keys(obj)) {
    // Issue 28a & Issue 22: Never upload local dirty flag or device-only settings to Firestore
    if (strippedKeys.has(key)) continue;
    const val = obj[key];
    if (val !== undefined) {
      if (typeof val === 'number') {
        result[key] = isNaN(val) || !isFinite(val) ? 0 : val;
      } else {
        result[key] = sanitizeForFirestore(val);
      }
    }
  }
  return result;
}

/**
 * Commits Firestore operations in chunks of 400.
 * Writes full documents for entities (no merge: true) so cleared fields are removed in the cloud (Issue 33).
 * On permission-denied (e.g. stale write rejected by security rule),
 * splits the chunk and retries per-document to isolate rejected writes (Issue 21).
 */
async function commitResilient(
  operations: FirestoreBatchOp[]
): Promise<{ succeeded: FirestoreBatchOp[]; rejected: Array<{ op: FirestoreBatchOp; error: any }> }> {
  const CHUNK_SIZE = 400;
  const succeeded: FirestoreBatchOp[] = [];
  const rejected: Array<{ op: FirestoreBatchOp; error: any }> = [];

  for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
    const chunk = operations.slice(i, i + CHUNK_SIZE);
    try {
      const batch = writeBatch(db);
      for (const op of chunk) {
        if (op.type === 'set') {
          if (op.merge) {
            batch.set(op.ref, op.data, { merge: true });
          } else {
            batch.set(op.ref, op.data);
          }
        } else if (op.type === 'delete') {
          batch.delete(op.ref);
        }
      }
      await batch.commit();
      succeeded.push(...chunk);
    } catch (chunkErr: any) {
      const isPermDenied =
        chunkErr?.code === 'permission-denied' ||
        String(chunkErr?.message || '').toLowerCase().includes('permission-denied') ||
        String(chunkErr?.message || '').toLowerCase().includes('permission_denied');

      if (!isPermDenied) {
        throw chunkErr;
      }

      // Isolate the rejected write(s) per document (Issue 21)
      for (const op of chunk) {
        try {
          if (op.type === 'set') {
            if (op.merge) {
              await setDoc(op.ref, op.data, { merge: true });
            } else {
              await setDoc(op.ref, op.data);
            }
          } else if (op.type === 'delete') {
            await deleteDoc(op.ref);
          }
          succeeded.push(op);
        } catch (singleErr: any) {
          const singlePermDenied =
            singleErr?.code === 'permission-denied' ||
            String(singleErr?.message || '').toLowerCase().includes('permission-denied') ||
            String(singleErr?.message || '').toLowerCase().includes('permission_denied');

          if (singlePermDenied) {
            rejected.push({ op, error: singleErr });
          } else {
            throw singleErr;
          }
        }
      }
    }
  }

  return { succeeded, rejected };
}

/**
 * Sync local ledger to Cloud Firestore using granular subcollections:
 * - users/{uid}/parties/{partyId}
 * - users/{uid}/dispatches/{dispatchId}
 * - users/{uid}/payments/{paymentId}
 * - users/{uid}/expenses/{expenseId}
 * - users/{uid}/pos/{poId}
 * - users/{uid}/settings/config
 * - users/{uid}/meta/sync
 *
 * Automatically includes accidental wipe protection, tombstone deletion, and legacy backup cleanup.
 */
export async function syncLedgerToCloud(
  uid: string,
  backupData: any,
  options?: CloudSyncOptions
): Promise<CloudSyncResult> {
  const now = new Date().toISOString();

  if (!isFirebaseConfigured || !db) {
    return {
      success: false,
      timestamp: now,
      message: 'Offline-only mode: Firebase cloud synchronization is not configured.',
    };
  }

  const rawParties: any[] = backupData.parties || [];
  const rawDispatches: any[] = backupData.dispatches || [];
  const rawPayments: any[] = backupData.payments || [];
  const rawExpenses: any[] = backupData.expenses || [];
  const rawPos: any[] = backupData.pos || [];
  const rawLots: any[] = backupData.lots || [];
  const rawMines: any[] = backupData.mines || [];

  const partiesList: any[] = options?.deltaOnly ? rawParties.filter((p) => p.dirty) : rawParties;
  const dispatchesList: any[] = options?.deltaOnly ? rawDispatches.filter((d) => d.dirty) : rawDispatches;
  const paymentsList: any[] = options?.deltaOnly ? rawPayments.filter((p) => p.dirty) : rawPayments;
  const expensesList: any[] = options?.deltaOnly ? rawExpenses.filter((e) => e.dirty) : rawExpenses;
  const posList: any[] = options?.deltaOnly ? rawPos.filter((po) => po.dirty) : rawPos;
  const lotsList: any[] = options?.deltaOnly ? rawLots.filter((l) => l.dirty) : rawLots;
  const minesList: any[] = options?.deltaOnly ? rawMines.filter((m) => m.dirty) : rawMines;

  const isLocalEmpty =
    rawParties.length === 0 &&
    rawDispatches.length === 0 &&
    rawPayments.length === 0 &&
    rawExpenses.length === 0 &&
    rawPos.length === 0 &&
    rawLots.length === 0 &&
    rawMines.length === 0;

  // Safeguard: Prevent accidental wipe of cloud records if local storage is cleared / empty
  if (isLocalEmpty && !options?.forceEmptyOverwrite) {
    try {
      const existingCloud = await fetchLedgerFromCloud(uid);
      if (existingCloud) {
        const cloudCount =
          (existingCloud.parties?.length || 0) +
          (existingCloud.dispatches?.length || 0) +
          (existingCloud.payments?.length || 0) +
          (existingCloud.expenses?.length || 0) +
          (existingCloud.pos?.length || 0) +
          (existingCloud.lots?.length || 0) +
          (existingCloud.mines?.length || 0);

        if (cloudCount > 0) {
          console.warn('[CloudSync] Protected: Prevented accidental wipe of remote cloud database with 0 local records.');
          return {
            success: false,
            timestamp: now,
            protected: true,
            message: 'Cloud backup protected: Local storage has 0 records while remote cloud database contains records.',
          };
        }
      }
    } catch (checkErr) {
      console.warn('[CloudSync] Warning checking existing cloud records:', checkErr);
    }
  }

  const operations: FirestoreBatchOp[] = [];

  // 1. Parties subcollection
  for (const party of partiesList) {
    if (party.id) {
      const partyUpdatedAt = Number(party.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'parties', party.id),
        collectionName: 'parties',
        id: party.id,
        uploadedUpdatedAt: partyUpdatedAt,
        data: sanitizeForFirestore({ ...party, updatedAt: partyUpdatedAt }),
      });
    }
  }

  // 2. Dispatches subcollection
  for (const dispatch of dispatchesList) {
    if (dispatch.id) {
      const dispatchUpdatedAt = Number(dispatch.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'dispatches', dispatch.id),
        collectionName: 'dispatches',
        id: dispatch.id,
        uploadedUpdatedAt: dispatchUpdatedAt,
        data: sanitizeForFirestore({ ...dispatch, updatedAt: dispatchUpdatedAt }),
      });
    }
  }

  // 3. Payments subcollection
  for (const payment of paymentsList) {
    if (payment.id) {
      const paymentUpdatedAt = Number(payment.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'payments', payment.id),
        collectionName: 'payments',
        id: payment.id,
        uploadedUpdatedAt: paymentUpdatedAt,
        data: sanitizeForFirestore({ ...payment, updatedAt: paymentUpdatedAt }),
      });
    }
  }

  // 4. Independent warehouse / general expenses subcollection
  for (const expense of expensesList) {
    if (expense.id) {
      const expenseUpdatedAt = Number(expense.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'expenses', expense.id),
        collectionName: 'expenses',
        id: expense.id,
        uploadedUpdatedAt: expenseUpdatedAt,
        data: sanitizeForFirestore({ ...expense, updatedAt: expenseUpdatedAt }),
      });
    }
  }

  // 5. Purchase Orders subcollection
  for (const po of posList) {
    if (po.id) {
      const poUpdatedAt = Number(po.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'pos', po.id),
        collectionName: 'pos',
        id: po.id,
        uploadedUpdatedAt: poUpdatedAt,
        data: sanitizeForFirestore({ ...po, updatedAt: poUpdatedAt }),
      });
    }
  }

  // 5. Inventory Lots subcollection
  for (const lot of lotsList) {
    if (lot.id) {
      const lotUpdatedAt = Number(lot.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'lots', lot.id),
        collectionName: 'lots',
        id: lot.id,
        uploadedUpdatedAt: lotUpdatedAt,
        data: sanitizeForFirestore({ ...lot, updatedAt: lotUpdatedAt }),
      });
    }
  }

  // 6. Mines subcollection
  for (const mine of minesList) {
    if (mine.id) {
      const mineUpdatedAt = Number(mine.updatedAt || Date.now());
      operations.push({
        type: 'set',
        ref: doc(db, 'users', uid, 'mines', mine.id),
        collectionName: 'mines',
        id: mine.id,
        uploadedUpdatedAt: mineUpdatedAt,
        data: sanitizeForFirestore({ ...mine, updatedAt: mineUpdatedAt }),
      });
    }
  }

  // 6. Settings document (strips PIN credentials and theme preference per Issue 14 & 22)
  // Only push settings if they actually changed locally (Issue 21)
  const lastSyncedSettingsKey = `fl_last_synced_settings_${uid}`;
  const lastSyncedSettingsAt = typeof localStorage !== 'undefined'
    ? Number(localStorage.getItem(lastSyncedSettingsKey) || 0)
    : 0;
  const settingsUpdatedAt = Number(backupData.settings?.updatedAt || 0);

  const shouldSyncSettings =
    Boolean(backupData.settings) &&
    (options?.forceSettingsSync || !lastSyncedSettingsAt || settingsUpdatedAt > lastSyncedSettingsAt);

  if (shouldSyncSettings && backupData.settings) {
    const cloudSettings = { ...backupData.settings };
    delete cloudSettings.theme; // Issue 22: Strip per-device theme preference
    delete cloudSettings.pinHash;
    delete cloudSettings.pinLength;
    delete cloudSettings.lockTimeout;
    delete cloudSettings.appLockEnabled;

    operations.push({
      type: 'set',
      ref: doc(db, 'users', uid, 'settings', 'config'),
      collectionName: 'settings',
      id: 'config',
      data: sanitizeForFirestore({
        ...cloudSettings,
        updatedAt: cloudSettings.updatedAt || Date.now(),
      }),
    });
  }

  // 7. Metadata document
  operations.push({
    type: 'set',
    ref: doc(db, 'users', uid, 'meta', 'sync'),
    collectionName: 'meta',
    id: 'sync',
    merge: true,
    data: {
      ...sanitizeForFirestore({
        version: backupData.version || '2026.10_books_v3',
        exportDate: backupData.exportDate || now,
        lastCloudSync: now,
        partiesCount: rawParties.length,
        dispatchesCount: rawDispatches.length,
        paymentsCount: rawPayments.length,
        expensesCount: rawExpenses.length,
        posCount: rawPos.length,
        lotsCount: rawLots.length,
        minesCount: rawMines.length,
        totalCount: rawParties.length + rawDispatches.length + rawPayments.length + rawExpenses.length + rawPos.length + rawLots.length + rawMines.length,
      }),
      // Keep the Firestore transform sentinel intact. Deep-sanitizing it turns
      // it into a literal {_methodName: 'serverTimestamp'} map.
      updatedAt: serverTimestamp(),
    },
  });

  // Issue 21: Commit batch writes resiliently
  const { succeeded, rejected } = await commitResilient(operations);

  // If settings succeeded, record last synced timestamp
  if (shouldSyncSettings && succeeded.some((op) => op.collectionName === 'settings')) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(lastSyncedSettingsKey, String(settingsUpdatedAt || Date.now()));
    }
  }

  // Issue 11 & Issue 31: Mark ONLY successfully committed records clean if updatedAt still matches
  const successParties = succeeded
    .filter((o) => o.collectionName === 'parties' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successDispatches = succeeded
    .filter((o) => o.collectionName === 'dispatches' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successPayments = succeeded
    .filter((o) => o.collectionName === 'payments' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successExpenses = succeeded
    .filter((o) => o.collectionName === 'expenses' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successPos = succeeded
    .filter((o) => o.collectionName === 'pos' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successLots = succeeded
    .filter((o) => o.collectionName === 'lots' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));
  const successMines = succeeded
    .filter((o) => o.collectionName === 'mines' && o.id && o.uploadedUpdatedAt !== undefined)
    .map((o) => ({ id: o.id!, updatedAt: o.uploadedUpdatedAt! }));

  try {
    await markRecordsClean({
      parties: successParties,
      dispatches: successDispatches,
      payments: successPayments,
      expenses: successExpenses,
      pos: successPos,
      lots: successLots,
      mines: successMines,
    });
  } catch (cleanErr) {
    console.warn('[CloudSync] Warning marking records clean:', cleanErr);
  }

  // Issue 21 & Issue 34: Resolve rejected documents by pulling newer cloud record and merging into Dexie
  let mergedConflictCount = 0;
  const unresolvedRejections: Array<{ path: string; id?: string; collectionName?: string; error?: any }> = [];

  if (rejected.length > 0) {
    for (const { op, error } of rejected) {
      let resolved = false;
      try {
        const cloudSnap = await getDoc(op.ref);
        if (cloudSnap.exists()) {
          const cloudData = cloudSnap.data();
          const cloudTime = Number(cloudData.updatedAt || cloudData.createdAt || 0);
          const localTime = Number(op.data?.updatedAt || op.data?.createdAt || 0);

          if (cloudTime >= localTime) {
            // Cloud version wins
            if (op.collectionName === 'parties' && op.id) {
              await idb.parties.put({ ...cloudData, dirty: false } as Party);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'dispatches' && op.id) {
              await idb.dispatches.put({ ...cloudData, dirty: false } as Dispatch);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'payments' && op.id) {
              await idb.payments.put({ ...cloudData, dirty: false } as Payment);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'expenses' && op.id) {
              await idb.expenses.put({ ...cloudData, dirty: false } as GeneralExpense);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'pos' && op.id) {
              await idb.pos.put({ ...cloudData, dirty: false } as PurchaseOrder);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'lots' && op.id) {
              await idb.lots.put({ ...cloudData, dirty: false } as InventoryLot);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'mines' && op.id) {
              await idb.mines.put({ ...cloudData, dirty: false } as Mine);
              mergedConflictCount++;
              resolved = true;
            } else if (op.collectionName === 'settings') {
              const localSettings = await getSettings();
              const merged: AppSettings = {
                ...(localSettings || {}),
                ...cloudData,
                theme: localSettings?.theme ?? 'light',
                appLockEnabled: localSettings?.appLockEnabled ?? false,
                pinHash: localSettings?.pinHash ?? '',
                pinLength: localSettings?.pinLength ?? 5,
                lockTimeout: localSettings?.lockTimeout ?? 0,
              } as AppSettings;
              await saveSettings(merged);
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(lastSyncedSettingsKey, String(cloudTime));
              }
              mergedConflictCount++;
              resolved = true;
            }
          }
        }
      } catch (mergeErr) {
        console.warn(`[CloudSync] Warning resolving rejected doc ${op.ref.path}:`, mergeErr);
      }

      if (!resolved) {
        unresolvedRejections.push({
          path: op.ref.path,
          id: op.id,
          collectionName: op.collectionName,
          error,
        });
      }
    }
  }

  // Clean up legacy single-document backup (users/{uid}/ledger/backup) so Firebase Console stays clean
  try {
    const legacyDocRef = doc(db, 'users', uid, 'ledger', 'backup');
    await deleteDoc(legacyDocRef);
  } catch {
    // Non-fatal if legacy doc is already gone or non-existent
  }

  const unresolvedCount = unresolvedRejections.length;
  const isSuccess = unresolvedCount === 0;

  let message = 'Synchronized with Firebase Cloud subcollections successfully.';
  if (unresolvedCount > 0) {
    message = `${unresolvedCount} record(s) could not sync with cloud. Check security rules or pending edits.`;
  } else if (mergedConflictCount > 0) {
    message = `Sync found newer changes on another device and merged them (${mergedConflictCount} records).`;
  }

  return {
    success: isSuccess,
    timestamp: now,
    message,
    mergedCount: mergedConflictCount,
    unresolvedCount,
    unresolvedPaths: unresolvedRejections.map((r) => r.path),
    unresolvedIds: unresolvedRejections.filter((r) => r.id).map((r) => r.id!),
  };
}

/**
 * Pull cloud records from Cloud Firestore subcollections:
 * parties, dispatches, payments, expenses, pos, lots, mines, settings, and meta.
 * Issue 32 (Option A): Always pulls full subcollections without incremental updatedAt filter,
 * ensuring delayed offline uploads from other devices (with earlier updatedAt) are never permanently missed.
 * All pulled documents are ingested as clean (dirty: false) per Issue 28a.
 */
export async function fetchLedgerFromCloud(
  uid: string,
  _options?: { full?: boolean }
): Promise<any | null> {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const [partiesSnap, dispatchesSnap, paymentsSnap, expensesSnap, posSnap, lotsSnap, minesSnap, settingsSnap, metaSnap] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'parties')),
      getDocs(collection(db, 'users', uid, 'dispatches')),
      getDocs(collection(db, 'users', uid, 'payments')),
      getDocs(collection(db, 'users', uid, 'expenses')),
      getDocs(collection(db, 'users', uid, 'pos')),
      getDocs(collection(db, 'users', uid, 'lots')),
      getDocs(collection(db, 'users', uid, 'mines')),
      getDoc(doc(db, 'users', uid, 'settings', 'config')),
      getDoc(doc(db, 'users', uid, 'meta', 'sync')),
    ]);

    // Issue 28a: Ensure all pulled documents are ingested as clean (dirty: false)
    const parties = partiesSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const dispatches = dispatchesSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const payments = paymentsSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const expenses = expensesSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const pos = posSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const lots = lotsSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const mines = minesSnap.docs.map((d) => ({ ...d.data(), dirty: false }));
    const settings = settingsSnap.exists() ? settingsSnap.data() : null;
    const meta = metaSnap.exists() ? metaSnap.data() : null;

    const totalSubrecords = parties.length + dispatches.length + payments.length + expenses.length + pos.length + lots.length + mines.length;

    // Backward-compatibility: Check if legacy single-document backup exists
    if (totalSubrecords === 0 && !settings) {
      const legacyDocRef = doc(db, 'users', uid, 'ledger', 'backup');
      const legacySnap = await getDoc(legacyDocRef);
      if (legacySnap.exists()) {
        const legacyData = legacySnap.data();
        console.log('[CloudSync] Migrating existing legacy single-document data to subcollections...');
        // Migrate to granular subcollections immediately
        await syncLedgerToCloud(uid, legacyData);
        // Clean up legacy doc
        try {
          await deleteDoc(legacyDocRef);
        } catch {
          // ignore
        }
        return legacyData;
      }
      return null;
    }

    return {
      version: meta?.version || '2026.10_books_v3',
      exportDate: meta?.exportDate || new Date().toISOString(),
      lastCloudSync: meta?.lastCloudSync || new Date().toISOString(),
      parties,
      dispatches,
      payments,
      expenses,
      pos,
      lots,
      mines,
      settings: settings || {},
    };
  } catch (err: any) {
    console.error('Failed to fetch ledger from Cloud Firestore subcollections:', err);
    throw err;
  }
}

/**
 * Instant write-through for single item creation / update
 */
export async function syncSingleEntityToCloud(
  uid: string,
  entityType: 'party' | 'dispatch' | 'payment' | 'expense' | 'purchase_order' | 'lot' | 'mine' | 'settings',
  item: any
): Promise<void> {
  if (!isFirebaseConfigured || !db || !uid || !item) return;
  try {
    if (entityType === 'settings') {
      const ref = doc(db, 'users', uid, 'settings', 'config');
      await setDoc(ref, sanitizeForFirestore({ ...item, updatedAt: Date.now() }), { merge: true });
      return;
    }
    const collectionName =
      entityType === 'party' ? 'parties' :
      entityType === 'dispatch' ? 'dispatches' :
      entityType === 'payment' ? 'payments' :
      entityType === 'expense' ? 'expenses' :
      entityType === 'purchase_order' ? 'pos' :
      entityType === 'lot' ? 'lots' :
      entityType === 'mine' ? 'mines' : null;

    if (collectionName && item.id) {
      const ref = doc(db, 'users', uid, collectionName, item.id);
      // Issue 33: Write full entity document without merge: true so cleared fields are removed in cloud
      await setDoc(ref, sanitizeForFirestore({ ...item, updatedAt: item.updatedAt || Date.now() }));
    }
  } catch (err) {
    console.warn(`[CloudSync] Warning writing single ${entityType} to cloud:`, err);
  }
}

/**
 * Instant deletion for single item in Firestore subcollection
 */
export async function deleteSingleEntityFromCloud(
  uid: string,
  entityType: 'party' | 'dispatch' | 'payment' | 'expense' | 'purchase_order' | 'lot' | 'mine',
  id: string,
  deletedAt = Date.now()
): Promise<void> {
  if (!isFirebaseConfigured || !db || !uid || !id) return;
  try {
    const collectionName =
      entityType === 'party' ? 'parties' :
      entityType === 'dispatch' ? 'dispatches' :
      entityType === 'payment' ? 'payments' :
      entityType === 'expense' ? 'expenses' :
      entityType === 'purchase_order' ? 'pos' :
      entityType === 'lot' ? 'lots' :
      entityType === 'mine' ? 'mines' : null;

    if (collectionName) {
      const ref = doc(db, 'users', uid, collectionName, id);
      await setDoc(
        ref,
        {
          id,
          deleted: true,
          deletedAt,
          updatedAt: deletedAt,
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn(`[CloudSync] Warning soft-deleting single ${entityType} in cloud:`, err);
  }
}

/**
 * Fully wipe a user's ledger data from Cloud Firestore.
 *
 * This operation fails closed: an unreadable collection, rejected deletion,
 * or remaining document is reported as failure. Callers must not clear the
 * device ledger or sign the user out until success is returned.
 */
export async function wipeCloudUserData(uid: string): Promise<CloudWipeResult> {
  if (!uid) return { success: false, message: 'No authenticated user ID provided' };
  if (!isFirebaseConfigured || !db) return { success: true, message: 'Offline mode: no cloud database to wipe.' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, message: 'Connect to the internet before deleting cloud data.' };
  }
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return { success: false, message: 'Cloud deletion requires the currently signed-in account.' };
  }

  try {
    const subcollections = ['parties', 'dispatches', 'payments', 'expenses', 'pos', 'lots', 'mines'] as const;
    const operations: FirestoreBatchOp[] = [];

    for (const sub of subcollections) {
      const snap = await getDocs(collection(db, 'users', uid, sub));
      snap.forEach((docSnap) => {
        operations.push({ type: 'delete', ref: docSnap.ref, collectionName: sub });
      });
    }

    // Also delete config, meta, and legacy backup
    operations.push({ type: 'delete', ref: doc(db, 'users', uid, 'settings', 'config') });
    operations.push({ type: 'delete', ref: doc(db, 'users', uid, 'meta', 'sync') });
    operations.push({ type: 'delete', ref: doc(db, 'users', uid, 'ledger', 'backup') });

    const { rejected } = await commitResilient(operations);
    if (rejected.length > 0) {
      const failedPaths = rejected.map(({ op }) => op.ref.path);
      console.error('[CloudWipe] Cloud deletion rejected for:', failedPaths);
      return {
        success: false,
        message: `Cloud deletion was incomplete. ${failedPaths.length} record(s) could not be deleted.`,
        failedPaths,
      };
    }

    const [
      ...collectionChecks
    ] = await Promise.all(subcollections.map((sub) => getDocs(collection(db, 'users', uid, sub))));
    const [settings, meta, legacy] = await Promise.all([
      getDoc(doc(db, 'users', uid, 'settings', 'config')),
      getDoc(doc(db, 'users', uid, 'meta', 'sync')),
      getDoc(doc(db, 'users', uid, 'ledger', 'backup')),
    ]);
    const remainingPaths = collectionChecks.flatMap((snap) => snap.docs.map((docSnap) => docSnap.ref.path));
    if (settings.exists()) remainingPaths.push(settings.ref.path);
    if (meta.exists()) remainingPaths.push(meta.ref.path);
    if (legacy.exists()) remainingPaths.push(legacy.ref.path);

    if (remainingPaths.length > 0) {
      console.error('[CloudWipe] Cloud deletion verification found remaining records:', remainingPaths);
      return {
        success: false,
        message: `Cloud deletion could not be verified. ${remainingPaths.length} record(s) remain.`,
        failedPaths: remainingPaths,
      };
    }

    return { success: true, message: 'Cloud database wiped cleanly.' };
  } catch (err: any) {
    console.error('[CloudWipe] Error wiping cloud database:', err);
    return { success: false, message: err?.message || 'Failed to wipe cloud database' };
  }
}

/**
 * One-time cloud purge for legacy security fields (pinHash, pinLength, lockTimeout, appLockEnabled)
 * previously stored in Firestore under users/{uid}/settings/config (Issue 23).
 * Protects accounts that synced before the local PIN security hardening fix.
 */
export async function purgeLegacySecurityFieldsFromCloud(uid: string): Promise<void> {
  if (!isFirebaseConfigured || !db || !uid) return;
  const flag = `fl_cloud_security_purged_v1:${uid}`;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(flag)) return;

  try {
    const ref = doc(db, 'users', uid, 'settings', 'config');
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      const stale = ['pinHash', 'pinLength', 'lockTimeout', 'appLockEnabled'].filter((k) => k in data);
      if (stale.length > 0) {
        console.log(`[Firebase] Purging ${stale.length} legacy PIN security fields from cloud for user:`, uid);
        await updateDoc(ref, Object.fromEntries(stale.map((k) => [k, deleteField()])));
      }
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(flag, '1');
    }
  } catch (err) {
    console.warn('[Firebase] Warning: Failed to purge legacy security fields from cloud:', err);
  }
}
