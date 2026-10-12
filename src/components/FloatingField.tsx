import React, { useState, useRef } from 'react';
import { formatNumberWithCommas, stripNonNumeric, calculateNewCursor } from '../utils/numberFormat';

export default function FloatingField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  suffix,
  step,
  required = false,
  autoFocus = false,
  error,
  disabled = false,
  readOnly = false,
  helperText,
  style,
  inputStyle,
}: {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  suffix?: string;
  step?: string;
  required?: boolean;
  autoFocus?: boolean;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  helperText?: string;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}) {
  const isNumberType = type === 'number';
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [localVal, setLocalVal] = useState<string>(() => {
    if (value === 0 || value === '0') return '';
    if (isNumberType) {
      return value !== undefined && value !== null && value !== '' ? formatNumberWithCommas(value) : '';
    }
    return value !== undefined && value !== null ? String(value) : '';
  });

  const [prevValue, setPrevValue] = useState(value);

  // Sync localVal during render when external prop changes while not actively typing
  if (value !== prevValue) {
    setPrevValue(value);
    if (!isFocused) {
      if (value === 0 || value === '0' || value === '' || value === undefined || value === null) {
        setLocalVal('');
      } else if (isNumberType) {
        setLocalVal(formatNumberWithCommas(value));
      } else {
        setLocalVal(String(value));
      }
    }
  }

  const isFloated =
    type === 'date' ||
    isFocused ||
    Boolean(localVal !== '' && localVal !== undefined && localVal !== null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isNumberType) return;

    // Handle backspace right after comma
    if (e.key === 'Backspace') {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start !== null && start === end && start > 0) {
        if (target.value[start - 1] === ',') {
          e.preventDefault();
          const val = target.value;
          const charToDeleteIndex = start - 2;
          if (charToDeleteIndex >= 0) {
            const modified = val.slice(0, charToDeleteIndex) + val.slice(start - 1);
            const clean = stripNonNumeric(modified);
            const formatted = formatNumberWithCommas(clean);
            const cursor = calculateNewCursor(val, formatted, charToDeleteIndex);
            setLocalVal(formatted);
            onChange(clean);
            requestAnimationFrame(() => {
              if (inputRef.current) {
                inputRef.current.setSelectionRange(cursor, cursor);
              }
            });
          }
          return;
        }
      }
    }

    // Handle delete right before comma
    if (e.key === 'Delete') {
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start !== null && start === end && start < target.value.length) {
        if (target.value[start] === ',') {
          e.preventDefault();
          const val = target.value;
          const charToDeleteIndex = start + 1;
          if (charToDeleteIndex < val.length) {
            const modified = val.slice(0, start) + val.slice(start + 2);
            const clean = stripNonNumeric(modified);
            const formatted = formatNumberWithCommas(clean);
            const cursor = calculateNewCursor(val, formatted, start);
            setLocalVal(formatted);
            onChange(clean);
            requestAnimationFrame(() => {
              if (inputRef.current) {
                inputRef.current.setSelectionRange(cursor, cursor);
              }
            });
          }
          return;
        }
      }
    }

    // Allow navigation & control keys
    if (
      e.key === 'Backspace' ||
      e.key === 'Delete' ||
      e.key === 'Tab' ||
      e.key === 'Escape' ||
      e.key === 'Enter' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'Home' ||
      e.key === 'End' ||
      e.ctrlKey ||
      e.metaKey
    ) {
      return;
    }

    // Allow digits 0-9
    if (e.key >= '0' && e.key <= '9') {
      return;
    }

    // Allow decimal point only if one isn't already present
    if (e.key === '.') {
      if (!e.currentTarget.value.includes('.')) {
        return;
      }
    }

    // Block any other key (letters, symbols)
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isNumberType) {
      const rawInput = e.target.value;
      const clean = stripNonNumeric(rawInput);
      if (clean === '') {
        setLocalVal('');
        onChange('');
        return;
      }
      const formatted = formatNumberWithCommas(clean);
      const cursor = calculateNewCursor(rawInput, formatted, e.target.selectionStart ?? rawInput.length);
      setLocalVal(formatted);
      onChange(clean);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(cursor, cursor);
        }
      });
    } else {
      const val = e.target.value;
      setLocalVal(val);
      onChange(val);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (value === 0 || value === '0' || value === '' || value === undefined || value === null) {
      setLocalVal('');
    } else if (isNumberType) {
      setLocalVal(formatNumberWithCommas(value));
    } else {
      setLocalVal(String(value));
    }
  };

  return (
    <div style={{ marginBottom: error || helperText ? 14 : 12, width: '100%' }}>
      <div
        className={`floating-field ${isFocused ? 'is-focused' : ''} ${isFloated ? 'is-floated' : ''} ${suffix ? 'has-suffix' : ''} ${error ? 'has-error' : ''}`}
        style={{
          marginBottom: 0,
          opacity: disabled ? 0.62 : 1,
          background: disabled || readOnly ? 'var(--fill-quaternary)' : undefined,
          ...(error ? { borderColor: '#ff3b30', borderWidth: 1.5 } : {}),
          ...style
        }}
      >
        <input
          ref={inputRef}
          type={isNumberType ? 'text' : type}
          inputMode={isNumberType ? 'decimal' : undefined}
          pattern={isNumberType ? '[0-9,.]*' : undefined}
          autoComplete="off"
          step={step}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={isFloated && placeholder ? placeholder : ''}
          value={localVal}
          onChange={handleChange}
          onKeyDown={isNumberType ? handleKeyDown : undefined}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          className="floating-input"
          style={{
            cursor: disabled ? 'not-allowed' : readOnly ? 'default' : undefined,
            ...inputStyle,
          }}
        />
        <label className="floating-label" style={error ? { color: '#ff3b30' } : undefined}>
          {label}
        </label>
        {suffix && (
          <span className="floating-suffix">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: '#ff3b30', marginTop: 3, paddingLeft: 4, fontWeight: 500 }}>
          {error}
        </div>
      )}
      {!error && helperText && (
        <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 4, paddingLeft: 4, lineHeight: 1.35 }}>
          {helperText}
        </div>
      )}
    </div>
  );
}
