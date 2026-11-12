'use client';

import { GST_RATES, ORDER_STATUSES, orderFormSchema, receiveGoodsInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
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
import { useBranches } from '@/features/admin/api';
import { QueryState } from '@/features/admin/async';
import { FormActions } from '@/features/admin/branches-page';
import { usePermission, useViewer } from '@/features/auth/viewer';
import { useItemOptions, useWarehouses } from '@/features/store/api';
import { formatQty } from '@/features/store/format';
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import {
  PAGE_SIZE,
  useDecideOrder,
  useOrder,
  useOrders,
  useReceiveGoods,
  useSaveOrder,
  useSupplierOptions,
  type OrderDetail,
  type OrderFilter,
} from './api';
import { formatMoney, previewOrder, remainingQty, STATUS_LABEL, STATUS_VARIANT } from './format';

const NONE = '__none__';
const today = () => new Date().toISOString().slice(0, 10);

function StatusPill({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

// -------------------------------------------------------------------- list

export function OrdersView() {
  const canCreate = usePermission('purchase.order.create');
  const [filter, setFilter] = useState<OrderFilter>({ search: '', status: '', page: 0 });
  const [typed, setTyped] = useState('');
  const [form, setForm] = useState<OrderDetail | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useOrders(filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
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
              placeholder="Order number"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="w-48">
            <SelectField
              label="Status"
              value={filter.status || NONE}
              onValueChange={(v) =>
                setFilter({
                  ...filter,
                  status: v === NONE ? '' : (v as OrderFilter['status']),
                  page: 0,
                })
              }
              options={[
                { value: NONE, label: 'All' },
                ...ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              ]}
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {canCreate ? (
          <Button className="ml-auto" onClick={() => setForm('new')}>
            <Plus className="size-4" aria-hidden /> New order
          </Button>
        ) : null}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No purchase orders found."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Number</TableHead>
                  <TableHead className="px-4">Supplier</TableHead>
                  <TableHead className="px-4">Branch</TableHead>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4 text-right">Total</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{o.number}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{o.supplier.name}</TableCell>
                    <TableCell className="px-4 py-3">{o.branch.name}</TableCell>
                    <TableCell className="px-4 py-3">{o.orderDate}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(o.grandTotal)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusPill status={o.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open ${o.number}`}
                        onClick={() => setOpenId(o.id)}
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
              noun="order"
              pageSize={PAGE_SIZE}
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>

      <Modal
        size="lg"
        open={form !== null}
        onClose={() => setForm(null)}
        title={form === 'new' ? 'New purchase order' : 'Edit purchase order'}
      >
        {form ? (
          <OrderForm order={form === 'new' ? null : form} onDone={() => setForm(null)} />
        ) : null}
      </Modal>
      <DetailModal
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={(o) => {
          setOpenId(null);
          setForm(o);
        }}
      />
    </div>
  );
}

// -------------------------------------------------------------- order form

type OrderIn = z.input<typeof orderFormSchema>;

function useBranchOptions() {
  const viewer = useViewer();
  const canList = usePermission('branch.branch.view');
  const query = useBranches(canList);
  const source = canList && query.data ? query.data : viewer.branches;
  return source
    .filter((b) => !('status' in b) || (b as { status: string }).status === 'active')
    .map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));
}

function OrderForm({ order, onDone }: { order: OrderDetail | null; onDone: () => void }) {
  const save = useSaveOrder();
  const branches = useBranchOptions();
  const suppliers = useSupplierOptions();
  const items = useItemOptions();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<OrderIn>({
    resolver: zodResolver(orderFormSchema) as Resolver<OrderIn>,
    defaultValues: order
      ? {
          supplierId: order.supplier.id,
          orderDate: order.orderDate,
          expectedDate: order.expectedDate ?? '',
          notes: order.notes ?? '',
          lines: order.lines.map((l) => ({
            itemId: l.item.id,
            quantity: formatQty(l.quantity),
            unitPrice: l.unitPrice,
            gstRate: l.gstRate,
          })),
        }
      : {
          branchId: branches[0]?.value ?? '',
          supplierId: '',
          orderDate: today(),
          expectedDate: '',
          notes: '',
          lines: [{ itemId: '', quantity: '1', unitPrice: '', gstRate: 18 }],
        },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const watched = useWatch({ control, name: 'lines' }) ?? [];
  const preview = previewOrder(
    watched.map((l) => ({
      quantity: String(l?.quantity ?? ''),
      unitPrice: String(l?.unitPrice ?? ''),
      gstRate: l?.gstRate ?? 0,
    })),
  );

  const onSubmit = handleSubmit(async (values) => {
    try {
      const base = {
        supplierId: values.supplierId,
        orderDate: values.orderDate,
        expectedDate: values.expectedDate || null,
        notes: values.notes || null,
        lines: values.lines,
      };
      await save.mutateAsync(
        order
          ? { id: order.id, input: { ...base, version: order.version } }
          : { input: { ...base, branchId: values.branchId } },
      );
      toast.success(order ? 'Order updated' : 'Order saved as draft');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['branchId', 'supplierId', 'orderDate', 'expectedDate', 'notes', 'lines'],
      });
    }
  });

  const itemOptions = (items.data ?? []).map((i) => ({
    value: i.id,
    label: `${i.sku} — ${i.name}`,
  }));
  const linesError =
    (errors.lines as { message?: string; root?: { message?: string } } | undefined)?.message ??
    (errors.lines as { root?: { message?: string } } | undefined)?.root?.message;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {order ? null : (
          <Controller
            control={control}
            name="branchId"
            render={({ field }) => (
              <SelectField
                label="Branch"
                value={field.value ?? ''}
                onValueChange={field.onChange}
                options={branches}
                error={errors.branchId?.message}
              />
            )}
          />
        )}
        <Controller
          control={control}
          name="supplierId"
          render={({ field }) => (
            <SelectField
              label="Supplier"
              value={field.value}
              onValueChange={field.onChange}
              options={(suppliers.data ?? []).map((s) => ({
                value: s.id,
                label: `${s.name} (${s.code})`,
              }))}
              error={errors.supplierId?.message}
            />
          )}
        />
        <Field
          label="Order date"
          type="date"
          error={errors.orderDate?.message}
          {...register('orderDate')}
        />
        <Field
          label="Expected on"
          type="date"
          error={errors.expectedDate?.message}
          {...register('expectedDate')}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Lines</p>
        {fields.map((f, index) => {
          const lineErrors = errors.lines?.[index];
          return (
            <div
              key={f.id}
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-start"
            >
              <Controller
                control={control}
                name={`lines.${index}.itemId`}
                render={({ field }) => (
                  <SelectField
                    label="Item"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={itemOptions}
                    error={lineErrors?.itemId?.message}
                  />
                )}
              />
              <Field
                label="Quantity"
                inputMode="decimal"
                error={lineErrors?.quantity?.message}
                {...register(`lines.${index}.quantity`)}
              />
              <Field
                label="Unit price"
                inputMode="decimal"
                error={lineErrors?.unitPrice?.message}
                {...register(`lines.${index}.unitPrice`)}
              />
              <Controller
                control={control}
                name={`lines.${index}.gstRate`}
                render={({ field }) => (
                  <SelectField
                    label="GST"
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                    options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
                    error={lineErrors?.gstRate?.message}
                  />
                )}
              />
              <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end sm:pt-6">
                <span className="text-sm tabular-nums" aria-label={`Line ${index + 1} total`}>
                  {preview.lineTotals[index] ? formatMoney(preview.lineTotals[index]!) : '—'}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
        {linesError ? (
          <p role="alert" className="text-sm text-destructive">
            {linesError}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={fields.length >= 100}
          onClick={() => append({ itemId: '', quantity: '1', unitPrice: '', gstRate: 18 })}
        >
          <Plus className="size-4" aria-hidden /> Add line
        </Button>
      </div>

      <Field label="Notes" error={errors.notes?.message} {...register('notes')} />

      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <Row label="Subtotal" value={formatMoney(preview.subtotal)} />
        <Row label="GST" value={formatMoney(preview.tax)} />
        <Row label="Total" value={formatMoney(preview.total)} strong />
        <p className="pt-1 text-xs text-muted-foreground">
          This is a preview. The server works out the final amounts when you save.
        </p>
      </div>

      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={order ? 'Save changes' : 'Save draft'}
      />
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ detail

function DetailModal({
  id,
  onClose,
  onEdit,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (order: OrderDetail) => void;
}) {
  const query = useOrder(id);
  const viewer = useViewer();
  const canApprove = usePermission('purchase.order.approve');
  const canCancel = usePermission('purchase.order.cancel');
  const canCreate = usePermission('purchase.order.create');
  const canReceive = usePermission('purchase.receipt.create');
  const decide = useDecideOrder();
  const [receiving, setReceiving] = useState(false);

  const act = async (order: OrderDetail, decision: 'approve' | 'cancel') => {
    try {
      await decide.mutateAsync({ id: order.id, version: order.version, decision });
      toast.success(decision === 'approve' ? 'Order approved' : 'Order cancelled');
    } catch (error) {
      handleApiError(error);
    }
  };

  const order = query.data;
  return (
    <Modal
      size="lg"
      open={id !== null}
      onClose={() => {
        setReceiving(false);
        onClose();
      }}
      title={order ? `Purchase order ${order.number}` : 'Purchase order'}
    >
      <QueryState query={query} isEmpty={() => false} emptyText="">
        {(o) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <StatusPill status={o.status} />
              <span>{o.supplier.name}</span>
              <span className="text-muted-foreground">
                {o.branch.name} · {o.orderDate}
                {o.expectedDate ? ` · expected ${o.expectedDate}` : ''}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Created by {o.createdByName}
              {o.approvedByName ? ` · approved by ${o.approvedByName}` : ''}
            </p>
            {o.notes ? <p className="text-sm">{o.notes}</p> : null}

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Item</TableHead>
                    <TableHead className="px-3 text-right">Qty</TableHead>
                    <TableHead className="px-3 text-right">Received</TableHead>
                    <TableHead className="px-3 text-right">Price</TableHead>
                    <TableHead className="px-3 text-right">GST</TableHead>
                    <TableHead className="px-3 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {o.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="px-3 py-2">
                        {l.item.name}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {l.item.sku}
                        </span>
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {formatQty(l.quantity)} {l.item.unit}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {formatQty(l.receivedQuantity)}
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
              <Row label="Subtotal" value={formatMoney(o.subtotal)} />
              <Row label="GST" value={formatMoney(o.taxTotal)} />
              <Row label="Total" value={formatMoney(o.grandTotal)} strong />
            </div>

            {o.receipts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Goods received</p>
                {o.receipts.map((r) => (
                  <div key={r.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-mono text-xs">{r.number}</span>
                      <span className="text-muted-foreground">
                        {r.warehouse.name} · {r.receivedByName}
                        {r.supplierInvoiceNo ? ` · invoice ${r.supplierInvoiceNo}` : ''}
                      </span>
                    </div>
                    <ul className="mt-1 list-disc pl-5">
                      {r.lines.map((l, i) => (
                        <li key={i}>
                          {l.item.name}: {formatQty(l.quantity)} {l.item.unit}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              {o.status === 'draft' && canCreate ? (
                <Button variant="outline" onClick={() => onEdit(o)}>
                  Edit
                </Button>
              ) : null}
              {o.status === 'draft' && canApprove && o.createdById !== viewer.user.id ? (
                <Button disabled={decide.isPending} onClick={() => act(o, 'approve')}>
                  Approve
                </Button>
              ) : null}
              {o.status === 'draft' && canApprove && o.createdById === viewer.user.id ? (
                <span className="self-center text-xs text-muted-foreground">
                  Someone else must approve this order.
                </span>
              ) : null}
              {(o.status === 'draft' || o.status === 'approved') && canCancel ? (
                <Button
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => act(o, 'cancel')}
                >
                  Cancel order
                </Button>
              ) : null}
              {(o.status === 'approved' || o.status === 'partly_received') && canReceive ? (
                <Button onClick={() => setReceiving(true)}>Receive goods</Button>
              ) : null}
            </div>

            <Modal
              open={receiving}
              onClose={() => setReceiving(false)}
              title={`Receive goods for ${o.number}`}
            >
              {receiving ? <ReceiveForm order={o} onDone={() => setReceiving(false)} /> : null}
            </Modal>
          </div>
        )}
      </QueryState>
    </Modal>
  );
}

// ----------------------------------------------------------------- receive

interface ReceiveIn {
  warehouseId: string;
  supplierInvoiceNo: string;
  notes: string;
  quantities: Record<string, string>;
}

function ReceiveForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const receive = useReceiveGoods();
  const warehouses = useWarehouses();
  const open = order.lines.filter((l) => remainingQty(l.quantity, l.receivedQuantity) !== '0.000');
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ReceiveIn>({
    defaultValues: { warehouseId: '', supplierInvoiceNo: '', notes: '', quantities: {} },
  });

  const onSubmit = handleSubmit(async (values) => {
    const lines = open
      .map((l) => ({ orderLineId: l.id, quantity: (values.quantities[l.id] ?? '').trim() }))
      .filter((l) => l.quantity !== '' && Number(l.quantity) !== 0);
    const parsed = receiveGoodsInputSchema.safeParse({
      orderId: order.id,
      warehouseId: values.warehouseId,
      supplierInvoiceNo: values.supplierInvoiceNo,
      notes: values.notes,
      lines,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const path = String(issue.path[0] ?? '');
      if (path === 'warehouseId') setError('warehouseId', { message: 'Choose a warehouse' });
      else if (path === 'lines' && issue.path.length >= 3) {
        const line = lines[Number(issue.path[1])];
        if (line) setError(`quantities.${line.orderLineId}`, { message: issue.message });
      } else toast.error(issue.message);
      return;
    }
    try {
      await receive.mutateAsync(parsed.data);
      toast.success('Goods received and stock updated');
      onDone();
    } catch (error) {
      handleApiError(error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Controller
        control={control}
        name="warehouseId"
        render={({ field }) => (
          <SelectField
            label="Warehouse"
            value={field.value}
            onValueChange={field.onChange}
            options={(warehouses.data ?? [])
              .filter((w) => w.status === 'active')
              .map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }))}
            error={errors.warehouseId?.message}
          />
        )}
      />
      <Field label="Supplier invoice no." {...register('supplierInvoiceNo')} maxLength={40} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Quantity received now</p>
        {open.map((l) => {
          const left = remainingQty(l.quantity, l.receivedQuantity);
          return (
            <Field
              key={l.id}
              label={`${l.item.name} (${l.item.sku})`}
              inputMode="decimal"
              placeholder="0"
              hint={`Still to receive: ${formatQty(left)} ${l.item.unit}`}
              error={errors.quantities?.[l.id]?.message}
              {...register(`quantities.${l.id}`)}
            />
          );
        })}
      </div>
      <Field label="Notes" {...register('notes')} maxLength={300} />
      <FormActions pending={receive.isPending} onCancel={onDone} submit="Receive goods" />
    </form>
  );
}
