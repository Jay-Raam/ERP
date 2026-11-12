import { lineAmounts, orderAmounts, paiseToString, type OrderStatus } from '@erp/shared';

/** "1234567.5" -> "₹12,34,567.50". Money from the API is always a 2-decimal string. */
export function formatMoney(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const grouped = new Intl.NumberFormat('en-IN').format(BigInt(whole!));
  return `${negative ? '-' : ''}₹${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  partly_received: 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export const STATUS_VARIANT: Record<
  OrderStatus,
  'secondary' | 'default' | 'success' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  approved: 'default',
  partly_received: 'outline',
  received: 'success',
  cancelled: 'destructive',
};

interface DraftLine {
  quantity: string;
  unitPrice: string;
  gstRate: number | string;
}

const QTY = /^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$/;
const PRICE = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;

/**
 * A live preview of one line while the form is being filled in. The server works the real
 * amounts out again; this uses the same code, so the two always match. Returns null while
 * the inputs are incomplete or invalid.
 */
export function previewLine(line: DraftLine) {
  const gst = Number(line.gstRate);
  if (!QTY.test(line.quantity.trim()) || !PRICE.test(line.unitPrice.trim())) return null;
  if (!Number.isInteger(gst) || gst < 0 || gst > 28) return null;
  return lineAmounts(line.quantity.trim(), line.unitPrice.trim(), gst);
}

export function previewOrder(lines: DraftLine[]) {
  const priced = lines.map(previewLine).filter((l): l is NonNullable<typeof l> => l !== null);
  const totals = orderAmounts(priced);
  return {
    ...totals,
    lineTotals: lines.map((l) => {
      const p = previewLine(l);
      return p ? paiseToString(p.total) : null;
    }),
    complete: priced.length === lines.length && lines.length > 0,
  };
}

/** What can still be received on a line, as a decimal string with three places. */
export function remainingQty(ordered: string, received: string): string {
  const scale = (v: string) => {
    const [w = '0', f = ''] = v.split('.');
    return BigInt(w + f.padEnd(3, '0').slice(0, 3));
  };
  const left = scale(ordered) - scale(received);
  const s = (left < 0n ? 0n : left).toString().padStart(4, '0');
  return `${s.slice(0, -3)}.${s.slice(-3)}`;
}
