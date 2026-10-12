import { useMemo, useState } from 'react';
import { Plus, ReceiptText, Trash2, ChevronRight, Search, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { AppSettings, GeneralExpense, GeneralExpenseCategory } from '../types';
import { deleteGeneralExpense, saveGeneralExpense } from '../lib/db';
import { getTodayDateString, toLocalDateString } from '../utils/dateUtils';
import { formatCurrency } from '../utils/currency';
import { playPopSound } from '../utils/delight';
import { isDateInBooksPeriod, type BooksPeriod } from '../utils/calculations';
import {
  CATEGORY_SELECT_OPTIONS,
  EXPENSE_CATEGORIES,
  getExpenseCategoryMeta,
} from '../utils/expenseCategories';
import IOSDatePicker from './IOSDatePicker';
import IOSSelect, { type IOSSelectOption } from './IOSSelect';
import FloatingField from './FloatingField';
import IOSConfirmModal from './IOSConfirmModal';
import ExpensePreviewModal from './ExpensePreviewModal';

const MODE_OPTIONS: IOSSelectOption<NonNullable<GeneralExpense['paymentMode']>>[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'online', label: 'Online' },
];

const AMOUNT_PRESETS = [5000, 10000, 25000, 50000, 100000];

function emptyExpense(): GeneralExpense {
  const now = Date.now();
  return {
    id: uuidv4(),
    date: getTodayDateString(),
    category: 'warehouse_rent',
    amount: 0,
    description: '',
    paymentMode: 'cash',
    createdAt: now,
    updatedAt: now,
  };
}

interface Props {
  isOpen: boolean;
  expenses: GeneralExpense[];
  settings?: AppSettings;
  activePeriod?: 'all' | 'month' | '30days';
  initialMode?: 'list' | 'new';
  initialExpense?: GeneralExpense | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

export default function GeneralExpensesSheet({
  isOpen,
  expenses,
  settings,
  activePeriod = 'all',
  initialMode = 'list',
  initialExpense = null,
  onClose,
  onChanged,
}: Props) {
  const [draft, setDraft] = useState<GeneralExpense | null>(() => {
    if (initialExpense) return { ...initialExpense };
    if (initialMode === 'new') return emptyExpense();
    return null;
  });
  const [previewExpense, setPreviewExpense] = useState<GeneralExpense | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GeneralExpense | null>(null);
  const [period, setPeriod] = useState<'all' | 'month' | '30days'>(activePeriod);
  const [selectedCategory, setSelectedCategory] = useState<'all' | GeneralExpenseCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [nowInfo] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;
    return {
      monthPrefix,
      monthEnd,
      thirtyDaysAgo: now.getTime() - 30 * 86400000,
    };
  });

  // Dynamic date calculations for books period bounds
  const booksPeriod: BooksPeriod | undefined = useMemo(() => {
    if (period === 'all') return undefined;
    if (period === 'month') {
      return { from: `${nowInfo.monthPrefix}-01`, to: nowInfo.monthEnd };
    }
    return { from: toLocalDateString(nowInfo.thirtyDaysAgo), to: getTodayDateString() };
  }, [period, nowInfo]);

  // Live non-deleted expenses
  const liveExpenses = useMemo(() => {
    return expenses.filter((e) => !e.deleted);
  }, [expenses]);

  // Expenses for the current period
  const periodExpenses = useMemo(() => {
    return liveExpenses.filter((e) => isDateInBooksPeriod(e.date, booksPeriod));
  }, [liveExpenses, booksPeriod]);

  // Filtered expenses based on category and search query, sorted newest date first
  const filteredExpenses = useMemo(() => {
    let result = periodExpenses;

    if (selectedCategory !== 'all') {
      result = result.filter((e) => e.category === selectedCategory);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((e) => {
        const descMatch = e.description?.toLowerCase().includes(query);
        const vendorMatch = e.vendor?.toLowerCase().includes(query);
        const notesMatch = e.notes?.toLowerCase().includes(query);
        const catMeta = getExpenseCategoryMeta(e.category);
        const catMatch = catMeta.label.toLowerCase().includes(query);
        return descMatch || vendorMatch || notesMatch || catMatch;
      });
    }

    return [...result].sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [periodExpenses, selectedCategory, searchQuery]);

  // Period total sum
  const periodTotalAmount = useMemo(() => {
    return periodExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [periodExpenses]);

  // Filtered total sum
  const filteredTotalAmount = useMemo(() => {
    return filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }, [filteredExpenses]);

  if (!isOpen) return null;

  const openDraft = (expense?: GeneralExpense) => {
    setSaveError(null);
    setDraft(expense ? { ...expense } : emptyExpense());
  };

  const handleSave = async () => {
    if (!draft || isSaving) return;
    if (!draft.description.trim()) {
      setSaveError('Enter a short description for this expense.');
      return;
    }
    if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
      setSaveError('Expense amount must be greater than zero.');
      return;
    }

    try {
      setIsSaving(true);
      setSaveError(null);
      await saveGeneralExpense(draft);
      await onChanged();
      setDraft(null);
    } catch (error: any) {
      setSaveError(error?.message || 'Could not save this expense.');
    } finally {
      setIsSaving(false);
    }
  };

  const currentCategoryMeta = draft ? getExpenseCategoryMeta(draft.category) : null;

  return (
    <>
      <div className="ios-modal-backdrop" onClick={onClose} />
      <div className="ios-bottom-sheet" role="dialog" aria-modal="true" aria-label="General expenses">
        <div className="ios-sheet-handle" />
        <div className="ios-sheet-header">
          <button
            type="button"
            className="ios-nav-action"
            onClick={draft ? () => setDraft(null) : onClose}
          >
            {draft ? 'Back' : 'Done'}
          </button>
          <span style={{ fontSize: 17, fontWeight: 650, color: 'var(--label-primary)' }}>
            {draft
              ? expenses.some((expense) => expense.id === draft.id)
                ? 'Edit Expense'
                : 'New Expense'
              : 'General Expenses'}
          </span>
          {draft ? (
            <button
              type="button"
              className="ios-nav-action"
              onClick={() => void handleSave()}
              disabled={isSaving}
              style={{ fontWeight: 650 }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          ) : (
            <button
              type="button"
              className="ios-nav-action"
              onClick={() => openDraft()}
              aria-label="Add expense"
            >
              <Plus size={20} />
            </button>
          )}
        </div>

        <div className="ios-sheet-body" style={{ padding: '12px 16px calc(32px + env(safe-area-inset-bottom))' }}>
          {draft ? (
            /* ──────────────── EDIT / NEW EXPENSE FORM ──────────────── */
            <>
              <div
                style={{
                  padding: '10px 12px',
                  marginBottom: 14,
                  borderRadius: 12,
                  background: 'var(--fill-quaternary)',
                  color: 'var(--label-secondary)',
                  fontSize: 12,
                  lineHeight: 1.45,
                }}
              >
                Record independent overheads like yard rent, staff wages, electricity, or maintenance.
                Truck-specific freight and coal sourcing are recorded on dispatches.
              </div>

              {/* Date */}
              <IOSDatePicker
                label="Expense Date"
                value={draft.date}
                onChange={(date) => setDraft({ ...draft, date })}
                floating
              />

              {/* Category selector */}
              <IOSSelect
                label="Category"
                title="Expense Category"
                value={draft.category}
                options={CATEGORY_SELECT_OPTIONS}
                onChange={(category) => setDraft({ ...draft, category })}
                floating
              />

              {/* Quick Category Chips for rapid 1-tap switching */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  overflowX: 'auto',
                  paddingBottom: 4,
                  marginTop: -4,
                  marginBottom: 12,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {EXPENSE_CATEGORIES.map((cat) => {
                  const isSelected = draft.category === cat.id;
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, category: cat.id })}
                      style={{
                        padding: '5px 9px',
                        borderRadius: 10,
                        border: 'none',
                        background: isSelected ? cat.color : 'var(--fill-quaternary)',
                        color: isSelected ? '#ffffff' : 'var(--label-secondary)',
                        fontSize: 11,
                        fontWeight: isSelected ? 650 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={12} strokeWidth={2.4} />
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* Amount */}
              <FloatingField
                label="Amount"
                type="number"
                value={draft.amount || ''}
                onChange={(value) => setDraft({ ...draft, amount: Number(value) || 0 })}
                placeholder="0"
                required
              />

              {/* Quick Amount Increment Presets */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflowX: 'auto',
                  marginTop: -6,
                  marginBottom: 12,
                  paddingBottom: 2,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--label-tertiary)', flexShrink: 0 }}>Quick:</span>
                {AMOUNT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      const current = Number(draft.amount) || 0;
                      setDraft({ ...draft, amount: current + preset });
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: '0.5px solid var(--separator)',
                      background: 'var(--fill-quaternary)',
                      color: 'var(--ios-blue)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    +{preset >= 1000 ? `${preset / 1000}k` : preset}
                  </button>
                ))}
                {Boolean(draft.amount) && (
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, amount: 0 })}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--ios-yellow)',
                      color: 'white',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Description */}
              <FloatingField
                label="Description"
                value={draft.description}
                onChange={(description) => setDraft({ ...draft, description })}
                placeholder="e.g. October Yard Rent"
                required
              />

              {/* Category-Specific Quick Description Autocomplete Suggestions */}
              {currentCategoryMeta?.quickDescriptions && currentCategoryMeta.quickDescriptions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflowX: 'auto',
                    marginTop: -6,
                    marginBottom: 12,
                    paddingBottom: 2,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--label-tertiary)', flexShrink: 0 }}>Suggestions:</span>
                  {currentCategoryMeta.quickDescriptions.map((desc) => (
                    <button
                      key={desc}
                      type="button"
                      onClick={() => setDraft({ ...draft, description: desc })}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 8,
                        border: '0.5px solid var(--separator)',
                        background: draft.description === desc ? 'var(--tint-blue)' : 'var(--fill-quaternary)',
                        color: draft.description === desc ? 'var(--ios-blue)' : 'var(--label-secondary)',
                        fontSize: 11,
                        fontWeight: 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {desc}
                    </button>
                  ))}
                </div>
              )}

              {/* Vendor / Payee */}
              <FloatingField
                label="Vendor / Payee"
                value={draft.vendor || ''}
                onChange={(vendor) => setDraft({ ...draft, vendor })}
                placeholder="Landlord, staff name, or contractor"
              />

              {/* Payment Mode */}
              <IOSSelect
                label="Payment Mode"
                title="Payment Mode"
                value={draft.paymentMode}
                options={MODE_OPTIONS}
                onChange={(paymentMode) => setDraft({ ...draft, paymentMode })}
                floating
              />

              {/* Notes */}
              <FloatingField
                label="Notes"
                value={draft.notes || ''}
                onChange={(notes) => setDraft({ ...draft, notes })}
                placeholder="Optional reference, cheque number, or details"
              />

              {saveError && (
                <div
                  role="alert"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: 'var(--ios-red)',
                    color: 'white',
                    fontSize: 13,
                    marginBottom: 14,
                    fontWeight: 500,
                  }}
                >
                  {saveError}
                </div>
              )}

              {expenses.some((expense) => expense.id === draft.id) && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(draft)}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    border: 'none',
                    borderRadius: 12,
                    background: 'var(--ios-red)',
                    color: 'white',
                    fontSize: 15,
                    fontWeight: 650,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    marginTop: 8,
                  }}
                >
                  <Trash2 size={17} /> Delete Expense
                </button>
              )}
            </>
          ) : (
            /* ──────────────── EXPENSE LIST VIEW ──────────────── */
            <>
              {/* Period Switcher Segmented Control */}
              <div style={{ marginBottom: 12 }}>
                <div className="ios-segmented">
                  <button
                    type="button"
                    className={`ios-segmented-item ${period === 'all' ? 'active' : ''}`}
                    onClick={() => setPeriod('all')}
                  >
                    All Time
                  </button>
                  <button
                    type="button"
                    className={`ios-segmented-item ${period === 'month' ? 'active' : ''}`}
                    onClick={() => setPeriod('month')}
                  >
                    This Month
                  </button>
                  <button
                    type="button"
                    className={`ios-segmented-item ${period === '30days' ? 'active' : ''}`}
                    onClick={() => setPeriod('30days')}
                  >
                    Last 30 Days
                  </button>
                </div>
              </div>

              {/* Period Summary Metric Banner */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '0.5px solid var(--separator)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  marginBottom: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxShadow: 'var(--shadow-card)',
                }}
              >
                <div>
                  <div style={{ fontSize: 11, fontWeight: 650, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {period === 'month' ? 'This Month Overheads' : period === '30days' ? 'Last 30 Days Overheads' : 'All-Time Overheads'}
                  </div>
                  <div
                    className="tabular-nums"
                    style={{ fontSize: 22, fontWeight: 750, color: 'var(--ios-red)', marginTop: 2 }}
                  >
                    −{formatCurrency(periodTotalAmount, settings)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 2 }}>
                    {periodExpenses.length} {periodExpenses.length === 1 ? 'entry' : 'entries'} recorded
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openDraft()}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    background: 'var(--ios-blue)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: 650,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={16} strokeWidth={2.4} /> Add
                </button>
              </div>

              {/* Search Bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--fill-quaternary)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  marginBottom: 10,
                }}
              >
                <Search size={15} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search description, vendor, or notes…"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--label-primary)',
                    fontSize: 14,
                    width: '100%',
                  }}
                />
                {Boolean(searchQuery) && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--label-tertiary)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Category Filter Chips */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  overflowX: 'auto',
                  paddingBottom: 4,
                  marginBottom: 12,
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 10,
                    border: 'none',
                    background: selectedCategory === 'all' ? 'var(--ios-blue)' : 'var(--fill-quaternary)',
                    color: selectedCategory === 'all' ? '#ffffff' : 'var(--label-secondary)',
                    fontSize: 12,
                    fontWeight: selectedCategory === 'all' ? 650 : 500,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  All ({periodExpenses.length})
                </button>
                {EXPENSE_CATEGORIES.map((cat) => {
                  const count = periodExpenses.filter((e) => e.category === cat.id).length;
                  const isSelected = selectedCategory === cat.id;
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 10,
                        border: 'none',
                        background: isSelected ? cat.color : 'var(--fill-quaternary)',
                        color: isSelected ? '#ffffff' : count > 0 ? 'var(--label-primary)' : 'var(--label-tertiary)',
                        fontSize: 12,
                        fontWeight: isSelected ? 650 : 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={13} strokeWidth={2.2} />
                      {cat.label} {count > 0 && `(${count})`}
                    </button>
                  );
                })}
              </div>

              {/* Active Filter Info (if filtered) */}
              {(selectedCategory !== 'all' || searchQuery.trim()) && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                    color: 'var(--label-secondary)',
                    marginBottom: 8,
                    padding: '0 4px',
                  }}
                >
                  <span>
                    Showing {filteredExpenses.length} of {periodExpenses.length} entries
                  </span>
                  <span className="tabular-nums" style={{ fontWeight: 650, color: 'var(--ios-red)' }}>
                    −{formatCurrency(filteredTotalAmount, settings)}
                  </span>
                </div>
              )}

              {/* Grouped List of Expenses */}
              {filteredExpenses.length === 0 ? (
                <div
                  style={{
                    padding: '36px 16px',
                    textAlign: 'center',
                    background: 'var(--bg-card)',
                    borderRadius: 14,
                    border: '0.5px solid var(--separator)',
                  }}
                >
                  <ReceiptText
                    size={36}
                    strokeWidth={1.5}
                    style={{ color: 'var(--label-tertiary)', margin: '0 auto 8px', opacity: 0.4 }}
                  />
                  <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--label-primary)' }}>
                    {selectedCategory !== 'all' || searchQuery.trim()
                      ? 'No Matching Expenses'
                      : periodExpenses.length === 0
                        ? 'No Expenses in This Period'
                        : 'No General Expenses'}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.45,
                      color: 'var(--label-secondary)',
                      margin: '4px auto 16px',
                      maxWidth: 280,
                    }}
                  >
                    {selectedCategory !== 'all' || searchQuery.trim()
                      ? 'Try clearing the search or category filter to view other overheads.'
                      : 'Record warehouse rent, staff wages, utilities, or maintenance costs.'}
                  </div>
                  {selectedCategory !== 'all' || searchQuery.trim() ? (
                    <button
                      type="button"
                      className="ios-button-primary"
                      onClick={() => {
                        setSelectedCategory('all');
                        setSearchQuery('');
                      }}
                      style={{ minHeight: 40, padding: '0 16px' }}
                    >
                      Clear Filters
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ios-button-primary"
                      onClick={() => openDraft()}
                      style={{ minHeight: 40, padding: '0 16px' }}
                    >
                      Add Expense
                    </button>
                  )}
                </div>
              ) : (
                <div className="ios-card-grouped">
                  {filteredExpenses.map((expense, index) => {
                    const meta = getExpenseCategoryMeta(expense.category);
                    const dateParts = (expense.date || '').split('-');
                    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                    const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
                    const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

                    return (
                      <button
                        type="button"
                        key={expense.id}
                        className="ios-cell"
                        onClick={() => {
                          playPopSound();
                          setPreviewExpense(expense);
                        }}
                        style={{
                          width: '100%',
                          border: 'none',
                          background: 'transparent',
                          textAlign: 'left',
                          minHeight: 64,
                          cursor: 'pointer',
                        }}
                      >
                        {/* Date Calendar Tile Icon (Same as Dispatch) */}
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: 'var(--fill-tertiary)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                            flexShrink: 0,
                            border: '0.5px solid var(--separator)',
                          }}
                        >
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ios-red)', letterSpacing: 0.3 }}>
                            {monthStr}
                          </span>
                          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                            {dayStr}
                          </span>
                        </div>

                        {/* Two-Column Aligned Content Grid */}
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                          }}
                        >
                          {/* Left Column: Description & Category Indicator */}
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 650,
                                color: 'var(--label-primary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                letterSpacing: '-0.24px',
                                lineHeight: 1.25,
                              }}
                              title={expense.description}
                            >
                              {expense.description}
                            </div>

                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--label-secondary)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                lineHeight: 1.2,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                              }}
                            >
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: meta.color,
                                  flexShrink: 0,
                                }}
                              />
                              <span>{meta.label}</span>
                              {expense.vendor && (
                                <>
                                  <span style={{ opacity: 0.5 }}>·</span>
                                  <span>To: {expense.vendor}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Right Column: Financial Amount & Payment Tag */}
                          <div
                            style={{
                              flexShrink: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'flex-end',
                              justifyContent: 'center',
                              gap: 3,
                              textAlign: 'right',
                            }}
                          >
                            <div
                              className="tabular-nums"
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                color: 'var(--ios-red)',
                                whiteSpace: 'nowrap',
                                letterSpacing: '-0.3px',
                                lineHeight: 1.25,
                              }}
                            >
                              −{formatCurrency(expense.amount, settings)}
                            </div>

                            <div style={{ minHeight: 16, display: 'flex', alignItems: 'center' }}>
                              {expense.paymentMode ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 650,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.4px',
                                    padding: '1.5px 6px',
                                    borderRadius: 5,
                                    background: 'var(--fill-quaternary)',
                                    color: 'var(--label-secondary)',
                                    lineHeight: 1.2,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {expense.paymentMode}
                                </span>
                              ) : (
                                <span style={{ fontSize: 11, color: 'var(--label-tertiary)', lineHeight: 1.2 }}>—</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <ChevronRight className="ios-chevron" size={16} strokeWidth={2.5} style={{ marginLeft: 6, flexShrink: 0 }} />
                        {index < filteredExpenses.length - 1 && <div className="ios-separator with-glyph" style={{ left: 72 }} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Read-only Expense Preview Modal with Edit option */}
      <ExpensePreviewModal
        expense={previewExpense}
        settings={settings}
        onClose={() => setPreviewExpense(null)}
        onEdit={(exp) => {
          setPreviewExpense(null);
          openDraft(exp);
        }}
        onDelete={async (exp) => {
          setPreviewExpense(null);
          setPendingDelete(exp);
        }}
      />

      {/* Confirmation Dialog for Expense Deletion */}
      <IOSConfirmModal
        isOpen={Boolean(pendingDelete)}
        title="Delete Expense?"
        message="This permanently removes the expense from your Books totals and syncs the deletion to your other devices."
        confirmText="Delete Expense"
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteGeneralExpense(pendingDelete.id);
          await onChanged();
          setPendingDelete(null);
          setDraft(null);
        }}
      />
    </>
  );
}
