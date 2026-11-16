import type { PayrollStatus } from '@erp/shared';

export { formatMoney } from '@/features/purchase/format';
export { localToday } from '@/features/accounts/format';

export const STATUS_LABEL: Record<PayrollStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const STATUS_VARIANT: Record<
  PayrollStatus,
  'secondary' | 'default' | 'success' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  approved: 'default',
  paid: 'success',
  cancelled: 'destructive',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-10" -> "October 2026". */
export function monthName(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1] ?? month} ${year}`;
}

/**
 * The months that can be paid: every finished month, newest first. `today` is yyyy-mm-dd, so
 * the month it falls in is still running and is left out.
 */
export function finishedMonths(today: string, count = 12): { value: string; label: string }[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    const value = `${year}-${String(month).padStart(2, '0')}`;
    out.push({ value, label: monthName(value) });
  }
  return out;
}

/** Paid days are stored in halves: 59 -> "29.5", 62 -> "31". */
export function formatDays(halves: number): string {
  return halves % 2 === 0 ? String(halves / 2) : `${Math.floor(halves / 2)}.5`;
}
