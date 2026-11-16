'use client';

import { useState } from 'react';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { usePermission } from '@/features/auth/viewer';
import { BalanceSheetView, PayrollCostView, ProfitAndLossView } from './financial-views';
import { AttendanceReportView, StockView, SummaryView } from './operations-views';

type Tab = 'pnl' | 'balance' | 'sales' | 'purchases' | 'stock' | 'attendance' | 'payroll';

export function ReportsPage() {
  const financial = usePermission('report.financial.view');
  const sales = usePermission('report.sales.view');
  const operational = usePermission('report.operational.view');

  const tabs: { id: Tab; label: string }[] = [
    ...(financial
      ? [
          { id: 'pnl' as const, label: 'Profit and loss' },
          { id: 'balance' as const, label: 'Balance sheet' },
        ]
      : []),
    ...(sales ? [{ id: 'sales' as const, label: 'Sales' }] : []),
    ...(operational
      ? [
          { id: 'purchases' as const, label: 'Purchases' },
          { id: 'stock' as const, label: 'Stock' },
          { id: 'attendance' as const, label: 'Attendance' },
        ]
      : []),
    ...(financial ? [{ id: 'payroll' as const, label: 'Payroll cost' }] : []),
  ];
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (tabs.length === 0) return <NoAccess />;
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Reports"
        description="Figures taken straight from the books, stock and attendance."
      />
      <div role="tablist" aria-label="Reports" className="flex gap-1 overflow-x-auto border-b">
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
      {tab === 'pnl' ? <ProfitAndLossView /> : null}
      {tab === 'balance' ? <BalanceSheetView /> : null}
      {tab === 'sales' ? <SummaryView kind="sales" /> : null}
      {tab === 'purchases' ? <SummaryView kind="purchase" /> : null}
      {tab === 'stock' ? <StockView /> : null}
      {tab === 'attendance' ? <AttendanceReportView /> : null}
      {tab === 'payroll' ? <PayrollCostView /> : null}
    </div>
  );
}
