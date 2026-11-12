/**
 * Purchase order money, in exact integer arithmetic (BigInt) so the server and the browser
 * always agree to the paisa. Quantities have 3 decimals, prices 2, GST is a whole percent.
 * Each line is rounded half-up to the paisa on its own, and the order is the sum of its lines.
 */

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

/** A single line may not exceed this (in paise): 1,000,000,000,000.00. */
export const MAX_LINE_PAISE = 100_000_000_000_000n;

function scaled(value: string, decimals: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
}

/** Integer division rounding half up (all inputs here are non-negative). */
function divRound(numerator: bigint, divisor: bigint): bigint {
  return (numerator * 2n + divisor) / (divisor * 2n);
}

export function paiseToString(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export interface LineAmounts {
  subtotal: bigint;
  tax: bigint;
  total: bigint;
}

/** quantity "12.5", unitPrice "99.50", gstRate 18 -> amounts in paise. */
export function lineAmounts(quantity: string, unitPrice: string, gstRate: number): LineAmounts {
  const product = scaled(quantity, 3) * scaled(unitPrice, 2); // scale 10^5
  const subtotal = divRound(product, 1000n);
  const tax = divRound(subtotal * BigInt(gstRate), 100n);
  return { subtotal, tax, total: subtotal + tax };
}

export interface OrderAmounts {
  subtotal: string;
  tax: string;
  total: string;
}

export function orderAmounts(lines: LineAmounts[]): OrderAmounts {
  const sum = lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal + l.subtotal,
      tax: acc.tax + l.tax,
      total: acc.total + l.total,
    }),
    { subtotal: 0n, tax: 0n, total: 0n },
  );
  return {
    subtotal: paiseToString(sum.subtotal),
    tax: paiseToString(sum.tax),
    total: paiseToString(sum.total),
  };
}
