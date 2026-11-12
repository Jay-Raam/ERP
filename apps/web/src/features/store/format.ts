import type { MovementKind } from '@erp/shared';

/** "12.500" -> "12.5", "3.000" -> "3". Display only: the server keeps three decimals. */
export function formatQty(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  const grouped = new Intl.NumberFormat('en-IN').format(BigInt(whole!));
  const sign = whole!.startsWith('-') && !grouped.startsWith('-') ? '-' : '';
  return `${sign}${grouped}${trimmed ? `.${trimmed}` : ''}`;
}

/** A ledger quantity with an explicit sign: "+10", "-2.5". */
export function formatSigned(value: string): string {
  const text = formatQty(value);
  return text.startsWith('-') ? text : `+${text}`;
}

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  receipt: 'Received',
  issue: 'Issued',
  adjustment: 'Adjusted',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
};

export function formatMovementTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}
