import { beforeEach, describe, expect, it } from 'vitest';
import type { Dispatch, GeneralExpense, GeneralExpenseCategory } from '../src/types';
import { calculateBooksTotals, isDateInBooksPeriod } from '../src/utils/calculations';
import { getExpenseCategoryMeta, EXPENSE_CATEGORIES } from '../src/utils/expenseCategories';
import {
  clearAllData,
  deleteGeneralExpense,
  getAllBackupData,
  getDispatch,
  getGeneralExpenses,
  getLedgerForSync,
  markRecordsClean,
  restoreBackup,
  saveDispatch,
  saveGeneralExpense,
} from '../src/lib/db';

function dispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: 'books-dispatch-1',
    partyId: 'party-1',
    date: '2026-09-30',
    truckNumber: 'TK-BOOKS-1',
    factoryName: 'Books Factory',
    targetGcv: 4500,
    baseRate: 38000,
    coalInputs: [{ id: 'coal-1', sourceName: 'Yard Stock', weight: 30, purchaseRate: 30000 }],
    overheads: { loading: 3000, freight: 90000, crush: 0, royalty: 0, other: 0 },
    labActualGcv: 4500,
    labSulphur: 1,
    labReceivedWeight: 29.5,
    manualTax: 0,
    manualDeduction: 0,
    manualPremium: 0,
    taxMethod: 'manual',
    commissionPerTon: 0,
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function expense(overrides: Partial<GeneralExpense> = {}): GeneralExpense {
  return {
    id: 'expense-1',
    date: '2026-09-30',
    category: 'warehouse_rent',
    amount: 50000,
    description: 'September warehouse rent',
    paymentMode: 'bank',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Books P&L recognition', () => {
  it('posts pending dispatch cost immediately while recognizing zero revenue', () => {
    const totals = calculateBooksTotals([dispatch()], []);
    expect(totals.dispatchCost).toBe(993000);
    expect(totals.inTransitCost).toBe(993000);
    expect(totals.totalInflow).toBe(0);
    expect(totals.totalOutflow).toBe(993000);
    expect(totals.netEffect).toBe(-993000);
    expect(totals.pendingCount).toBe(1);
  });

  it('uses explicit pending status even when provisional factory weight exists', () => {
    const totals = calculateBooksTotals([dispatch({ labReceivedWeight: 29.5, status: 'pending' })], []);
    expect(totals.totalInflow).toBe(0);
    expect(totals.netEffect).toBe(-993000);
  });

  it('posts dispatch cost and settled revenue into their separate recognition periods', () => {
    const settled = dispatch({
      status: 'settled',
      settledDate: '2026-10-02',
      settledAt: 2,
    });

    const september = calculateBooksTotals([settled], [], undefined, { from: '2026-09-01', to: '2026-09-30' });
    expect(september.totalInflow).toBe(0);
    expect(september.totalOutflow).toBe(993000);
    expect(september.netEffect).toBe(-993000);

    const october = calculateBooksTotals([settled], [], undefined, { from: '2026-10-01', to: '2026-10-31' });
    expect(october.totalInflow).toBe(1121000);
    expect(october.totalOutflow).toBe(0);
    expect(october.netEffect).toBe(1121000);
  });

  it('adds independent expenses once and maintains the Books invariant', () => {
    const totals = calculateBooksTotals([dispatch()], [expense()]);
    expect(totals.generalExpenses).toBe(50000);
    expect(totals.totalOutflow).toBe(1043000);
    expect(totals.netEffect).toBe(totals.totalInflow - totals.totalOutflow);
  });
});

describe('Books persistence and backup lifecycle', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('preserves an explicit pending status and settlement fields through IndexedDB', async () => {
    await saveDispatch(dispatch({ status: 'pending', labReceivedWeight: 29.5 }));
    const savedPending = await getDispatch('books-dispatch-1');
    expect(savedPending?.status).toBe('pending');

    await saveDispatch(dispatch({ status: 'settled', settledAt: 123, settledDate: '2026-10-02' }));
    const savedSettled = await getDispatch('books-dispatch-1');
    expect(savedSettled?.status).toBe('settled');
    expect(savedSettled?.settledAt).toBe(123);
    expect(savedSettled?.settledDate).toBe('2026-10-02');
  });

  it('includes expenses in active queries, dirty sync data, backup, restore, and soft delete', async () => {
    await saveGeneralExpense(expense());
    expect(await getGeneralExpenses()).toHaveLength(1);
    const dirtyExpense = (await getLedgerForSync(true)).expenses[0];
    expect(dirtyExpense).toBeDefined();
    await markRecordsClean({ expenses: [{ id: dirtyExpense.id, updatedAt: dirtyExpense.updatedAt }] });
    expect((await getLedgerForSync(true)).expenses).toHaveLength(0);

    const backup = await getAllBackupData();
    expect(backup.expenses).toHaveLength(1);
    await clearAllData();
    expect(await getGeneralExpenses()).toHaveLength(0);

    const restored = await restoreBackup(backup, { skipSnapshot: true });
    expect(restored.success).toBe(true);
    expect(await getGeneralExpenses()).toHaveLength(1);

    await deleteGeneralExpense('expense-1');
    expect(await getGeneralExpenses()).toHaveLength(0);
    expect((await getLedgerForSync(true)).expenses.some((item) => item.id === 'expense-1' && item.deleted)).toBe(true);
  });

  it('correctly filters dates using canonical books period boundaries', () => {
    expect(isDateInBooksPeriod('2026-10-05', undefined)).toBe(true);
    expect(isDateInBooksPeriod('2026-10-05', { from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(isDateInBooksPeriod('2026-09-30', { from: '2026-10-01', to: '2026-10-31' })).toBe(false);
    expect(isDateInBooksPeriod('2026-11-01', { from: '2026-10-01', to: '2026-10-31' })).toBe(false);
    expect(isDateInBooksPeriod(undefined, { from: '2026-10-01', to: '2026-10-31' })).toBe(false);
  });

  it('provides complete iOS category metadata and suggestions for all defined categories', () => {
    expect(EXPENSE_CATEGORIES.length).toBe(8);
    const categories: GeneralExpenseCategory[] = [
      'warehouse_rent',
      'warehouse_labour',
      'utilities',
      'equipment',
      'maintenance',
      'office',
      'transport',
      'other',
    ];

    for (const cat of categories) {
      const meta = getExpenseCategoryMeta(cat);
      expect(meta.id).toBe(cat);
      expect(meta.label).toBeTruthy();
      expect(meta.color).toMatch(/^var\(--ios-|^var\(--label-/);
      expect(meta.icon).toBeDefined();
      expect(meta.quickDescriptions.length).toBeGreaterThan(0);
    }

    const fallback = getExpenseCategoryMeta('unknown' as any);
    expect(fallback.id).toBe('other');
  });
});

