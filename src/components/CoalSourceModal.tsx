import { useState, useMemo, useCallback } from 'react';
import type { Mine, InventoryLot, Dispatch, AppSettings } from '../types';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
import { calculateMineStock, calculateLotStock } from '../utils/calculations';
import { playPopSound } from '../utils/delight';
import {
  Search,
  X,
  Package,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  ArrowRight,
  Layers,
  Lock,
} from 'lucide-react';

export interface CoalSourceSelection {
  mineId?: string;
  lotId?: string;
  sourceName: string;
  weight: number;
  rate: number;
}

interface CoalSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  mines: Mine[];
  lots: InventoryLot[];
  dispatches: Dispatch[];
  settings?: AppSettings;
  currentMineId?: string;
  currentLotId?: string;
  currentDispatchId?: string;
  excludeLotIds?: string[];
  onSelect: (selection: CoalSourceSelection) => void;
  onSelectManual: () => void;
  onManageMines: () => void;
}

export default function CoalSourceModal({
  isOpen,
  onClose,
  mines,
  lots,
  dispatches,
  settings,
  currentMineId,
  currentLotId,
  currentDispatchId,
  excludeLotIds,
  onSelect,
  onSelectManual,
  onManageMines,
}: CoalSourceModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMineIds, setExpandedMineIds] = useState<Record<string, boolean>>(() => {
    // By default expand all mines so lots are immediately visible
    const initial: Record<string, boolean> = {};
    mines.forEach((m) => {
      initial[m.id] = true;
    });
    return initial;
  });
  const [expandedUsedMines, setExpandedUsedMines] = useState<Record<string, boolean>>({});

  const curSym = getCurrencySymbol(settings?.currency);

  const toggleExpand = (mineId: string) => {
    playPopSound();
    setExpandedMineIds((prev) => ({
      ...prev,
      [mineId]: !(prev[mineId] ?? true),
    }));
  };

  const otherDispatches = useMemo(
    () => dispatches.filter((d) => !d.deleted && (!currentDispatchId || d.id !== currentDispatchId)),
    [dispatches, currentDispatchId]
  );

  // Helper: Determine if a lot is currently available for this dispatch
  const isLotAvailable = useCallback((lot: InventoryLot) => {
    if (lot.deleted) return false;

    // If this lot is currently selected in THIS input field, keep it available
    if (currentLotId && lot.id === currentLotId) return true;

    // If lot was already picked by another coal input in the current form
    if (excludeLotIds && excludeLotIds.includes(lot.id)) {
      return false;
    }

    // Check if lot has remaining stock after all other dispatches
    const stock = calculateLotStock(lot, otherDispatches);
    if (stock.remainingWeight <= 0.001) {
      return false;
    }

    return true;
  }, [currentLotId, excludeLotIds, otherDispatches]);

  // Group available and used lots by mineId
  const { availableLotsByMineId, usedLotsByMineId } = useMemo(() => {
    const availMap = new Map<string, InventoryLot[]>();
    const usedMap = new Map<string, InventoryLot[]>();

    for (const lot of lots) {
      if (lot.deleted) continue;
      const key = lot.mineId || 'unassigned';

      if (isLotAvailable(lot)) {
        const existing = availMap.get(key) || [];
        existing.push(lot);
        availMap.set(key, existing);
      } else {
        const existing = usedMap.get(key) || [];
        existing.push(lot);
        usedMap.set(key, existing);
      }
    }
    return { availableLotsByMineId: availMap, usedLotsByMineId: usedMap };
  }, [lots, isLotAvailable]);

  // Filtered mines based on search
  const filteredMines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mines;

    return mines.filter((m) => {
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.location && m.location.toLowerCase().includes(q)) return true;
      const mineLots = availableLotsByMineId.get(m.id) || [];
      return mineLots.some(
        (l) =>
          (l.boughtFrom && l.boughtFrom.toLowerCase().includes(q)) ||
          (l.supplier && l.supplier.toLowerCase().includes(q)) ||
          (l.storedAt && l.storedAt.toLowerCase().includes(q))
      );
    });
  }, [mines, availableLotsByMineId, searchQuery]);

  if (!isOpen) return null;

  return (
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
        padding: 0,
      }}
      onClick={onClose}
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

        {/* Modal Top Bar */}
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
            onClick={onClose}
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
            Select Coal Mine & Stock
          </span>

          <button
            type="button"
            onClick={() => {
              onClose();
              onManageMines();
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--ios-blue)',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Plus size={15} />
            <span>Manage</span>
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '12px 16px 8px' }}>
          <div
            className="ios-search-bar"
            style={{
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
              border: '1px solid var(--border-glass)',
              background: 'var(--fill-tertiary)',
              height: 40,
            }}
          >
            <Search size={16} style={{ color: 'var(--label-tertiary)' }} />
            <input
              type="text"
              placeholder="Search mines or stock entries…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ios-search-input"
              style={{ fontSize: 14 }}
              autoFocus={false}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'var(--fill-primary)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--label-secondary)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 32px' }}>
          {/* Manual Option */}
          <div
            onClick={() => {
              playPopSound();
              onClose();
              onSelectManual();
            }}
            style={{
              padding: '12px 16px',
              borderRadius: 14,
              background: !currentMineId && !currentLotId ? 'rgba(0, 122, 255, 0.12)' : 'var(--fill-quaternary, rgba(120,120,128,0.08))',
              border: !currentMineId && !currentLotId ? '1.5px solid var(--ios-blue)' : '0.5px solid var(--separator)',
              marginBottom: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.15s ease',
            }}
            className="hover-bg"
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)' }}>
                Manual / Custom Source
              </div>
              <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2 }}>
                Enter custom source name, tonnage & price manually
              </div>
            </div>
            {!currentMineId && !currentLotId && (
              <Check size={18} style={{ color: 'var(--ios-blue)' }} strokeWidth={2.5} />
            )}
          </div>

          {/* Mines Sections */}
          {filteredMines.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
              <Layers size={40} style={{ opacity: 0.35, margin: '0 auto 8px' }} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>No Mines Found</div>
              <div style={{ fontSize: 12, color: 'var(--label-tertiary)', marginTop: 4 }}>
                {searchQuery ? `No results for "${searchQuery}"` : 'Add mines in Inventory to see them here.'}
              </div>
            </div>
          ) : (
            filteredMines.map((mine) => {
              const mineLots = availableLotsByMineId.get(mine.id) || [];
              const usedLots = usedLotsByMineId.get(mine.id) || [];
              const isExpanded = expandedMineIds[mine.id] ?? true;
              const stock = calculateMineStock(mine, lots, otherDispatches);

              return (
                <div
                  key={mine.id}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 16,
                    border: '0.5px solid var(--separator)',
                    boxShadow: 'var(--shadow-card)',
                    marginBottom: 14,
                    overflow: 'hidden',
                  }}
                >
                  {/* Mine Section Header */}
                  <div
                    style={{
                      padding: '12px 14px',
                      background: 'var(--fill-tertiary)',
                      borderBottom: isExpanded ? '0.5px solid var(--separator)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(0, 122, 255, 0.12)',
                          color: 'var(--ios-blue)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Package size={18} />
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {mine.name}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--label-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                          <span>Rate: <strong>{curSym} {formatAmountNumber(mine.ratePerTon)}/t</strong></span>
                          <span>·</span>
                          <span style={{ color: stock.isOverdrawn ? 'var(--ios-red)' : 'var(--label-secondary)' }}>
                            {stock.remainingTons.toFixed(1)}t available
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {/* Expand / Collapse toggle */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(mine.id)}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: 'none',
                          border: 'none',
                          color: 'var(--label-tertiary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                        title={isExpanded ? 'Collapse stock entries' : 'Expand stock entries'}
                      >
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Stock entries list under this mine */}
                  {isExpanded && (
                    <div style={{ padding: '6px 10px 10px' }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--label-secondary)',
                          textTransform: 'uppercase',
                          padding: '6px 8px 4px',
                          letterSpacing: 0.3,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>Stock With Balance ({mineLots.length})</span>
                        {usedLots.length > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--label-tertiary)', textTransform: 'none' }}>
                            {usedLots.length} fully allocated
                          </span>
                        )}
                      </div>

                      {mineLots.length === 0 ? (
                        <div style={{ padding: '12px 8px', fontSize: 13, color: 'var(--label-tertiary)', fontStyle: 'italic' }}>
                          {usedLots.length > 0
                            ? `All stock entries for this mine (${usedLots.length}) are fully allocated to dispatches.`
                            : 'No stock entries recorded in this mine yet. Add stock in Inventory first, or use Manual / Custom Source.'}
                        </div>
                      ) : (
                        mineLots.map((lot) => {
                          const isSelectedLot = currentLotId === lot.id;
                          const stock = calculateLotStock(lot, otherDispatches);
                          const availableWeight = Math.max(0, stock.remainingWeight);
                          const lotRate = lot.landedRate || lot.purchaseRate || lot.ratePerTon || mine.ratePerTon;
                          const isPartiallyUsed = stock.usedWeight > 0.001 && availableWeight > 0.001;

                          return (
                            <div
                              key={lot.id}
                              onClick={() => {
                                playPopSound();
                                onClose();
                                onSelect({
                                  mineId: mine.id,
                                  lotId: lot.id,
                                  sourceName: `${mine.name} - ${lot.boughtFrom || lot.supplier}`,
                                  weight: availableWeight,
                                  rate: lotRate,
                                });
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 12px',
                                borderRadius: 12,
                                background: isSelectedLot ? 'rgba(0, 122, 255, 0.12)' : 'var(--fill-quaternary, rgba(120,120,128,0.06))',
                                border: isSelectedLot ? '1.5px solid var(--ios-blue)' : '0.5px solid var(--separator)',
                                marginTop: 6,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                              className="hover-bg"
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }}>
                                    {lot.boughtFrom || lot.supplier || 'Stock Batch'}
                                  </span>

                                  {isSelectedLot ? (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        background: 'rgba(0, 122, 255, 0.15)',
                                        color: 'var(--ios-blue)',
                                      }}
                                    >
                                      Selected in this Dispatch
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: '2px 6px',
                                        borderRadius: 6,
                                        background: isPartiallyUsed ? 'rgba(255, 149, 0, 0.15)' : 'rgba(52, 199, 89, 0.15)',
                                        color: isPartiallyUsed ? 'var(--ios-orange)' : 'var(--ios-green)',
                                      }}
                                    >
                                      {isPartiallyUsed ? 'Partially Used' : 'Available'}
                                    </span>
                                  )}
                                </div>

                                <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2, display: 'flex', gap: 6 }}>
                                  <span>{formatDisplayDate(lot.date)}</span>
                                  <span>·</span>
                                  <span>Stored: {lot.storedAt || mine.location || 'Yard'}</span>
                                </div>
                              </div>

                              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-primary)' }} className="tabular-nums">
                                    {availableWeight.toFixed(2)}t available
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ios-blue)' }} className="tabular-nums">
                                    {curSym} {formatAmountNumber(lotRate, settings)}/t
                                  </div>
                                </div>

                                {isSelectedLot ? (
                                  <Check size={18} style={{ color: 'var(--ios-blue)' }} strokeWidth={2.5} />
                                ) : (
                                  <ArrowRight size={15} style={{ color: 'var(--label-tertiary)' }} />
                                )}
                              </div>
                            </div>
                          );
                        })
                      )}

                      {/* Optional expandable view for fully allocated entries */}
                      {usedLots.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              playPopSound();
                              setExpandedUsedMines((prev) => ({
                                ...prev,
                                [mine.id]: !prev[mine.id],
                              }));
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: '6px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'var(--label-tertiary)',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Lock size={11} />
                            <span>
                              {expandedUsedMines[mine.id]
                                ? `Hide ${usedLots.length} fully allocated entries`
                                : `View ${usedLots.length} fully allocated entries`}
                            </span>
                          </button>

                          {expandedUsedMines[mine.id] && (
                            <div style={{ marginTop: 4, opacity: 0.6 }}>
                              {usedLots.map((lot) => {
                                const billed = lot.billedWeight || lot.tonnage || 0;
                                const received = lot.receivedWeight || billed;
                                const effectiveWeight = received > 0 ? received : billed;
                                const usedByDispatches = otherDispatches.filter((dispatch) =>
                                  (dispatch.coalInputs || []).some((input) => input.lotId === lot.id)
                                );

                                return (
                                  <div
                                    key={lot.id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '8px 10px',
                                      borderRadius: 10,
                                      background: 'var(--fill-quaternary)',
                                      border: '0.5px dashed var(--separator)',
                                      marginTop: 4,
                                      cursor: 'not-allowed',
                                    }}
                                    title="This stock entry has no remaining balance"
                                  >
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-secondary)' }}>
                                          {lot.boughtFrom || lot.supplier || 'Stock Batch'}
                                        </span>
                                        <span
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            padding: '1px 5px',
                                            borderRadius: 6,
                                            background: 'rgba(175, 82, 222, 0.15)',
                                            color: 'var(--ios-purple, #af52de)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 3,
                                          }}
                                        >
                                          <Lock size={9} />
                                          Fully Allocated
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 1 }}>
                                        {formatDisplayDate(lot.date)} · {usedByDispatches.length} {usedByDispatches.length === 1 ? 'dispatch' : 'dispatches'}
                                      </div>
                                    </div>

                                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <div style={{ fontSize: 12, color: 'var(--label-tertiary)' }} className="tabular-nums">
                                        {effectiveWeight.toFixed(2)}t
                                      </div>
                                      <Lock size={13} style={{ color: 'var(--label-tertiary)' }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
