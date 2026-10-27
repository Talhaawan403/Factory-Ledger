// @vitest-environment node
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc, getDoc } from 'firebase/firestore';

describe('Issue 29: Firestore Security Rules Unit Tests', () => {
  let testEnv: RulesTestEnvironment;
  const ownerFirestore = (uid: string) => testEnv.authenticatedContext(uid).firestore();
  const validParty = (id: string, updatedAt = 200) => ({
    id,
    name: 'Example Factory',
    contactPerson: 'Accounts',
    phone: '03001234567',
    address: 'Quetta',
    createdAt: 100,
    updatedAt,
  });
  const validDispatch = (id: string, updatedAt = 200) => ({
    id,
    partyId: 'party-1',
    date: '2026-10-10',
    truckNumber: 'TK-100',
    factoryName: 'Example Factory',
    targetGcv: 4500,
    baseRate: 30000,
    commissionPerTon: 100,
    coalInputs: [{ id: 'input-1', sourceName: 'Yard stock', weight: 10, purchaseRate: 22000 }],
    overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
    labActualGcv: 0,
    labReceivedWeight: 0,
    labSulphur: 0,
    status: 'pending',
    createdAt: 100,
    updatedAt,
  });
  const validLot = (id: string, updatedAt = 200) => ({
    id,
    supplier: 'Hashim Coal',
    date: '2026-10-10',
    billedWeight: 10,
    receivedWeight: 10,
    purchaseRate: 22000,
    landedRate: 22000,
    createdAt: 100,
    updatedAt,
  });
  const validPayment = (id: string, updatedAt = 200) => ({
    id,
    partyId: 'party-1',
    date: '2026-10-10',
    amount: 100000,
    type: 'received',
    mode: 'bank',
    createdAt: 100,
    updatedAt,
  });
  const validPurchaseOrder = (id: string, updatedAt = 200) => ({
    id,
    partyId: 'party-1',
    poNumber: 'PO-100',
    targetGcv: 4500,
    baseRate: 30000,
    commissionPerTon: 100,
    isActive: true,
    createdAt: 100,
    updatedAt,
  });
  const validMine = (id: string, updatedAt = 200) => ({
    id,
    name: 'Example Mine',
    ratePerTon: 22000,
    createdAt: 100,
    updatedAt,
  });
  const validExpense = (id: string, updatedAt = 200) => ({
    id,
    date: '2026-10-10',
    category: 'warehouse_rent',
    amount: 50000,
    description: 'Monthly warehouse rent',
    paymentMode: 'bank',
    createdAt: 100,
    updatedAt,
  });

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-factory-ledger',
      firestore: {
        rules: fs.readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  it('owner can create records in their own subcollections', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1'))
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/parties/p1'), validParty('p1'))
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/lots/lot1'), validLot('lot1'))
    );
  });

  it('accepts backward-compatible multi-material dispatches and catalog settings', async () => {
    const alice = ownerFirestore('alice');
    const now = Date.now();
    await assertSucceeds(setDoc(doc(alice, 'users/alice/dispatches/laterite-1'), {
      ...validDispatch('laterite-1', now),
      createdAt: now,
      itemId: 'material-laterite',
      itemName: 'Laterite',
      pricingModel: 'purity',
      qualityLabel: 'Purity',
      qualityUnit: '%',
      ratePerQualityUnit: 116,
      receivedQuality: 30,
      baseRate: 3480,
      coalInputs: [{
        id: 'input-1',
        sourceName: 'Laterite Supplier',
        supplierId: 'supplier-1',
        weight: 10,
        purchaseRate: 2200,
      }],
    }));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/settings/config'), {
      materialItems: [{ id: 'material-laterite', name: 'Laterite', pricingModel: 'purity', defaultRate: 116 }],
      suppliers: [{ id: 'supplier-1', name: 'Laterite Supplier' }],
      updatedAt: now,
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/bad-material'), {
      ...validDispatch('bad-material', now),
      createdAt: now,
      itemId: 'material-bad',
      itemName: 'Bad Material',
      pricingModel: 'arbitrary-formula',
    }));
  });

  it('allows an authenticated owner without an app-specific second factor', async () => {
    const alice = ownerFirestore('alice');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/dispatches/secured'), validDispatch('secured'));
    });

    await assertSucceeds(getDoc(doc(alice, 'users/alice/dispatches/secured')));
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/new-record'), validDispatch('new-record'))
    );
  });

  it('stale update is denied when updatedAt is older than stored document', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1', 200))
    );
    await assertFails(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), { id: 'd1', updatedAt: 100 }, { merge: true })
    );
  });

  it('equal timestamp is allowed (idempotent write/retry)', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1', 200))
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), { id: 'd1', updatedAt: 200 }, { merge: true })
    );
  });

  it('newer timestamp is allowed', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1', 200))
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), { id: 'd1', updatedAt: 300 }, { merge: true })
    );
  });

  it('requires a numeric updatedAt and rejects a timestamp more than five minutes ahead', async () => {
    const alice = ownerFirestore('alice');
    const now = Date.now();

    const { updatedAt: _ignored, ...missingTimestamp } = validDispatch('missing-time');
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/missing-time'), missingTimestamp));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/text-time'), validDispatch('text-time', 'now' as unknown as number)));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/dispatches/near-future'), validDispatch('near-future', now + 60_000)));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/far-future'), validDispatch('far-future', now + 10 * 60_000)));
  });

  it('accepts valid financial records in every ledger collection', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(setDoc(doc(alice, 'users/alice/parties/party-1'), validParty('party-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/payments/payment-1'), validPayment('payment-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/expenses/expense-1'), validExpense('expense-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/pos/po-1'), validPurchaseOrder('po-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/lots/lot-1'), validLot('lot-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/mines/mine-1'), validMine('mine-1')));
  });

  it('accepts the real epoch-millisecond timestamps written by the app', async () => {
    const alice = ownerFirestore('alice');
    const now = Date.now();

    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/parties/current-party'), {
        ...validParty('current-party', now),
        createdAt: now,
      })
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/mines/current-mine'), {
        ...validMine('current-mine', now),
        createdAt: now,
      })
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/current-settlement'), {
        ...validDispatch('current-settlement', now),
        createdAt: now,
        status: 'settled',
        settledAt: now,
        settledDate: '2026-10-11',
      })
    );
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/parties/deleted-party'), {
        id: 'deleted-party',
        deleted: true,
        deletedAt: now,
        updatedAt: now,
      })
    );
  });

  it('rejects malformed or impossible financial values from an authenticated owner', async () => {
    const alice = ownerFirestore('alice');

    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/dispatch-empty-factory'), {
      ...validDispatch('dispatch-empty-factory'), factoryName: '',
    }));

    await assertFails(setDoc(doc(alice, 'users/alice/payments/payment-negative'), {
      ...validPayment('payment-negative'), amount: -1,
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/expenses/expense-negative'), {
      ...validExpense('expense-negative'), amount: -1,
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/expenses/expense-empty'), {
      ...validExpense('expense-empty'), description: '',
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/pos/po-invalid-rule'), {
      ...validPurchaseOrder('po-invalid-rule'), gcvAdjustment: 'invented-rule',
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/lots/lot-negative-freight'), {
      ...validLot('lot-negative-freight'), freightCost: -500,
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/mines/mine-negative-rate'), {
      ...validMine('mine-negative-rate'), ratePerTon: -22000,
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/dispatch-negative-overhead'), {
      ...validDispatch('dispatch-negative-overhead'),
      overheads: { loading: 0, freight: -1, crush: 0, royalty: 0, other: 0 },
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/dispatch-absurd-overhead'), {
      ...validDispatch('dispatch-absurd-overhead'),
      overheads: { loading: 0, freight: 1_000_000_000_001, crush: 0, royalty: 0, other: 0 },
    }));
    await assertFails(setDoc(doc(alice, 'users/alice/dispatches/dispatch-not-a-list'), {
      ...validDispatch('dispatch-not-a-list'), coalInputs: 'not-a-list',
    }));
  });

  it('allows a compact soft-delete marker but prevents local lock credentials from reaching cloud settings', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(setDoc(doc(alice, 'users/alice/payments/payment-1'), validPayment('payment-1')));
    await assertSucceeds(setDoc(doc(alice, 'users/alice/payments/payment-1'), {
      id: 'payment-1', deleted: true, deletedAt: 300, updatedAt: 300,
    }, { merge: true }));

    await assertFails(setDoc(doc(alice, 'users/alice/settings/not-config'), { updatedAt: 200 }));
    await assertFails(setDoc(doc(alice, 'users/alice/settings/config'), {
      businessName: 'Factory Ledger', updatedAt: 200, pinHash: 'must-stay-local',
    }));
  });

  it('does not allow a replacement update without updatedAt to bypass the stale-write guard', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1', Date.now()))
    );
    await assertFails(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), { id: 'd1', note: 'missing updatedAt' })
    );
  });

  it('requires entity ids to match their document path', async () => {
    const alice = ownerFirestore('alice');
    await assertFails(
      setDoc(doc(alice, 'users/alice/lots/lot-a'), validLot('lot-b', Date.now()))
    );
  });

  it('allows legacy backup reads and deletes, but not creates or updates', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice/ledger/backup'), { legacy: true });
    });
    const alice = ownerFirestore('alice');

    await assertSucceeds(getDoc(doc(alice, 'users/alice/ledger/backup')));
    await assertFails(setDoc(doc(alice, 'users/alice/ledger/backup'), { legacy: false }));
    await assertSucceeds(deleteDoc(doc(alice, 'users/alice/ledger/backup')));
  });

  it('denies writes to the unused top-level user document', async () => {
    const alice = ownerFirestore('alice');
    await assertFails(setDoc(doc(alice, 'users/alice'), { unexpected: true }));
  });

  it('other user is denied reading another user private documents', async () => {
    const alice = ownerFirestore('alice');
    const bob = ownerFirestore('bob');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), validDispatch('d1'))
    );
    await assertFails(getDoc(doc(bob, 'users/alice/dispatches/d1')));
  });

  it('unauthenticated user is denied reading or writing', async () => {
    const unauth = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(unauth, 'users/alice/dispatches/d1'), validDispatch('d1'))
    );
    await assertFails(getDoc(doc(unauth, 'users/alice/dispatches/d1')));
  });

  it('unknown arbitrary root path is denied', async () => {
    const alice = ownerFirestore('alice');
    await assertFails(setDoc(doc(alice, 'random/x'), { a: 1 }));
  });

  it('stale settings update is denied', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/settings/config'), { businessName: 'Coal Corp', updatedAt: 500 })
    );
    await assertFails(
      setDoc(doc(alice, 'users/alice/settings/config'), { businessName: 'Stale Corp', updatedAt: 300 }, { merge: true })
    );
  });

  it('Scenario S1: soft delete with newer timestamp rejects stale resurrection update', async () => {
    const alice = ownerFirestore('alice');
    // Device A soft-deletes dispatch at timestamp 500
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), {
        ...validDispatch('d1', 500), deleted: true, deletedAt: 500,
      })
    );
    // Device B (stale, timestamp 300) attempts to push old non-deleted dispatch
    await assertFails(
      setDoc(doc(alice, 'users/alice/dispatches/d1'), { id: 'd1', deleted: false, updatedAt: 300 }, { merge: true })
    );
    // Verify cloud document is still deleted
    const snap = await getDoc(doc(alice, 'users/alice/dispatches/d1'));
    expect(snap.data()?.deleted).toBe(true);
    expect(snap.data()?.updatedAt).toBe(500);
  });

  it('Scenario S2: stale settings write is denied without blocking valid dispatches', async () => {
    const alice = ownerFirestore('alice');
    // Device A updated business settings at timestamp 500
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/settings/config'), { businessName: 'Factory HQ', updatedAt: 500 })
    );
    // Device B tries to push stale settings at 300 -> denied
    await assertFails(
      setDoc(doc(alice, 'users/alice/settings/config'), { businessName: 'Stale Factory', updatedAt: 300 }, { merge: true })
    );
    // But Device B's new dispatch at timestamp 600 -> succeeds!
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d2'), { ...validDispatch('d2', 600), truckNumber: 'TK-999' })
    );
  });

  it('Scenario S3: concurrent offline dispatch edits - higher updatedAt wins', async () => {
    const alice = ownerFirestore('alice');
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d_conflict'), { ...validDispatch('d_conflict', 100), notes: 'Initial' })
    );
    // Device A was edited offline to 400 and synced
    await assertSucceeds(
      setDoc(doc(alice, 'users/alice/dispatches/d_conflict'), { id: 'd_conflict', notes: 'Device A edit', updatedAt: 400 }, { merge: true })
    );
    // Device B had edited offline to 350; pushing 350 is denied because 400 > 350
    await assertFails(
      setDoc(doc(alice, 'users/alice/dispatches/d_conflict'), { id: 'd_conflict', notes: 'Device B edit', updatedAt: 350 }, { merge: true })
    );
    const snap = await getDoc(doc(alice, 'users/alice/dispatches/d_conflict'));
    expect(snap.data()?.notes).toBe('Device A edit');
    expect(snap.data()?.updatedAt).toBe(400);
  });
});
