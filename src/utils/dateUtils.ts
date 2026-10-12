/**
 * dateUtils.ts
 * Timezone-aware local date helpers ensuring calendar dates are formatted
 * in local time (e.g. Asia/Karachi UTC+5) without shifting night deliveries to the previous day.
 */

/**
 * Returns today's date in local YYYY-MM-DD format.
 */
export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a timestamp (ms) or Date instance into local YYYY-MM-DD format.
 */
export function toLocalDateString(msOrDate?: number | Date | string | null): string {
  if (!msOrDate) return getTodayDateString();
  const d = typeof msOrDate === 'number' || typeof msOrDate === 'string' ? new Date(msOrDate) : msOrDate;
  if (isNaN(d.getTime())) return getTodayDateString();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/**
 * Formats a calendar date or timestamp into uppercase "MMM DD, YYYY" format (e.g. "OCT 08, 2026").
 * Issue 28g: Uniform display format throughout app, PDF, WhatsApp, Excel and receipts.
 */
export function formatDisplayDate(msOrDate?: number | Date | string | null): string {
  if (!msOrDate) return '';
  if (typeof msOrDate === 'string') {
    const trimmed = msOrDate.trim();
    // Handles 'YYYY-MM-DD' directly without timezone distortion
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
    if (match) {
      const year = match[1];
      const monthIdx = parseInt(match[2], 10) - 1;
      const day = match[3].padStart(2, '0');
      const monthStr = MONTH_NAMES[monthIdx] || 'JAN';
      return `${monthStr} ${day}, ${year}`;
    }
  }

  const d = typeof msOrDate === 'number' || typeof msOrDate === 'string' ? new Date(msOrDate) : msOrDate;
  if (!d || isNaN(d.getTime())) return String(msOrDate);
  const year = d.getFullYear();
  const monthStr = MONTH_NAMES[d.getMonth()] || 'JAN';
  const day = String(d.getDate()).padStart(2, '0');
  return `${monthStr} ${day}, ${year}`;
}
