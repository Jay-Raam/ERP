'use client';

import { useState } from 'react';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { usePermission } from '@/features/auth/viewer';
import { ItemsView, WarehousesView } from './catalogue-views';
import { MovementsView, StockView } from './stock-views';

type Tab = 'stock' | 'items' | 'warehouses' | 'movements';

export function StorePage() {
  const canItems = usePermission('store.item.view');
  const canWarehouses = usePermission('store.warehouse.view');
  const canStock = usePermission('store.stock.view');
  const tabs: { id: Tab; label: string }[] = [
    ...(canStock ? [{ id: 'stock' as const, label: 'Stock' }] : []),
    ...(canItems ? [{ id: 'items' as const, label: 'Items' }] : []),
    ...(canWarehouses ? [{ id: 'warehouses' as const, label: 'Warehouses' }] : []),
    ...(canStock ? [{ id: 'movements' as const, label: 'Movements' }] : []),
  ];
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (tabs.length === 0) return <NoAccess />;
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Store" description="Items, warehouses and every change to your stock." />
      <div
        role="tablist"
        aria-label="Store sections"
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
      {tab === 'stock' ? <StockView /> : null}
      {tab === 'items' ? <ItemsView /> : null}
      {tab === 'warehouses' ? <WarehousesView /> : null}
      {tab === 'movements' ? <MovementsView /> : null}
    </div>
  );
}
