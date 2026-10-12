/**
 * numberFormat.ts
 * Utilities for strictly numeric inputs with automatic comma formatting (e.g., 100000 -> 100,000)
 * and cursor position preservation across the application.
 */

/**
 * Strips all characters except digits (0-9) and at most one decimal point (.).
 * Optionally preserves a leading minus sign if allowNegative is true.
 */
export function stripNonNumeric(val: string | number | undefined | null, allowDecimal = true, allowNegative = false): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  let seenDot = false;
  let cleaned = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch >= '0' && ch <= '9') {
      cleaned += ch;
    } else if (ch === '.' && allowDecimal && !seenDot) {
      cleaned += '.';
      seenDot = true;
    } else if (ch === '-' && allowNegative && cleaned === '') {
      cleaned += '-';
    }
  }

  // Remove redundant leading zeros from integer part (e.g., "05" -> "5", but keep "0" or "0.5")
  if (cleaned.length > 1 && cleaned.startsWith('0') && cleaned[1] !== '.') {
    cleaned = cleaned.replace(/^0+/, '') || '0';
  } else if (cleaned.length > 2 && cleaned.startsWith('-0') && cleaned[2] !== '.') {
    cleaned = '-' + (cleaned.slice(1).replace(/^0+/, '') || '0');
  }

  return cleaned;
}

/**
 * Formats a clean or raw numeric string with thousands separator commas.
 * Preserves trailing decimal points and partial typing (e.g. "100000." -> "100,000.").
 */
export function formatNumberWithCommas(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === '') return '';
  const str = String(val).replace(/,/g, '').trim();
  if (str === '') return '';

  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;

  const parts = cleanStr.split('.');
  let intPart = parts[0] || '';
  const decPart = parts.length > 1 ? parts.slice(1).join('') : null;

  // Format integer portion with commas every 3 digits
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let result = (isNegative ? '-' : '') + formattedInt;
  if (decPart !== null) {
    result += '.' + decPart;
  }
  return result;
}

/**
 * Calculates the new cursor position after commas are inserted or removed.
 * Counts how many raw numeric characters (digits and dot) preceded the cursor before formatting,
 * then maps that count to the corresponding position in the formatted string.
 */
export function calculateNewCursor(
  oldVal: string,
  newValFormatted: string,
  oldCursor: number
): number {
  let digitsBeforeCursor = 0;
  for (let i = 0; i < oldCursor && i < oldVal.length; i++) {
    const ch = oldVal[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      digitsBeforeCursor++;
    }
  }

  let newCursor = 0;
  let countedDigits = 0;
  while (newCursor < newValFormatted.length && countedDigits < digitsBeforeCursor) {
    const ch = newValFormatted[newCursor];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      countedDigits++;
    }
    newCursor++;
  }

  return newCursor;
}
