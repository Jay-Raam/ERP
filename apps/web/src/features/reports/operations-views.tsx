'use client';

import { financialYearStart } from '@erp/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney, localToday } from '@/features/accounts/format';
import { QueryState } from '@/features/admin/async';
import { formatDays } from '@/features/payroll/format';
import { formatQty } from '@/features/store/format';
import { Pager } from '@/features/store/pager';
import {
  PAGE_SIZE,
  useAttendanceSummary,
  useInvoiceSummary,
  useStockReport,
  type AttendanceFilter,
  type StockFilter,
} from './api';
import { DateRangeForm, Section, Stat } from './shared-bits';

const th = 'px-4';
const td = 'px-4 py-3';
const num = `${td} text-right tabular-nums`;

export function SummaryView({ kind }: { kind: 'sales' | 'purchase' }) {
  const today = localToday();
  const [range, setRange] = useState({ from: financialYearStart(today), to: today });
  const query = useInvoiceSummary(kind, range);
  const sales = kind === 'sales';

  return (
    <div className="space-y-4">
      <DateRangeForm from={range.from} to={range.to} onApply={setRange} />
      <QueryState query={query} emptyText="No figures.">
        {(s) => (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Posted {sales ? 'invoices' : 'bills'} from {s.from} to {s.to}. Drafts and cancelled
              ones are left out.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label={sales ? 'Invoices' : 'Bills'} value={String(s.count)} />
              <Stat label="Before tax" value={formatMoney(s.subtotal)} />
              <Stat label="GST" value={formatMoney(s.taxTotal)} />
              <Stat label="Total" value={formatMoney(s.grandTotal)} />
              <Stat
                label={sales ? 'Still to receive' : 'Still to pay'}
                value={formatMoney(s.outstanding)}
                tone={Number(s.outstanding) > 0 ? 'bad' : undefined}
              />
            </div>

            <Section title="By month">
              {s.byMonth.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nothing in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={th}>Month</TableHead>
                      <TableHead className={`${th} text-right`}>
                        {sales ? 'Invoices' : 'Bills'}
                      </TableHead>
                      <TableHead className={`${th} text-right`}>Before tax</TableHead>
                      <TableHead className={`${th} text-right`}>GST</TableHead>
                      <TableHead className={`${th} text-right`}>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.byMonth.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className={`${td} font-medium`}>{m.month}</TableCell>
                        <TableCell className={num}>{m.count}</TableCell>
                        <TableCell className={num}>{formatMoney(m.subtotal)}</TableCell>
                        <TableCell className={num}>{formatMoney(m.taxTotal)}</TableCell>
                        <TableCell className={num}>{formatMoney(m.grandTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Section title={sales ? 'Top customers' : 'Top suppliers'}>
                {s.byParty.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Nothing in this period.</p>
                ) : (
                  <Table>
                    <TableBody>
                      {s.byParty.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className={`${td} font-medium`}>{p.name}</TableCell>
                          <TableCell className={num}>{p.count}</TableCell>
                          <TableCell className={num}>{formatMoney(p.grandTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>
              <Section title="Top items">
                {s.byItem.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">Nothing in this period.</p>
                ) : (
                  <Table>
                    <TableBody>
                      {s.byItem.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className={td}>
                            <div className="font-medium">{i.name}</div>
                            <div className="font-mono text-xs text-muted-foreground">{i.sku}</div>
                          </TableCell>
                          <TableCell className={num}>
                            {formatQty(i.quantity)} {i.unit}
                          </TableCell>
                          <TableCell className={num}>{formatMoney(i.subtotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function StockView() {
  const [filter, setFilter] = useState<StockFilter>({ search: '', lowOnly: false, page: 0 });
  const [typed, setTyped] = useState('');
  const query = useStockReport(filter);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, search: typed.trim(), page: 0 });
        }}
      >
        <div className="w-60">
          <Field
            label="Search"
            placeholder="Item name or SKU"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={80}
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="low-only"
            checked={filter.lowOnly}
            onCheckedChange={(v) => setFilter({ ...filter, lowOnly: v === true, page: 0 })}
          />
          <Label htmlFor="low-only">Only low stock</Label>
        </div>
      </form>
      <QueryState query={query} isEmpty={(d) => d.items.length === 0} emptyText="No stock to show.">
        {(r) => (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Stock value" value={formatMoney(r.totalValue)} />
              <Stat
                label="Low stock items"
                value={String(r.lowCount)}
                tone={r.lowCount > 0 ? 'bad' : undefined}
              />
              <Stat label="Items with no purchase price" value={String(r.unpriced)} />
            </div>
            <p className="text-sm text-muted-foreground">
              Valued at the average price paid on purchase orders, as of {r.asOf}. Items that were
              never bought have no price, so they add nothing to the value.
            </p>
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={th}>Item</TableHead>
                    <TableHead className={`${th} text-right`}>On hand</TableHead>
                    <TableHead className={`${th} text-right`}>Reorder at</TableHead>
                    <TableHead className={`${th} text-right`}>Average cost</TableHead>
                    <TableHead className={`${th} text-right`}>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className={td}>
                        <div className="font-medium">
                          {i.name} {i.low ? <Badge variant="destructive">Low</Badge> : null}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{i.sku}</div>
                      </TableCell>
                      <TableCell className={num}>
                        {formatQty(i.quantity)} {i.unit}
                      </TableCell>
                      <TableCell className={num}>
                        {Number(i.reorderLevel) > 0 ? formatQty(i.reorderLevel) : '—'}
                      </TableCell>
                      <TableCell className={num}>
                        {i.averageCost ? formatMoney(i.averageCost) : '—'}
                      </TableCell>
                      <TableCell className={num}>{i.value ? formatMoney(i.value) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                page={filter.page}
                total={r.total}
                noun="item"
                pageSize={PAGE_SIZE}
                onPage={(page) => setFilter({ ...filter, page })}
              />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

export function AttendanceReportView() {
  const [filter, setFilter] = useState<AttendanceFilter>({
    month: localToday().slice(0, 7),
    search: '',
    page: 0,
  });
  const [month, setMonth] = useState(filter.month);
  const [typed, setTyped] = useState('');
  const query = useAttendanceSummary(filter);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ month, search: typed.trim(), page: 0 });
        }}
      >
        <div className="w-44">
          <Field
            label="Month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <div className="w-60">
          <Field
            label="Search"
            placeholder="Name or code"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={80}
          />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No employees found."
      >
        {(r) => (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {r.label}. Paid days are counted the way payroll pays them: present, leave, weekly off
              and holidays in full, half days as half.
            </p>
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={th}>Employee</TableHead>
                    <TableHead className={`${th} text-right`}>Present</TableHead>
                    <TableHead className={`${th} text-right`}>Half</TableHead>
                    <TableHead className={`${th} text-right`}>Leave</TableHead>
                    <TableHead className={`${th} text-right`}>Off / holiday</TableHead>
                    <TableHead className={`${th} text-right`}>Absent</TableHead>
                    <TableHead className={`${th} text-right`}>Unclear</TableHead>
                    <TableHead className={`${th} text-right`}>Paid days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((e) => (
                    <TableRow key={e.employeeId}>
                      <TableCell className={td}>
                        <div className="font-medium">{e.employeeName}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{e.employeeCode}</span> · {e.branch.name}
                        </div>
                      </TableCell>
                      <TableCell className={num}>{e.presentDays}</TableCell>
                      <TableCell className={num}>{e.halfDays}</TableCell>
                      <TableCell className={num}>{e.leaveDays}</TableCell>
                      <TableCell className={num}>{e.offDays + e.holidayDays}</TableCell>
                      <TableCell className={num}>{e.absentDays}</TableCell>
                      <TableCell className={num} title="Short days and punches never closed">
                        {e.shortDays + e.incompleteDays}
                      </TableCell>
                      <TableCell className={`${num} font-medium`}>
                        {formatDays(e.paidHalfDays)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pager
                page={filter.page}
                total={r.total}
                noun="employee"
                pageSize={PAGE_SIZE}
                onPage={(page) => setFilter({ ...filter, page })}
              />
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
