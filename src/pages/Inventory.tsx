import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMines, saveMine, getLots, getDispatches, getSettings } from '../lib/db';
import type { Mine, InventoryLot, Dispatch, AppSettings } from '../types';
import { calculateMineStock, calculateOverallMinesSummary, auditInventoryRelations } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playPopSound, playSuccessSound, triggerConfetti } from '../utils/delight';
import { useLedgerListener } from '../hooks/useLedgerListener';
import { v4 as uuidv4 } from 'uuid';
import {
  Layers,
  Search,
  X,
  List,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  MapPin,
  TrendingUp,
  Package,
  ShieldAlert,
} from 'lucide-react';
import FloatingField from '../components/FloatingField';
import IOSSelect from '../components/IOSSelect';

export default function Inventory() {
  const navigate = useNavigate();

  const [mines, setMines] = useState<Mine[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'name' | 'highest_stock' | 'highest_value'>('latest');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Persistent List / Grid view mode
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (localStorage.getItem('inventory_view_mode') as 'list' | 'grid') || 'list';
  });

  // Modal Sheet State: Add / Edit Mine
  const [isAddMineOpen, setIsAddMineOpen] = useState(false);
  const [editingMine, setEditingMine] = useState<Mine | null>(null);
  const [mineForm, setMineForm] = useState({
    name: '',
    ratePerTon: '',
    location: '',
    notes: '',
  });

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [mineFormError, setMineFormError] = useState<string | null>(null);

  const curSym = getCurrencySymbol(settings?.currency);

  const loadData = async () => {
    const [m, l, d, s] = await Promise.all([
      getMines(),
      getLots(),
      getDispatches(),
      getSettings(),
    ]);
    setMines(m);
    setLots(l);
    setDispatches(d);
    setSettings(s);
    setLoading(false);
  };

  useEffect(() => {
    let current = true;
    Promise.all([getMines(), getLots(), getDispatches(), getSettings()]).then(([m, l, d, s]) => {
      if (current) {
        setMines(m);
        setLots(l);
        setDispatches(d);
        setSettings(s);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  useLedgerListener(() => {
    loadData();
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleViewModeChange = (mode: 'list' | 'grid') => {
    playPopSound();
    setViewMode(mode);
    localStorage.setItem('inventory_view_mode', mode);
  };

  // Overall Yard Summary
  const overallSummary = useMemo(() => {
    return calculateOverallMinesSummary(mines, lots, dispatches);
  }, [mines, lots, dispatches]);

  const integrityIssues = useMemo(
    () => auditInventoryRelations(lots, dispatches),
    [lots, dispatches]
  );

  // Per-mine detailed stocks
  const mineCardData = useMemo(() => {
    return mines.map((mine) => {
      const stock = calculateMineStock(mine, lots, dispatches);
      return {
        mine,
        stock,
      };
    });
  }, [mines, lots, dispatches]);

  // Filter & Sort
  const filteredMines = useMemo(() => {
    let result = mineCardData.filter(({ mine }) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = mine.name.toLowerCase().includes(q);
      const matchLoc = (mine.location || '').toLowerCase().includes(q);
      const matchNotes = (mine.notes || '').toLowerCase().includes(q);
      return matchName || matchLoc || matchNotes;
    });

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'latest':
          comparison = (b.mine.createdAt || 0) - (a.mine.createdAt || 0);
          break;
        case 'name':
          comparison = a.mine.name.localeCompare(b.mine.name);
          break;
        case 'highest_stock':
          comparison = b.stock.remainingTons - a.stock.remainingTons;
          break;
        case 'highest_value':
          comparison = b.stock.remainingValue - a.stock.remainingValue;
          break;
      }
      return sortOrder === 'desc' ? comparison : -comparison;
    });

    return result;
  }, [mineCardData, searchQuery, sortBy, sortOrder]);

  // Open Add Mine Sheet
  const handleOpenAddMine = () => {
    playPopSound();
    setEditingMine(null);
    setMineFormError(null);
    setMineForm({
      name: '',
      ratePerTon: '',
      location: '',
      notes: '',
    });
    setIsAddMineOpen(true);
  };

  // Save Mine
  const handleSaveMine = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = mineForm.name.trim();
    const rate = parseFloat(mineForm.ratePerTon);

    if (!name) {
      setMineFormError('Please enter the mine name.');
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      setMineFormError('Please enter a valid rate per ton (must be greater than 0).');
      return;
    }
    setMineFormError(null);

    try {
      const now = Date.now();
      const mineToSave: Mine = {
        id: editingMine ? editingMine.id : uuidv4(),
        name,
        ratePerTon: rate,
        location: mineForm.location.trim() || undefined,
        notes: mineForm.notes.trim() || undefined,
        createdAt: editingMine?.createdAt || now,
        updatedAt: now,
      };

      await saveMine(mineToSave);
      playSuccessSound();
      triggerConfetti();
      setIsAddMineOpen(false);
      showToast(editingMine ? 'Mine updated successfully' : 'Mine added successfully');
      loadData();
    } catch (err: any) {
      setMineFormError(err?.message || 'Failed to save mine. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="ios-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--label-secondary)', fontSize: 15 }}>Loading Inventory…</div>
      </div>
    );
  }

  return (
    <div className="ios-page" style={{ paddingBottom: 100 }}>
      {/* Toast Notification */}
      {toastMsg && (
        <div className="ios-toast-banner">
          <Check style={{ width: 16, height: 16, color: 'var(--ios-green)' }} strokeWidth={3} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── iOS Navigation Header with Large Title ── */}
      <div className="ios-large-header">
        <div className="ios-large-subtitle">
          {mines.length} {mines.length === 1 ? 'MINE' : 'MINES'} · {overallSummary.totalYardTons.toFixed(1)}t TOTAL STOCK
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 className="ios-large-title">Inventory</h1>
        </div>
      </div>

      {integrityIssues.length > 0 && (
        <div style={{ padding: '0 16px 14px' }}>
          <div
            role="status"
            style={{
              background: 'rgba(255, 149, 0, 0.1)',
              border: '0.5px solid rgba(255, 149, 0, 0.34)',
              borderRadius: 16,
              padding: '12px 14px',
              display: 'flex',
              gap: 11,
              alignItems: 'flex-start',
            }}
          >
            <ShieldAlert size={20} style={{ color: 'var(--ios-orange)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }}>
                Inventory relationship needs review
              </div>
              <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                {integrityIssues.slice(0, 2).map((issue) => issue.message).join(' ')}
                {integrityIssues.length > 2 ? ` +${integrityIssues.length - 2} more.` : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ios-orange)', fontWeight: 600, marginTop: 5 }}>
                Open the affected mine and reassign the stock entry before relying on its balance.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Top Summary Metrics Cards ── */}
      <div style={{ padding: '0 16px 14px' }}>
        {/* Full-width Pill Card: Total Stock Value */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 16,
            padding: '12px 16px',
            border: '0.5px solid var(--separator)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'var(--ios-green)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <TrendingUp size={16} style={{ color: 'white' }} />
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--label-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.3px',
                whiteSpace: 'nowrap',
              }}
            >
              Total Stock Value
            </span>
          </div>
          <div
            style={{
              fontSize: 19,
              fontWeight: 700,
              color: 'var(--ios-green)',
              flexShrink: 0,
            }}
            className="tabular-nums"
          >
            {curSym} {formatAmountNumber(overallSummary.totalYardValue, settings)}
          </div>
        </div>

        {/* 2-Column Grid: Yard Stock & Active Mines */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
            marginTop: 10,
          }}
        >
          {/* Card: Yard Stock */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 14,
              padding: '12px 14px',
              border: '0.5px solid var(--separator)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Package size={14} style={{ color: 'var(--ios-blue)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                Yard Stock
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }} className="tabular-nums">
              {overallSummary.totalYardTons.toFixed(1)} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-secondary)' }}>t</span>
            </div>
          </div>

          {/* Card: Active Mines */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 14,
              padding: '12px 14px',
              border: '0.5px solid var(--separator)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Layers size={14} style={{ color: 'var(--ios-purple, #af52de)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                Active Mines
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }} className="tabular-nums">
              {overallSummary.totalMines}
            </div>
          </div>
        </div>
      </div>

      {/* ── Big Luxury Add New Mine Button (Mirroring PartiesList) ── */}
      <div style={{ padding: '0 16px 14px' }}>
        <button
          onClick={handleOpenAddMine}
          style={{
            width: '100%',
            height: 52,
            borderRadius: 16,
            background: 'var(--ios-blue)',
            color: '#FFFFFF',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: 'none',
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="ios-btn-primary"
        >
          <Plus style={{ width: 20, height: 20 }} strokeWidth={2.6} />
          <span>Add New Mine</span>
        </button>
      </div>

      {/* ── iOS Search Bar ── */}
      <div className="ios-search-container" style={{ padding: '0 16px 12px' }}>
        <div
          className="ios-search-bar"
          style={{
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            border: '1px solid var(--border-glass)',
            background: 'var(--fill-tertiary)',
          }}
        >
          <Search style={{ width: 17, height: 17, color: 'var(--label-tertiary)' }} strokeWidth={2.4} />
          <input
            type="text"
            placeholder="Search mines, locations, notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ios-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                playPopSound();
              }}
              style={{
                background: 'var(--fill-primary)',
                border: 'none',
                borderRadius: '50%',
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--label-secondary)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── Sorting & View Switcher Bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px 14px',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)' }}>
          {filteredMines.length} {filteredMines.length === 1 ? 'Mine Ledger' : 'Mine Ledgers'}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Sorting controls */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'var(--fill-primary)',
              borderRadius: 9,
              padding: '2px 4px',
              gap: 2,
            }}
          >
            <IOSSelect
              label="Sort Mines"
              title="Sort Mines"
              value={sortBy}
              onChange={(val) => setSortBy(val as any)}
              options={[
                { value: 'latest', label: 'Latest Created' },
                { value: 'name', label: 'Name (A-Z)' },
                { value: 'highest_stock', label: 'Highest Stock' },
                { value: 'highest_value', label: 'Highest Value' },
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
                  aria-label="Sort Mines"
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
                justifyContent: 'center',
              }}
            >
              {sortOrder === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            </button>
          </div>

          {/* Persistent List vs Grid Switcher */}
          <div
            style={{
              display: 'flex',
              background: 'var(--fill-primary)',
              padding: 3,
              borderRadius: 10,
              gap: 2,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => handleViewModeChange('list')}
              title="List View"
              style={{
                border: 'none',
                background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
                color: viewMode === 'list' ? 'var(--label-primary)' : 'var(--label-tertiary)',
                padding: '5px 8px',
                borderRadius: 7,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: viewMode === 'list' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <List style={{ width: 17, height: 17 }} strokeWidth={2.4} />
            </button>

            <button
              onClick={() => handleViewModeChange('grid')}
              title="Grid View"
              style={{
                border: 'none',
                background: viewMode === 'grid' ? 'var(--bg-card)' : 'transparent',
                color: viewMode === 'grid' ? 'var(--label-primary)' : 'var(--label-tertiary)',
                padding: '5px 8px',
                borderRadius: 7,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: viewMode === 'grid' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <LayoutGrid style={{ width: 17, height: 17 }} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {/* ── View 1: List View (Full Detailed Cards) ── */}
      {viewMode === 'list' && (
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredMines.length === 0 ? (
            <div
              style={{
                padding: '40px 16px',
                textAlign: 'center',
                color: 'var(--label-secondary)',
                background: 'var(--bg-card)',
                borderRadius: 16,
                border: '0.5px solid var(--separator)',
              }}
            >
              <Layers style={{ width: 44, height: 44, margin: '0 auto 10px', opacity: 0.35 }} strokeWidth={1.5} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>No Mines Found</div>
              <div style={{ fontSize: 13, marginTop: 4, color: 'var(--label-tertiary)' }}>
                {searchQuery ? `No results for "${searchQuery}"` : 'Add your first coal mine to manage stocks and ledgers.'}
              </div>
              {!searchQuery && (
                <button
                  onClick={handleOpenAddMine}
                  style={{
                    marginTop: 16,
                    padding: '8px 16px',
                    borderRadius: 10,
                    background: 'var(--ios-blue)',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Add Mine
                </button>
              )}
            </div>
          ) : (
            filteredMines.map(({ mine, stock }) => {
              const initials = mine.name.slice(0, 2).toUpperCase();

              return (
                <div
                  key={mine.id}
                  onClick={() => {
                    playPopSound();
                    navigate(`/inventory/${mine.id}`);
                  }}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 18,
                    padding: 16,
                    border: '0.5px solid var(--separator)',
                    boxShadow: 'var(--shadow-card)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                  className="hover-card"
                >
                  {/* Top Bar: Icon, Name & Rate */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          background: 'var(--ios-blue)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 15,
                          color: 'white',
                        }}
                      >
                        {initials}
                      </div>

                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 8,
                          background: 'var(--ios-blue)',
                          color: 'white',
                        }}
                      >
                        {curSym} {formatAmountNumber(mine.ratePerTon)}/t
                      </span>
                    </div>

                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)', marginBottom: 2 }}>
                      {mine.name}
                    </div>

                    {mine.location && (
                      <div style={{ fontSize: 13, color: 'var(--label-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={12} /> {mine.location}
                      </div>
                    )}
                  </div>

                  {/* Stock & Value Metrics */}
                  <div
                    style={{
                      background: 'var(--fill-tertiary)',
                      borderRadius: 14,
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                        Remaining Stock
                      </div>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 800,
                          color: stock.isOverdrawn ? 'var(--ios-red)' : 'var(--label-primary)',
                        }}
                        className="tabular-nums"
                      >
                        {stock.remainingTons.toFixed(2)} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-secondary)' }}>tons</span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                        Est. Value
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ios-green)' }} className="tabular-nums">
                        {curSym} {formatAmountNumber(stock.remainingValue, settings)}
                      </div>
                    </div>
                  </div>

                  {/* Footer Stats & Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
                    <span style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
                      In: {stock.totalInflowTons.toFixed(1)}t · Out: {stock.totalOutflowTons.toFixed(1)}t
                    </span>

                    <ChevronRight className="ios-chevron" style={{ width: 16, height: 16, color: 'var(--label-tertiary)' }} strokeWidth={2.5} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── View 2: Grid View (High-Density Modern Apple Tiles) ── */}
      {viewMode === 'grid' && (
        <div
          style={{
            padding: '0 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
          }}
        >
          {filteredMines.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '40px 16px',
                textAlign: 'center',
                color: 'var(--label-secondary)',
                background: 'var(--bg-card)',
                borderRadius: 16,
                border: '0.5px solid var(--separator)',
              }}
            >
              <Layers style={{ width: 44, height: 44, margin: '0 auto 10px', opacity: 0.35 }} strokeWidth={1.5} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>No Mines Found</div>
              <div style={{ fontSize: 13, marginTop: 4, color: 'var(--label-tertiary)' }}>
                {searchQuery ? `No results for "${searchQuery}"` : 'Add your first coal mine to manage stocks and ledgers.'}
              </div>
            </div>
          ) : (
            filteredMines.map(({ mine, stock }) => {
              const initials = mine.name.slice(0, 2).toUpperCase();
              const isOverdrawn = stock.isOverdrawn;
              const isLow = stock.remainingTons > 0 && stock.remainingTons < 10;
              const isExhausted = stock.remainingTons === 0;

              return (
                <div
                  key={mine.id}
                  onClick={() => {
                    playPopSound();
                    navigate(`/inventory/${mine.id}`);
                  }}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 16,
                    padding: '14px 12px',
                    border: '0.5px solid var(--separator)',
                    boxShadow: 'var(--shadow-card)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 154,
                    gap: 10,
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  }}
                  className="hover-card hover-press"
                >
                  {/* Top Line: Compact glyph circle & Rate pill */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 9,
                          background: 'var(--ios-blue)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 12,
                          color: 'white',
                        }}
                      >
                        {initials}
                      </div>

                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background: 'var(--ios-blue)',
                          color: 'white',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {curSym} {formatAmountNumber(mine.ratePerTon)}/t
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: 'var(--label-primary)',
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={mine.name}
                    >
                      {mine.name}
                    </div>

                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--label-tertiary)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <MapPin size={10} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mine.location || 'Mine Yard'}
                      </span>
                    </div>
                  </div>

                  {/* High-density Stock Box */}
                  <div
                    style={{
                      background: 'var(--fill-tertiary)',
                      borderRadius: 10,
                      padding: '8px 10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                        Yard Stock
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: isOverdrawn
                            ? 'rgba(255, 59, 48, 0.12)'
                            : isExhausted
                              ? 'var(--fill-secondary)'
                              : isLow
                                ? 'rgba(255, 149, 0, 0.12)'
                                : 'rgba(52, 199, 89, 0.12)',
                          color: isOverdrawn
                            ? 'var(--ios-red)'
                            : isExhausted
                              ? 'var(--label-tertiary)'
                              : isLow
                                ? 'var(--ios-orange)'
                                : 'var(--ios-green)',
                        }}
                      >
                        {isOverdrawn ? 'Over' : isExhausted ? 'Empty' : isLow ? 'Low' : 'In Stock'}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 800,
                        color: isOverdrawn ? 'var(--ios-red)' : 'var(--label-primary)',
                        marginTop: 2,
                      }}
                      className="tabular-nums"
                    >
                      {stock.remainingTons.toFixed(1)} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--label-secondary)' }}>tons</span>
                    </div>
                  </div>

                  {/* Bottom Line: Est. Value */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 1 }}>
                    <span style={{ fontSize: 10, color: 'var(--label-tertiary)' }}>
                      Est. Val:
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ios-green)' }} className="tabular-nums">
                      {curSym} {formatAmountNumber(stock.remainingValue, settings)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Add / Edit Mine Modal Sheet ── */}
      {isAddMineOpen && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => {
              playPopSound();
              setIsAddMineOpen(false);
            }}
          />
          <div
            className="ios-bottom-sheet"
            style={{
              maxHeight: '85vh',
              zIndex: 99999,
            }}
          >
            <div className="ios-sheet-handle" />

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  playPopSound();
                  setIsAddMineOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
                {editingMine ? 'Edit Mine' : 'New Mine Ledger'}
              </span>

              <button
                type="button"
                onClick={handleSaveMine}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Save
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSaveMine} style={{ padding: '16px 16px 32px' }}>
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Mine Name *"
                  value={mineForm.name}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, name: val }))}
                  placeholder="e.g. Duki Coal Mine, Khost Pit 3"
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label={`Default Rate Per Ton (${curSym}/t) *`}
                  type="number"
                  suffix={`${curSym}/t`}
                  value={mineForm.ratePerTon}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, ratePerTon: val }))}
                  placeholder="e.g. 21000"
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Yard / Dump Location (Optional)"
                  value={mineForm.location}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, location: val }))}
                  placeholder="e.g. Yard 1 - Sector B"
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <FloatingField
                  label="Notes / Remarks (Optional)"
                  value={mineForm.notes}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, notes: val }))}
                  placeholder="e.g. Grade, contractor contact, seam details"
                />
              </div>

              {mineFormError && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '10px 14px',
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.3)',
                    borderRadius: 10,
                    fontSize: 13,
                    color: 'var(--ios-red)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <ShieldAlert size={16} style={{ flexShrink: 0 }} />
                  <span>{mineFormError}</span>
                </div>
              )}

              <button
                type="submit"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 14,
                  background: 'var(--ios-blue)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                className="ios-btn-primary"
              >
                {editingMine ? 'Update Mine' : 'Create Mine Ledger'}
              </button>
            </form>
          </div>
        </>
      )}

    </div>
  );
}
