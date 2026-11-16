'use client';

import { useState } from 'react';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { usePermission } from '@/features/auth/viewer';
import { OrdersView } from './orders-view';
import { CustomersView } from './customers-view';

type Tab = 'orders' | 'customers';

export function SalesPage() {
  const canOrders = usePermission('sale.order.view');
  const canCustomers = usePermission('sale.customer.view');
  const tabs: { id: Tab; label: string }[] = [
    ...(canOrders ? [{ id: 'orders' as const, label: 'Orders' }] : []),
    ...(canCustomers ? [{ id: 'customers' as const, label: 'Customers' }] : []),
  ];
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (tabs.length === 0) return <NoAccess />;
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales"
        description="Customers, sales orders and goods delivered from your store."
      />
      <div
        role="tablist"
        aria-label="Sales sections"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setChosen(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'orders' ? <OrdersView /> : null}
      {tab === 'customers' ? <CustomersView /> : null}
    </div>
  );
}
