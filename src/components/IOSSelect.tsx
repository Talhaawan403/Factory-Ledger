import React, { useState, useRef, useMemo, useEffect } from 'react';
import { ChevronDown, Check, Search, X, ChevronRight } from 'lucide-react';
import { playPopSound } from '../utils/delight';

export interface IOSSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export interface IOSSelectProps<T extends string | number = string> {
  label: string;
  value: T | undefined | null;
  onChange: (value: T) => void;
  options: IOSSelectOption<T>[];
  placeholder?: string;
  title?: string;
  floating?: boolean;
  glyphBadge?: React.ReactNode;
  description?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  onClear?: () => void;
  required?: boolean;
  error?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  className?: string;
  emptyText?: string;
  actionButton?: {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
  };
  customTrigger?: (triggerProps: {
    open: () => void;
    selectedOption?: IOSSelectOption<T>;
    isOpen: boolean;
    displayLabel: string;
  }) => React.ReactNode;
}

export default function IOSSelect<T extends string | number = string>({
  label,
  value,
  onChange,
  options,
  placeholder,
  title,
  floating = false,
  glyphBadge,
  description,
  searchable,
  searchPlaceholder,
  disabled = false,
  clearable = false,
  onClear,
  style,
  inputStyle,
  className = '',
  emptyText = 'No options available',
  actionButton,
  customTrigger,
  error,
}: IOSSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-enable search if there are 6 or more options, unless explicitly set
  const showSearch = searchable !== undefined ? searchable : options.length >= 6;

  // Selected option lookup
  const selectedOption = useMemo(() => {
    return options.find((opt) => opt.value === value);
  }, [options, value]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const matchLabel = opt.label.toLowerCase().includes(q);
      const matchSubtitle = opt.subtitle ? opt.subtitle.toLowerCase().includes(q) : false;
      return matchLabel || matchSubtitle;
    });
  }, [options, searchQuery]);

  // Focus search input when sheet opens
  useEffect(() => {
    if (isOpen && showSearch) {
      // Small delay to allow sheet animation to initiate smoothly
      const t = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 120);
      return () => clearTimeout(t);
    }
  }, [isOpen, showSearch]);

  const handleOpen = () => {
    if (disabled) return;
    playPopSound();
    setSearchQuery('');
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleSelect = (option: IOSSelectOption<T>) => {
    if (option.disabled) return;
    playPopSound();
    onChange(option.value);
    handleClose();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClear) {
      onClear();
    }
    handleClose();
  };

  const isFloated = floating && (isOpen || Boolean(selectedOption) || Boolean(value));
  const displayLabel = selectedOption ? selectedOption.label : '';

  return (
    <>
      {/* ── Trigger Component ── */}
      {customTrigger ? (
        customTrigger({
          open: handleOpen,
          selectedOption,
          isOpen,
          displayLabel: displayLabel || (placeholder || ''),
        })
      ) : floating ? (
        <div style={{ marginBottom: error ? 14 : 12, width: '100%' }}>
          <div
            className={`floating-field ios-select-trigger ${isOpen ? 'is-focused' : ''} ${isFloated ? 'is-floated' : ''} ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
            style={{
              marginBottom: 0,
              cursor: disabled ? 'not-allowed' : 'pointer',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              position: 'relative',
              ...(error ? { borderColor: '#ff3b30', borderWidth: 1.5 } : {}),
              ...style,
            }}
          onClick={handleOpen}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpen();
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
        >
          <div
            className="floating-input"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              paddingRight: 14,
              overflow: 'hidden',
              ...inputStyle,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: 8 }}>
              {selectedOption?.icon && (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  {selectedOption.icon}
                </div>
              )}
              <span
                style={{
                  color: selectedOption ? 'var(--label-primary)' : 'var(--label-tertiary)',
                  fontWeight: selectedOption ? 600 : 400,
                  fontSize: 16,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  opacity: selectedOption ? 1 : 0.7,
                }}
              >
                {displayLabel || (placeholder || (isFloated ? '' : label))}
              </span>
            </div>

            <ChevronDown
              size={18}
              strokeWidth={2.2}
              style={{
                color: isOpen ? 'var(--ios-blue)' : 'var(--label-secondary)',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), color 0.18s ease',
                flexShrink: 0,
                marginLeft: 8,
              }}
            />
          </div>

            <label
              className="floating-label"
              style={{
                pointerEvents: 'none',
                ...(error ? { color: '#ff3b30' } : {}),
              }}
            >
              {label}
            </label>
          </div>
          {error && (
            <div style={{ fontSize: 11, color: '#ff3b30', marginTop: 3, paddingLeft: 4, fontWeight: 500 }}>
              {error}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`ios-select-trigger ${disabled ? 'opacity-50 pointer-events-none' : ''} ${className}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            minHeight: 52,
            position: 'relative',
            cursor: disabled ? 'not-allowed' : 'pointer',
            userSelect: 'none',
            ...style,
          }}
          onClick={handleOpen}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpen();
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, paddingRight: 8 }}>
            {glyphBadge}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 16, color: 'var(--label-primary)', fontWeight: 400 }}>
                {label}
              </span>
              {description && (
                <span style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }}>
                  {description}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {selectedOption?.icon && (
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                {selectedOption.icon}
              </div>
            )}
            <span
              style={{
                fontSize: 16,
                color: selectedOption ? 'var(--ios-blue)' : 'var(--label-tertiary)',
                fontWeight: selectedOption ? 500 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 180,
                textAlign: 'right',
                ...inputStyle,
              }}
            >
              {displayLabel || (placeholder || 'Select')}
            </span>
            <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
          </div>
        </div>
      )}

      {/* ── Apple iOS Bottom Sheet Modal ── */}
      {isOpen && (
        <>
          {/* Dimmed Blur Backdrop */}
          <div
            className="ios-modal-backdrop"
            onClick={handleClose}
            style={{
              zIndex: 99998,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              animation: 'fadeIn 0.2s ease',
            }}
          />

          {/* Action Sheet Container */}
          <div
            className="ios-bottom-sheet"
            style={{
              zIndex: 99999,
              maxHeight: '88vh',
              height: 'auto',
              background: 'var(--bg-grouped)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTop: '0.5px solid var(--separator)',
              boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            role="dialog"
            aria-modal="true"
            aria-label={title || `Select ${label}`}
          >
            {/* Grabber Handle */}
            <div
              className="ios-sheet-handle"
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                backgroundColor: 'var(--label-quaternary)',
                margin: '8px auto 4px',
                flexShrink: 0,
              }}
            />

            {/* Navigation Header */}
            <div
              className="ios-sheet-header"
              style={{
                padding: '10px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
                background: 'var(--bg-grouped)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={handleClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 17,
                  fontWeight: 400,
                  cursor: 'pointer',
                  padding: '4px 6px',
                  fontFamily: 'var(--font-system)',
                }}
              >
                Cancel
              </button>

              <span
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--label-primary)',
                  letterSpacing: -0.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '55%',
                  textAlign: 'center',
                }}
              >
                {title || `Select ${label}`}
              </span>

              {actionButton ? (
                <button
                  type="button"
                  onClick={() => {
                    playPopSound();
                    handleClose();
                    actionButton.onClick();
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ios-blue)',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontFamily: 'var(--font-system)',
                  }}
                >
                  {actionButton.icon}
                  <span>{actionButton.label}</span>
                </button>
              ) : clearable && value ? (
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ios-red)',
                    fontSize: 16,
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: '4px 6px',
                    fontFamily: 'var(--font-system)',
                  }}
                >
                  Clear
                </button>
              ) : (
                <div style={{ width: 50 }} />
              )}
            </div>

            {/* Apple-style Inset Search Bar (Auto-shown for larger option sets) */}
            {showSearch && (
              <div
                style={{
                  padding: '8px 16px 10px',
                  background: 'var(--bg-grouped)',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 38,
                    padding: '0 12px',
                    background: 'var(--fill-tertiary)',
                    borderRadius: 10,
                  }}
                >
                  <Search size={16} strokeWidth={2.2} style={{ color: 'var(--label-tertiary)', flexShrink: 0 }} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: 15,
                      color: 'var(--label-primary)',
                      fontFamily: 'var(--font-system)',
                    }}
                  />
                  {searchQuery.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      style={{
                        background: 'var(--fill-secondary)',
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
                      aria-label="Clear search"
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Options List Container */}
            <div
              className="ios-sheet-body"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 0 max(28px, env(safe-area-inset-bottom))',
                background: 'var(--bg-grouped)',
              }}
            >
              <div className="ios-group" style={{ margin: '4px 16px 12px' }}>
                <div
                  className="ios-card-grouped"
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 14,
                    border: '0.5px solid var(--separator)',
                    overflow: 'hidden',
                  }}
                  role="listbox"
                >
                  {filteredOptions.length === 0 ? (
                    <div
                      style={{
                        padding: '36px 16px',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      <Search size={32} strokeWidth={1.5} style={{ color: 'var(--label-quaternary)' }} />
                      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--label-secondary)' }}>
                        No Results
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--label-tertiary)' }}>
                        {searchQuery ? `No matches found for "${searchQuery}"` : emptyText}
                      </div>
                    </div>
                  ) : (
                    filteredOptions.map((option, index) => {
                      const isSelected = option.value === value;
                      const isLast = index === filteredOptions.length - 1;

                      return (
                        <div key={String(option.value)} style={{ position: 'relative' }}>
                          <button
                            type="button"
                            onClick={() => handleSelect(option)}
                            disabled={option.disabled}
                            style={{
                              width: '100%',
                              minHeight: 52,
                              padding: '11px 16px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: isSelected ? 'var(--tint-blue)' : 'transparent',
                              border: 'none',
                              textAlign: 'left',
                              cursor: option.disabled ? 'not-allowed' : 'pointer',
                              opacity: option.disabled ? 0.45 : 1,
                              transition: 'background-color 0.15s ease',
                              fontFamily: 'var(--font-system)',
                              userSelect: 'none',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected && !option.disabled) {
                                e.currentTarget.style.backgroundColor = 'var(--fill-quaternary)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected && !option.disabled) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: 12 }}>
                              {option.icon && (
                                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                  {option.icon}
                                </div>
                              )}

                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    fontSize: 16,
                                    fontWeight: isSelected ? 600 : 500,
                                    color: isSelected ? 'var(--ios-blue)' : 'var(--label-primary)',
                                    lineHeight: 1.3,
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {option.label}
                                </div>

                                {option.subtitle && (
                                  <div
                                    style={{
                                      fontSize: 13,
                                      color: 'var(--label-secondary)',
                                      marginTop: 2,
                                      lineHeight: 1.25,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {option.subtitle}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                              {option.badge && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    backgroundColor: 'var(--fill-secondary)',
                                    color: 'var(--label-secondary)',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {option.badge}
                                </span>
                              )}

                              {isSelected ? (
                                <Check
                                  size={19}
                                  strokeWidth={2.8}
                                  style={{
                                    color: 'var(--ios-blue)',
                                    flexShrink: 0,
                                  }}
                                />
                              ) : (
                                <div style={{ width: 19 }} />
                              )}
                            </div>
                          </button>

                          {/* iOS Hairline Inset Separator */}
                          {!isLast && (
                            <div
                              className="ios-separator"
                              style={{
                                left: option.icon ? 56 : 16,
                              }}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Optional Bottom Action Button (e.g. Add New Party) */}
              {actionButton && (
                <div style={{ padding: '0 16px 8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      handleClose();
                      actionButton.onClick();
                    }}
                    style={{
                      width: '100%',
                      height: 48,
                      borderRadius: 12,
                      border: '0.5px solid var(--separator)',
                      background: 'var(--bg-card)',
                      color: 'var(--ios-blue)',
                      fontSize: 15,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--fill-quaternary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-card)')}
                  >
                    {actionButton.icon}
                    <span>{actionButton.label}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
