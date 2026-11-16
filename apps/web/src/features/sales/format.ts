import type { SalesOrderStatus } from '@erp/shared';

export { formatMoney, previewOrder, previewLine, remainingQty } from '@/features/purchase/format';

export const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  partly_delivered: 'Partly delivered',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const STATUS_VARIANT: Record<
  SalesOrderStatus,
  'secondary' | 'default' | 'success' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  confirmed: 'default',
  partly_delivered: 'outline',
  delivered: 'success',
  cancelled: 'destructive',
};
