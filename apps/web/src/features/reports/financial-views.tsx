'use client';

import { financialYearStart } from '@erp/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryState } from '@/features/admin/async';
import { formatMoney, localToday } from '@/features/accounts/format';
import { STATUS_LABEL, STATUS_VARIANT } from '@/features/payroll/format';
import { useBalanceSheet, usePayrollSummary, useProfitAndLoss, type AccountLine } from './api';
import { AmountRow, DateRangeForm, Section, Stat } from './shared-bits';

function Lines({ rows, empty }: { rows: AccountLine[]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      {rows.map((r) => (
        <AmountRow
          key={r.code}
          label={
            <>
              <span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>
              {r.name}
            </>
          }
          value={formatMoney(r.amount)}
        />
      ))}
    </>
  );
}

export function ProfitAndLossView() {
  const today = localToday();
  const [range, setRange] = useState({ from: financialYearStart(today), to: today });
  const query = useProfitAndLoss(range);

  return (
    <div className="space-y-4">
      <DateRangeForm from={range.from} to={range.to} onApply={setRange} />
      <QueryState query={query} emptyText="No figures.">
        {(r) => (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Income" value={formatMoney(r.totalIncome)} />
              <Stat label="Expenses" value={formatMoney(r.totalExpenses)} />
              <Stat
                label={r.netProfit.startsWith('-') ? 'Loss' : 'Profit'}
                value={formatMoney(r.netProfit)}
                tone={r.netProfit.startsWith('-') ? 'bad' : 'good'}
              />
            </div>
            <Section title={`Income, ${r.from} to ${r.to}`}>
              <Lines rows={r.income} empty="No income in this period." />
              <AmountRow label="Total income" value={formatMoney(r.totalIncome)} strong />
            </Section>
            <Section title="Expenses">
              <Lines rows={r.expenses} empty="No expenses in this period." />
              <AmountRow label="Total expenses" value={formatMoney(r.totalExpenses)} strong />
            </Section>
            <AmountRow
              label={r.netProfit.startsWith('-') ? 'Net loss' : 'Net profit'}
              value={formatMoney(r.netProfit)}
              strong
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function BalanceSheetView() {
  const [asOf, setAsOf] = useState(localToday());
  const [typed, setTyped] = useState(asOf);
  const query = useBalanceSheet(asOf);

  return (
    <div className="space-y-4">
      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setAsOf(typed);
        }}
      >
        <div className="w-44">
          <Field
            label="As of"
            type="date"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <QueryState query={query} emptyText="No figures.">
        {(b) => (
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-sm">
              {b.balanced ? (
                <Badge variant="success">Balanced</Badge>
              ) : (
                <Badge variant="destructive">Does not balance</Badge>
              )}
              <span className="text-muted-foreground">As of {b.asOf}</span>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Assets">
                <Lines rows={b.assets} empty="No assets yet." />
                <AmountRow label="Total assets" value={formatMoney(b.totalAssets)} strong />
              </Section>
              <div className="space-y-5">
                <Section title="Liabilities">
                  <Lines rows={b.liabilities} empty="No liabilities." />
                  <AmountRow
                    label="Total liabilities"
                    value={formatMoney(b.totalLiabilities)}
                    strong
                  />
                </Section>
                <Section title="Equity">
                  <Lines rows={b.equity} empty="No equity entries." />
                  <AmountRow label="Profit to date" value={formatMoney(b.earnings)} muted />
                  <AmountRow label="Total equity" value={formatMoney(b.totalEquity)} strong />
                </Section>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function PayrollCostView() {
  const today = localToday();
  const [range, setRange] = useState({
    fromMonth: financialYearStart(today).slice(0, 7),
    toMonth: today.slice(0, 7),
  });
  const [f, setF] = useState(range.fromMonth);
  const [t, setT] = useState(range.toMonth);
  const query = usePayrollSummary(range);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ fromMonth: f, toMonth: t });
        }}
      >
        <div className="w-44">
          <Field label="From month" type="month" value={f} onChange={(e) => setF(e.target.value)} />
        </div>
        <div className="w-44">
          <Field label="To month" type="month" value={t} onChange={(e) => setT(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <QueryState query={query} emptyText="No figures.">
        {(p) => (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Gross pay" value={formatMoney(p.gross)} />
              <Stat label="Deductions" value={formatMoney(p.deductions)} />
              <Stat label="Net pay" value={formatMoney(p.net)} />
            </div>
            <Section title="By month">
              {p.runs.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No payroll in this period. Cancelled runs are left out.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">Month</TableHead>
                      <TableHead className="px-4">Status</TableHead>
                      <TableHead className="px-4 text-right">People</TableHead>
                      <TableHead className="px-4 text-right">Gross</TableHead>
                      <TableHead className="px-4 text-right">Deductions</TableHead>
                      <TableHead className="px-4 text-right">Net pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 py-3 font-medium">{r.label}</TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {r.employeeCount}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(r.gross)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(r.deductions)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(r.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>
            {p.byBranch.length > 0 ? (
              <Section title="By branch">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">Branch</TableHead>
                      <TableHead className="px-4 text-right">People</TableHead>
                      <TableHead className="px-4 text-right">Gross</TableHead>
                      <TableHead className="px-4 text-right">Deductions</TableHead>
                      <TableHead className="px-4 text-right">Net pay</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.byBranch.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="px-4 py-3 font-medium">{b.name}</TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {b.employees}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(b.gross)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(b.deductions)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(b.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Section>
            ) : null}
          </div>
        )}
      </QueryState>
    </div>
  );
}
