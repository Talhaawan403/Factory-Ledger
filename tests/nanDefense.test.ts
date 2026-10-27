// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { idb, deepSanitizeNumbers } from '../src/lib/dexieDb';
import { cleanNumber, sanitizeDispatch, sanitizePayment, sanitizeLot } from '../src/lib/db';
import { calculateSettlement } from '../src/utils/calculations';
import { sanitizeForFirestore } from '../src/lib/firebase';
import { stripNonNumeric } from '../src/utils/numberFormat';
import type { Dispatch, Payment, InventoryLot } from '../src/types';

describe('NaN & Corrupt Input Defense Suite', () => {
  beforeEach(async () => {
    await idb.dispatches.clear();
    await idb.payments.clear();
    await idb.lots.clear();
  });

  it('deepSanitizeNumbers converts NaN and Infinity in nested objects and arrays to 0', () => {
    const corrupt = {
      amount: NaN,
      rate: Infinity,
      negativeInf: -Infinity,
      stringNan: 'NaN',
      stringInf: 'Infinity',
      valid: 1234.56,
      nested: {
        deeper: NaN,
        arr: [NaN, Infinity, 42, 'nan'],
      },
    };

    const cleaned = deepSanitizeNumbers(corrupt);
    expect(cleaned.amount).toBe(0);
    expect(cleaned.rate).toBe(0);
    expect(cleaned.negativeInf).toBe(0);
    expect(cleaned.stringNan).toBe(0);
    expect(cleaned.stringInf).toBe(0);
    expect(cleaned.valid).toBe(1234.56);
    expect(cleaned.nested.deeper).toBe(0);
    expect(cleaned.nested.arr).toEqual([0, 0, 42, 0]);
  });

  it('Dexie database hooks prevent NaN and Infinity from ever entering IndexedDB on put()', async () => {
    const corruptDispatch = {
      id: 'disp_nan_test',
      partyId: 'party_1',
      date: '2026-10-27',
      truckNumber: 'TK-001',
      factoryName: 'Test Factory',
      targetGcv: NaN,
      baseRate: Infinity,
      labReceivedWeight: NaN,
      labActualGcv: NaN,
      labSulphur: NaN,
      overheads: {
        loading: NaN,
        freight: Infinity,
        crush: 0,
        royalty: 0,
        other: 0,
      },
      coalInputs: [
        { id: 'in_1', sourceName: 'Yard', weight: NaN, purchaseRate: Infinity },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as unknown as Dispatch;

    await idb.dispatches.put(corruptDispatch);
    const stored = await idb.dispatches.get('disp_nan_test');

    expect(stored).toBeDefined();
    expect(stored?.targetGcv).toBe(0);
    expect(stored?.baseRate).toBe(0);
    expect(stored?.labReceivedWeight).toBe(0);
    expect(stored?.overheads.loading).toBe(0);
    expect(stored?.overheads.freight).toBe(0);
    expect(stored?.coalInputs[0].weight).toBe(0);
    expect(stored?.coalInputs[0].purchaseRate).toBe(0);
  });

  it('Dexie database hooks prevent NaN on update()', async () => {
    await idb.payments.put({
      id: 'pay_nan_test',
      partyId: 'party_1',
      date: '2026-10-27',
      amount: 50000,
      type: 'received',
      mode: 'bank',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await idb.payments.update('pay_nan_test', { amount: NaN });
    const stored = await idb.payments.get('pay_nan_test');

    expect(stored?.amount).toBe(0);
    expect(isNaN(stored?.amount as number)).toBe(false);
  });

  it('cleanNumber safely handles non-numeric strings, injection strings, and null/undefined', () => {
    expect(cleanNumber(NaN)).toBe(0);
    expect(cleanNumber(Infinity)).toBe(0);
    expect(cleanNumber(-Infinity)).toBe(0);
    expect(cleanNumber('NaN')).toBe(0);
    expect(cleanNumber('nan')).toBe(0);
    expect(cleanNumber('Infinity')).toBe(0);
    expect(cleanNumber('null')).toBe(0);
    expect(cleanNumber('undefined')).toBe(0);
    expect(cleanNumber('<script>alert(1)</script>')).toBe(0);
    expect(cleanNumber('100,000')).toBe(100000);
    expect(cleanNumber('  550.25  ')).toBe(550.25);
    expect(cleanNumber(null)).toBe(0);
    expect(cleanNumber(undefined)).toBe(0);
    expect(cleanNumber('', 99)).toBe(99);
  });

  it('stripNonNumeric completely removes alphabets, SQL/script injections, and extra symbols', () => {
    expect(stripNonNumeric('abc')).toBe('');
    expect(stripNonNumeric('12a34b56')).toBe('123456');
    expect(stripNonNumeric('<script>alert("hacked")</script>4500')).toBe('4500');
    expect(stripNonNumeric("100' OR '1'='1")).toBe('10011');
    expect(stripNonNumeric('12.34.56')).toBe('12.3456'); // only one dot preserved
    expect(stripNonNumeric('--50', true, true)).toBe('-50'); // only leading minus preserved
    expect(stripNonNumeric('50-20', true, true)).toBe('5020'); // middle minus stripped
  });

  it('calculateSettlement never outputs NaN even when dispatch has zero or NaN inputs', () => {
    const corruptDispatch = {
      id: 'test_disp',
      partyId: 'p1',
      date: '2026-10-27',
      truckNumber: 'TK-1',
      factoryName: 'Factory',
      pricingModel: 'gcv',
      gcvAdjustment: 'prorata',
      targetGcv: 0, // Potential division by zero
      baseRate: 0,
      labActualGcv: 0,
      labReceivedWeight: 0,
      labSulphur: 0,
      manualDeduction: NaN,
      manualPremium: NaN,
      manualTax: NaN,
      overheads: { loading: NaN, freight: NaN, crush: NaN, royalty: NaN, other: NaN },
      coalInputs: [{ id: '1', sourceName: 'Yard', weight: NaN, purchaseRate: NaN }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as unknown as Dispatch;

    const settlement = calculateSettlement(corruptDispatch);
    expect(isNaN(settlement.payableRate)).toBe(false);
    expect(isNaN(settlement.totalRevenue)).toBe(false);
    expect(isNaN(settlement.totalCost)).toBe(false);
    expect(isNaN(settlement.netProfit)).toBe(false);
    expect(settlement.totalRevenue).toBe(0);
    expect(settlement.totalCost).toBe(0);
    expect(settlement.netProfit).toBe(0);
  });

  it('sanitizeForFirestore eliminates NaN, Infinity, and string-encoded NaN before upload', () => {
    const dataToUpload = {
      id: 'disp_1',
      factoryName: 'Clean Factory',
      baseRate: NaN,
      targetGcv: Infinity,
      notes: 'Clean note',
      labSulphur: 'NaN',
      overheads: {
        freight: NaN,
        loading: 500,
      },
      dirty: true, // Should be stripped
      pinHash: 'secret', // Should be stripped
    };

    const sanitized = sanitizeForFirestore(dataToUpload);
    expect(sanitized.baseRate).toBe(0);
    expect(sanitized.targetGcv).toBe(0);
    expect(sanitized.labSulphur).toBe(0);
    expect(sanitized.overheads.freight).toBe(0);
    expect(sanitized.overheads.loading).toBe(500);
    expect(sanitized.dirty).toBeUndefined();
    expect(sanitized.pinHash).toBeUndefined();
  });
});
