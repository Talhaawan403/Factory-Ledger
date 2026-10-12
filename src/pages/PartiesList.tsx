import { useEffect, useState, useMemo } from 'react';
import { getParties, saveParty, archiveParty, getDispatches, getPayments, getSettings } from '../lib/db';
import type { Party, Dispatch, Payment, AppSettings } from '../types';
import { calculatePartyBalance } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playPopSound, triggerConfetti } from '../utils/delight';
import { useLedgerListener } from '../hooks/useLedgerListener';
import { v4 as uuidv4 } from 'uuid';
import {
  UserPlus,
  ChevronRight,
  Building2,
  Search,
  X,
  List,
  LayoutGrid,
  Phone,
  PhoneCall,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PartyModalSheet from '../components/PartyModalSheet';
import PartyGlyph from '../components/PartyGlyph';
import IOSConfirmModal from '../components/IOSConfirmModal';
import IOSSelect from '../components/IOSSelect';

export default function PartiesList() {
  const [parties, setParties] = useState<Party[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDuplicateParty, setPendingDuplicateParty] = useState<{
    newParty: Party;
    existingParty: Party;
  } | null>(null);

  const curSym = getCurrencySymbol(settings?.currency);

  const duplicateNameMap = useMemo(() => {
    const counts: Record<string, number> = {};
    parties.forEach((p) => {
      const k = p.name.trim().toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [parties]);

  // Persistent List / Grid view state
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (localStorage.getItem('parties_view_mode') as 'list' | 'grid') || 'list';
  });

  const navigate = useNavigate();

  const refreshData = async () => {
    const [p, d, pay, s] = await Promise.all([getParties(), getDispatches(), getPayments(), getSettings()]);
    setParties(p);
    setDispatches(d);
    setPayments(pay);
    setSettings(s);
  };

  useEffect(() => {
    let current = true;
    Promise.all([getParties(), getDispatches(), getPayments(), getSettings()]).then(([p, d, pay, s]) => {
      if (current) {
        setParties(p);
        setDispatches(d);
        setPayments(pay);
        setSettings(s);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  useLedgerListener(() => {
    refreshData();
  });

  const [tabFilter, setTabFilter] = useState<'active' | 'archived'>('active');
  const [sortBy, setSortBy] = useState<'latest_entry' | 'name' | 'highest_due' | 'highest_adv'>('latest_entry');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const handleViewModeChange = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    localStorage.setItem('parties_view_mode', mode);
  };

  const handleArchiveParty = async (party: Party, archiveState = true) => {
    await archiveParty(party.id, archiveState);
    playPopSound();
    showToast(archiveState ? 'Party archived' : 'Party un-archived successfully');
    refreshData();
  };

  // Map metadata (latest activity timestamp, balance, profit) for efficient sorting
  const partyMetadataMap = useMemo(() => {
    const map = new Map<string, {
      latestEntryTime: number;
      outstandingBalance: number;
      totalProfit: number;
      dispatchCount: number;
    }>();

    parties.forEach((party) => {
      const pDispatches = dispatches.filter((d) =>
        d.partyId === party.id || (!d.partyId && d.factoryName?.trim().toLowerCase() === party.name.trim().toLowerCase())
      );
      const pPayments = payments.filter((p) =>
        p.partyId === party.id || (!p.partyId && (p as any).partyName?.trim().toLowerCase() === party.name.trim().toLowerCase())
      );

      let latestTime = party.createdAt || 0;
      pDispatches.forEach((d) => {
        const t = d.date ? new Date(d.date).getTime() : 0;
        const ct = d.createdAt || 0;
        const best = Math.max(t, ct);
        if (best > latestTime) latestTime = best;
      });
      pPayments.forEach((p) => {
        const t = p.date ? new Date(p.date).getTime() : 0;
        const ct = p.createdAt || 0;
        const best = Math.max(t, ct);
        if (best > latestTime) latestTime = best;
      });

      const balanceResult = calculatePartyBalance(pDispatches, pPayments);

      map.set(party.id, {
        latestEntryTime: latestTime,
        outstandingBalance: balanceResult.outstandingBalance,
        totalProfit: balanceResult.totalProfit,
        dispatchCount: pDispatches.length
      });
    });

    return map;
  }, [parties, dispatches, payments]);

  // Filter and sort parties
  const filteredParties = useMemo(() => {
    const result = parties.filter((p) => {
      const isArchived = Boolean(p.isArchived);
      if (tabFilter === 'archived' ? !isArchived : isArchived) return false;

      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.contactPerson?.toLowerCase().includes(q) ||
        p.phone?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      return true;
    });

    return result.sort((a, b) => {
      const metaA = partyMetadataMap.get(a.id);
      const metaB = partyMetadataMap.get(b.id);
      let diff = 0;

      if (sortBy === 'latest_entry') {
        const timeA = metaA?.latestEntryTime || 0;
        const timeB = metaB?.latestEntryTime || 0;
        diff = timeB - timeA;
      } else if (sortBy === 'name') {
        diff = a.name.localeCompare(b.name);
        return sortOrder === 'asc' ? diff : -diff;
      } else if (sortBy === 'highest_due') {
        const dueA = metaA?.outstandingBalance || 0;
        const dueB = metaB?.outstandingBalance || 0;
        diff = dueB - dueA;
      } else if (sortBy === 'highest_adv') {
        const advA = (metaA?.outstandingBalance ?? 0) < 0 ? Math.abs(metaA!.outstandingBalance) : -1;
        const advB = (metaB?.outstandingBalance ?? 0) < 0 ? Math.abs(metaB!.outstandingBalance) : -1;
        diff = advB - advA;
      }

      return sortOrder === 'desc' ? diff : -diff;
    });
  }, [parties, searchQuery, tabFilter, sortBy, sortOrder, partyMetadataMap]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
        Loading parties…
      </div>
    );
  }

  return (
    <div className="ios-fade-in" style={{ paddingBottom: 32 }}>
      {/* ── Toast Notification (Issue 28f: Full screen mobile width + centered) ── */}
      {toastMsg && (
        <div className="ios-toast-banner">
          <Check style={{ width: 16, height: 16, color: 'var(--ios-green)' }} strokeWidth={3} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── iOS Navigation Header with Large Title ── */}
      <div className="ios-large-header">
        <div className="ios-large-subtitle">{parties.length} ACCOUNTS</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 className="ios-large-title">Parties</h1>
        </div>
      </div>

      {/* ── Big Luxury Add New Party Button ── */}
      <div style={{ padding: '4px 16px 14px' }}>
        <button
          onClick={() => {
            playPopSound();
            setIsAdding(true);
          }}
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
          <UserPlus style={{ width: 20, height: 20 }} strokeWidth={2.6} />
          <span>Add New Party</span>
        </button>
      </div>

      {/* ── iOS Search Bar ── */}
      <div className="ios-search-container" style={{ padding: '0 16px 12px' }}>
        <div className="ios-search-bar" style={{
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
          border: '1px solid var(--border-glass)',
          background: 'var(--fill-tertiary)'
        }}>
          <Search style={{ width: 17, height: 17, color: 'var(--label-tertiary)' }} strokeWidth={2.4} />
          <input
            type="text"
            placeholder="Search factories, contacts, city…"
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
                padding: 0
              }}
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── Categories, Sorting & Persistent View Switcher Bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px 14px',
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              setTabFilter('active');
            }}
            style={{
              padding: '5px 10px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: tabFilter === 'active' ? 'var(--ios-blue)' : 'var(--fill-primary)',
              color: tabFilter === 'active' ? '#ffffff' : 'var(--label-secondary)',
              cursor: 'pointer',
            }}
          >
            Active ({parties.filter((p) => !p.isArchived).length})
          </button>
          {parties.some((p) => p.isArchived) && (
            <button
              type="button"
              onClick={() => {
                playPopSound();
                setTabFilter('archived');
              }}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                backgroundColor: tabFilter === 'archived' ? 'var(--ios-blue)' : 'var(--fill-primary)',
                color: tabFilter === 'archived' ? '#ffffff' : 'var(--label-secondary)',
                cursor: 'pointer',
              }}
            >
              Archived ({parties.filter((p) => p.isArchived).length})
            </button>
          )}
        </div>

        {/* Right side: Sorting controls + View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Sorting button and asc/desc toggle */}
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
              label="Sort Parties"
              title="Sort Parties"
              value={sortBy}
              onChange={(val) => setSortBy(val as any)}
              options={[
                { value: 'latest_entry', label: 'Latest Entry' },
                { value: 'name', label: 'Name' },
                { value: 'highest_due', label: 'Highest Due' },
                { value: 'highest_adv', label: 'Highest Advance' },
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
                  aria-label="Sort Parties"
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

          {/* Persistent List vs Grid Switcher */}
          <div
            style={{
              display: 'flex',
              background: 'var(--fill-primary)',
              padding: 3,
              borderRadius: 10,
              gap: 2,
              flexShrink: 0
            }}
          >
            <button
              onClick={() => {
                playPopSound();
                handleViewModeChange('list');
              }}
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
                transition: 'all 0.15s ease'
              }}
            >
              <List style={{ width: 17, height: 17 }} strokeWidth={2.4} />
            </button>

            <button
              onClick={() => {
                playPopSound();
                handleViewModeChange('grid');
              }}
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
                transition: 'all 0.15s ease'
              }}
            >
              <LayoutGrid style={{ width: 17, height: 17 }} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {/* ── View 1: List View (Apple Grouped Inset) ── */}
      {viewMode === 'list' && (
        <div className="ios-group">
          <div className="ios-card-grouped">
            {filteredParties.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
                <Building2 style={{ width: 40, height: 40, margin: '0 auto 8px', opacity: 0.35 }} strokeWidth={1.5} />
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {searchQuery ? 'No Matching Parties' : 'No Parties Yet'}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {searchQuery ? 'Try a different search query' : 'Tap "+ Add New Party" above to add your first client.'}
                </div>
              </div>
            ) : (
              filteredParties.map((party, i) => {
                const partyDispatches = dispatches.filter((d) =>
                  d.partyId === party.id || (!d.partyId && d.factoryName?.trim().toLowerCase() === party.name.trim().toLowerCase())
                );
                const partyPayments = payments.filter((p) =>
                  p.partyId === party.id || (!p.partyId && (p as any).partyName?.trim().toLowerCase() === party.name.trim().toLowerCase())
                );
                const balanceResult = calculatePartyBalance(partyDispatches, partyPayments);
                const partyProfit = balanceResult.totalProfit;
                const outstandingBalance = balanceResult.outstandingBalance;
                const isCleared = balanceResult.isCleared;

                return (
                  <div
                    key={party.id}
                    className="ios-cell"
                    onClick={() => {
                      playPopSound();
                      navigate(`/parties/${party.id}`);
                    }}
                    style={{
                      padding: '16px 16px',
                      alignItems: 'flex-start',
                      display: 'flex',
                      position: 'relative',
                      cursor: 'pointer'
                    }}
                  >
                    {/* Authentic Apple iOS Business Glyph */}
                    <PartyGlyph
                      name={party.name}
                      size={42}
                      borderRadius={11}
                      iconSize={20}
                      style={{ marginRight: 13, marginTop: 2 }}
                    />

                    {/* Party Information */}
                    <div style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
                      {/* Row 1: Party Name & Contact with Top Actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span
                              style={{
                                fontSize: 16,
                                fontWeight: 700,
                                color: 'var(--label-primary)',
                                lineHeight: 1.25,
                                letterSpacing: -0.2
                              }}
                            >
                              {party.name}
                            </span>
                            {(duplicateNameMap[party.name.trim().toLowerCase()] || 0) > 1 && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: 'white',
                                  background: 'var(--ios-orange)',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  whiteSpace: 'nowrap',
                                }}
                                title="Duplicate name: check phone or address"
                              >
                                {party.address || party.phone || 'Distinct Account'}
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 12.5,
                              color: 'var(--label-secondary)',
                              marginTop: 3,
                              lineHeight: 1.3,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {party.contactPerson ? `${party.contactPerson} · ` : ''}{party.phone || party.address || 'No phone added'}
                          </div>
                        </div>

                        {/* Top Actions: Unarchive / Delete + Chevron */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginTop: -2 }}>
                          {party.isArchived && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                playPopSound();
                                await handleArchiveParty(party, false);
                              }}
                              style={{
                                background: 'var(--ios-blue)',
                                border: 'none',
                                padding: '4px 8px',
                                color: 'white',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                borderRadius: 8,
                                fontSize: 11.5,
                                fontWeight: 600
                              }}
                              title="Unarchive Party"
                            >
                              <ArchiveRestore style={{ width: 14, height: 14 }} />
                              <span>Unarchive</span>
                            </button>
                          )}
                          <ChevronRight className="ios-chevron" style={{ width: 16, height: 16 }} strokeWidth={2.5} />
                        </div>
                      </div>

                      {/* Row 2: Outstanding / Advance Balance Pill + Quick Call Button */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                        {outstandingBalance > 0 ? (
                          <span style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--ios-orange)',
                            padding: '3px 9px',
                            borderRadius: 7,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }} className="tabular-nums">
                            Due&nbsp;:&nbsp;{curSym}&nbsp;{formatAmountNumber(outstandingBalance, settings)}
                          </span>
                        ) : outstandingBalance < 0 ? (
                          <span style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--ios-blue)',
                            padding: '3px 9px',
                            borderRadius: 7,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }} className="tabular-nums">
                            Adv&nbsp;:&nbsp;{curSym}&nbsp;{formatAmountNumber(Math.abs(outstandingBalance), settings)}
                          </span>
                        ) : isCleared ? (
                          <span style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--ios-green)',
                            padding: '3px 9px',
                            borderRadius: 7,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}>
                            Settled
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--label-tertiary)',
                            background: 'var(--fill-tertiary)',
                            padding: '2px 8px',
                            borderRadius: 6,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}>
                            No Ledger
                          </span>
                        )}

                        {/* Quick Call Action */}
                        {party.phone && (
                          <a
                            href={`tel:${party.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: 'white',
                              background: 'var(--ios-green)',
                              padding: '3px 9px',
                              borderRadius: 7,
                              textDecoration: 'none',
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                            title={`Call ${party.phone}`}
                          >
                            <PhoneCall style={{ width: 11, height: 11 }} />
                            <span>Call</span>
                          </a>
                        )}
                      </div>

                      {/* Row 3: Operational Metrics (Dispatches & Net Profit) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                        <span className="dispatch-status-badge">
                          {partyDispatches.length} {partyDispatches.length === 1 ? 'Dispatch' : 'Dispatches'}
                        </span>

                        {partyProfit > 0 ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'white',
                              background: 'var(--ios-green)',
                              padding: '2px 8px',
                              borderRadius: 6,
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                            className="tabular-nums"
                          >
                            +{curSym}&nbsp;{formatAmountNumber(Math.round(partyProfit), settings)}&nbsp;Profit
                          </span>
                        ) : partyProfit < 0 ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: 'white',
                              background: 'var(--ios-red)',
                              padding: '2px 8px',
                              borderRadius: 6,
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}
                            className="tabular-nums"
                          >
                            -{curSym}&nbsp;{formatAmountNumber(Math.abs(Math.round(partyProfit)), settings)}&nbsp;Loss
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {i < filteredParties.length - 1 && <div className="ios-separator with-glyph" style={{ left: 71 }} />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── View 2: Grid View (Apple 2-Column Cards) ── */}
      {viewMode === 'grid' && (
        <div style={{ padding: '0 16px' }}>
          {filteredParties.length === 0 ? (
            <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
              <Building2 style={{ width: 40, height: 40, margin: '0 auto 8px', opacity: 0.35 }} strokeWidth={1.5} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>No Parties Found</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {filteredParties.map((party) => {
                const partyDispatches = dispatches.filter((d) =>
                  d.partyId === party.id || (!d.partyId && d.factoryName?.trim().toLowerCase() === party.name.trim().toLowerCase())
                );
                const partyPayments = payments.filter((p) =>
                  p.partyId === party.id || (!p.partyId && (p as any).partyName?.trim().toLowerCase() === party.name.trim().toLowerCase())
                );
                const balanceResult = calculatePartyBalance(partyDispatches, partyPayments);
                const partyProfit = balanceResult.totalProfit;
                const outstandingBalance = balanceResult.outstandingBalance;
                const isCleared = balanceResult.isCleared;

                return (
                  <div
                    key={party.id}
                    onClick={() => {
                      playPopSound();
                      navigate(`/parties/${party.id}`);
                    }}
                    style={{
                      background: 'var(--bg-card)',
                      borderRadius: 18,
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: 160,
                      boxShadow: 'var(--shadow-card)',
                      border: '1px solid var(--border-glass)',
                      cursor: 'pointer',
                      transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                      position: 'relative',
                      backdropFilter: 'blur(16px)'
                    }}
                    className="ios-metric-widget"
                  >
                    <div>
                      {/* Top Header: Business Glyph, Unarchive & Call */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <PartyGlyph
                          name={party.name}
                          size={36}
                          borderRadius={10}
                          iconSize={18}
                        />

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {party.isArchived && (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                playPopSound();
                                await handleArchiveParty(party, false);
                              }}
                              style={{
                                border: 'none',
                                background: 'rgba(0, 122, 255, 0.12)',
                                color: 'var(--ios-blue)',
                                borderRadius: 7,
                                padding: '3px 7px',
                                fontSize: 11,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                cursor: 'pointer'
                              }}
                              title="Unarchive Party"
                            >
                              <ArchiveRestore size={12} />
                              <span>Unarchive</span>
                            </button>
                          )}

                          {party.phone && (
                            <a
                              href={`tel:${party.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: 'var(--ios-green)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textDecoration: 'none'
                              }}
                              title={`Call ${party.phone}`}
                            >
                              <Phone style={{ width: 13, height: 13 }} />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Party Name */}
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: 'var(--label-primary)',
                          lineHeight: 1.25,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical'
                        }}
                      >
                        {party.name}
                      </div>
                      {(duplicateNameMap[party.name.trim().toLowerCase()] || 0) > 1 && (
                        <div style={{ marginTop: 2 }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: 'white',
                              background: 'var(--ios-orange)',
                              padding: '1px 5px',
                              borderRadius: 4,
                              display: 'inline-flex',
                              alignItems: 'center',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {party.address || party.phone || 'Distinct Account'}
                          </span>
                        </div>
                      )}

                      {/* Contact / Phone */}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--label-secondary)',
                          marginTop: 4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {party.contactPerson || party.phone || 'Industrial Plant'}
                      </div>
                    </div>

                    {/* Bottom Status Pill */}
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--separator)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--label-tertiary)', fontWeight: 500 }}>
                          {partyDispatches.length} {partyDispatches.length === 1 ? 'truck' : 'trucks'}
                        </span>

                        {partyProfit > 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ios-green)' }} className="tabular-nums">
                            +{(partyProfit / 1000).toFixed(0)}k
                          </span>
                        ) : partyProfit < 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ios-red)' }} className="tabular-nums">
                            -{(Math.abs(partyProfit) / 1000).toFixed(0)}k
                          </span>
                        ) : null}
                      </div>

                      <div>
                        {outstandingBalance > 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: 'var(--ios-orange)', padding: '0px 9px', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} className="tabular-nums">
                            Due&nbsp;:&nbsp;{curSym}&nbsp;{formatAmountNumber(outstandingBalance, settings)}
                          </span>
                        ) : outstandingBalance < 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'white', background: 'var(--ios-blue)', padding: '3px 9px', borderRadius: 7, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} className="tabular-nums">
                            Adv&nbsp;:&nbsp;{curSym}&nbsp;{formatAmountNumber(Math.abs(outstandingBalance), settings)}
                          </span>
                        ) : isCleared ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ios-green)', display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                            Settled
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--label-tertiary)', whiteSpace: 'nowrap' }}>No ledger</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Add Party Apple iOS Modal Sheet ── */}
      <PartyModalSheet
        isOpen={isAdding}
        mode="add"
        onClose={() => setIsAdding(false)}
        onSave={async (data) => {
          const trimmedName = data.name.trim();
          const existing = parties.find(
            (p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase()
          );

          const party: Party = {
            id: uuidv4(),
            name: trimmedName,
            contactPerson: data.contactPerson?.trim() || '',
            phone: data.phone?.trim() || '',
            address: data.address?.trim() || '',
            createdAt: Date.now()
          };

          if (existing) {
            setPendingDuplicateParty({ newParty: party, existingParty: existing });
            return;
          }

          await saveParty(party);
          triggerConfetti();
          setIsAdding(false);
          refreshData();
        }}
      />

      {/* ── Duplicate Party Name Warning Modal (Issue 30a) ── */}
      <IOSConfirmModal
        isOpen={Boolean(pendingDuplicateParty)}
        title="Duplicate Party Name?"
        message={`A party named "${pendingDuplicateParty?.existingParty.name}" already exists (${pendingDuplicateParty?.existingParty.phone ||
          pendingDuplicateParty?.existingParty.address ||
          'Existing account'
          }). Do you want to create another party with the exact same name? We recommend adding a location or plant name (e.g. "${pendingDuplicateParty?.newParty.name} - Plant 2") to avoid ledger confusion.`}
        confirmText="Create Duplicate"
        cancelText="Go Back & Edit"
        destructive={false}
        countdownSeconds={0}
        icon="warning"
        onConfirm={async () => {
          if (pendingDuplicateParty) {
            await saveParty(pendingDuplicateParty.newParty);
            triggerConfetti();
            setPendingDuplicateParty(null);
            setIsAdding(false);
            refreshData();
          }
        }}
        onCancel={() => {
          setPendingDuplicateParty(null);
        }}
      />

    </div>
  );
}
