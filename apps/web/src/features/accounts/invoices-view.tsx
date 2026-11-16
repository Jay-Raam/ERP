'use client';

import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  invoiceFormSchema,
  recordPaymentInputSchema,
  type InvoiceKind,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
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
import { FormActions } from '@/features/admin/branches-page';
import { usePermission } from '@/features/auth/viewer';
import { formatQty } from '@/features/store/format';
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import {
  PAGE_SIZE,
  useCancelInvoice,
  useInvoice,
  useInvoices,
  usePostInvoice,
  useRecordPayment,
  useUpdateInvoice,
  useVoidPayment,
  type InvoiceDetail,
  type InvoiceFilter,
  type PaymentRow,
} from './api';
import {
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_VARIANT,
  KIND_LABEL,
  METHOD_LABEL,
  formatMoney,
  isOverdue,
  localToday,
} from './format';
import { ReasonModal } from './reason-form';

const NONE = '__none__';

export function InvoiceStatusPill({
  invoice,
}: {
  invoice: { status: keyof typeof INVOICE_STATUS_LABEL; dueDate: string; outstanding: string };
}) {
  return (
    <span className="inline-flex gap-1.5">
      <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
        {INVOICE_STATUS_LABEL[invoice.status]}
      </Badge>
      {isOverdue(invoice) ? <Badge variant="destructive">Overdue</Badge> : null}
    </span>
  );
}

// -------------------------------------------------------------------- list

export function InvoicesView({ kind }: { kind: InvoiceKind }) {
  const copy = KIND_LABEL[kind];
  const [filter, setFilter] = useState<InvoiceFilter>({
    kind,
    search: '',
    status: '',
    outstandingOnly: false,
    page: 0,
  });
  const [typed, setTyped] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useInvoices(filter);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, search: typed.trim(), page: 0 });
        }}
      >
        <div className="w-56">
          <Field
            label="Search"
            placeholder={`${copy.one[0]!.toUpperCase()}${copy.one.slice(1)} number`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="w-44">
          <SelectField
            label="Status"
            value={filter.status || NONE}
            onValueChange={(v) =>
              setFilter({
                ...filter,
                status: v === NONE ? '' : (v as InvoiceFilter['status']),
                page: 0,
              })
            }
            options={[
              { value: NONE, label: 'All' },
              ...INVOICE_STATUSES.map((s) => ({ value: s, label: INVOICE_STATUS_LABEL[s] })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id={`outstanding-${kind}`}
            checked={filter.outstandingOnly}
            onCheckedChange={(v) => setFilter({ ...filter, outstandingOnly: v === true, page: 0 })}
          />
          <Label htmlFor={`outstanding-${kind}`}>Unpaid only</Label>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {copy.many} are created from a {kind === 'sales' ? 'delivery' : 'goods receipt'}: open the
        {kind === 'sales' ? ' sales order' : ' purchase order'} and choose “Create {copy.one}”.
      </p>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText={`No ${copy.many.toLowerCase()} found.`}
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Number</TableHead>
                  <TableHead className="px-4">{copy.party}</TableHead>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">Due</TableHead>
                  <TableHead className="px-4 text-right">Total</TableHead>
                  <TableHead className="px-4 text-right">Balance</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{i.number}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{i.party.name}</TableCell>
                    <TableCell className="px-4 py-3">{i.invoiceDate}</TableCell>
                    <TableCell className="px-4 py-3">{i.dueDate}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(i.grandTotal)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {i.status === 'posted' ? formatMoney(i.outstanding) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <InvoiceStatusPill invoice={i} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open ${i.number}`}
                        onClick={() => setOpenId(i.id)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={filter.page}
              total={data.total}
              noun={copy.one}
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

// ------------------------------------------------------------------ detail

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Also opened from the payments list, so it takes just an id. */
export function InvoiceModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useInvoice(id);
  const canCreate = usePermission('accounts.invoice.create');
  const canPost = usePermission('accounts.invoice.post');
  const canCancel = usePermission('accounts.invoice.cancel');
  const canPay = usePermission('accounts.payment.create');
  const canVoid = usePermission('accounts.payment.void');
  const post = usePostInvoice();
  const cancel = useCancelInvoice();
  const voidPayment = useVoidPayment();
  const [sub, setSub] = useState<'edit' | 'pay' | 'cancel' | null>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);

  const invoice = query.data;
  const word = invoice ? KIND_LABEL[invoice.kind].one : 'invoice';

  const doPost = async (i: InvoiceDetail) => {
    try {
      await post.mutateAsync({ id: i.id, version: i.version });
      toast.success(`${word[0]!.toUpperCase()}${word.slice(1)} posted to the ledger`);
    } catch (error) {
      handleApiError(error);
    }
  };

  return (
    <Modal
      size="lg"
      open={id !== null}
      onClose={() => {
        setSub(null);
        setVoiding(null);
        onClose();
      }}
      title={invoice ? `${invoice.number}` : 'Invoice'}
      description={invoice ? `${KIND_LABEL[invoice.kind].party}: ${invoice.party.name}` : undefined}
    >
      <QueryState query={query} emptyText="Not found.">
        {(i) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <InvoiceStatusPill invoice={i} />
              <span className="text-muted-foreground">
                {i.branch.name} · from {i.sourceNumber} · {i.invoiceDate}, due {i.dueDate}
              </span>
            </div>
            {i.reference ? <p className="text-sm">Reference: {i.reference}</p> : null}
            {i.notes ? <p className="text-sm text-muted-foreground">{i.notes}</p> : null}
            {i.status === 'cancelled' ? (
              <p className="rounded-md bg-muted/50 p-3 text-sm">
                Cancelled{i.cancelReason ? `: ${i.cancelReason}` : ''}
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Item</TableHead>
                    <TableHead className="px-3 text-right">Qty</TableHead>
                    <TableHead className="px-3 text-right">Price</TableHead>
                    <TableHead className="px-3 text-right">GST</TableHead>
                    <TableHead className="px-3 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {i.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="px-3 py-2">
                        {l.item.name}
                        <span className="ml-1 font-mono text-xs text-muted-foreground">
                          {l.item.sku}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {formatQty(l.quantity)} {l.item.unit}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(l.unitPrice)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right">{l.gstRate}%</TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(l.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <Row label="Subtotal" value={formatMoney(i.subtotal)} />
              <Row label="GST" value={formatMoney(i.taxTotal)} />
              <Row label="Total" value={formatMoney(i.grandTotal)} strong />
              {i.status === 'posted' ? (
                <>
                  <Row label="Paid" value={formatMoney(i.paidAmount)} />
                  <Row label="Balance due" value={formatMoney(i.outstanding)} strong />
                </>
              ) : null}
            </div>

            {i.payments.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Payments</p>
                {i.payments.map((p) => (
                  <div key={p.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-mono text-xs">{p.number}</span>{' '}
                        <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>{' '}
                        {p.voidedAt ? <Badge variant="destructive">Voided</Badge> : null}
                      </span>
                      <span className="text-muted-foreground">
                        {p.paidOn} ·{' '}
                        {METHOD_LABEL[p.method as keyof typeof METHOD_LABEL] ?? p.method}
                        {p.reference ? ` · ${p.reference}` : ''} · {p.createdByName}
                      </span>
                    </div>
                    {p.voidedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Voided by {p.voidedByName}: {p.voidReason}
                      </p>
                    ) : canVoid ? (
                      <div className="mt-2 flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => setVoiding(p)}>
                          Void payment
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              {i.status === 'draft' && canCreate ? (
                <Button variant="outline" onClick={() => setSub('edit')}>
                  Edit
                </Button>
              ) : null}
              {i.status === 'draft' && canPost ? (
                <Button disabled={post.isPending} onClick={() => void doPost(i)}>
                  Post {word}
                </Button>
              ) : null}
              {i.status !== 'cancelled' && canCancel && Number(i.paidAmount) === 0 ? (
                <Button variant="outline" onClick={() => setSub('cancel')}>
                  Cancel {word}
                </Button>
              ) : null}
              {i.status === 'posted' && Number(i.paidAmount) > 0 && canCancel ? (
                <span className="self-center text-xs text-muted-foreground">
                  Void the payments before cancelling.
                </span>
              ) : null}
              {i.status === 'posted' && Number(i.outstanding) > 0 && canPay ? (
                <Button onClick={() => setSub('pay')}>
                  {i.kind === 'sales' ? 'Record receipt' : 'Record payment'}
                </Button>
              ) : null}
            </div>

            <Modal open={sub === 'edit'} onClose={() => setSub(null)} title={`Edit ${i.number}`}>
              {sub === 'edit' ? <EditForm invoice={i} onDone={() => setSub(null)} /> : null}
            </Modal>
            <Modal
              open={sub === 'pay'}
              onClose={() => setSub(null)}
              title={i.kind === 'sales' ? `Record receipt for ${i.number}` : `Pay ${i.number}`}
              description={`Balance due ${formatMoney(i.outstanding)}`}
            >
              {sub === 'pay' ? <PaymentForm invoice={i} onDone={() => setSub(null)} /> : null}
            </Modal>
            <ReasonModal
              open={sub === 'cancel'}
              title={`Cancel ${i.number}`}
              description="This reverses its ledger entry. It cannot be undone."
              submit={`Cancel ${word}`}
              pending={cancel.isPending}
              onClose={() => setSub(null)}
              onConfirm={async (reason) => {
                try {
                  await cancel.mutateAsync({ id: i.id, version: i.version, reason });
                  toast.success(`${word[0]!.toUpperCase()}${word.slice(1)} cancelled`);
                  setSub(null);
                } catch (error) {
                  handleApiError(error);
                }
              }}
            />
            <ReasonModal
              open={voiding !== null}
              title={voiding ? `Void ${voiding.number}` : 'Void payment'}
              description="The payment stays on record as voided and its ledger entry is reversed."
              submit="Void payment"
              pending={voidPayment.isPending}
              onClose={() => setVoiding(null)}
              onConfirm={async (reason) => {
                if (!voiding) return;
                try {
                  await voidPayment.mutateAsync({ id: voiding.id, reason });
                  toast.success('Payment voided');
                  setVoiding(null);
                } catch (error) {
                  handleApiError(error);
                }
              }}
            />
          </div>
        )}
      </QueryState>
    </Modal>
  );
}

// -------------------------------------------------------------------- edit

type EditIn = z.input<typeof invoiceFormSchema>;

function EditForm({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => void }) {
  const update = useUpdateInvoice();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditIn>({
    resolver: zodResolver(invoiceFormSchema) as Resolver<EditIn>,
    defaultValues: {
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      reference: invoice.reference ?? '',
      notes: invoice.notes ?? '',
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        id: invoice.id,
        input: {
          invoiceDate: values.invoiceDate,
          dueDate: values.dueDate || null,
          reference: values.reference || null,
          notes: values.notes || null,
          version: invoice.version,
        },
      });
      toast.success('Saved');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['invoiceDate', 'dueDate', 'reference', 'notes'],
      });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Date"
          type="date"
          error={errors.invoiceDate?.message}
          {...register('invoiceDate')}
        />
        <Field
          label="Due on"
          type="date"
          error={errors.dueDate?.message}
          {...register('dueDate')}
        />
      </div>
      <Field
        label="Reference"
        maxLength={40}
        error={errors.reference?.message}
        {...register('reference')}
      />
      <Field label="Notes" maxLength={300} error={errors.notes?.message} {...register('notes')} />
      <p className="text-xs text-muted-foreground">
        Amounts cannot be edited: they come from the order and the delivered quantities.
      </p>
      <FormActions pending={update.isPending} onCancel={onDone} submit="Save changes" />
    </form>
  );
}

// ----------------------------------------------------------------- payment

type PayIn = z.input<typeof recordPaymentInputSchema>;

function PaymentForm({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => void }) {
  const record = useRecordPayment();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PayIn>({
    resolver: zodResolver(recordPaymentInputSchema) as Resolver<PayIn>,
    defaultValues: {
      invoiceId: invoice.id,
      amount: invoice.outstanding,
      method: 'bank',
      paidOn: localToday(),
      reference: '',
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await record.mutateAsync({ ...values, reference: values.reference || null });
      toast.success(invoice.kind === 'sales' ? 'Receipt recorded' : 'Payment recorded');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['amount', 'method', 'paidOn', 'reference'],
      });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Amount (₹)"
          inputMode="decimal"
          error={errors.amount?.message}
          {...register('amount')}
        />
        <Field label="Paid on" type="date" error={errors.paidOn?.message} {...register('paidOn')} />
        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <SelectField
              label="Method"
              value={field.value}
              onValueChange={field.onChange}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
              error={errors.method?.message}
            />
          )}
        />
        <Field
          label="Reference"
          hint="Cheque number, UPI ref, …"
          maxLength={40}
          error={errors.reference?.message}
          {...register('reference')}
        />
      </div>
      <FormActions
        pending={record.isPending}
        onCancel={onDone}
        submit={invoice.kind === 'sales' ? 'Record receipt' : 'Record payment'}
      />
    </form>
  );
}
