import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => {
  const batch = {
    delete: vi.fn(),
    set: vi.fn(),
    commit: vi.fn(),
  };
  const authUser = { uid: 'wipe-user', getIdToken: vi.fn() };
  const multiFactorManager = { enrolledFactors: [] as Array<{ uid: string; factorId: string; displayName?: string }>, unenroll: vi.fn() };

  return {
    authUser,
    auth: { currentUser: authUser },
    multiFactorManager,
    multiFactor: vi.fn(() => multiFactorManager),
    db: {},
    batch,
    initializeApp: vi.fn(() => ({})),
    getApps: vi.fn(() => []),
    getApp: vi.fn(() => ({})),
    getAuth: vi.fn(),
    initializeFirestore: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    writeBatch: vi.fn(),
    deleteDoc: vi.fn(),
  };
});

vi.mock('firebase/app', () => ({
  initializeApp: firestoreMocks.initializeApp,
  getApps: firestoreMocks.getApps,
  getApp: firestoreMocks.getApp,
}));

vi.mock('firebase/auth', () => ({
  getAuth: firestoreMocks.getAuth,
  getMultiFactorResolver: vi.fn(),
  multiFactor: firestoreMocks.multiFactor,
  TotpMultiFactorGenerator: {
    FACTOR_ID: 'totp',
    generateSecret: vi.fn(),
    assertionForEnrollment: vi.fn(),
    assertionForSignIn: vi.fn(),
  },
  GoogleAuthProvider: class {
    static credential = vi.fn();
    setCustomParameters = vi.fn();
  },
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithCredential: vi.fn(),
  getRedirectResult: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  initializeFirestore: firestoreMocks.initializeFirestore,
  getFirestore: vi.fn(() => firestoreMocks.db),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: vi.fn(),
  getDoc: firestoreMocks.getDoc,
  getDocs: firestoreMocks.getDocs,
  deleteDoc: firestoreMocks.deleteDoc,
  writeBatch: firestoreMocks.writeBatch,
  serverTimestamp: vi.fn(),
  updateDoc: vi.fn(),
  deleteField: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {},
}));

const emptyCollection = () => ({
  docs: [],
  forEach: (_callback: (doc: unknown) => void) => undefined,
});

const missingDocument = () => ({
  exists: () => false,
  ref: { path: '' },
});

describe('cloud wipe fail-closed behavior', () => {
  let wipeCloudUserData: typeof import('../src/lib/firebase').wipeCloudUserData;
  let getFactoryLedgerTotpFactorCount: typeof import('../src/lib/firebase').getFactoryLedgerTotpFactorCount;
  let removeFactoryLedgerTotpFactors: typeof import('../src/lib/firebase').removeFactoryLedgerTotpFactors;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

    firestoreMocks.auth.currentUser = firestoreMocks.authUser;
    firestoreMocks.authUser.getIdToken.mockReset().mockResolvedValue('refreshed-token');
    firestoreMocks.multiFactorManager.enrolledFactors = [];
    firestoreMocks.multiFactorManager.unenroll.mockReset().mockResolvedValue(undefined);
    firestoreMocks.multiFactor.mockClear();
    firestoreMocks.batch.delete.mockReset();
    firestoreMocks.batch.set.mockReset();
    firestoreMocks.batch.commit.mockReset().mockResolvedValue(undefined);
    firestoreMocks.getDocs.mockReset().mockImplementation(async () => emptyCollection());
    firestoreMocks.getDoc.mockReset().mockImplementation(async () => missingDocument());
    firestoreMocks.writeBatch.mockReset().mockReturnValue(firestoreMocks.batch);
    firestoreMocks.deleteDoc.mockReset().mockResolvedValue(undefined);
    firestoreMocks.getAuth.mockReset().mockReturnValue(firestoreMocks.auth);
    firestoreMocks.initializeFirestore.mockReset().mockReturnValue(firestoreMocks.db);

    ({
      wipeCloudUserData,
      getFactoryLedgerTotpFactorCount,
      removeFactoryLedgerTotpFactors,
    } = await import('../src/lib/firebase'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails without deleting anything when a cloud collection cannot be read', async () => {
    firestoreMocks.getDocs.mockRejectedValueOnce(new Error('permission denied'));

    const result = await wipeCloudUserData('wipe-user');

    expect(result).toMatchObject({ success: false, message: 'permission denied' });
    expect(firestoreMocks.writeBatch).not.toHaveBeenCalled();
  });

  it('fails and reports rejected document paths instead of claiming success', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
    firestoreMocks.batch.commit.mockRejectedValue(denied);
    firestoreMocks.deleteDoc.mockRejectedValue(denied);

    const result = await wipeCloudUserData('wipe-user');

    expect(result.success).toBe(false);
    expect(result.failedPaths).toEqual([
      'users/wipe-user/settings/config',
      'users/wipe-user/meta/sync',
      'users/wipe-user/ledger/backup',
    ]);
  });

  it('fails post-delete verification when a record remains in cloud storage', async () => {
    firestoreMocks.getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        ref: { path: 'users/wipe-user/settings/config' },
      })
      .mockImplementationOnce(async () => missingDocument())
      .mockImplementationOnce(async () => missingDocument());

    const result = await wipeCloudUserData('wipe-user');

    expect(result).toMatchObject({
      success: false,
      failedPaths: ['users/wipe-user/settings/config'],
    });
  });

  it('only reports success after all collections and singleton records verify empty', async () => {
    const result = await wipeCloudUserData('wipe-user');

    expect(result).toEqual({ success: true, message: 'Cloud database wiped cleanly.' });
    expect(firestoreMocks.getDocs).toHaveBeenCalledTimes(14);
    expect(firestoreMocks.getDoc).toHaveBeenCalledTimes(3);
  });

  it('removes only the legacy Factory Ledger TOTP factor and refreshes the session', async () => {
    const factoryTotp = { uid: 'factory-totp', factorId: 'totp', displayName: 'Factory Ledger authenticator' };
    const otherTotp = { uid: 'other-totp', factorId: 'totp', displayName: 'Personal authenticator' };
    const phoneFactor = { uid: 'phone-factor', factorId: 'phone', displayName: 'Phone' };
    firestoreMocks.multiFactorManager.enrolledFactors = [factoryTotp, otherTotp, phoneFactor];

    expect(getFactoryLedgerTotpFactorCount()).toBe(1);
    await expect(removeFactoryLedgerTotpFactors()).resolves.toBe(1);

    expect(firestoreMocks.multiFactorManager.unenroll).toHaveBeenCalledOnce();
    expect(firestoreMocks.multiFactorManager.unenroll).toHaveBeenCalledWith(factoryTotp);
    expect(firestoreMocks.authUser.getIdToken).toHaveBeenCalledWith(true);
  });
});
