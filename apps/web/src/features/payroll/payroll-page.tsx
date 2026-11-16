'use client';

import { useState } from 'react';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { usePermission } from '@/features/auth/viewer';
import { MyPayslipsView } from './my-payslips-view';
import { RunsView } from './runs-view';
import { StructuresView } from './structures-view';

type Tab = 'runs' | 'salaries' | 'mine';

export function PayrollPage() {
  const canRuns = usePermission('payroll.run.view');
  const canStructures = usePermission('payroll.structure.view');
  const canMine = usePermission('payroll.payslip.view-own');

  const tabs: { id: Tab; label: string }[] = [
    ...(canRuns ? [{ id: 'runs' as const, label: 'Payroll runs' }] : []),
    ...(canStructures ? [{ id: 'salaries' as const, label: 'Salaries' }] : []),
    ...(canMine ? [{ id: 'mine' as const, label: 'My payslips' }] : []),
  ];
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (tabs.length === 0) return <NoAccess />;
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Payroll"
        description="Salaries, monthly payroll and payslips. Pay is cut for each day of absence."
      />
      <div
        role="tablist"
        aria-label="Payroll sections"
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
      {tab === 'runs' ? <RunsView /> : null}
      {tab === 'salaries' ? <StructuresView /> : null}
      {tab === 'mine' ? <MyPayslipsView /> : null}
    </div>
  );
}
