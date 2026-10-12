import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { formatNumberWithCommas, stripNonNumeric, calculateNewCursor } from '../utils/numberFormat';

export interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string | number | undefined | null;
  onChange: (cleanVal: string) => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
}

const NumericInput = forwardRef<HTMLInputElement, NumericInputProps>(({
  value,
  onChange,
  allowDecimal = true,
  allowNegative = false,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}, ref) => {
  const innerRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

  const [isFocused, setIsFocused] = useState(false);
  const [localVal, setLocalVal] = useState<string>(() => {
    if (value === 0 || value === '0') return '';
    return value !== undefined && value !== null && value !== '' ? formatNumberWithCommas(value) : '';
  });

  const [prevVal, setPrevVal] = useState(value);
  if (value !== prevVal) {
    setPrevVal(value);
    if (!isFocused) {
      if (value === 0 || value === '0' || value === '' || value === undefined || value === null) {
        setLocalVal('');
      } else {
        setLocalVal(formatNumberWithCommas(value));
      }
    }
  }

  const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Check if Backspace right after comma
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
            const clean = stripNonNumeric(modified, allowDecimal, allowNegative);
            const formatted = formatNumberWithCommas(clean);
            const cursor = calculateNewCursor(val, formatted, charToDeleteIndex);
            setLocalVal(formatted);
            onChange(clean);
            requestAnimationFrame(() => {
              if (innerRef.current) {
                innerRef.current.setSelectionRange(cursor, cursor);
              }
            });
          }
          return;
        }
      }
    }

    // Check if Delete right before comma
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
            const clean = stripNonNumeric(modified, allowDecimal, allowNegative);
            const formatted = formatNumberWithCommas(clean);
            const cursor = calculateNewCursor(val, formatted, start);
            setLocalVal(formatted);
            onChange(clean);
            requestAnimationFrame(() => {
              if (innerRef.current) {
                innerRef.current.setSelectionRange(cursor, cursor);
              }
            });
          }
          return;
        }
      }
    }

    // Allow control/navigation keys
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
      onKeyDown?.(e);
      return;
    }

    // Digits
    if (e.key >= '0' && e.key <= '9') {
      onKeyDown?.(e);
      return;
    }

    // Decimal point
    if (e.key === '.' && allowDecimal) {
      if (!e.currentTarget.value.includes('.')) {
        onKeyDown?.(e);
        return;
      }
    }

    // Minus sign
    if (e.key === '-' && allowNegative) {
      if (!e.currentTarget.value.includes('-')) {
        onKeyDown?.(e);
        return;
      }
    }

    // Block any other key (letters, symbols)
    e.preventDefault();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawInput = e.target.value;
    const clean = stripNonNumeric(rawInput, allowDecimal, allowNegative);

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
      if (innerRef.current) {
        innerRef.current.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    if (value === 0 || value === '0' || value === '' || value === undefined || value === null) {
      setLocalVal('');
    } else {
      setLocalVal(formatNumberWithCommas(value));
    }
    onBlur?.(e);
  };

  return (
    <input
      {...props}
      ref={innerRef}
      type="text"
      inputMode="decimal"
      pattern="[0-9,.]*"
      autoComplete="off"
      value={localVal}
      onChange={handleChange}
      onKeyDown={handleKeyDownInternal}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
});

export default NumericInput;
