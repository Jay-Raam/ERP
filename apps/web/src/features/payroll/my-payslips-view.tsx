'use client';

import { paiseToString, parsePaise } from '@erp/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryState } from '@/features/admin/async';
import { Pager } from '@/features/store/pager';
import { PAGE_SIZE, useMyPayslips, type MyPayslip } from './api';
import { STATUS_LABEL, STATUS_VARIANT, formatDays, formatMoney, monthName } from './format';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t pt-2 font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function MyPayslipsView() {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<MyPayslip | null>(null);
  const query = useMyPayslips(page);

  return (
    <div className="space-y-4">
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No payslips yet. They appear here once a month's payroll is approved."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Month</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4 text-right">Earned</TableHead>
                  <TableHead className="px-4 text-right">Deductions</TableHead>
                  <TableHead className="px-4 text-right">Net pay</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4 py-3 font-medium">
                      {monthName(p.periodStart.slice(0, 7))}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[p.runStatus]}>
                        {p.runStatus === 'paid' && p.paidOn
                          ? `Paid on ${p.paidOn}`
                          : STATUS_LABEL[p.runStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(p.earned)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(
                        paiseToString(parsePaise(p.deductions) + parsePaise(p.otherDeductions)),
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(p.netPay)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open payslip for ${monthName(p.periodStart.slice(0, 7))}`}
                        onClick={() => setOpen(p)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={page}
              total={data.total}
              noun="payslip"
              pageSize={PAGE_SIZE}
              onPage={setPage}
            />
          </div>
        )}
      </QueryState>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `Payslip: ${monthName(open.periodStart.slice(0, 7))}` : 'Payslip'}
        description={open ? `${open.employeeName} (${open.employeeCode})` : undefined}
      >
        {open ? (
          <div className="space-y-4 text-sm">
            <div className="space-y-1.5">
              <p className="font-medium">Salary for the month</p>
              <Row label="Basic" value={formatMoney(open.basic)} />
              <Row label="HRA" value={formatMoney(open.hra)} />
              <Row label="Allowance" value={formatMoney(open.allowance)} />
              <Row label="Full month gross" value={formatMoney(open.fullGross)} strong />
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">Days</p>
              <Row
                label="Paid days"
                value={`${formatDays(open.paidHalfDays)} of ${open.daysInPeriod}`}
              />
              <Row label="Present" value={String(open.presentDays)} />
              <Row label="Half days" value={String(open.halfDays)} />
              <Row label="Leave" value={String(open.leaveDays)} />
              <Row
                label="Weekly off and holidays"
                value={String(open.offDays + open.holidayDays)}
              />
              <Row label="Absent" value={String(open.absentDays)} />
            </div>
            <div className="space-y-1.5">
              <p className="font-medium">Pay</p>
              <Row label="Earned for the days paid" value={formatMoney(open.earned)} />
              {Number(open.bonus) > 0 ? (
                <Row label="Bonus" value={formatMoney(open.bonus)} />
              ) : null}
              <Row label="Deductions" value={`-${formatMoney(open.deductions)}`} />
              {Number(open.otherDeductions) > 0 ? (
                <Row label="Other deductions" value={`-${formatMoney(open.otherDeductions)}`} />
              ) : null}
              <Row label="Net pay" value={formatMoney(open.netPay)} strong />
            </div>
            {open.adjustmentNote ? (
              <p className="text-muted-foreground">Note: {open.adjustmentNote}</p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
