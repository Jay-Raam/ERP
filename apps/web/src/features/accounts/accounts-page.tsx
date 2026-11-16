'use client';

import { useState } from 'react';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { usePermission } from '@/features/auth/viewer';
import { AccountsView } from './accounts-view';
import { InvoicesView } from './invoices-view';
import { JournalView } from './journal-view';
import { PaymentsView } from './payments-view';
import { ReportsView } from './reports-view';

type Tab = 'invoices' | 'bills' | 'payments' | 'journal' | 'reports' | 'chart';

export function AccountsPage() {
  const canInvoices = usePermission('accounts.invoice.view');
  const canPayments = usePermission('accounts.payment.view');
  const canJournal = usePermission('accounts.journal.view');
  const canReports = usePermission('accounts.report.view');
  const canChart = usePermission('accounts.account.view');

  const tabs: { id: Tab; label: string }[] = [
    ...(canInvoices
      ? [
          { id: 'invoices' as const, label: 'Invoices' },
          { id: 'bills' as const, label: 'Bills' },
        ]
      : []),
    ...(canPayments ? [{ id: 'payments' as const, label: 'Payments' }] : []),
    ...(canJournal ? [{ id: 'journal' as const, label: 'Journal' }] : []),
    ...(canReports || canJournal ? [{ id: 'reports' as const, label: 'Reports' }] : []),
    ...(canChart ? [{ id: 'chart' as const, label: 'Chart of accounts' }] : []),
  ];
  const [chosen, setChosen] = useState<Tab | null>(null);
  if (tabs.length === 0) return <NoAccess />;
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Accounts"
        description="Invoices, supplier bills, payments and the books behind them."
      />
      <div
        role="tablist"
        aria-label="Accounts sections"
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
      {tab === 'invoices' ? <InvoicesView kind="sales" /> : null}
      {tab === 'bills' ? <InvoicesView kind="purchase" /> : null}
      {tab === 'payments' ? <PaymentsView /> : null}
      {tab === 'journal' ? <JournalView /> : null}
      {tab === 'reports' ? <ReportsView /> : null}
      {tab === 'chart' ? <AccountsView /> : null}
    </div>
  );
}
