import { useEffect, useState, useMemo } from 'react';
import IOSDatePicker from '../components/IOSDatePicker';
import { getDispatches, getParties, getPurchaseOrders, getSettings } from '../lib/db';
import type { Dispatch, Party, PurchaseOrder, AppSettings } from '../types';
import { calculateSettlement, calculateLedgerTotals, isDispatchPending } from '../utils/calculations';
import { formatCurrency, formatCompactFinancial } from '../utils/currency';
import { useLedgerListener } from '../hooks/useLedgerListener';
import {
    Truck,
    Search,
    ChevronRight,
    ArrowUpRight,
    ArrowDown,
    ArrowUp,
    ChevronDown
} from 'lucide-react';
import { playPopSound, triggerConfetti } from '../utils/delight';
import ExportLedgerDropdown from '../components/ExportLedgerDropdown';
import DispatchPreviewModal from '../components/DispatchPreviewModal';
import IOSSelect from '../components/IOSSelect';

export default function AllEntries() {
    const [dispatches, setDispatches] = useState<Dispatch[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [previewDispatch, setPreviewDispatch] = useState<Dispatch | null>(null);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState<'all' | 'profit' | 'loss'>('all');
    const [selectedPartyId, setSelectedPartyId] = useState<string>('all');
    const [selectedPoId, setSelectedPoId] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'truck' | 'weight' | 'revenue'>('date');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

    const loadEntries = () => {
        Promise.all([getDispatches(), getParties(), getPurchaseOrders(), getSettings()]).then(([d, p, posData, s]) => {
            setDispatches(d);
            setParties(p);
            setPos(posData);
            setSettings(s);
            setLoading(false);
        });
    };

    useEffect(() => {
        loadEntries();
    }, []);

    useLedgerListener(() => {
        loadEntries();
    });

    // Filtered entries
    const filteredDispatches = useMemo(() => {
        const result = dispatches.filter((d) => {
            const party = parties.find((p) => p.id === d.partyId);
            const po = pos.find(p => p.id === d.poId);
            const settlement = calculateSettlement(d, settings);

            // Search match
            const q = searchQuery.toLowerCase();
            const matchSearch =
                !q ||
                (d.truckNumber || '').toLowerCase().includes(q) ||
                (party?.name || '').toLowerCase().includes(q) ||
                (d.date || '').includes(q) ||
                (po?.poNumber || '').toLowerCase().includes(q) ||
                (d.coalInputs || []).some((ci) => (ci.sourceName || '').toLowerCase().includes(q));

            // Dropdown filters
            const matchParty = selectedPartyId === 'all' || d.partyId === selectedPartyId;
            const matchPo = selectedPoId === 'all' || d.poId === selectedPoId;

            // Date Range
            let matchDate = true;
            if (dateFrom && d.date < dateFrom) matchDate = false;
            if (dateTo && d.date > dateTo) matchDate = false;

            // Status filter: in-transit (unweighed) dispatches do not have finalized profit/loss yet (Issue 20)
            let matchStatus = true;
            const isPending = isDispatchPending(d);
            if (activeFilter === 'profit') {
                matchStatus = !isPending && settlement.netProfit >= 0;
            } else if (activeFilter === 'loss') {
                matchStatus = !isPending && settlement.netProfit < 0;
            }

            return matchSearch && matchParty && matchPo && matchDate && matchStatus;
        });

        return result.sort((a, b) => {
            let diff = 0;
            if (sortBy === 'date') {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                diff = timeB - timeA;
            } else if (sortBy === 'truck') {
                diff = (a.truckNumber || '').localeCompare(b.truckNumber || '');
                return sortOrder === 'asc' ? diff : -diff;
            } else if (sortBy === 'weight') {
                const wA = a.labReceivedWeight || a.coalInputs?.[0]?.weight || 0;
                const wB = b.labReceivedWeight || b.coalInputs?.[0]?.weight || 0;
                diff = wB - wA;
            } else if (sortBy === 'revenue') {
                const rA = calculateSettlement(a, settings).totalRevenue;
                const rB = calculateSettlement(b, settings).totalRevenue;
                diff = rB - rA;
            }
            return sortOrder === 'desc' ? diff : -diff;
        });
    }, [dispatches, parties, pos, settings, searchQuery, activeFilter, selectedPartyId, selectedPoId, dateFrom, dateTo, sortBy, sortOrder]);

    // Live Aggregations for Filtered Dispatches using unified calculateLedgerTotals (Issue 20)
    const ledgerTotals = useMemo(() => {
        return calculateLedgerTotals(filteredDispatches, settings);
    }, [filteredDispatches, settings]);

    const filteredTons = ledgerTotals.receivedTons;
    const filteredRevenue = ledgerTotals.revenue;
    const filteredProfit = ledgerTotals.profit;

    const formattedProfit = useMemo(() => {
        return formatCurrency(filteredProfit, settings, { showSign: true });
    }, [filteredProfit, settings]);

    /* const handleAddNew = () => {
        playPopSound();
        if (parties.length > 0) {
            navigate(`/parties/${parties[0].id}/dispatch/new`);
        } else {
            navigate('/parties');
        }
    }; */


    if (loading) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
                Loading all entries…
            </div>
        );
    }

    // Get POs for selected party to populate PO filter
    const availablePos = selectedPartyId === 'all' ? pos : pos.filter(p => p.partyId === selectedPartyId);

    return (
        <div className="ios-fade-in" style={{ paddingBottom: 32 }}>
            {/* ── iOS Navigation Bar with Large Title ── */}
            <div className="ios-large-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <span className="ios-section-header" style={{ padding: 0 }}>
                        {dispatches.length} TOTAL DISPATCHES
                    </span>
                    <h1 className="ios-large-title">All Entries</h1>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <ExportLedgerDropdown
                        dispatches={filteredDispatches}
                        parties={parties}
                        pos={pos}
                        title="ALL DISPATCHES LEDGER"
                        subtitle={`Filtered: ${filteredDispatches.length} Entries • ${filteredTons.toFixed(1)} Tons`}
                        buttonLabel="Export Ledger"
                    />
                    {/* <button
                        onClick={handleAddNew}
                        className="ios-nav-circle-btn"
                        title="Create New Dispatch"
                    >
                        <Plus style={{ width: 20, height: 20 }} strokeWidth={2.6} />
                    </button> */}
                </div>
            </div>

            {/* ── Search Bar ── */}
            <div style={{ padding: '4px 16px 10px' }}>
                <div className="ios-search-bar">
                    <Search className="ios-search-icon" strokeWidth={2.4} />
                    <input
                        type="text"
                        className="ios-search-input"
                        placeholder="Search truck, factory, PO, source, date..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--label-tertiary)',
                                fontSize: 14,
                                cursor: 'pointer',
                                padding: '0 4px'
                            }}
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* ── Date Range Filters ── */}
            <div style={{ padding: '0 16px 10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: (dateFrom || dateTo) ? '1fr 1fr auto' : '1fr 1fr', gap: 10, alignItems: 'center' }}>
                    <IOSDatePicker
                        label="Date From"
                        value={dateFrom}
                        onChange={setDateFrom}
                        floating
                        style={{ marginBottom: 0 }}
                    />
                    <IOSDatePicker
                        label="Date To"
                        value={dateTo}
                        onChange={setDateTo}
                        floating
                        style={{ marginBottom: 0 }}
                    />
                    {(dateFrom || dateTo) && (
                        <button
                            type="button"
                            onClick={() => {
                                playPopSound();
                                setDateFrom('');
                                setDateTo('');
                            }}
                            style={{
                                padding: '10px 12px',
                                borderRadius: 12,
                                border: 'none',
                                background: 'var(--fill-primary)',
                                color: 'var(--ios-red)',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            title="Clear date filter"
                        >
                            Clear
                        </button>
                    )}
                </div>
            </div>

            {/* ── iOS Segmented Filter Control (Profit/Loss) & Sort Controls ── */}
            <div style={{ padding: '0 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div className="ios-segmented" style={{ flex: 1, minWidth: 200 }}>
                    <button
                        className={`ios-segmented-item ${activeFilter === 'all' ? 'active' : ''}`}
                        onClick={() => { playPopSound(); setActiveFilter('all'); }}
                    >
                        All Entries
                    </button>
                    <button
                        className={`ios-segmented-item ${activeFilter === 'profit' ? 'active' : ''}`}
                        onClick={() => { playPopSound(); setActiveFilter('profit'); }}
                    >
                        Profit
                    </button>
                    <button
                        className={`ios-segmented-item ${activeFilter === 'loss' ? 'active' : ''}`}
                        onClick={() => { playPopSound(); setActiveFilter('loss'); }}
                    >
                        Loss
                    </button>
                </div>

                {/* Sort selector and toggle arrow */}
                <div
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        background: 'var(--fill-primary)',
                        borderRadius: 9,
                        padding: '2px 4px',
                        gap: 2
                    }}
                >
                    <IOSSelect
                        label="Sort Dispatches"
                        title="Sort Dispatches"
                        value={sortBy}
                        onChange={(val) => setSortBy(val as any)}
                        options={[
                            { value: 'date', label: 'Date' },
                            { value: 'truck', label: 'Truck' },
                            { value: 'weight', label: 'Weight' },
                            { value: 'revenue', label: 'Revenue' },
                        ]}
                        customTrigger={({ open, displayLabel }) => (
                            <button
                                type="button"
                                onClick={open}
                                style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--label-primary)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    padding: '4px 6px',
                                    outline: 'none',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                }}
                                aria-label="Sort Dispatches"
                            >
                                <span>{displayLabel}</span>
                                <ChevronDown size={13} style={{ color: 'var(--label-tertiary)' }} />
                            </button>
                        )}
                    />

                    <button
                        type="button"
                        onClick={() => {
                            playPopSound();
                            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
                        }}
                        title={sortOrder === 'desc' ? 'Descending order' : 'Ascending order'}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--label-primary)',
                            padding: '4px 6px',
                            borderRadius: 6,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        {sortOrder === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                    </button>
                </div>
            </div>

            {/* ── Filter By Party & PO Horizontal Scroll ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 12px' }}>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    <button
                        onClick={() => { setSelectedPartyId('all'); setSelectedPoId('all'); }}
                        style={{
                            padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                            background: selectedPartyId === 'all' ? 'var(--ios-blue)' : 'var(--fill-primary)',
                            color: selectedPartyId === 'all' ? '#FFFFFF' : 'var(--label-secondary)'
                        }}
                    >
                        All Factories
                    </button>
                    {parties.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => { setSelectedPartyId(p.id); setSelectedPoId('all'); }}
                            style={{
                                padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                                background: selectedPartyId === p.id ? 'var(--ios-blue)' : 'var(--fill-primary)',
                                color: selectedPartyId === p.id ? '#FFFFFF' : 'var(--label-secondary)'
                            }}
                        >
                            {p.name}
                        </button>
                    ))}
                </div>

                {selectedPartyId !== 'all' && availablePos.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                        <button
                            onClick={() => setSelectedPoId('all')}
                            style={{
                                padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                                background: selectedPoId === 'all' ? 'var(--ios-blue)' : 'var(--fill-primary)',
                                color: selectedPoId === 'all' ? '#FFFFFF' : 'var(--label-secondary)'
                            }}
                        >
                            All POs
                        </button>
                        {availablePos.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setSelectedPoId(p.id)}
                                style={{
                                    padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                                    background: selectedPoId === p.id ? 'var(--ios-blue)' : 'var(--fill-primary)',
                                    color: selectedPoId === p.id ? '#FFFFFF' : 'var(--label-secondary)'
                                }}
                            >
                                {p.poNumber}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Live Filter Statistics Hero Card with Generous Breathing Room ── */}
            <div style={{ padding: '0 16px 16px' }}>
                <div
                    className="ios-hero-card"
                    style={{
                        margin: 0,
                        padding: '20px 20px 18px',
                        background: 'var(--bg-card)',
                        border: '0.5px solid var(--separator)',
                        borderRadius: 20,
                    }}
                >
                    {/* Header Row: Label & Active Pulse + Celebratory Margin Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="ios-hero-label">Net Trading Spread</span>
                            <span className="pulse-dot" style={{ background: 'var(--ios-blue)' }} title="Live Filtered Shipments" />
                        </div>

                        {filteredRevenue > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    playPopSound();
                                    triggerConfetti(e.clientX, e.clientY);
                                }}
                                className="ios-hero-badge"
                                title="Click for celebration!"
                                style={{
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: filteredProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)',
                                    color: filteredProfit >= 0 ? 'white' : 'white',
                                    borderWidth: 0.5,
                                    borderStyle: 'solid',
                                    borderColor: filteredProfit >= 0 ? 'rgba(52, 199, 89, 0.25)' : 'rgba(255, 59, 48, 0.25)',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <ArrowUpRight style={{ width: 13, height: 13, transform: filteredProfit < 0 ? 'rotate(90deg)' : 'none' }} strokeWidth={2.6} />
                                <span style={{ whiteSpace: 'nowrap' }}>
                                    {((filteredProfit / filteredRevenue) * 100).toFixed(1)}% margin
                                </span>
                            </button>
                        )}
                    </div>

                    {/* Hero Amount: Dedicated full width, guaranteed single line */}
                    <div
                        style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: formattedProfit.length > 15 ? 26 : formattedProfit.length > 12 ? 30 : 34,
                            fontWeight: 800,
                            letterSpacing: -0.8,
                            color: filteredProfit >= 0 ? 'var(--ios-green)' : 'var(--ios-red)',
                            lineHeight: 1.15,
                            marginTop: 10,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}
                        className="tabular-nums"
                    >
                        {formattedProfit}
                    </div>

                    {/* Operational Stats: Generous bottom row with fine separator */}
                    <div
                        style={{
                            marginTop: 16,
                            paddingTop: 14,
                            borderTop: '0.5px solid var(--separator)',
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 12
                        }}
                    >
                        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Filtered Shipments
                            </div>
                            <div
                                style={{
                                    fontSize: 15,
                                    fontWeight: 700,
                                    color: 'var(--label-primary)',
                                    marginTop: 3,
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'baseline',
                                    gap: '2px 6px'
                                }}
                                className="tabular-nums"
                            >
                                <span>
                                    {filteredDispatches.length} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--label-secondary)' }}>trucks</span>
                                </span>
                                {ledgerTotals.pendingCount > 0 && (
                                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ios-blue)' }}>
                                        ({ledgerTotals.pendingCount} in transit)
                                    </span>
                                )}
                                <span style={{ color: 'var(--label-tertiary)', fontWeight: 400 }}>·</span>
                                <span>
                                    {filteredTons.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--label-secondary)' }}>tons</span>
                                </span>
                            </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Billed Revenue
                            </div>
                            <div
                                style={{
                                    fontSize: 15,
                                    fontWeight: 700,
                                    color: 'var(--label-primary)',
                                    marginTop: 3,
                                    whiteSpace: 'nowrap'
                                }}
                                className="tabular-nums"
                            >
                                {(() => {
                                    const rev = formatCompactFinancial(filteredRevenue, settings, 2);
                                    return (
                                        <>
                                            {rev.symbol} {rev.value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--label-secondary)' }}>{rev.unit === 'M' ? 'Million' : 'Lakh'}</span>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Inset Grouped Entries List ── */}
            <div className="ios-group">
                <div className="ios-group-title">Date • Truck • Factory • PO • Weight • GCV • Profit/Loss</div>
                <div className="ios-card-grouped">
                    {filteredDispatches.length === 0 ? (
                        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
                            <Truck style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.35 }} strokeWidth={1.5} />
                            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>No Entries Found</div>
                        </div>
                    ) : (
                        filteredDispatches.map((dispatch, idx) => {
                            const party = parties.find((p) => p.id === dispatch.partyId);
                            const po = pos.find(p => p.id === dispatch.poId);
                            const settlement = calculateSettlement(dispatch, settings);
                            const isPending = isDispatchPending(dispatch);
                            const isProfit = settlement.netProfit >= 0;

                            const dateParts = (dispatch.date || '').split('-');
                            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
                            const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

                            return (
                                <div
                                    key={dispatch.id}
                                    className="ios-cell"
                                    onClick={() => {
                                        playPopSound();
                                        setPreviewDispatch(dispatch);
                                    }}
                                >
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
                                            marginRight: 14,
                                            flexShrink: 0,
                                            border: '0.5px solid var(--separator)'
                                        }}
                                    >
                                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ios-red)', letterSpacing: 0.3 }}>
                                            {monthStr}
                                        </span>
                                        <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                                            {dayStr}
                                        </span>
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>
                                                {dispatch.truckNumber}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: 16,
                                                    fontWeight: 700,
                                                    color: isPending ? 'var(--ios-blue)' : isProfit ? 'var(--ios-green)' : 'var(--ios-red)'
                                                }}
                                                className="tabular-nums"
                                            >
                                                {isPending ? `Cost −${formatCurrency(settlement.totalCost, settings)}` : formatCurrency(settlement.netProfit, settings, { showSign: true })}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                                            <span style={{ fontSize: 13, color: 'var(--label-secondary)' }}>
                                                {party?.name || dispatch.factoryName} {po ? `• ${po.poNumber}` : ''}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: 'white', background: 'var(--ios-blue)', padding: '1px 6px', borderRadius: 4 }}>
                                                {isPending ? 'IN TRANSIT' : `${dispatch.labReceivedWeight} t`}
                                            </span>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: 'white', background: 'var(--ios-orange)', padding: '1px 6px', borderRadius: 4 }}>
                                                GCV: {dispatch.labActualGcv}
                                            </span>
                                        </div>
                                    </div>

                                    <ChevronRight className="ios-chevron" strokeWidth={2.5} />
                                    {idx < filteredDispatches.length - 1 && <div className="ios-separator with-glyph" />}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* ── Global Dispatch Preview Modal ── */}
            <DispatchPreviewModal
                dispatch={previewDispatch}
                onClose={() => setPreviewDispatch(null)}
                parties={parties}
                pos={pos}
                settings={settings}
            />


        </div>
    );
}
