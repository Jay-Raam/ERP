'use client';

import { INVOICE_KINDS } from '@erp/shared';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select-field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { QueryState } from '@/features/admin/async';
import { usePermission } from '@/features/auth/viewer';
import { Pager } from '@/features/store/pager';
import { PAGE_SIZE, usePayments, type PaymentFilter } from './api';
import { METHOD_LABEL, formatMoney } from './format';
import { InvoiceModal } from './invoices-view';

const NONE = '__none__';

export function PaymentsView() {
  const canInvoices = usePermission('accounts.invoice.view');
  const [filter, setFilter] = useState<PaymentFilter>({ kind: '', page: 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const query = usePayments(filter);

  return (
    <div className="space-y-4">
      <div className="w-52">
        <SelectField
          label="Show"
          value={filter.kind || NONE}
          onValueChange={(v) =>
            setFilter({ kind: v === NONE ? '' : (v as PaymentFilter['kind']), page: 0 })
          }
          options={[
            { value: NONE, label: 'All payments' },
            ...INVOICE_KINDS.map((k) => ({
              value: k,
              label: k === 'sales' ? 'Receipts from customers' : 'Payments to suppliers',
            })),
          ]}
        />
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No payments recorded yet."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Number</TableHead>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">Party</TableHead>
                  <TableHead className="px-4">Against</TableHead>
                  <TableHead className="px-4">Method</TableHead>
                  <TableHead className="px-4 text-right">Amount</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{p.number}</TableCell>
                    <TableCell className="px-4 py-3">{p.paidOn}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">
                      {p.partyName}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        {p.kind === 'sales' ? 'received' : 'paid'}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 font-mono text-xs">
                      {p.invoice.number}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      {METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(p.amount)}{' '}
                      {p.voidedAt ? <Badge variant="destructive">Voided</Badge> : null}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canInvoices ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Open ${p.invoice.number}`}
                          onClick={() => setOpenId(p.invoice.id)}
                        >
                          Open {p.kind === 'sales' ? 'invoice' : 'bill'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={filter.page}
              total={data.total}
              noun="payment"
              pageSize={PAGE_SIZE}
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>
      <InvoiceModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
