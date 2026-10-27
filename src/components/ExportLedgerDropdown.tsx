import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown, Loader2, Calendar } from 'lucide-react';
import type { Dispatch, Party, PurchaseOrder } from '../types';
import { exportDispatchesPdf, exportDispatchesExcel } from '../utils/exportSharing';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { getDateRangeForPreset, type ExportDatePreset } from '../utils/dateRange';

interface ExportLedgerDropdownProps {
  dispatches: Dispatch[];
  parties: Party[];
  pos?: PurchaseOrder[];
  partyName?: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  buttonLabel?: string;
  align?: 'left' | 'right';
  className?: string;
  dateRange?: string;
  onSuccess?: (msg: string) => void;
  onError?: (err: Error) => void;
}

export default function ExportLedgerDropdown({
  dispatches,
  parties,
  pos = [],
  partyName,
  title,
  subtitle,
  compact = false,
  buttonLabel = 'Export Ledger',
  align = 'right',
  className = '',
  dateRange,
  onSuccess,
  onError,
}: ExportLedgerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingType, setLoadingType] = useState<'pdf' | 'excel' | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<ExportDatePreset | 'current'>('current');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Resolve active dispatches and dateRange string based on selected preset
  const { activeDispatches, activeDateRangeLabel } = useMemo(() => {
    if (selectedPreset === 'current') {
      return {
        activeDispatches: dispatches,
        activeDateRangeLabel: dateRange || undefined,
      };
    }

    const rangeInfo = getDateRangeForPreset(selectedPreset);
    const filtered = dispatches.filter((d) => {
      if (!d || d.deleted) return false;
      if (rangeInfo.from && (d.date || '') < rangeInfo.from) return false;
      if (rangeInfo.to && (d.date || '') > rangeInfo.to) return false;
      return true;
    });

    return {
      activeDispatches: filtered,
      activeDateRangeLabel: rangeInfo.label,
    };
  }, [dispatches, selectedPreset, dateRange]);

  const handleOpenToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dispatches.length === 0) return;
    playPopSound();
    setIsOpen((prev) => !prev);
  };

  const handleExportPdf = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loadingType || activeDispatches.length === 0) return;
    try {
      setLoadingType('pdf');
      await exportDispatchesPdf({
        title: title || (partyName ? `${partyName.toUpperCase()} - DISPATCH LEDGER` : 'COAL DISPATCH LEDGER'),
        subtitle,
        partyName,
        dateRange: activeDateRangeLabel,
        dispatches: activeDispatches,
        parties,
        pos,
      });
      playSuccessSound();
      onSuccess?.('PDF ledger ready to share!');
      setIsOpen(false);
    } catch (err: any) {
      console.error('PDF Export error:', err);
      onError?.(err);
    } finally {
      setLoadingType(null);
    }
  };

  const handleExportExcel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loadingType || activeDispatches.length === 0) return;
    try {
      setLoadingType('excel');
      await exportDispatchesExcel({
        partyName,
        dateRange: activeDateRangeLabel,
        dispatches: activeDispatches,
        parties,
        pos,
      });
      playSuccessSound();
      onSuccess?.('Excel spreadsheet ready to share!');
      setIsOpen(false);
    } catch (err: any) {
      console.error('Excel Export error:', err);
      onError?.(err);
    } finally {
      setLoadingType(null);
    }
  };

  const isDisabled = dispatches.length === 0;

  const presetChips: Array<{ id: ExportDatePreset | 'current'; label: string }> = [
    { id: 'current', label: 'Current Filter' },
    { id: 'this_month', label: 'This Month' },
    { id: 'last_month', label: 'Last Month' },
    { id: 'all', label: 'All Time' },
  ];

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      style={{ zIndex: isOpen ? 60 : 'auto' }}
    >
      {compact ? (
        <button
          type="button"
          onClick={handleOpenToggle}
          disabled={isDisabled}
          className="ios-icon-circle-btn"
          title={buttonLabel}
          style={{
            opacity: isDisabled ? 0.4 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
          }}
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          {loadingType ? (
            <Loader2 style={{ width: 18, height: 18 }} className="animate-spin text-slate-600 dark:text-slate-300" />
          ) : (
            <Download style={{ width: 18, height: 18 }} strokeWidth={2.4} />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleOpenToggle}
          disabled={isDisabled}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 13px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 18,
            border: '0.5px solid var(--separator)',
            background: 'var(--fill-tertiary)',
            color: 'var(--label-primary)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            opacity: isDisabled ? 0.45 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          {loadingType ? (
            <Loader2 style={{ width: 14, height: 14 }} className="animate-spin text-blue-500" />
          ) : (
            <Download style={{ width: 14, height: 14, color: 'var(--ios-blue)' }} strokeWidth={2.4} />
          )}
          <span style={{ whiteSpace: 'nowrap' }}>{buttonLabel}</span>
          <ChevronDown
            style={{
              width: 12,
              height: 12,
              color: 'var(--label-tertiary)',
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
              flexShrink: 0,
            }}
          />
        </button>
      )}

      {/* Utilitarian Dropdown Menu with Date Range Filtering */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'right' ? 'right' : 'left']: 0,
            minWidth: 260,
            backgroundColor: 'var(--bg-card)',
            borderRadius: 16,
            border: '0.5px solid var(--separator)',
            boxShadow: '0 10px 28px -4px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)',
            padding: 8,
            backdropFilter: 'blur(20px)',
            zIndex: 9999,
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {/* Header Title & Date Range Preset Selector */}
          <div
            style={{
              padding: '6px 8px 8px',
              borderBottom: '0.5px solid var(--separator)',
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--label-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
              }}
            >
              <span>Date Range</span>
              <span style={{ color: 'var(--ios-blue)', textTransform: 'none', fontWeight: 600 }}>
                {activeDispatches.length} Entries
              </span>
            </div>

            {/* Quick Presets Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 4,
                background: 'var(--fill-quaternary)',
                padding: 3,
                borderRadius: 8,
              }}
            >
              {presetChips.map((chip) => {
                const isSelected = selectedPreset === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playPopSound();
                      setSelectedPreset(chip.id);
                    }}
                    style={{
                      padding: '4px 2px',
                      fontSize: 10,
                      fontWeight: isSelected ? 700 : 500,
                      borderRadius: 6,
                      border: 'none',
                      background: isSelected ? 'var(--bg-card)' : 'transparent',
                      color: isSelected ? 'var(--ios-blue)' : 'var(--label-secondary)',
                      boxShadow: isSelected ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      cursor: 'pointer',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {activeDateRangeLabel && (
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--label-secondary)',
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Calendar size={11} style={{ color: 'var(--ios-blue)' }} />
                <span>{activeDateRangeLabel}</span>
              </div>
            )}
          </div>

          {/* Option: Export as PDF */}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={Boolean(loadingType) || activeDispatches.length === 0}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: 'var(--label-primary)',
              textAlign: 'left',
              cursor: loadingType ? 'wait' : 'pointer',
              opacity: loadingType && loadingType !== 'pdf' ? 0.4 : 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--fill-quaternary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'var(--ios-blue)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {loadingType === 'pdf' ? (
                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
              ) : (
                <FileText style={{ width: 16, height: 16 }} strokeWidth={2.2} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>Export as PDF</div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary)', marginTop: 2 }}>
                High-density tabular audit
              </div>
            </div>
          </button>

          {/* Option: Export as Excel */}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={Boolean(loadingType) || activeDispatches.length === 0}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 10,
              border: 'none',
              background: 'transparent',
              color: 'var(--label-primary)',
              textAlign: 'left',
              cursor: loadingType ? 'wait' : 'pointer',
              opacity: loadingType && loadingType !== 'excel' ? 0.4 : 1,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--fill-quaternary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                backgroundColor: 'var(--ios-green)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {loadingType === 'excel' ? (
                <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" />
              ) : (
                <FileSpreadsheet style={{ width: 16, height: 16 }} strokeWidth={2.2} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>Export as Excel</div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary)', marginTop: 2 }}>
                Full .xlsx workbook
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
