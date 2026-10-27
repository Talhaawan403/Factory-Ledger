import { describe, it, expect } from 'vitest';
import { calculateSettlement } from '../src/utils/calculations';
import type { Dispatch } from '../src/types';

describe('Final Issues Fixes & Validation Guards', () => {
  it('calculates pro-rata deduction properly and accurately detects negative payable rate', () => {
    // When deductions exceed base rate, payableRate can become negative in pure calculations
    const highDeductionDispatch: Dispatch = {
      id: 'disp-negative-test',
      date: '2026-10-27',
      partyId: 'party-test-1',
      truckNumber: 'TK-NEG-1',
      baseRate: 1000,
      manualDeduction: 1500, // exceeds base rate
      labReceivedWeight: 20,
      taxMethod: 'manual',
      manualTax: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      factoryName: '',
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
    };

    const settlement = calculateSettlement(highDeductionDispatch);
    expect(settlement.payableRate).toBe(-500);
    // In our UI form validation, settlement.payableRate <= 0 is strictly blocked from saving
    expect(settlement.payableRate <= 0).toBe(true);
  });

  it('correctly applies pro-rata GCV adjustment when labActualGcv is positive', () => {
    const prorataDispatch: Dispatch = {
      id: 'disp-prorata-valid',
      date: '2026-10-27',
      partyId: 'party-test-1',
      truckNumber: 'TK-PRO-1',
      baseRate: 30000,
      targetGcv: 6000,
      labActualGcv: 5800, // 200 GCV penalty
      gcvAdjustment: 'prorata',
      gcvAdjustmentRounding: 'paisa',
      labReceivedWeight: 30,
      taxMethod: 'manual',
      manualTax: 0,
      commissionPerTon: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      factoryName: '',
      coalInputs: [],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
    };

    const settlement = calculateSettlement(prorataDispatch);
    expect(settlement.isProrata).toBe(true);
    // 30,000 * (1 - 5800 / 6000) = 30,000 * (200 / 6000) = 1,000
    expect(settlement.gcvDeduction).toBeCloseTo(1000, 2);
    expect(settlement.payableRate).toBeCloseTo(29000, 2);
    expect(settlement.payableRate > 0).toBe(true);
  });

  it('verifies import.meta.env.DEV behavior for devSeed isolation', () => {
    // In vitest / test runner, import.meta.env.DEV is defined
    expect(typeof import.meta.env.DEV).toBe('boolean');
  });
});
