/**
 * currency.ts
 * Centralized currency parsing, symbol extraction, and number denomination formatting
 * supporting International (Millions) and South Asian (Lakhs & Crores) standards.
 */

import type { AppSettings } from '../types';

/**
 * Extracts a concise currency symbol/label from a currency setting string.
 * Examples:
 *   'PKR (Rs.)' -> 'Rs.'
 *   'USD ($)'   -> '$'
 *   'AED (AED)' -> 'AED'
 *   'SAR (SAR)' -> 'SAR'
 *   'EUR (€)'   -> '€'
 *   'INR (₹)'   -> '₹'
 *   'CNY (¥)'   -> '¥'
 */
export function getCurrencySymbol(currencySetting?: string | null): string {
  if (!currencySetting || typeof currencySetting !== 'string') {
    return 'Rs.';
  }

  const trimmed = currencySetting.trim();
  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    return parenMatch[1].trim();
  }

  // If already a clean code or symbol
  return trimmed || 'Rs.';
}

/**
 * Extracts the 3-letter currency code (e.g. 'PKR', 'USD', 'AED').
 */
export function getCurrencyCode(currencySetting?: string | null): string {
  if (!currencySetting || typeof currencySetting !== 'string') {
    return 'PKR';
  }
  const parts = currencySetting.trim().split(/[\s(]/);
  return parts[0] || 'PKR';
}

/**
 * Formats a raw number according to the active denomination preference.
 * Default is International ('million' -> 3-digit comma grouping like 1,250,000).
 * 'lakh' formats with 2-digit South Asian grouping like 12,50,000.
 */
export function formatAmountNumber(
  amount: number,
  settings?: AppSettings | null,
  decimals: number = 0
): string {
  const isLakh = settings?.numberFormat === 'lakh';
  const locale = isLakh ? 'en-PK' : 'en-US';

  const absAmount = Math.abs(amount);
  const formatted = decimals > 0
    ? absAmount.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(absAmount).toLocaleString(locale);

  return formatted;
}

/**
 * Formats an amount with the active currency symbol and sign.
 * E.g.
 *   formatCurrency(1250000, settings) => 'Rs. 1,250,000' (or '$ 1,250,000')
 *   formatCurrency(-5000, settings)    => '-Rs. 5,000'
 *   formatCurrency(5000, settings, { showSign: true }) => '+Rs. 5,000'
 */
export function formatCurrency(
  amount: number,
  currencyOrSettings?: AppSettings | string | null,
  options?: {
    showSign?: boolean;
    decimals?: number;
    spaceAfterSymbol?: boolean;
  }
): string {
  const settings = typeof currencyOrSettings === 'object' ? currencyOrSettings : null;
  const currencyStr = typeof currencyOrSettings === 'string'
    ? currencyOrSettings
    : settings?.currency;

  const symbol = getCurrencySymbol(currencyStr);
  const isNegative = amount < 0;
  const isPositive = amount > 0;
  const numStr = formatAmountNumber(amount, settings, options?.decimals ?? 0);

  const prefixSign = isNegative ? '-' : (options?.showSign && isPositive ? '+' : '');
  const space = options?.spaceAfterSymbol === false ? '' : ' ';

  return `${prefixSign}${symbol}${space}${numStr}`;
}

/**
 * Formats a high-magnitude financial figure compactly:
 * If 'million' (default): divides by 1,000,000 -> unit 'M' (e.g. 1.25M)
 * If 'lakh': divides by 100,000 -> unit 'L' (e.g. 12.50L)
 */
export function formatCompactFinancial(
  amount: number,
  settings?: AppSettings | null,
  decimals: number = 2
): {
  symbol: string;
  value: string;
  unit: string;
  fullString: string;
} {
  const symbol = getCurrencySymbol(settings?.currency);
  const isLakh = settings?.numberFormat === 'lakh';

  const divisor = isLakh ? 100000 : 1000000;
  const unit = isLakh ? 'L' : 'M';
  const valNum = Math.abs(amount) / divisor;
  const value = valNum.toFixed(decimals);

  const prefix = amount < 0 ? '-' : '';
  const fullString = `${prefix}${symbol} ${value}${unit}`;

  return {
    symbol,
    value,
    unit,
    fullString,
  };
}

/**
 * Returns an Excel format pattern for monetary cells matching the currency.
 * E.g. '"Rs. "#,##0' or '"$ "#,##0'
 */
export function getCurrencyExcelFormat(currencySetting?: string | null, withDecimals: boolean = false): string {
  const symbol = getCurrencySymbol(currencySetting).replace(/"/g, '""');
  const numPattern = withDecimals ? '#,##0.00' : '#,##0';
  return `"${symbol} "${numPattern}`;
}
