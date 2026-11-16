import type { InvoiceKind, InvoiceStatus, PaymentMethod } from '@erp/shared';

export { formatMoney } from '@/features/purchase/format';

/** Today's date in the browser's own time zone, as yyyy-mm-dd (an ISO string would give the UTC day). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

export const INVOICE_STATUS_VARIANT: Record<
  InvoiceStatus,
  'secondary' | 'default' | 'success' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  posted: 'success',
  cancelled: 'destructive',
};

export const KIND_LABEL: Record<InvoiceKind, { one: string; many: string; party: string }> = {
  sales: { one: 'invoice', many: 'Invoices', party: 'Customer' },
  purchase: { one: 'bill', many: 'Bills', party: 'Supplier' },
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  card: 'Card',
};

export const SOURCE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  manual: 'Manual',
  reversal: 'Reversal',
};

/** "Overdue" when a posted invoice still has a balance after its due date. */
export function isOverdue(
  invoice: { status: InvoiceStatus; dueDate: string; outstanding: string },
  today: string = localToday(),
): boolean {
  return invoice.status === 'posted' && Number(invoice.outstanding) > 0 && invoice.dueDate < today;
}
