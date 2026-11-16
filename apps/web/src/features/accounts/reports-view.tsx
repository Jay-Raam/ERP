'use client';

import { INVOICE_KINDS, type InvoiceKind } from '@erp/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/select-field';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryState } from '@/features/admin/async';
import { usePermission } from '@/features/auth/viewer';
import { Pager } from '@/features/store/pager';
import {
  PAGE_SIZE,
  useAccounts,
  useAgeing,
  useLedger,
  useTrialBalance,
  type LedgerFilter,
} from './api';
import { KIND_LABEL, SOURCE_LABEL, formatMoney } from './format';

type Report = 'trial' | 'ageing' | 'ledger';
const LABEL: Record<Report, string> = {
  trial: 'Trial balance',
  ageing: 'Ageing',
  ledger: 'Account ledger',
};

export function ReportsView() {
  const canReports = usePermission('accounts.report.view');
  const canLedger = usePermission('accounts.journal.view');
  const available: Report[] = [
    ...(canReports ? (['trial', 'ageing'] as const) : []),
    ...(canLedger ? (['ledger'] as const) : []),
  ];
  const [chosen, setChosen] = useState<Report | null>(null);
  const report = chosen && available.includes(chosen) ? chosen : available[0];
  if (!report) return null;

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Report" className="flex flex-wrap gap-2">
        {available.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={report === r}
            onClick={() => setChosen(r)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              report === r
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {LABEL[r]}
          </button>
        ))}
      </div>
      {report === 'trial' ? <TrialBalanceReport /> : null}
      {report === 'ageing' ? <AgeingReport /> : null}
      {report === 'ledger' ? <LedgerReport /> : null}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

function TrialBalanceReport() {
  const [asOf, setAsOf] = useState('');
  const query = useTrialBalance(asOf);
  return (
    <div className="space-y-4">
      <div className="w-44">
        <Field
          label="As of"
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          hint="Empty means today."
        />
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.rows.length === 0}
        emptyText="No accounts with a balance yet."
      >
        {(t) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Account</TableHead>
                  <TableHead className="px-4">Type</TableHead>
                  <TableHead className="px-4 text-right">Debit</TableHead>
                  <TableHead className="px-4 text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-4 py-2 font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="px-4 py-2">{r.name}</TableCell>
                    <TableCell className="px-4 py-2">{TYPE_LABEL[r.type]}</TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums">
                      {Number(r.debit) > 0 ? formatMoney(r.debit) : ''}
                    </TableCell>
                    <TableCell className="px-4 py-2 text-right tabular-nums">
                      {Number(r.credit) > 0 ? formatMoney(r.credit) : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="px-4 py-2 font-semibold">
                    Total as of {t.asOf}{' '}
                    <Badge variant={t.balanced ? 'success' : 'destructive'}>
                      {t.balanced ? 'Balanced' : 'Out of balance'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatMoney(t.totalDebit)}
                  </TableCell>
                  <TableCell className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatMoney(t.totalCredit)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function AgeingReport() {
  const [kind, setKind] = useState<InvoiceKind>('sales');
  const query = useAgeing(kind);
  return (
    <div className="space-y-4">
      <div className="w-60">
        <SelectField
          label="Report on"
          value={kind}
          onValueChange={(v) => setKind(v as InvoiceKind)}
          options={INVOICE_KINDS.map((k) => ({
            value: k,
            label: k === 'sales' ? 'Customers owe us' : 'We owe suppliers',
          }))}
        />
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.rows.length === 0}
        emptyText="Nothing outstanding."
      >
        {(a) => (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">{KIND_LABEL[kind].party}</TableHead>
                  <TableHead className="px-4 text-right">Not due</TableHead>
                  <TableHead className="px-4 text-right">1–30 days</TableHead>
                  <TableHead className="px-4 text-right">31–60</TableHead>
                  <TableHead className="px-4 text-right">61–90</TableHead>
                  <TableHead className="px-4 text-right">Over 90</TableHead>
                  <TableHead className="px-4 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.rows.map((r) => (
                  <TableRow key={r.partyId}>
                    <TableCell className="px-4 py-2 font-medium">{r.partyName}</TableCell>
                    {[r.current, r.days30, r.days60, r.days90, r.over90, r.total].map((v, i) => (
                      <TableCell key={i} className="px-4 py-2 text-right tabular-nums">
                        {Number(v) > 0 ? formatMoney(v) : '—'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="px-4 py-2 font-semibold">Total as of {a.asOf}</TableCell>
                  {[
                    a.totals.current,
                    a.totals.days30,
                    a.totals.days60,
                    a.totals.days90,
                    a.totals.over90,
                    a.totals.total,
                  ].map((v, i) => (
                    <TableCell key={i} className="px-4 py-2 text-right font-semibold tabular-nums">
                      {formatMoney(v)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function LedgerReport() {
  const accounts = useAccounts();
  const [filter, setFilter] = useState<LedgerFilter>({ accountId: '', from: '', to: '', page: 0 });
  const query = useLedger(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <SelectField
            label="Account"
            value={filter.accountId}
            onValueChange={(v) => setFilter({ ...filter, accountId: v, page: 0 })}
            options={(accounts.data ?? []).map((a) => ({
              value: a.id,
              label: `${a.code} — ${a.name}`,
            }))}
          />
        </div>
        <div className="w-40">
          <Field
            label="From"
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value, page: 0 })}
          />
        </div>
        <div className="w-40">
          <Field
            label="To"
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value, page: 0 })}
          />
        </div>
      </div>
      {filter.accountId === '' ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Choose an account to see its entries and running balance.
        </p>
      ) : (
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0 && Number(d.opening) === 0}
          emptyText="No entries for this account in that period."
        >
          {(l) => (
            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-2 text-sm">
                Opening balance: <span className="tabular-nums">{formatMoney(l.opening)}</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Date</TableHead>
                    <TableHead className="px-4">Entry</TableHead>
                    <TableHead className="px-4">Memo</TableHead>
                    <TableHead className="px-4 text-right">Debit</TableHead>
                    <TableHead className="px-4 text-right">Credit</TableHead>
                    <TableHead className="px-4 text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {l.items.map((r, i) => (
                    <TableRow key={`${r.entryId}-${i}`}>
                      <TableCell className="px-4 py-2">{r.entryDate}</TableCell>
                      <TableCell className="px-4 py-2 font-mono text-xs">
                        {r.number}{' '}
                        <span className="font-sans text-muted-foreground">
                          {SOURCE_LABEL[r.sourceType] ?? r.sourceType}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2">{r.memo}</TableCell>
                      <TableCell className="px-4 py-2 text-right tabular-nums">
                        {Number(r.debit) > 0 ? formatMoney(r.debit) : ''}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-right tabular-nums">
                        {Number(r.credit) > 0 ? formatMoney(r.credit) : ''}
                      </TableCell>
                      <TableCell className="px-4 py-2 text-right tabular-nums">
                        {formatMoney(r.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                page={filter.page}
                total={l.total}
                noun="entry"
                pageSize={PAGE_SIZE}
                onPage={(page) => setFilter({ ...filter, page })}
              />
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}
