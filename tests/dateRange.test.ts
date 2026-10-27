import { describe, it, expect } from 'vitest';
import { getDateRangeForPreset, filterLedgerByDateRange } from '../src/utils/dateRange';
import type { Dispatch, Payment, Party } from '../src/types';

describe('Date Range Presets & Ledger Filtering', () => {
  const refDate = new Date(2026, 9, 27); // Oct 27, 2026

  it('resolves This Month correctly', () => {
    const range = getDateRangeForPreset('this_month', undefined, undefined, refDate);
    expect(range.preset).toBe('this_month');
    expect(range.from).toBe('2026-10-01');
    expect(range.to).toBe('2026-10-31');
    expect(range.label).toContain('OCT 01, 2026 – OCT 31, 2026');
  });

  it('resolves Last Month correctly', () => {
    const range = getDateRangeForPreset('last_month', undefined, undefined, refDate);
    expect(range.preset).toBe('last_month');
    expect(range.from).toBe('2026-09-01');
    expect(range.to).toBe('2026-09-30');
    expect(range.label).toContain('SEP 01, 2026 – SEP 30, 2026');
  });

  it('resolves All Time correctly', () => {
    const range = getDateRangeForPreset('all', undefined, undefined, refDate);
    expect(range.preset).toBe('all');
    expect(range.from).toBeUndefined();
    expect(range.to).toBeUndefined();
    expect(range.label).toBe('All Time');
  });

  it('resolves Custom Range correctly', () => {
    const range = getDateRangeForPreset('custom', '2026-10-10', '2026-10-20', refDate);
    expect(range.preset).toBe('custom');
    expect(range.from).toBe('2026-10-10');
    expect(range.to).toBe('2026-10-20');
    expect(range.label).toContain('OCT 10, 2026 – OCT 20, 2026');
  });

  it('calculates Opening Balance B/F and Closing Balance for prior dispatches and payments', () => {
    const party: Party = {
      id: 'p1',
      name: 'Bestway Cement',
      contactPerson: 'Manager',
      phone: '03001234567',
      address: 'Taxila',
      createdAt: Date.now(),
    };

    // Dispatch 1: Sep 15 (Prior) -> 20t * 10,000 = 200,000
    // Dispatch 2: Oct 10 (Period) -> 10t * 10,000 = 100,000
    const dispatches: Dispatch[] = [
      {
        id: 'd-prior',
        partyId: 'p1',
        factoryName: 'Factory 1',
        date: '2026-09-15',
        truckNumber: 'TK-PRIOR',
        baseRate: 10000,
        rate: 10000,
        billedWeight: 20.0,
        labReceivedWeight: 20.0,
        totalAmount: 200000,
        coalInputs: [],
        createdAt: 1000,
        updatedAt: 1000,
      } as unknown as Dispatch,
      {
        id: 'd-current',
        partyId: 'p1',
        factoryName: 'Factory 1',
        date: '2026-10-10',
        truckNumber: 'TK-CURRENT',
        baseRate: 10000,
        rate: 10000,
        billedWeight: 10.0,
        labReceivedWeight: 10.0,
        totalAmount: 100000,
        coalInputs: [],
        createdAt: 2000,
        updatedAt: 2000,
      } as unknown as Dispatch,
    ];

    // Payment 1: Sep 20 (Prior) -> 50,000 received
    // Payment 2: Oct 12 (Period) -> 40,000 received
    const payments: Payment[] = [
      {
        id: 'pay-prior',
        partyId: 'p1',
        date: '2026-09-20',
        amount: 50000,
        type: 'received',
        mode: 'bank',
        createdAt: 1500,
      },
      {
        id: 'pay-current',
        partyId: 'p1',
        date: '2026-10-12',
        amount: 40000,
        type: 'received',
        mode: 'bank',
        createdAt: 2500,
      },
    ];

    // Filter for October 2026
    const range = { from: '2026-10-01', to: '2026-10-31', label: 'October 2026' };
    const result = filterLedgerByDateRange(dispatches, payments, range, party);

    // Prior Billed = 200,000, Prior Received = 50,000 => Opening Balance = 150,000
    expect(result.openingBalance).toBe(150000);

    // Period Dispatches = 1, Period Payments = 1
    expect(result.periodDispatches.length).toBe(1);
    expect(result.periodPayments.length).toBe(1);
    expect(result.periodBalance.totalBilled).toBe(100000);
    expect(result.periodBalance.totalPaymentsReceived).toBe(40000);

    // Closing Balance = 150,000 + 100,000 - 40,000 = 210,000
    expect(result.closingBalance).toBe(210000);
  });
});
