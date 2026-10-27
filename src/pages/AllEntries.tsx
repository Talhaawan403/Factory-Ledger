import { useEffect, useState, useMemo } from 'react';
import IOSDatePicker from '../components/IOSDatePicker';
import { getDispatches, getParties, getPurchaseOrders, getSettings, getLots, deleteLot } from '../lib/db';
import type { Dispatch, Party, PurchaseOrder, AppSettings, InventoryLot } from '../types';
import { calculateSettlement, calculateLedgerTotals, isDispatchPending } from '../utils/calculations';
import { formatCurrency, formatCompactFinancial } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
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
import SupplierDeliveryPreviewModal from '../components/SupplierDeliveryPreviewModal';
import IOSSelect from '../components/IOSSelect';
import { getMaterialForDispatch, getMaterialItems, getMaterialBadgeTheme } from '../utils/materials';

export default function AllEntries() {
    const [dispatches, setDispatches] = useState<Dispatch[]>([]);
    const [parties, setParties] = useState<Party[]>([]);
    const [lots, setLots] = useState<InventoryLot[]>([]);
    const [pos, setPos] = useState<PurchaseOrder[]>([]);
    const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [previewDispatch, setPreviewDispatch] = useState<Dispatch | null>(null);
    const [previewLot, setPreviewLot] = useState<InventoryLot | null>(null);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [entryTypeFilter, setEntryTypeFilter] = useState<'all' | 'sales' | 'inward'>('all');
    const [activeFilter, setActiveFilter] = useState<'all' | 'profit' | 'loss'>('all');
    const [selectedMaterialId, setSelectedMaterialId] = useState<string>('all');
    const [selectedPartyId, setSelectedPartyId] = useState<string>('all');
    const [selectedPoId, setSelectedPoId] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sortBy, setSortBy] = useState<'date' | 'truck' | 'weight' | 'revenue'>('date');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

    const loadEntries = () => {
        Promise.all([getDispatches(), getParties(), getPurchaseOrders(), getSettings(), getLots()]).then(([d, p, posData, s, lotData]) => {
            setDispatches(d);
            setParties(p);
            setPos(posData);
            setSettings(s);
            setLots(lotData);
            setLoading(false);
        });
    };

    useEffect(() => {
        loadEntries();
    }, []);

    useLedgerListener(() => {
        loadEntries();
    });

    const materials = useMemo(() => getMaterialItems(settings), [settings]);

    // Filtered dispatches (Sales to Buyers)
    const filteredDispatches = useMemo(() => {
        if (entryTypeFilter === 'inward') return [];
        const result = dispatches.filter((d) => {
            const party = parties.find((p) => p.id === d.partyId);
            const po = pos.find(p => p.id === d.poId);
            const settlement = calculateSettlement(d, settings);
            const material = getMaterialForDispatch(d, settings);

            // Search match
            const q = searchQuery.toLowerCase();
            const matchSearch =
                !q ||
                (d.truckNumber || '').toLowerCase().includes(q) ||
                (party?.name || '').toLowerCase().includes(q) ||
                (material.name || '').toLowerCase().includes(q) ||
                (d.date || '').includes(q) ||
                (po?.poNumber || '').toLowerCase().includes(q) ||
                (d.coalInputs || []).some((ci) => (ci.sourceName || '').toLowerCase().includes(q));

            // Dropdown & pill filters
            const dispatchMaterialId = d.itemId || 'coal';
            const matchMaterial = selectedMaterialId === 'all' || dispatchMaterialId === selectedMaterialId;
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

            return matchSearch && matchMaterial && matchParty && matchPo && matchDate && matchStatus;
        });

        return result;
    }, [dispatches, parties, pos, settings, searchQuery, activeFilter, selectedPartyId, selectedPoId, dateFrom, dateTo, selectedMaterialId, entryTypeFilter]);

    // Filtered Inward Lots (Purchases from Suppliers)
    const filteredLots = useMemo(() => {
        if (entryTypeFilter === 'sales') return [];
        return lots.filter((lot) => {
            if (lot.deleted) return false;
            const supplier = parties.find((p) => p.id === lot.supplierId || p.name === lot.supplier);

            // Search match
            const q = searchQuery.toLowerCase();
            const matchSearch =
                !q ||
                (lot.truckNumber || '').toLowerCase().includes(q) ||
                (supplier?.name || lot.supplier || lot.boughtFrom || '').toLowerCase().includes(q) ||
                (lot.mineName || lot.mineSource || '').toLowerCase().includes(q) ||
                (lot.storedAt || '').toLowerCase().includes(q) ||
                (lot.date || '').includes(q);

            // Party match
            const matchParty = selectedPartyId === 'all' || lot.supplierId === selectedPartyId || supplier?.id === selectedPartyId;

            // Date Range
            let matchDate = true;
            if (dateFrom && lot.date < dateFrom) matchDate = false;
            if (dateTo && lot.date > dateTo) matchDate = false;

            // Material match
            const lotMaterialId = lot.itemId || 'coal';
            const matchMaterial = selectedMaterialId === 'all' || lotMaterialId === selectedMaterialId;

            return matchSearch && matchParty && matchDate && matchMaterial;
        });
    }, [lots, parties, searchQuery, selectedPartyId, dateFrom, dateTo, selectedMaterialId, entryTypeFilter]);

    // Unified Sorted Entries for display
    const unifiedEntries = useMemo(() => {
        const items: Array<{
            kind: 'dispatch' | 'lot';
            id: string;
            date: string;
            truck: string;
            weight: number;
            amount: number;
            data: any;
        }> = [];

        for (const d of filteredDispatches) {
            const settlement = calculateSettlement(d, settings);
            const w = d.labReceivedWeight || d.coalInputs?.[0]?.weight || 0;
            items.push({
                kind: 'dispatch',
                id: d.id,
                date: d.date,
                truck: d.truckNumber || '',
                weight: w,
                amount: settlement.totalRevenue,
                data: d,
            });
        }

        for (const l of filteredLots) {
            const w = Number(l.receivedWeight || l.billedWeight || l.tonnage || 0);
            const r = Number(l.purchaseRate || l.ratePerTon || 0);
            const f = Number(l.freightCost || 0);
            const amt = l.totalValue !== undefined ? Number(l.totalValue) : w * r + f;
            items.push({
                kind: 'lot',
                id: l.id,
                date: l.date,
                truck: l.truckNumber || '',
                weight: w,
                amount: amt,
                data: l,
            });
        }

        return items.sort((a, b) => {
            let diff = 0;
            if (sortBy === 'date') {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                diff = timeB - timeA;
            } else if (sortBy === 'truck') {
                diff = a.truck.localeCompare(b.truck);
                return sortOrder === 'asc' ? diff : -diff;
            } else if (sortBy === 'weight') {
                diff = b.weight - a.weight;
            } else if (sortBy === 'revenue') {
                diff = b.amount - a.amount;
            }
            return sortOrder === 'desc' ? diff : -diff;
        });
    }, [filteredDispatches, filteredLots, sortBy, sortOrder, settings]);

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
            <div className="ios-large-header" style={{ paddingBottom: 10 }}>
                {/* Title & Action Row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <h1 className="ios-large-title" style={{ margin: 0, lineHeight: 1.15 }}>
                        All Entries
                    </h1>

                    <ExportLedgerDropdown
                        dispatches={filteredDispatches}
                        parties={parties}
                        pos={pos}
                        title="ALL DISPATCHES LEDGER"
                        subtitle={`Filtered: ${filteredDispatches.length} Entries • ${filteredTons.toFixed(1)} Tons`}
                        dateRange={dateFrom && dateTo ? `${formatDisplayDate(dateFrom)} – ${formatDisplayDate(dateTo)}` : dateFrom ? `From ${formatDisplayDate(dateFrom)}` : dateTo ? `Through ${formatDisplayDate(dateTo)}` : undefined}
                        buttonLabel="Export Ledger"
                    />
                </div>

                {/* Polished Subtitle Stats Row */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 4,
                        fontSize: 13,
                        color: 'var(--label-secondary)',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                >
                    <span>{dispatches.length + lots.length} Total Transactions</span>
                    <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                    <span style={{ color: 'var(--ios-blue)', fontWeight: 600 }}>
                        {dispatches.length} Sales
                    </span>
                    <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                    <span style={{ color: '#FF9500', fontWeight: 600 }}>
                        {lots.length} Inward
                    </span>
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

            {/* ── Entry Type Segment (All vs Sales vs Inward) ── */}
            <div style={{ padding: '0 16px 10px' }}>
                <div style={{ display: 'flex', background: 'var(--fill-tertiary)', padding: 3, borderRadius: 10 }}>
                    <button
                        type="button"
                        onClick={() => { playPopSound(); setEntryTypeFilter('all'); }}
                        style={{
                            flex: 1,
                            padding: '6px 0',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            background: entryTypeFilter === 'all' ? 'var(--bg-card)' : 'transparent',
                            color: entryTypeFilter === 'all' ? 'var(--label-primary)' : 'var(--label-secondary)',
                            boxShadow: entryTypeFilter === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            cursor: 'pointer'
                        }}
                    >
                        All ({dispatches.length + lots.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => { playPopSound(); setEntryTypeFilter('sales'); }}
                        style={{
                            flex: 1,
                            padding: '6px 0',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            background: entryTypeFilter === 'sales' ? 'var(--bg-card)' : 'transparent',
                            color: entryTypeFilter === 'sales' ? 'var(--ios-blue)' : 'var(--label-secondary)',
                            boxShadow: entryTypeFilter === 'sales' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Sales ({dispatches.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => { playPopSound(); setEntryTypeFilter('inward'); }}
                        style={{
                            flex: 1,
                            padding: '6px 0',
                            border: 'none',
                            borderRadius: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            background: entryTypeFilter === 'inward' ? 'var(--bg-card)' : 'transparent',
                            color: entryTypeFilter === 'inward' ? '#FF9500' : 'var(--label-secondary)',
                            boxShadow: entryTypeFilter === 'inward' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Inward ({lots.length})
                    </button>
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

            {/* ── Filter By Material, Party & PO Horizontal Scroll ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px 12px' }}>
                {/* Material Pills */}
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    <button
                        onClick={() => { playPopSound(); setSelectedMaterialId('all'); }}
                        style={{
                            padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
                            background: selectedMaterialId === 'all' ? 'var(--ios-blue)' : 'var(--fill-primary)',
                            color: selectedMaterialId === 'all' ? '#FFFFFF' : 'var(--label-secondary)'
                        }}
                    >
                        All Materials
                    </button>
                    {materials.map((m) => {
                        const isSelected = selectedMaterialId === m.id;
                        const theme = getMaterialBadgeTheme(m.id);
                        return (
                            <button
                                key={m.id}
                                onClick={() => { playPopSound(); setSelectedMaterialId(m.id); }}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 16,
                                    border: isSelected ? 'none' : `1px solid ${theme.border}`,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    whiteSpace: 'nowrap',
                                    cursor: 'pointer',
                                    background: isSelected ? theme.color : 'var(--fill-primary)',
                                    color: isSelected ? '#FFFFFF' : 'var(--label-primary)'
                                }}
                            >
                                {m.name}
                            </button>
                        );
                    })}
                </div>

                {/* Factory Pills */}
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
                <div className="ios-group-title">
                    {entryTypeFilter === 'sales'
                        ? `Sales (${unifiedEntries.length})`
                        : entryTypeFilter === 'inward'
                            ? `Inward Deliveries (${unifiedEntries.length})`
                            : `Transactions (${unifiedEntries.length})`}
                </div>
                <div className="ios-card-grouped">
                    {unifiedEntries.length === 0 ? (
                        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
                            <Truck style={{ width: 40, height: 40, margin: '0 auto 10px', opacity: 0.35 }} strokeWidth={1.5} />
                            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)' }}>No Entries Found</div>
                        </div>
                    ) : (
                        unifiedEntries.map((entry, idx) => {
                            const dateParts = (entry.date || '').split('-');
                            const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
                            const monthStr = dateParts.length === 3 ? (monthNames[parseInt(dateParts[1], 10) - 1] || '---') : '---';
                            const dayStr = dateParts.length === 3 ? parseInt(dateParts[2], 10) : '--';

                            if (entry.kind === 'dispatch') {
                                const dispatch = entry.data as Dispatch;
                                const party = parties.find((p) => p.id === dispatch.partyId);
                                const po = pos.find(p => p.id === dispatch.poId);
                                const settlement = calculateSettlement(dispatch, settings);
                                const isPending = isDispatchPending(dispatch);
                                const isProfit = settlement.netProfit >= 0;
                                const material = getMaterialForDispatch(dispatch, settings);
                                const badgeTheme = getMaterialBadgeTheme(material.id);
                                const monthColor = isPending ? '#FF9500' : isProfit ? 'var(--ios-green)' : 'var(--ios-red)';

                                const specInfo = material.pricingModel === 'gcv'
                                    ? (dispatch.labActualGcv ? `GCV ${dispatch.labActualGcv}` : dispatch.targetGcv ? `Target ${dispatch.targetGcv}` : null)
                                    : material.pricingModel === 'purity'
                                        ? (dispatch.receivedQuality !== undefined && dispatch.receivedQuality !== null ? `${material.qualityLabel || 'Purity'} ${dispatch.receivedQuality}%` : null)
                                        : null;

                                return (
                                    <div
                                        key={dispatch.id}
                                        className="ios-cell"
                                        onClick={() => {
                                            playPopSound();
                                            setPreviewDispatch(dispatch);
                                        }}
                                        style={{ cursor: 'pointer', padding: '12px 16px' }}
                                    >
                                        {/* iOS Calendar Tile Date Badge (Identical to PartyLedger) */}
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
                                            <span style={{ fontSize: 9, fontWeight: 700, color: monthColor, letterSpacing: 0.3 }}>
                                                {monthStr}
                                            </span>
                                            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                                                {dayStr}
                                            </span>
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                            {/* Top Row: Truck Number + Clean Badges | Financial Status */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', whiteSpace: 'nowrap' }}>
                                                        {dispatch.truckNumber}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            color: 'var(--ios-blue)',
                                                            background: 'rgba(0, 122, 255, 0.12)',
                                                            padding: '1.5px 6px',
                                                            borderRadius: 4,
                                                            letterSpacing: '0.3px',
                                                            flexShrink: 0
                                                        }}
                                                    >
                                                        SALE
                                                    </span>
                                                    {material?.name && (
                                                        <span
                                                            style={{
                                                                fontSize: 10,
                                                                fontWeight: 650,
                                                                color: badgeTheme.color,
                                                                background: badgeTheme.bg,
                                                                border: `0.5px solid ${badgeTheme.border}`,
                                                                padding: '1.5px 6px',
                                                                borderRadius: 4,
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            {material.name}
                                                        </span>
                                                    )}
                                                    {isPending && (
                                                        <span
                                                            style={{
                                                                fontSize: 10,
                                                                fontWeight: 700,
                                                                color: '#FF9500',
                                                                background: 'rgba(255, 149, 0, 0.12)',
                                                                padding: '1.5px 6px',
                                                                borderRadius: 4,
                                                                letterSpacing: '0.3px',
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            IN TRANSIT
                                                        </span>
                                                    )}
                                                </div>

                                                <span
                                                    style={{
                                                        fontSize: 15,
                                                        fontWeight: 700,
                                                        color: isPending ? '#FF9500' : isProfit ? 'var(--ios-green)' : 'var(--ios-red)',
                                                        flexShrink: 0,
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                    className="tabular-nums"
                                                >
                                                    {isPending
                                                        ? `Cost −${formatCurrency(settlement.totalCost, settings)}`
                                                        : formatCurrency(settlement.netProfit, settings, { showSign: true })}
                                                </span>
                                            </div>

                                            {/* Subtitle Row: Factory • PO · Weight · Specs | Revenue or Status */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 8 }}>
                                                <span
                                                    style={{
                                                        fontSize: 13,
                                                        color: 'var(--label-secondary)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        minWidth: 0,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    <span style={{ fontWeight: 500, color: 'var(--label-secondary)', whiteSpace: 'nowrap' }}>
                                                        {party?.name || dispatch.factoryName || 'Factory'}
                                                        {po ? ` • ${po.poNumber}` : ''}
                                                    </span>
                                                    <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                                                    <span style={{ whiteSpace: 'nowrap' }}>
                                                        {isPending ? `${dispatch.coalInputs?.[0]?.weight || 0} t loaded` : `${dispatch.labReceivedWeight || 0} t`}
                                                    </span>
                                                    {specInfo && (
                                                        <>
                                                            <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                                                            <span style={{ whiteSpace: 'nowrap', color: 'var(--label-secondary)' }}>{specInfo}</span>
                                                        </>
                                                    )}
                                                </span>

                                                <span
                                                    style={{
                                                        fontSize: 12,
                                                        fontWeight: 500,
                                                        color: 'var(--label-tertiary)',
                                                        flexShrink: 0,
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                    className="tabular-nums"
                                                >
                                                    {isPending ? 'Pending Weighbridge' : `Rev: ${formatCurrency(settlement.totalRevenue, settings)}`}
                                                </span>
                                            </div>
                                        </div>

                                        <ChevronRight className="ios-chevron" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                                        {idx < unifiedEntries.length - 1 && <div className="ios-separator with-glyph" style={{ left: 74 }} />}
                                    </div>
                                );
                            } else {
                                const lot = entry.data as InventoryLot;
                                const supplier = parties.find((p) => p.id === lot.supplierId || p.name === lot.supplier);
                                const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
                                const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
                                const freight = Number(lot.freightCost || 0);
                                const totalAmt = lot.totalValue !== undefined ? Number(lot.totalValue) : weight * rate + freight;
                                const landed = weight > 0 ? (lot.landedRate || totalAmt / weight) : rate;
                                const monthColor = '#FF9500';

                                return (
                                    <div
                                        key={lot.id}
                                        className="ios-cell"
                                        onClick={() => {
                                            playPopSound();
                                            setPreviewLot(lot);
                                        }}
                                        style={{ cursor: 'pointer', padding: '12px 16px' }}
                                    >
                                        {/* iOS Calendar Tile Date Badge (Identical to PartyLedger) */}
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
                                            <span style={{ fontSize: 9, fontWeight: 700, color: monthColor, letterSpacing: 0.3 }}>
                                                {monthStr}
                                            </span>
                                            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1 }}>
                                                {dayStr}
                                            </span>
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                            {/* Top Row: Truck Number + INWARD + Location | Total Amount */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                                                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--label-primary)', whiteSpace: 'nowrap' }}>
                                                        {lot.truckNumber || 'Inward Delivery'}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            background: 'rgba(255, 149, 0, 0.12)',
                                                            color: '#FF9500',
                                                            padding: '1.5px 6px',
                                                            borderRadius: 4,
                                                            letterSpacing: '0.3px',
                                                            flexShrink: 0
                                                        }}
                                                    >
                                                        INWARD
                                                    </span>
                                                    {lot.storedAt && (
                                                        <span
                                                            style={{
                                                                fontSize: 10,
                                                                fontWeight: 600,
                                                                color: 'var(--label-secondary)',
                                                                background: 'var(--fill-tertiary)',
                                                                padding: '1.5px 6px',
                                                                borderRadius: 4,
                                                                flexShrink: 0
                                                            }}
                                                        >
                                                            {lot.storedAt}
                                                        </span>
                                                    )}
                                                </div>

                                                <span
                                                    style={{
                                                        fontSize: 15,
                                                        fontWeight: 700,
                                                        color: 'var(--label-primary)',
                                                        flexShrink: 0,
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                    className="tabular-nums"
                                                >
                                                    {formatCurrency(totalAmt, settings)}
                                                </span>
                                            </div>

                                            {/* Subtitle Row: Supplier · Weight · Buy Rate | Landed rate or freight */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 8 }}>
                                                <span
                                                    style={{
                                                        fontSize: 13,
                                                        color: 'var(--label-secondary)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        minWidth: 0,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    <span style={{ fontWeight: 500, color: 'var(--label-secondary)', whiteSpace: 'nowrap' }}>
                                                        {supplier?.name || lot.supplier || lot.boughtFrom || 'Supplier'}
                                                    </span>
                                                    <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                                                    <span style={{ whiteSpace: 'nowrap' }}>
                                                        {weight.toFixed(2)} t
                                                    </span>
                                                    <span style={{ color: 'var(--label-tertiary)' }}>·</span>
                                                    <span style={{ whiteSpace: 'nowrap' }}>
                                                        @{formatCurrency(rate, settings)}/t
                                                    </span>
                                                </span>

                                                <span
                                                    style={{
                                                        fontSize: 12,
                                                        fontWeight: 500,
                                                        color: 'var(--label-tertiary)',
                                                        flexShrink: 0,
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                    className="tabular-nums"
                                                >
                                                    {freight > 0 ? `Landed: ${formatCurrency(landed, settings)}/t` : `Fare: Nil`}
                                                </span>
                                            </div>
                                        </div>

                                        <ChevronRight className="ios-chevron" strokeWidth={2.5} style={{ flexShrink: 0 }} />
                                        {idx < unifiedEntries.length - 1 && <div className="ios-separator with-glyph" style={{ left: 74 }} />}
                                    </div>
                                );
                            }
                        })
                    )}
                </div>
            </div>

            {/* ── Global Dispatch Preview Modal (Buyer Sales) ── */}
            <DispatchPreviewModal
                dispatch={previewDispatch}
                onClose={() => setPreviewDispatch(null)}
                parties={parties}
                pos={pos}
                settings={settings}
            />

            {/* ── Supplier Delivery Preview Modal (Supplier Inward) ── */}
            <SupplierDeliveryPreviewModal
                lot={previewLot}
                onClose={() => setPreviewLot(null)}
                parties={parties}
                settings={settings}
                showParty={true}
                onDelete={async (lotToDelete) => {
                    await deleteLot(lotToDelete.id);
                    setPreviewLot(null);
                    loadEntries();
                }}
            />

        </div>
    );
}
