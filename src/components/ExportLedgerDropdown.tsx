import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileSpreadsheet, ChevronDown, Loader2 } from 'lucide-react';
import type { Dispatch, Party, PurchaseOrder } from '../types';
import { exportDispatchesPdf, exportDispatchesExcel } from '../utils/exportSharing';
import { playPopSound, playSuccessSound } from '../utils/delight';

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
  onSuccess,
  onError,
}: ExportLedgerDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingType, setLoadingType] = useState<'pdf' | 'excel' | null>(null);
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

  const handleOpenToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dispatches.length === 0) return;
    playPopSound();
    setIsOpen((prev) => !prev);
  };

  const handleExportPdf = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loadingType || dispatches.length === 0) return;
    try {
      setLoadingType('pdf');
      await exportDispatchesPdf({
        title: title || (partyName ? `${partyName.toUpperCase()} - DISPATCH LEDGER` : 'COAL DISPATCH LEDGER'),
        subtitle,
        partyName,
        dispatches,
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
    if (loadingType || dispatches.length === 0) return;
    try {
      setLoadingType('excel');
      await exportDispatchesExcel({
        partyName,
        dispatches,
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
            height: 34,
            padding: '0 12px',
            fontSize: 13,
            fontWeight: 600,
            borderRadius: 10,
            border: '0.5px solid var(--separator)',
            background: 'var(--bg-card)',
            color: 'var(--label-primary)',
            boxShadow: 'var(--shadow-sm)',
            opacity: isDisabled ? 0.45 : 1,
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          {loadingType ? (
            <Loader2 style={{ width: 14, height: 14 }} className="animate-spin text-slate-600 dark:text-slate-300" />
          ) : (
            <Download style={{ width: 14, height: 14 }} strokeWidth={2.2} />
          )}
          <span>{buttonLabel}</span>
          <ChevronDown
            style={{
              width: 13,
              height: 13,
              opacity: 0.6,
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          />
        </button>
      )}

      {/* Utilitarian Dropdown Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align === 'right' ? 'right' : 'left']: 0,
            minWidth: 230,
            backgroundColor: 'var(--bg-card)',
            borderRadius: 14,
            border: '0.5px solid var(--separator)',
            boxShadow: '0 10px 28px -4px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08)',
            padding: 6,
            backdropFilter: 'blur(20px)',
            zIndex: 9999,
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          <div
            style={{
              padding: '6px 10px 6px',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--label-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              borderBottom: '0.5px solid var(--separator)',
              marginBottom: 4,
            }}
          >
            Export Filtered ({dispatches.length} Entries)
          </div>

          {/* Option: Export as PDF */}
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={Boolean(loadingType)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 8,
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
                color: 'hsla(0, 0%, 100%, 1.00)',
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
                Tabular paginated report
              </div>
            </div>
          </button>

          {/* Option: Export as Excel */}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={Boolean(loadingType)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 10px',
              borderRadius: 8,
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
                color: 'hsla(0, 0%, 100%, 1.00)',
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
                Full .xlsx spreadsheet
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
