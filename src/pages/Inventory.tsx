import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMines, saveMine, getLots, getDispatches, getSettings, getParties, saveParty } from '../lib/db';
import type { Mine, InventoryLot, Dispatch, AppSettings, SupplierProfile, Party } from '../types';
import {
  calculateMineStock,
  calculateSupplierStock,
  calculateMaterialInventorySummary,
  auditInventoryRelations,
} from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playPopSound, playSuccessSound, triggerConfetti } from '../utils/delight';
import { useLedgerListener } from '../hooks/useLedgerListener';
import { v4 as uuidv4 } from 'uuid';
import {
  COAL_ITEM_ID,
  getMaterialItems,
  getMaterialById,
  normalizeSuppliers,
  getMaterialBadgeTheme,
} from '../utils/materials';
import {
  Layers,
  Search,
  X,
  List,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  MapPin,
  TrendingUp,
  Package,
  ShieldAlert,
  Building2,
} from 'lucide-react';
import FloatingField from '../components/FloatingField';
import IOSSelect from '../components/IOSSelect';

export interface UnifiedStockSource {
  id: string;
  sourceType: 'mine' | 'supplier';
  name: string;
  materialId: string;
  materialName: string;
  contact?: string;
  phone?: string;
  location?: string;
  notes?: string;
  ratePerTon: number;
  createdAt: number;
  stock: {
    remainingTons: number;
    remainingValue: number;
    totalInflowTons: number;
    totalOutflowTons: number;
    isOverdrawn: boolean;
    entriesCount: number;
    dispatchesCount: number;
    status: 'in_stock' | 'low' | 'exhausted' | 'overdrawn';
  };
  rawMine?: Mine;
  rawSupplier?: SupplierProfile;
}

export default function Inventory() {
  const navigate = useNavigate();

  const [mines, setMines] = useState<Mine[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Active Material Tab Filter: 'all' | materialId
  const [selectedMaterialTab, setSelectedMaterialTab] = useState<string>('all');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'latest' | 'name' | 'highest_stock' | 'highest_value'>('latest');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Persistent List / Grid view mode
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (localStorage.getItem('inventory_view_mode') as 'list' | 'grid') || 'list';
  });

  // Modal Sheet State: Add Source (Mine or Supplier)
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const [sourceModalType, setSourceModalType] = useState<'mine' | 'supplier'>('mine');
  const [sourceForm, setSourceForm] = useState({
    name: '',
    materialId: COAL_ITEM_ID,
    ratePerTon: '',
    contactPerson: '',
    phone: '',
    location: '',
    notes: '',
  });

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [isSavingSource, setIsSavingSource] = useState(false);

  const curSym = getCurrencySymbol(settings?.currency);

  const loadData = async () => {
    const [m, l, d, s, p] = await Promise.all([
      getMines(),
      getLots(),
      getDispatches(),
      getSettings(),
      getParties(),
    ]);
    setMines(m);
    setLots(l);
    setDispatches(d);
    setSettings(s);
    setParties(p);
    setLoading(false);
  };

  useEffect(() => {
    let current = true;
    Promise.all([getMines(), getLots(), getDispatches(), getSettings(), getParties()]).then(([m, l, d, s, p]) => {
      if (current) {
        setMines(m);
        setLots(l);
        setDispatches(d);
        setSettings(s);
        setParties(p);
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

  // Active material catalogue
  const materials = useMemo(() => {
    return getMaterialItems(settings, true);
  }, [settings]);

  // Unified list of all sources (Mines + Suppliers)
  const allUnifiedSources = useMemo<UnifiedStockSource[]>(() => {
    const list: UnifiedStockSource[] = [];

    // Mines (Coal)
    for (const mine of mines.filter((m) => !m.deleted)) {
      const stock = calculateMineStock(mine, lots, dispatches);
      list.push({
        id: mine.id,
        sourceType: 'mine',
        name: mine.name,
        materialId: COAL_ITEM_ID,
        materialName: 'Coal',
        location: mine.location,
        notes: mine.notes,
        ratePerTon: mine.ratePerTon || 0,
        createdAt: mine.createdAt || 0,
        stock,
        rawMine: mine,
      });
    }

    // Suppliers (Parties of type 'supplier' + legacy settings.suppliers)
    const partySuppliers = parties.filter((p) => p.type === 'supplier' && !p.isArchived);
    const partySupplierIds = new Set(partySuppliers.map((p) => p.id));
    const legacySuppliers = normalizeSuppliers(settings?.suppliers).filter(
      (s) => !s.isArchived && !partySupplierIds.has(s.id)
    );

    const allSuppliers: SupplierProfile[] = [
      ...partySuppliers.map((p) => ({
        id: p.id,
        name: p.name,
        contactPerson: p.contactPerson,
        phone: p.phone,
        address: p.address,
        materialIds: p.materialIds && p.materialIds.length > 0 ? p.materialIds : [COAL_ITEM_ID],
        isArchived: p.isArchived,
      })),
      ...legacySuppliers,
    ];

    for (const supplier of allSuppliers) {
      const stock = calculateSupplierStock(supplier, lots, dispatches);
      const firstMatId = supplier.materialIds?.[0] || COAL_ITEM_ID;
      const mat = getMaterialById(firstMatId, settings);
      list.push({
        id: supplier.id,
        sourceType: 'supplier',
        name: supplier.name,
        materialId: firstMatId,
        materialName: mat.name,
        contact: supplier.contactPerson,
        phone: supplier.phone,
        location: supplier.address,
        notes: undefined,
        ratePerTon: 0,
        createdAt: 0,
        stock,
        rawSupplier: supplier,
      });
    }

    return list;
  }, [mines, parties, settings, lots, dispatches]);

  // Overall Yard Summary for current active tab
  const activeTabSummary = useMemo(() => {
    const partySuppliers = parties.filter((p) => p.type === 'supplier' && !p.isArchived);
    const partySupplierIds = new Set(partySuppliers.map((p) => p.id));
    const legacySuppliers = normalizeSuppliers(settings?.suppliers).filter(
      (s) => !s.isArchived && !partySupplierIds.has(s.id)
    );
    const allSuppliers: SupplierProfile[] = [
      ...partySuppliers.map((p) => ({
        id: p.id,
        name: p.name,
        contactPerson: p.contactPerson,
        phone: p.phone,
        address: p.address,
        materialIds: p.materialIds && p.materialIds.length > 0 ? p.materialIds : [COAL_ITEM_ID],
        isArchived: p.isArchived,
      })),
      ...legacySuppliers,
    ];

    return calculateMaterialInventorySummary(
      selectedMaterialTab,
      mines,
      allSuppliers,
      lots,
      dispatches
    );
  }, [selectedMaterialTab, mines, parties, settings, lots, dispatches]);

  // Integrity audit issues
  const integrityIssues = useMemo(
    () => auditInventoryRelations(lots, dispatches),
    [lots, dispatches]
  );

  // Filter sources by active material tab and search query
  const filteredSources = useMemo(() => {
    let result = allUnifiedSources;

    // 1. Material tab filter
    if (selectedMaterialTab !== 'all') {
      result = result.filter((src) => {
        if (src.sourceType === 'mine') {
          return selectedMaterialTab === COAL_ITEM_ID;
        }
        if (src.sourceType === 'supplier' && src.rawSupplier) {
          const s = src.rawSupplier;
          if (!s.materialIds?.length) return true; // supplier with no restriction matches
          return s.materialIds.includes(selectedMaterialTab);
        }
        return src.materialId === selectedMaterialTab;
      });
    }

    // 2. Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((src) => {
        const matchName = src.name.toLowerCase().includes(q);
        const matchLoc = (src.location || '').toLowerCase().includes(q);
        const matchContact = (src.contact || '').toLowerCase().includes(q);
        const matchPhone = (src.phone || '').toLowerCase().includes(q);
        const matchMat = src.materialName.toLowerCase().includes(q);
        const matchNotes = (src.notes || '').toLowerCase().includes(q);
        return matchName || matchLoc || matchContact || matchPhone || matchMat || matchNotes;
      });
    }

    // 3. Sorting
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'latest':
          comparison = (b.createdAt || 0) - (a.createdAt || 0);
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
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
  }, [allUnifiedSources, selectedMaterialTab, searchQuery, sortBy, sortOrder]);

  // Material tabs with counts of tons
  const materialTabsData = useMemo(() => {
    const tabs = [
      { id: 'all', label: 'All Materials' },
      ...materials.map((m) => ({ id: m.id, label: m.name })),
    ];
    return tabs;
  }, [materials]);

  // Open Add Source Modal
  const handleOpenAddSource = () => {
    playPopSound();
    setSourceFormError(null);
    const initialMatId = selectedMaterialTab !== 'all' ? selectedMaterialTab : COAL_ITEM_ID;
    const isCoalTab = initialMatId === COAL_ITEM_ID;
    setSourceModalType(isCoalTab ? 'mine' : 'supplier');
    setSourceForm({
      name: '',
      materialId: initialMatId,
      ratePerTon: '',
      contactPerson: '',
      phone: '',
      location: '',
      notes: '',
    });
    setIsAddSourceOpen(true);
  };

  // Save Source (Mine or Supplier)
  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = sourceForm.name.trim();

    if (!name) {
      setSourceFormError('Please enter a source name.');
      return;
    }

    try {
      setIsSavingSource(true);
      setSourceFormError(null);
      const now = Date.now();

      if (sourceModalType === 'mine') {
        const rate = parseFloat(sourceForm.ratePerTon) || 0;
        const mineToSave: Mine = {
          id: uuidv4(),
          name,
          ratePerTon: rate,
          location: sourceForm.location.trim() || undefined,
          notes: sourceForm.notes.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        await saveMine(mineToSave);
      } else {
        // Supplier (Party)
        const targetMat = sourceForm.materialId || COAL_ITEM_ID;
        const newParty: Party = {
          id: uuidv4(),
          name,
          type: 'supplier',
          contactPerson: sourceForm.contactPerson.trim() || '',
          phone: sourceForm.phone.trim() || '',
          address: sourceForm.location.trim() || '',
          materialIds: [targetMat],
          notes: sourceForm.notes.trim() || undefined,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
        };
        await saveParty(newParty);
      }

      playSuccessSound();
      triggerConfetti();
      setIsAddSourceOpen(false);
      showToast(sourceModalType === 'mine' ? 'Mine added successfully' : 'Supplier added successfully');
      await loadData();
    } catch (err: any) {
      setSourceFormError(err?.message || 'Failed to save source. Please try again.');
    } finally {
      setIsSavingSource(false);
    }
  };

  const activeMaterialDef = useMemo(() => {
    if (selectedMaterialTab === 'all') return null;
    return getMaterialById(selectedMaterialTab, settings);
  }, [selectedMaterialTab, settings]);

  if (loading) {
    return (
      <div className="ios-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--label-secondary)', fontSize: 15 }}>Loading Inventory…</div>
      </div>
    );
  }

  return (
    <div className="ios-page" style={{ paddingBottom: 110 }}>
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
          {activeTabSummary.totalSources} {activeTabSummary.totalSources === 1 ? 'SOURCE' : 'SOURCES'} · {activeTabSummary.totalYardTons.toFixed(1)}t{' '}
          {activeMaterialDef ? activeMaterialDef.name.toUpperCase() : 'TOTAL'} STOCK
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 className="ios-large-title">Inventory</h1>
        </div>
      </div>

      {/* ── Segmented Multi-Material Filter Bar ── */}
      <div style={{ padding: '0 16px 12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div
          style={{
            display: 'inline-flex',
            gap: 6,
            background: 'var(--fill-tertiary)',
            padding: 4,
            borderRadius: 14,
            border: '0.5px solid var(--separator)',
          }}
        >
          {materialTabsData.map((tab) => {
            const isActive = selectedMaterialTab === tab.id;
            const theme = tab.id !== 'all' ? getMaterialBadgeTheme(tab.id) : null;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  playPopSound();
                  setSelectedMaterialTab(tab.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: isActive ? 'var(--bg-card)' : 'transparent',
                  color: isActive ? 'var(--label-primary)' : 'var(--label-secondary)',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.18s ease',
                }}
              >
                {theme && (
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: theme.dot,
                    }}
                  />
                )}
                <span>{tab.label}</span>
              </button>
            );
          })}
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
              {activeMaterialDef ? `${activeMaterialDef.name} Stock Value` : 'Total Stock Value'}
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
            {curSym} {formatAmountNumber(activeTabSummary.totalYardValue, settings)}
          </div>
        </div>

        {/* 2-Column Grid: Yard Stock & Active Sources */}
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
              {activeTabSummary.totalYardTons.toFixed(1)} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-secondary)' }}>t</span>
            </div>
          </div>

          {/* Card: Active Sources */}
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
                Active Sources
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--label-primary)' }} className="tabular-nums">
              {activeTabSummary.totalSources}
            </div>
          </div>
        </div>
      </div>

      {/* ── Primary Action Button (Adaptive: Add Mine / Add Supplier) ── */}
      <div style={{ padding: '0 16px 14px' }}>
        <button
          onClick={handleOpenAddSource}
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
          <span>
            {selectedMaterialTab === COAL_ITEM_ID
              ? 'Add Coal Mine'
              : activeMaterialDef
                ? `Add ${activeMaterialDef.name} Supplier`
                : 'Add Stock Source / Supplier'}
          </span>
        </button>
      </div>

      {/* ── Search & Controls Bar ── */}
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
            placeholder={`Search ${selectedMaterialTab === COAL_ITEM_ID ? 'mines' : 'suppliers'}, locations, contacts…`}
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
              <X style={{ width: 12, height: 12 }} strokeWidth={2.6} />
            </button>
          )}
        </div>
      </div>

      {/* ── Sorting & View Toggle Controls ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 12px' }}>
        {/* iOS Sort Selector & Order Toggle Pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'var(--fill-tertiary)',
            border: '0.5px solid var(--separator)',
            borderRadius: 8,
            padding: '2px 4px',
            gap: 2,
          }}
        >
          <IOSSelect<'latest' | 'name' | 'highest_stock' | 'highest_value'>
            label="Sort Inventory"
            title="Sort Inventory"
            value={sortBy}
            onChange={(val) => setSortBy(val)}
            options={[
              { value: 'latest', label: 'Latest' },
              { value: 'name', label: 'Name (A-Z)' },
              { value: 'highest_stock', label: 'Highest Stock' },
              { value: 'highest_value', label: 'Highest Value' },
            ]}
            searchable={false}
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
                aria-label="Sort Inventory"
              >
                <span>Sort: {displayLabel}</span>
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
            title={sortOrder === 'desc' ? 'Descending' : 'Ascending'}
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

        {/* View Mode Toggle (List / Grid) */}
        <div style={{ display: 'flex', background: 'var(--fill-tertiary)', borderRadius: 8, padding: 2 }}>
          <button
            type="button"
            onClick={() => handleViewModeChange('list')}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: 'none',
              background: viewMode === 'list' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'list' ? 'var(--label-primary)' : 'var(--label-tertiary)',
              boxShadow: viewMode === 'list' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="List view"
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange('grid')}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: 'none',
              background: viewMode === 'grid' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--label-primary)' : 'var(--label-tertiary)',
              boxShadow: viewMode === 'grid' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Grid view"
          >
            <LayoutGrid size={15} />
          </button>
        </div>
      </div>

      {/* ── Sources List / Grid ── */}
      <div style={{ padding: '0 16px' }}>
        {filteredSources.length === 0 ? (
          <div
            style={{
              padding: '48px 16px',
              textAlign: 'center',
              background: 'var(--bg-card)',
              borderRadius: 18,
              border: '0.5px solid var(--separator)',
            }}
          >
            {selectedMaterialTab === COAL_ITEM_ID ? (
              <Layers size={44} style={{ opacity: 0.35, margin: '0 auto 10px' }} />
            ) : (
              <Building2 size={44} style={{ opacity: 0.35, margin: '0 auto 10px' }} />
            )}
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)' }}>
              No {activeMaterialDef ? activeMaterialDef.name : ''} Sources Found
            </div>
            <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 4 }}>
              {searchQuery
                ? `No results matching "${searchQuery}"`
                : `Tap "+ Add" above to record your first ${activeMaterialDef ? activeMaterialDef.name : ''} supplier or mine.`}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {filteredSources.map((source) => {
              const theme = getMaterialBadgeTheme(source.materialId);
              const isOverdraw = source.stock.isOverdrawn;

              return (
                <div
                  key={source.id}
                  onClick={() => {
                    playPopSound();
                    if (source.sourceType === 'supplier') {
                      navigate(`/parties/${source.id}`);
                    } else {
                      navigate(`/inventory/${source.id}`);
                    }
                  }}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 16,
                    border: '0.5px solid var(--separator)',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-card)',
                    transition: 'all 0.15s ease',
                  }}
                  className="hover-bg"
                >
                  <div>
                    {/* Top row: badge & status */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: theme.bg,
                          color: theme.color,
                          border: `0.5px solid ${theme.border}`,
                          textTransform: 'uppercase',
                          letterSpacing: 0.3,
                        }}
                      >
                        {source.materialName}
                      </span>

                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 6,
                          background: isOverdraw
                            ? 'rgba(255, 59, 48, 0.12)'
                            : source.stock.remainingTons <= 0
                              ? 'var(--fill-tertiary)'
                              : source.stock.remainingTons < 20
                                ? 'rgba(255, 149, 0, 0.12)'
                                : 'rgba(52, 199, 89, 0.12)',
                          color: isOverdraw
                            ? 'var(--ios-red)'
                            : source.stock.remainingTons <= 0
                              ? 'var(--label-secondary)'
                              : source.stock.remainingTons < 20
                                ? 'var(--ios-orange)'
                                : 'var(--ios-green)',
                        }}
                      >
                        {isOverdraw
                          ? 'Overdrawn'
                          : source.stock.remainingTons <= 0
                            ? 'Exhausted'
                            : source.stock.remainingTons < 20
                              ? 'Low'
                              : 'In Stock'}
                      </span>
                    </div>

                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', lineHeight: 1.25 }}>
                      {source.name}
                    </div>

                    {source.location && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--label-secondary)', marginTop: 4 }}>
                        <MapPin size={11} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {source.location}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 14, paddingTop: 10, borderTop: '0.5px solid var(--separator)' }}>
                    <div style={{ fontSize: 11, color: 'var(--label-tertiary)', textTransform: 'uppercase', fontWeight: 600 }}>
                      Available Stock
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: isOverdraw ? 'var(--ios-red)' : 'var(--label-primary)' }} className="tabular-nums">
                      {source.stock.remainingTons.toFixed(1)} <span style={{ fontSize: 11, fontWeight: 500 }}>tons</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ios-green)', marginTop: 1 }} className="tabular-nums">
                      {curSym} {formatAmountNumber(source.stock.remainingValue, settings)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View Mode */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredSources.map((source) => {
              const theme = getMaterialBadgeTheme(source.materialId);
              const isMine = source.sourceType === 'mine';
              const isOverdraw = source.stock.isOverdrawn;

              return (
                <div
                  key={source.id}
                  onClick={() => {
                    playPopSound();
                    if (source.sourceType === 'supplier') {
                      navigate(`/parties/${source.id}`);
                    } else {
                      navigate(`/inventory/${source.id}`);
                    }
                  }}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 16,
                    border: '0.5px solid var(--separator)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-card)',
                    transition: 'all 0.15s ease',
                  }}
                  className="hover-bg"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, marginRight: 10 }}>
                    {/* Glyph */}
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 12,
                        background: theme.bg,
                        color: theme.color,
                        border: `0.5px solid ${theme.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isMine ? <Package size={20} /> : <Building2 size={20} />}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)' }}>
                          {source.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 5,
                            background: theme.bg,
                            color: theme.color,
                            border: `0.5px solid ${theme.border}`,
                            textTransform: 'uppercase',
                          }}
                        >
                          {source.materialName}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: 'var(--fill-tertiary)',
                            color: 'var(--label-secondary)',
                          }}
                        >
                          {isMine ? 'Mine' : 'Supplier'}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {source.phone ? (
                          <>
                            <span>{source.phone}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        {source.location ? (
                          <>
                            <span>{source.location}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        <span>
                          {source.stock.entriesCount} {source.stock.entriesCount === 1 ? 'voucher' : 'vouchers'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Stock Metrics on Right */}
                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 700,
                          color: isOverdraw ? 'var(--ios-red)' : 'var(--label-primary)',
                        }}
                        className="tabular-nums"
                      >
                        {source.stock.remainingTons.toFixed(1)} <span style={{ fontSize: 11, fontWeight: 500 }}>tons</span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--ios-green)',
                          marginTop: 1,
                        }}
                        className="tabular-nums"
                      >
                        {curSym} {formatAmountNumber(source.stock.remainingValue, settings)}
                      </div>
                    </div>

                    <ChevronRight size={18} style={{ color: 'var(--label-tertiary)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal Sheet: Add Source (Mine or Supplier) ── */}
      {isAddSourceOpen && (
        <div
          className="ios-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setIsAddSourceOpen(false)}
        >
          <div
            className="ios-action-sheet"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'slideUpSheet 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--label-tertiary)', opacity: 0.4 }} />
            </div>

            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsAddSourceOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
                {sourceModalType === 'mine' ? 'Add Coal Mine' : 'Add Material Supplier'}
              </span>

              <button
                type="button"
                onClick={handleSaveSource}
                disabled={isSavingSource}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isSavingSource ? 0.6 : 1,
                }}
              >
                {isSavingSource ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveSource} style={{ padding: '16px 16px 36px', overflowY: 'auto' }}>
              {sourceFormError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.3)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {sourceFormError}
                </div>
              )}

              {/* Source Type Switcher */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', background: 'var(--fill-tertiary)', borderRadius: 10, padding: 3 }}>
                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setSourceModalType('supplier');
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: sourceModalType === 'supplier' ? 'var(--bg-card)' : 'transparent',
                      color: sourceModalType === 'supplier' ? 'var(--label-primary)' : 'var(--label-secondary)',
                      boxShadow: sourceModalType === 'supplier' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Building2 size={15} />
                    <span>Supplier / Vendor</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setSourceModalType('mine');
                      setSourceForm((prev) => ({ ...prev, materialId: COAL_ITEM_ID }));
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: 'none',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: sourceModalType === 'mine' ? 'var(--bg-card)' : 'transparent',
                      color: sourceModalType === 'mine' ? 'var(--label-primary)' : 'var(--label-secondary)',
                      boxShadow: sourceModalType === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Package size={15} />
                    <span>Coal Mine</span>
                  </button>
                </div>
              </div>

              {/* Material Assignment */}
              <div style={{ marginBottom: 12 }}>
                <IOSSelect
                  label="Primary Material"
                  value={sourceForm.materialId}
                  disabled={sourceModalType === 'mine'}
                  onChange={(val) => setSourceForm((prev) => ({ ...prev, materialId: val }))}
                  options={materials.map((m) => ({
                    value: m.id,
                    label: m.name,
                    badge: m.pricingModel === 'purity' ? 'Purity' : m.pricingModel === 'gcv' ? 'GCV' : 'Per Ton',
                  }))}
                  title="Select Material"
                  floating
                />
              </div>

              {/* Source Name */}
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label={sourceModalType === 'mine' ? 'Mine Name' : 'Supplier Business Name'}
                  value={sourceForm.name}
                  onChange={(val) => setSourceForm((prev) => ({ ...prev, name: val }))}
                  placeholder={sourceModalType === 'mine' ? 'e.g. Duki Mine Block 4' : 'e.g. Haji Latif Laterite Trading'}
                  required
                />
              </div>

              {sourceModalType === 'mine' ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Standard Rate per Ton"
                      type="number"
                      value={sourceForm.ratePerTon}
                      onChange={(val) => setSourceForm((prev) => ({ ...prev, ratePerTon: val }))}
                      placeholder="e.g. 18500"
                      suffix={`${curSym}/t`}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Location / Pit"
                      value={sourceForm.location}
                      onChange={(val) => setSourceForm((prev) => ({ ...prev, location: val }))}
                      placeholder="e.g. Duki, Balochistan"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <FloatingField
                      label="Contact Person"
                      value={sourceForm.contactPerson}
                      onChange={(val) => setSourceForm((prev) => ({ ...prev, contactPerson: val }))}
                      placeholder="e.g. Haji Latif"
                    />
                    <FloatingField
                      label="Phone Number"
                      type="tel"
                      value={sourceForm.phone}
                      onChange={(val) => setSourceForm((prev) => ({ ...prev, phone: val }))}
                      placeholder="0300-1234567"
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Address / Yard Location"
                      value={sourceForm.location}
                      onChange={(val) => setSourceForm((prev) => ({ ...prev, location: val }))}
                      placeholder="e.g. Plot 42, Hub Chowki"
                    />
                  </div>
                </>
              )}

              <div style={{ marginBottom: 16 }}>
                <FloatingField
                  label="Notes (Optional)"
                  value={sourceForm.notes}
                  onChange={(val) => setSourceForm((prev) => ({ ...prev, notes: val }))}
                  placeholder="Terms, quality specs, bank info…"
                />
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
