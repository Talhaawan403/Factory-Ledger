import { useCallback, useEffect, useState } from 'react';
import { getDispatches, getParties, getPayments, getPurchaseOrders, getSettings, getGeneralExpenses, getLots, deleteGeneralExpense } from '../lib/db';
import type { Dispatch, Party, Payment, PurchaseOrder, AppSettings, GeneralExpense, InventoryLot } from '../types';
import { calculateSettlement, calculatePartyBalance, isDispatchPending, calculateLedgerTotals, calculateBooksTotals, isDateInBooksPeriod } from '../utils/calculations';
import { formatCurrency, formatCompactFinancial } from '../utils/currency';
import { playPopSound, triggerConfetti } from '../utils/delight';
import { getTodayDateString, toLocalDateString } from '../utils/dateUtils';
import { useLedgerListener } from '../hooks/useLedgerListener';
import {
    Truck,
    Building2,
    ChevronRight,
    ArrowUpRight,
    Scale,
    TrendingUp,
    Calculator,
    ArrowDownRight,
    ReceiptText,
    Plus,
    Store
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DealEstimatorModal from '../components/DealEstimatorModal';
import DispatchPreviewModal from '../components/DispatchPreviewModal';
import ExpensePreviewModal from '../components/ExpensePreviewModal';
import GeneralExpensesSheet from '../components/GeneralExpensesSheet';
import { getExpenseCategoryMeta } from '../utils/expenseCategories';

export default function Summary() {
    const [dispatches, setDispatches] = useState<Dispatch[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [lots, setLots] = useState<InventoryLot[]>([]);
    const [expenses, setExpenses] = useState<GeneralExpense[]>([]);
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [period, setPeriod] = useState<'all' | 'month' | '30days'>('all');
    const [previewDispatch, setPreviewDispatch] = useState<Dispatch | null>(null);
    const [previewExpense, setPreviewExpense] = useState<GeneralExpense | null>(null);
    const [isEstimatorOpen, setIsEstimatorOpen] = useState(false);
    const [isExpensesOpen, setIsExpensesOpen] = useState(false);
    const [expenseInitialMode, setExpenseInitialMode] = useState<'list' | 'new'>('list');
    const [expenseInitialItem, setExpenseInitialItem] = useState<GeneralExpense | null>(null);
    const navigate = useNavigate();

    // Lazy initialization for today's date & timestamps (ensuring zero purity warnings)
    const [todayStr] = useState(() =>
        new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        }).toUpperCase()
    );

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
            thirtyDaysAgo: now.getTime() - 30 * 86400000
        };
    });

    const loadData = useCallback(async () => {
        try {
            const [d, p, pay, expenseList, poList, s, lotList] = await Promise.all([
                getDispatches(),
                getParties(),
                getPayments(),
                getGeneralExpenses(),
                getPurchaseOrders(),
                getSettings(),
                getLots(),
            ]);
            setDispatches(d);
            setParties(p);
            setPayments(pay);
            setExpenses(expenseList);
            setPos(poList);
            setSettings(s);
            setLots(lotList);
            setLoadError(null);
        } catch (error) {
            console.error('[Summary] Could not load the overview:', error);
            setLoadError('Could not load your local ledger. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all([
            getDispatches(),
            getParties(),
            getPayments(),
            getGeneralExpenses(),
            getPurchaseOrders(),
            getSettings(),
            getLots(),
        ]).then(([d, p, pay, expenseList, poList, s, lotList]) => {
            if (active) {
                setDispatches(d);
                setParties(p);
                setPayments(pay);
                setExpenses(expenseList);
                setPos(poList);
                setSettings(s);
                setLots(lotList);
                setLoadError(null);
                setLoading(false);
            }
        }).catch((error) => {
            if (active) {
                console.error('[Summary] Could not load the overview:', error);
                setLoadError('Could not load your local ledger. Please try again.');
                setLoading(false);
            }
        });
        return () => {
            active = false;
        };
    }, []);

    useLedgerListener(() => {
        void loadData();
    });



    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
                Loading overview…
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
                <p style={{ margin: '0 0 16px' }}>{loadError}</p>
                <button
                    type="button"
                    className="ios-button-primary"
                    onClick={() => {
                        setLoading(true);
                        void loadData();
                    }}
                >
                    Try again
                </button>
            </div>
        );
    }

    // Filter dispatches based on selected period
    const filteredDispatches = dispatches.filter(d => {
        if (period === 'month') {
            return d.date?.startsWith(nowInfo.monthPrefix) || d.createdAt >= new Date(nowInfo.monthPrefix + '-01').getTime();
        }
        if (period === '30days') {
            return d.date >= toLocalDateString(nowInfo.thirtyDaysAgo);
        }
        return true;
    });

    // Separate settled dispatches from pending (in-transit / unweighed) dispatches (Issue 19 / T6)
    const pendingDispatches = filteredDispatches.filter(d => isDispatchPending(d));

    // Operational totals remain settled-only. Books posts cost on dispatch date
    // and revenue on the separate factory-settlement date.
    const ledgerTotals = calculateLedgerTotals(filteredDispatches, settings);
    const booksPeriod = period === 'all'
        ? undefined
        : period === 'month'
            ? { from: `${nowInfo.monthPrefix}-01`, to: nowInfo.monthEnd }
            : { from: toLocalDateString(nowInfo.thirtyDaysAgo), to: getTodayDateString() };
    const booksTotals = calculateBooksTotals(dispatches, expenses, settings, booksPeriod);
    const totalProfit = booksTotals.netEffect;
    const totalRevenue = booksTotals.totalInflow;
    const totalCost = booksTotals.totalOutflow;
    const totalTons = ledgerTotals.receivedTons;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const formattedProfit = formatCurrency(totalProfit, settings, { showSign: true });

    // Filter and sort general expenses for the active period
    const periodExpenses = expenses.filter((e) => !e.deleted && isDateInBooksPeriod(e.date, booksPeriod));

    const sortedPeriodExpenses = [...periodExpenses].sort((a, b) => {
        const dateCmp = (b.date || '').localeCompare(a.date || '');
        if (dateCmp !== 0) return dateCmp;
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // Calculate category distribution for period overview
    const categoryDistribution: Record<string, number> = {};
    for (const e of periodExpenses) {
        categoryDistribution[e.category] = (categoryDistribution[e.category] || 0) + (e.amount || 0);
    }

    let topExpenseCategoryMeta = null;
    let maxVal = -1;
    for (const [cat, val] of Object.entries(categoryDistribution)) {
        if (val > maxVal) {
            maxVal = val;
            topExpenseCategoryMeta = getExpenseCategoryMeta(cat);
        }
    }

    // Recent Dispatches
    const recentDispatches = [...filteredDispatches]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5);

    const partyBalances = parties.map(party => {
        const isSupplier = party.type === 'supplier';
        const pDispatches = isSupplier ? [] : dispatches.filter(d => d.partyId === party.id);
        const pPayments = payments.filter(p => p.partyId === party.id || (isSupplier && p.supplierId === party.id));
        const balanceResult = calculatePartyBalance(pDispatches, pPayments, party, lots);
        return {
            party,
            balance: balanceResult.outstandingBalance,
            dispatchesCount: isSupplier ? balanceResult.dispatchesCount : pDispatches.length,
            isSupplier,
            balanceResult
        };
    });

    const buyerBalances = partyBalances.filter(pb => !pb.isSupplier);
    const totalReceivables = buyerBalances.reduce((sum, pb) => pb.balance > 0 ? sum + pb.balance : sum, 0);
    const partiesWithDues = buyerBalances.filter(pb => pb.balance > 0);

    const supplierBalances = partyBalances.filter(pb => pb.isSupplier);
    const totalPayables = supplierBalances.reduce((sum, pb) => pb.balance > 0 ? sum + pb.balance : sum, 0);
    const suppliersWithPayables = supplierBalances.filter(pb => pb.balance > 0);

    const sortedPartyBalances = [...partyBalances].sort((a, b) => {
        const aHasBal = Math.abs(a.balance) > 0 ? 1 : 0;
        const bHasBal = Math.abs(b.balance) > 0 ? 1 : 0;
        if (bHasBal !== aHasBal) return bHasBal - aHasBal;
        return Math.abs(b.balance) - Math.abs(a.balance);
    });


    const firstName = settings?.userName?.trim().split(/\s+/)[0] || '';

    return (
        <div className="ios-fade-in" style={{ paddingBottom: 24 }}>
            {/* ── iOS Navigation Header with Large Title ── */}
            <div className="ios-large-header">
                <div className="ios-large-subtitle">{todayStr}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h1 className="ios-large-title">{firstName ? `Welcome ${firstName}` : 'Welcome'}</h1>
                    <button
                        type="button"
                        onClick={() => {
                            playPopSound();
                            setIsEstimatorOpen(true);
                        }}
                        className="ios-nav-circle-btn"
                        title="Quick Deal Estimator & Margin Calculator"
                    >
                        <Calculator style={{ width: 19, height: 19 }} strokeWidth={2.4} />
                    </button>
                </div>
            </div>

            {/* ── Period Selector (Segmented Control) ── */}
            <div style={{ padding: '0 16px', marginBottom: 14 }}>
                <div className="ios-segmented">
                    <button
                        type="button"
                        className={`ios-segmented-item ${period === 'all' ? 'active' : ''}`}
                        onClick={() => {
                            setPeriod('all');
                            playPopSound();
                        }}
                    >
                        All Time
                    </button>
                    <button
                        type="button"
                        className={`ios-segmented-item ${period === 'month' ? 'active' : ''}`}
                        onClick={() => {
                            setPeriod('month');
                            playPopSound();
                        }}
                    >
                        This Month
                    </button>
                    <button
                        type="button"
                        className={`ios-segmented-item ${period === '30days' ? 'active' : ''}`}
                        onClick={() => {
                            setPeriod('30days');
                            playPopSound();
                        }}
                    >
                        Last 30 Days
                    </button>
                </div>
            </div>

            {/* ── Business Books: recognized inflow minus all posted outflow ── */}
            <div className="ios-hero-card">
                {/* Header row: Metric Title + Period Indicator on Left, Margin Badge on Right */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
                            {totalProfit > 0 ? 'Net Effect · Profit' : totalProfit < 0 ? 'Net Effect · Loss' : 'Net Effect · Balanced'}
                        </span>
                        {period !== 'all' && (
                            <span style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: 6,
                                background: 'var(--ios-blue)',
                                color: 'white',
                                textTransform: 'uppercase',
                                letterSpacing: 0.3,
                                whiteSpace: 'nowrap'
                            }}>
                                {period === 'month' ? 'This Month' : 'Last 30d'}
                            </span>
                        )}
                    </div>

                    {/* Celebratory interactive margin badge */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (totalProfit > 0) triggerConfetti(e.clientX, e.clientY);
                        }}
                        className="ios-hero-badge"
                        title={totalProfit > 0 ? 'Profitable period' : totalProfit < 0 ? 'Loss for this period' : 'Books are balanced'}
                        style={{ background: totalProfit > 0 ? 'var(--ios-green)' : totalProfit < 0 ? 'var(--ios-red)' : 'var(--label-tertiary)', border: 'none', cursor: totalProfit > 0 ? 'pointer' : 'default', flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                        {totalProfit < 0
                            ? <ArrowDownRight style={{ color: 'white', width: 14, height: 14, flexShrink: 0 }} strokeWidth={2.6} />
                            : <ArrowUpRight style={{ color: 'white', width: 14, height: 14, flexShrink: 0 }} strokeWidth={2.6} />}
                        <span style={{ color: 'white', fontWeight: 800, whiteSpace: 'nowrap' }}>
                            {totalRevenue > 0 ? `${profitMargin.toFixed(1)}% margin` : booksTotals.pendingCount > 0 ? 'Revenue pending' : 'No settled inflow'}
                        </span>
                    </button>
                </div>

                {/* Hero Amount: Dedicated full width, guaranteed single line */}
                <div
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: formattedProfit.length > 15 ? 28 : formattedProfit.length > 12 ? 34 : 38,
                        fontWeight: 800,
                        letterSpacing: -1,
                        color: totalProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)',
                        lineHeight: 1.15,
                        marginTop: 8,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                    className="tabular-nums"
                >
                    {formattedProfit}
                </div>

                {/* Visual Multi-Segment Comparison Progress Bar */}
                <div style={{ marginTop: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--label-secondary)', marginBottom: 7, fontWeight: 500 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Scale style={{ width: 13, height: 13, color: 'var(--accent-primary)' }} />
                            <span>Recognized Inflow vs Total Outflow</span>
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--label-primary)' }}>{totalTons.toFixed(1)} t delivered</span>
                    </div>
                    <div style={{
                        height: 10,
                        borderRadius: 6,
                        background: 'var(--fill-primary)',
                        overflow: 'hidden',
                        display: 'flex',
                        gap: 2,
                        padding: 1
                    }}>
                        {/* Coal Sourcing Segment */}
                        <div
                            style={{
                                width: `${Math.max(10, Math.min(85, totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 70))}%`,
                                background: 'var(--ios-blue)',
                                borderRadius: '4px 0 0 4px',
                                transition: 'width 0.4s ease'
                            }}
                            title={`Cost: ${formatCurrency(totalCost, settings)}`}
                        />
                        {/* Net Margin Segment */}
                        <div
                            style={{
                                flex: 1,
                                background: totalProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)',
                                borderRadius: '0 4px 4px 0',
                                transition: 'all 0.4s ease'
                            }}
                            title={`Margin: ${formatCurrency(totalProfit, settings)}`}
                        />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--label-tertiary)', marginTop: 5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ios-blue)' }} />
                            Total Outflow: {formatCompactFinancial(totalCost, settings, 1).fullString}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: totalProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)' }} />
                            Net Effect: {formatCompactFinancial(totalProfit, settings, 1).fullString}
                        </span>
                    </div>
                </div>
            </div>

            {/* In-Transit Dispatches Banner (Issue 19) */}
            {pendingDispatches.length > 0 && (
                <div style={{ padding: '0 16px', marginBottom: 14 }}>
                    <div
                        onClick={() => {
                            navigate('/entries');
                            playPopSound();
                        }}
                        style={{
                            background: 'var(--bg-card)',
                            borderRadius: 14,
                            border: '0.5px solid var(--separator)',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            boxShadow: 'var(--shadow-card)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div
                                style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 9,
                                    background: 'var(--fill-quaternary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--ios-blue)',
                                }}
                            >
                                <Truck size={18} />
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }}>
                                    {pendingDispatches.length} {pendingDispatches.length === 1 ? 'Truck' : 'Trucks'} in Transit
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                                    {formatCurrency(booksTotals.inTransitCost, settings)} cost included · revenue pending
                                </div>
                            </div>
                        </div>
                        <ChevronRight size={16} style={{ color: 'var(--label-tertiary)' }} />
                    </div>
                </div>
            )}

            {/* ── 2x2 Interactive Metric Widgets Grid ── */}
            <div className="ios-widget-grid">
                {/* Revenue */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="View Total Inflow details in Dispatches"
                    onClick={() => {
                        navigate('/entries');
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/entries');
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>Total Inflow</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                    </div>
                    <div className="ios-widget-value">
                        {(() => {
                            const rev = formatCompactFinancial(totalRevenue, settings, 2);
                            return (
                                <>
                                    {rev.symbol} {rev.value}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>{rev.unit}</span>
                                </>
                            );
                        })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <TrendingUp style={{ width: 12, height: 12, color: 'var(--ios-green)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Factory revenue</span>
                        </div>
                        {/*  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--ios-blue)', fontWeight: 650, fontSize: 11, flexShrink: 0 }}>
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span> */}
                    </div>
                </div>

                {/* Costs */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="View Total Outflow details in Dispatches"
                    onClick={() => {
                        navigate('/entries');
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/entries');
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>Total Outflow</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                    </div>
                    <div className="ios-widget-value">
                        {(() => {
                            const cost = formatCompactFinancial(totalCost, settings, 2);
                            return (
                                <>
                                    {cost.symbol} {cost.value}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>{cost.unit}</span>
                                </>
                            );
                        })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <ArrowDownRight style={{ width: 12, height: 12, color: 'var(--ios-red)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Dispatches + exp.</span>
                        </div>
                        {/*  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--ios-blue)', fontWeight: 650, fontSize: 11, flexShrink: 0 }}>
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span> */}
                    </div>
                </div>

                {/* Independent warehouse / general expenses */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="Open General Expenses Ledger"
                    onClick={() => {
                        setExpenseInitialItem(null);
                        setExpenseInitialMode('list');
                        setIsExpensesOpen(true);
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpenseInitialItem(null);
                            setExpenseInitialMode('list');
                            setIsExpensesOpen(true);
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>General Expenses</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setExpenseInitialItem(null);
                                setExpenseInitialMode('new');
                                setIsExpensesOpen(true);
                                playPopSound();
                            }}
                            title="Add General Expense"
                            aria-label="Add General Expense"
                            style={{
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                background: 'var(--fill-quaternary)',
                                border: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--ios-blue)',
                                cursor: 'pointer',
                                padding: 0,
                                flexShrink: 0,
                                transition: 'transform 0.15s ease, background 0.15s ease',
                            }}
                        >
                            <Plus size={15} strokeWidth={2.4} />
                        </button>
                    </div>
                    <div className="ios-widget-value">
                        {(() => {
                            const value = formatCompactFinancial(booksTotals.generalExpenses, settings, 2);
                            return (
                                <>
                                    {value.symbol} {value.value}
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>
                                        {value.unit}
                                    </span>
                                </>
                            );
                        })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <ReceiptText size={12} style={{ color: 'var(--ios-orange)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {periodExpenses.length === 0
                                    ? 'No overheads'
                                    : topExpenseCategoryMeta
                                        ? `${periodExpenses.length} ${periodExpenses.length === 1 ? 'entry' : 'entries'} · ${topExpenseCategoryMeta.label}`
                                        : `${periodExpenses.length} ${periodExpenses.length === 1 ? 'entry' : 'entries'}`}
                            </span>
                        </div>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 1,
                                color: 'var(--ios-blue)',
                                fontWeight: 650,
                                fontSize: 11,
                                flexShrink: 0,
                            }}
                        >
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span>
                    </div>
                </div>

                {/* Capital currently committed to trucks awaiting settlement */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="View Capital in Transit details in Dispatches"
                    onClick={() => {
                        navigate('/entries');
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/entries');
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>Capital in Transit</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                    </div>
                    <div className="ios-widget-value">
                        {(() => {
                            const value = formatCompactFinancial(booksTotals.inTransitCost, settings, 2);
                            return <>{value.symbol} {value.value}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>{value.unit}</span></>;
                        })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Truck size={12} style={{ color: 'var(--ios-blue)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{booksTotals.pendingCount} pending</span>
                        </div>
                        {/*  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--ios-blue)', fontWeight: 650, fontSize: 11, flexShrink: 0 }}>
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span> */}
                    </div>
                </div>

                {/* Total Dispatches */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="View all Dispatches"
                    onClick={() => {
                        navigate('/entries');
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/entries');
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>Dispatches</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                    </div>
                    <div className="ios-widget-value">
                        {filteredDispatches.length}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>Trucks</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Scale size={12} style={{ color: 'var(--ios-teal)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Avg {(totalTons / Math.max(1, filteredDispatches.length)).toFixed(1)} t/truck</span>
                        </div>
                        {/*  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--ios-blue)', fontWeight: 650, fontSize: 11, flexShrink: 0 }}>
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span>*/}
                    </div>
                </div>

                {/* Active Parties */}
                <div
                    className="ios-metric-widget"
                    role="button"
                    tabIndex={0}
                    aria-label="View Parties directory"
                    onClick={() => {
                        navigate('/parties');
                        playPopSound();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/parties');
                            playPopSound();
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                            <span className="ios-widget-title" style={{ whiteSpace: 'nowrap' }}>Parties</span>
                            <ChevronRight size={13} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                        </div>
                    </div>
                    <div className="ios-widget-value">
                        {parties.length}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)', marginLeft: 3 }}>Accounts</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: -2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Store size={12} style={{ color: 'var(--ios-purple)', flexShrink: 0 }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{buyerBalances.length}B · {supplierBalances.length}S</span>
                        </div>
                        {/*  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--ios-blue)', fontWeight: 650, fontSize: 11, flexShrink: 0 }}>
                            View <ChevronRight size={11} strokeWidth={2.4} />
                        </span> */}
                    </div>
                </div>
            </div>

            {/* ── Quick Deal Estimator Banner ── */}
            <div style={{ padding: '0 16px', marginBottom: 16 }}>
                <button
                    type="button"
                    onClick={() => {
                        playPopSound();
                        setIsEstimatorOpen(true);
                    }}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--separator)',
                        borderRadius: 14,
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            style={{
                                width: 38,
                                height: 38,
                                borderRadius: 10,
                                backgroundColor: 'var(--ios-blue)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#ffffff',
                                flexShrink: 0,
                            }}
                        >
                            <Calculator style={{ width: 20, height: 20 }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-primary)' }}>
                                Quick Deal Estimator
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                                Calculate per-ton profit, breakeven & WhatsApp quotes
                            </div>
                        </div>
                    </div>
                    <ChevronRight style={{ width: 18, height: 18, color: 'var(--label-tertiary)' }} />
                </button>
            </div>

            {/* ── Recent Dispatches Grouped List ── */}
            <div className="ios-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="ios-group-title">Recent Dispatches</div>
                    {dispatches.length > 0 && (
                        <button
                            onClick={() => navigate('/entries')}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ios-blue)',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                paddingRight: 14
                            }}
                        >
                            See All
                        </button>
                    )}
                </div>

                <div className="ios-card-grouped">
                    {recentDispatches.length === 0 ? (
                        <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
                            <Truck style={{ width: 36, height: 36, margin: '0 auto 8px', opacity: 0.4 }} strokeWidth={1.5} />
                            <div style={{ fontSize: 16, fontWeight: 500 }}>No Dispatches Recorded</div>
                            <div style={{ fontSize: 13, marginTop: 4 }}>Tap "+ New Dispatch" to record your first truck shipment.</div>
                        </div>
                    ) : (
                        recentDispatches.map((d, i) => {
                            const party = parties.find(p => p.id === d.partyId);
                            const settlement = calculateSettlement(d);
                            const isPending = isDispatchPending(d);
                            const isProfit = settlement.netProfit >= 0;
                            const dateParts = (d.date || '').split('-');
                            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
                            const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

                            return (
                                <div
                                    key={d.id}
                                    className="ios-cell"
                                    onClick={() => {
                                        playPopSound();
                                        setPreviewDispatch(d);
                                    }}
                                    style={{
                                        minHeight: 64,
                                        paddingTop: 12,
                                        paddingBottom: 12,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {/* Date Calendar Tile Icon (Same as AllEntries & PartyLedger) */}
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
                                        <span style={{ fontSize: 9, fontWeight: 700, color: isPending ? 'var(--ios-amber, #ff9500)' : 'var(--ios-red)', letterSpacing: 0.3 }}>
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
                                        {/* Left Column: Truck & Factory Party */}
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                            <div
                                                style={{
                                                    fontSize: 15,
                                                    fontWeight: 600,
                                                    color: 'var(--label-primary)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    letterSpacing: '-0.24px',
                                                    lineHeight: 1.25,
                                                }}
                                            >
                                                {d.truckNumber || 'Truck Dispatch'}
                                            </div>

                                            <div
                                                style={{
                                                    fontSize: 12,
                                                    color: 'var(--label-secondary)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                {party?.name || d.factoryName || 'Factory'}
                                            </div>
                                        </div>

                                        {/* Right Column: Financial Profit/Cost & Weight/Date */}
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
                                                    color: isPending ? 'var(--ios-blue)' : isProfit ? 'var(--ios-green)' : 'var(--ios-red)',
                                                    whiteSpace: 'nowrap',
                                                    letterSpacing: '-0.3px',
                                                    lineHeight: 1.25,
                                                }}
                                            >
                                                {isPending ? `Cost −${formatCurrency(settlement.totalCost, settings)}` : formatCurrency(settlement.netProfit, settings, { showSign: true })}
                                            </div>

                                            <div
                                                style={{
                                                    fontSize: 11,
                                                    color: 'var(--label-tertiary)',
                                                    whiteSpace: 'nowrap',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                {isPending ? 'Revenue pending' : `${d.labReceivedWeight || 0} t delivered`}
                                            </div>
                                        </div>
                                    </div>

                                    <ChevronRight className="ios-chevron" strokeWidth={2.4} style={{ marginLeft: 6, flexShrink: 0 }} />
                                    {i < recentDispatches.length - 1 && <div className="ios-separator with-glyph" style={{ left: 72 }} />}
                                </div>
                            );
                        })
                    )}
                </div>
                <div className="ios-group-footnote">
                    Real-time profits calculated after GCV adjustments, Sulphur deductions, GST, and transport overheads.
                </div>
            </div>

            {/* ── General Expenses Grouped Section ── */}
            <div className="ios-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="ios-group-title" style={{ margin: 0 }}>General Expenses</div>

                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 14 }}>
                        <button
                            type="button"
                            onClick={() => {
                                setExpenseInitialItem(null);
                                setExpenseInitialMode('new');
                                setIsExpensesOpen(true);
                                playPopSound();
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ios-blue)',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 3,
                                padding: 0,
                            }}
                        >
                            <Plus size={14} strokeWidth={2.4} /> Add
                        </button>

                        {periodExpenses.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setExpenseInitialItem(null);
                                    setExpenseInitialMode('list');
                                    setIsExpensesOpen(true);
                                    playPopSound();
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--ios-blue)',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                            >
                                See All
                            </button>
                        )}
                    </div>
                </div>

                <div className="ios-card-grouped">
                    {sortedPeriodExpenses.length === 0 ? (
                        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
                            <ReceiptText style={{ width: 34, height: 34, margin: '0 auto 8px', opacity: 0.35, color: 'var(--label-tertiary)' }} strokeWidth={1.5} />
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-primary)' }}>
                                {period === 'month' ? 'No Expenses This Month' : period === '30days' ? 'No Expenses in Past 30 Days' : 'No General Expenses Recorded'}
                            </div>
                            <div style={{ fontSize: 12, marginTop: 4, maxWidth: 300, marginInline: 'auto' }}>
                                Log warehouse rent, staff wages, electricity, or equipment overheads outside truck dispatches.
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setExpenseInitialItem(null);
                                    setExpenseInitialMode('new');
                                    setIsExpensesOpen(true);
                                    playPopSound();
                                }}
                                style={{
                                    marginTop: 12,
                                    padding: '6px 14px',
                                    borderRadius: 9,
                                    border: 'none',
                                    background: 'var(--fill-quaternary)',
                                    color: 'var(--ios-blue)',
                                    fontSize: 13,
                                    fontWeight: 650,
                                    cursor: 'pointer',
                                }}
                            >
                                + Log Expense
                            </button>
                        </div>
                    ) : (
                        sortedPeriodExpenses.slice(0, 4).map((expense, i) => {
                            const meta = getExpenseCategoryMeta(expense.category);
                            const dateParts = (expense.date || '').split('-');
                            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
                            const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

                            return (
                                <div
                                    key={expense.id}
                                    className="ios-cell"
                                    onClick={() => {
                                        playPopSound();
                                        setPreviewExpense(expense);
                                    }}
                                    style={{
                                        minHeight: 64,
                                        paddingTop: 12,
                                        paddingBottom: 12,
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
                                                    fontWeight: 600,
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

                                    <ChevronRight className="ios-chevron" strokeWidth={2.4} style={{ marginLeft: 6, flexShrink: 0 }} />
                                    {i < Math.min(sortedPeriodExpenses.length, 4) - 1 && <div className="ios-separator with-glyph" style={{ left: 72 }} />}
                                </div>
                            );
                        })
                    )}

                    {/* Category distribution pills if multiple categories exist in period */}
                    {Object.keys(categoryDistribution).length > 1 && booksTotals.generalExpenses > 0 && (
                        <div style={{ padding: '8px 16px 10px', borderTop: '0.5px solid var(--separator)' }}>
                            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                {Object.entries(categoryDistribution).map(([catId, amount]) => {
                                    const meta = getExpenseCategoryMeta(catId);
                                    const percent = Math.round((amount / booksTotals.generalExpenses) * 100);
                                    return (
                                        <div
                                            key={catId}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 5,
                                                fontSize: 11,
                                                color: 'var(--label-secondary)',
                                                background: 'var(--fill-quaternary)',
                                                padding: '3px 8px',
                                                borderRadius: 6,
                                                whiteSpace: 'nowrap',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color }} />
                                            <span>{meta.label}: {percent}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <div className="ios-group-footnote">
                    Operating expenses are included in Total Outflow and deducted from Books Net Effect.
                </div>
            </div>


            {/* ── Key Parties Grouped Section with Live Ledger Balances ── */}
            {parties.length > 0 && (
                <div className="ios-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 16px 8px' }}>
                        <div className="ios-group-title" style={{ margin: 0 }}>Active Accounts</div>
                        <button
                            type="button"
                            onClick={() => {
                                navigate('/parties');
                                playPopSound();
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--ios-blue)',
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: 'pointer',
                                padding: 0,
                            }}
                        >
                            See All
                        </button>
                    </div>

                    {(totalReceivables > 0 || totalPayables > 0) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 16px 12px', flexWrap: 'wrap' }}>
                            {totalReceivables > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: 'var(--ios-blue)', padding: '3px 9px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'white', opacity: 0.9 }} />
                                    {formatCompactFinancial(totalReceivables, settings, 2).fullString} Dues ({partiesWithDues.length})
                                </span>
                            )}
                            {totalPayables > 0 && (
                                <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: '#FF9500', padding: '3px 9px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'white', opacity: 0.9 }} />
                                    {formatCompactFinancial(totalPayables, settings, 2).fullString} Payable ({suppliersWithPayables.length})
                                </span>
                            )}
                        </div>
                    )}

                    <div className="ios-card-grouped">
                        {sortedPartyBalances.slice(0, 5).map((item, i) => {
                            const { party, balance, dispatchesCount, isSupplier } = item;
                            const isPositive = balance > 0;
                            const isNegative = balance < 0;

                            const roleLabel = isSupplier ? 'Supplier' : 'Buyer';
                            const countLabel = isSupplier
                                ? `${dispatchesCount} ${dispatchesCount === 1 ? 'delivery' : 'deliveries'}`
                                : `${dispatchesCount} ${dispatchesCount === 1 ? 'dispatch' : 'dispatches'}`;

                            const statusLabel = isSupplier
                                ? (isPositive ? 'Payable' : isNegative ? 'Advance Paid' : 'Settled')
                                : (isPositive ? 'Due' : isNegative ? 'Overpaid' : 'Settled');

                            const balanceColor = isSupplier
                                ? (isPositive ? '#FF9500' : isNegative ? 'var(--ios-green)' : 'var(--label-secondary)')
                                : (isPositive ? 'var(--ios-orange)' : isNegative ? 'var(--ios-green)' : 'var(--label-secondary)');

                            const statusBg = isPositive
                                ? (isSupplier ? 'rgba(255,149,0,0.12)' : 'rgba(255,149,0,0.12)')
                                : isNegative
                                    ? 'rgba(52,199,89,0.12)'
                                    : 'var(--fill-quaternary)';

                            return (
                                <div
                                    key={party.id}
                                    className="ios-cell"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Open ledger for ${party.name}, ${statusLabel}: ${formatCurrency(Math.abs(balance), settings)}`}
                                    onClick={() => {
                                        playPopSound();
                                        navigate(`/parties/${party.id}`);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            playPopSound();
                                            navigate(`/parties/${party.id}`);
                                        }
                                    }}
                                    style={{
                                        minHeight: 84,
                                        paddingTop: 14,
                                        paddingBottom: 14,
                                        paddingLeft: 16,
                                        paddingRight: 14,
                                        cursor: 'pointer',
                                        alignItems: 'center',
                                    }}
                                >
                                    <div
                                        className="ios-glyph-badge"
                                        style={{
                                            background: isSupplier
                                                ? 'linear-gradient(135deg, #FF9500 0%, #D97706 100%)'
                                                : `hsl(${party.name.charCodeAt(0) * 23 % 360}, 62%, 46%)`,
                                            width: 42,
                                            height: 42,
                                            borderRadius: 11,
                                            marginRight: 12,
                                            flexShrink: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
                                        }}
                                    >
                                        {isSupplier ? <Store style={{ width: 20, height: 20 }} /> : <Building2 style={{ width: 20, height: 20 }} />}
                                    </div>

                                    {/* 3-Row Center Column */}
                                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 6 }}>
                                        {/* Row 1: Party Name & Role Badge */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    fontSize: 15.5,
                                                    fontWeight: 650,
                                                    color: 'var(--label-primary)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    letterSpacing: '-0.24px',
                                                    lineHeight: 1.25,
                                                }}
                                            >
                                                {party.name}
                                            </div>
                                            <span
                                                style={{
                                                    fontSize: 9.5,
                                                    fontWeight: 700,
                                                    padding: '1.5px 5.5px',
                                                    borderRadius: 4,
                                                    background: isSupplier ? 'rgba(255,149,0,0.14)' : 'rgba(0,122,255,0.14)',
                                                    color: isSupplier ? '#FF9500' : 'var(--ios-blue)',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.4px',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {roleLabel}
                                            </span>
                                        </div>

                                        {/* Row 2: Deliveries & Contact info */}
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                fontSize: 12,
                                                color: 'var(--label-secondary)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                lineHeight: 1.2,
                                            }}
                                        >
                                            <span>{countLabel}</span>
                                            <span style={{ opacity: 0.35 }}>•</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {party.contactPerson?.trim() || (isSupplier ? 'Mine / Quarry Yard' : 'Plant / Warehouse')}
                                            </span>
                                        </div>

                                        {/* Row 3: Status Pill & Balance Amount */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
                                            <span
                                                style={{
                                                    fontSize: 9.5,
                                                    fontWeight: 700,
                                                    padding: '1.5px 6px',
                                                    borderRadius: 4,
                                                    background: statusBg,
                                                    color: balanceColor,
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.3px',
                                                    flexShrink: 0,
                                                }}
                                            >
                                                {statusLabel}
                                            </span>
                                            <span
                                                className="tabular-nums"
                                                style={{
                                                    fontSize: 14,
                                                    fontWeight: 700,
                                                    color: balanceColor,
                                                    letterSpacing: '-0.2px',
                                                    lineHeight: 1.2,
                                                }}
                                            >
                                                {formatCurrency(Math.abs(balance), settings)}
                                            </span>
                                        </div>
                                    </div>

                                    <ChevronRight className="ios-chevron" strokeWidth={2.4} style={{ marginLeft: 6, flexShrink: 0 }} />
                                    {i < Math.min(sortedPartyBalances.length, 5) - 1 && <div className="ios-separator with-glyph" style={{ left: 70 }} />}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Unified Reusable Dispatch Preview Modal ── */}
            <DispatchPreviewModal
                dispatch={previewDispatch}
                onClose={() => setPreviewDispatch(null)}
                parties={parties}
                pos={pos}
                settings={settings}
            />

            {/* ── Unified Reusable Expense Preview Modal ── */}
            <ExpensePreviewModal
                expense={previewExpense}
                settings={settings}
                onClose={() => setPreviewExpense(null)}
                onEdit={(exp) => {
                    setPreviewExpense(null);
                    setExpenseInitialItem(exp);
                    setExpenseInitialMode('new');
                    setIsExpensesOpen(true);
                }}
                onDelete={async (exp) => {
                    await deleteGeneralExpense(exp.id);
                    setPreviewExpense(null);
                    await loadData();
                }}
            />

            {/* Quick Deal Estimator Modal Sheet */}
            <DealEstimatorModal
                isOpen={isEstimatorOpen}
                onClose={() => setIsEstimatorOpen(false)}
            />

            <GeneralExpensesSheet
                key={isExpensesOpen ? `open-${period}-${expenseInitialMode}-${expenseInitialItem?.id || 'none'}` : 'closed'}
                isOpen={isExpensesOpen}
                expenses={expenses}
                settings={settings}
                activePeriod={period}
                initialMode={expenseInitialMode}
                initialExpense={expenseInitialItem}
                onClose={() => {
                    setIsExpensesOpen(false);
                    setExpenseInitialItem(null);
                    setExpenseInitialMode('list');
                }}
                onChanged={loadData}
            />


        </div>
    );
}
