'use client';

import {
  MOVEMENT_KINDS,
  adjustStockInputSchema,
  receiveStockInputSchema,
  transferStockInputSchema,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { handleApiError } from '@/lib/handle-api-error';
import {
  useItemOptions,
  useMovements,
  useStockAction,
  useStockLevels,
  useWarehouses,
  type LevelFilter,
  type MovementFilter,
  type StockAction,
} from './api';
import { MOVEMENT_LABEL, formatMovementTime, formatQty, formatSigned } from './format';
import { Pager } from './pager';

const NONE = '__none__';

function useWarehouseOptions(activeOnly: boolean) {
  const query = useWarehouses();
  return (query.data ?? [])
    .filter((w) => !activeOnly || w.status === 'active')
    .map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
}

// ------------------------------------------------------------- stock levels

const ACTIONS: { id: StockAction; label: string; permission: string }[] = [
  { id: 'receive', label: 'Receive', permission: 'store.stock.receive' },
  { id: 'issue', label: 'Issue', permission: 'store.stock.issue' },
  { id: 'adjust', label: 'Adjust', permission: 'store.stock.adjust' },
  { id: 'transfer', label: 'Transfer', permission: 'store.stock.transfer' },
];

export function StockView() {
  const [filter, setFilter] = useState<LevelFilter>({
    search: '',
    warehouseId: '',
    lowOnly: false,
    page: 0,
  });
  const [typed, setTyped] = useState('');
  const [acting, setActing] = useState<{ action: StockAction; itemId?: string } | null>(null);
  const warehouses = useWarehouseOptions(false);
  const query = useStockLevels(filter);
  const can = {
    receive: usePermission('store.stock.receive'),
    issue: usePermission('store.stock.issue'),
    adjust: usePermission('store.stock.adjust'),
    transfer: usePermission('store.stock.transfer'),
  };
  const allowed = ACTIONS.filter((a) => can[a.id]);

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
          <div className="w-60">
            <Field
              label="Search"
              placeholder="SKU or name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={80}
            />
          </div>
          {warehouses.length > 1 ? (
            <div className="w-52">
              <SelectField
                label="Warehouse"
                value={filter.warehouseId || NONE}
                onValueChange={(v) =>
                  setFilter({ ...filter, warehouseId: v === NONE ? '' : v, page: 0 })
                }
                options={[{ value: NONE, label: 'All warehouses' }, ...warehouses]}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2 pb-2">
            <Checkbox
              id="low-only"
              checked={filter.lowOnly}
              onCheckedChange={(c) => setFilter({ ...filter, lowOnly: c === true, page: 0 })}
            />
            <Label htmlFor="low-only">Low stock only</Label>
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {allowed.length > 0 ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {allowed.map((a) => (
              <Button
                key={a.id}
                variant={a.id === 'receive' ? 'default' : 'outline'}
                onClick={() => setActing({ action: a.id })}
              >
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText={filter.lowOnly ? 'Nothing is running low.' : 'No items found.'}
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Item</TableHead>
                  <TableHead className="px-4 text-right">On hand</TableHead>
                  <TableHead className="px-4">Where</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      <span className="font-medium">{formatQty(row.onHand)}</span>{' '}
                      <span className="text-muted-foreground">{row.unit}</span>
                      {row.low ? (
                        <Badge variant="destructive" className="ml-2">
                          Low
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                      {row.byWarehouse.length === 0
                        ? '—'
                        : row.byWarehouse
                            .map((b) => `${b.warehouse.code}: ${formatQty(b.quantity)}`)
                            .join(' · ')}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {can.receive && row.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Receive ${row.name}`}
                          onClick={() => setActing({ action: 'receive', itemId: row.id })}
                        >
                          Receive
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
              noun="item"
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>

      <Modal
        open={acting !== null}
        onClose={() => setActing(null)}
        title={ACTIONS.find((a) => a.id === acting?.action)?.label ?? ''}
      >
        {acting ? (
          <StockForm action={acting.action} itemId={acting.itemId} onDone={() => setActing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

interface StockIn {
  itemId: string;
  warehouseId?: string;
  fromWarehouseId?: string;
  toWarehouseId?: string;
  quantity: string;
  reference?: string | null;
  reason?: string | null;
}

const SCHEMAS = {
  receive: receiveStockInputSchema,
  issue: receiveStockInputSchema,
  adjust: adjustStockInputSchema,
  transfer: transferStockInputSchema,
} as const;

const DONE: Record<StockAction, string> = {
  receive: 'Stock received',
  issue: 'Stock issued',
  adjust: 'Stock adjusted',
  transfer: 'Stock transferred',
};

function StockForm({
  action,
  itemId,
  onDone,
}: {
  action: StockAction;
  itemId?: string;
  onDone: () => void;
}) {
  const run = useStockAction();
  const items = useItemOptions();
  const warehouses = useWarehouseOptions(true);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<StockIn>({
    resolver: zodResolver(SCHEMAS[action] as z.ZodType<StockIn, StockIn>),
    // Only the fields this action sends: the server schemas are strict.
    defaultValues: {
      itemId: itemId ?? '',
      ...(action === 'transfer'
        ? { fromWarehouseId: '', toWarehouseId: '' }
        : { warehouseId: warehouses.length === 1 ? warehouses[0]!.value : '' }),
      quantity: '',
      ...(action === 'adjust' ? { reason: '' } : { reference: '', reason: '' }),
    },
  });
  const itemOptions = (items.data ?? []).map((i) => ({
    value: i.id,
    label: `${i.name} (${i.sku}, ${i.unit})`,
  }));

  const onSubmit = handleSubmit(async (values) => {
    try {
      const base = { itemId: values.itemId, quantity: values.quantity };
      const input =
        action === 'adjust'
          ? { ...base, warehouseId: values.warehouseId, reason: values.reason }
          : action === 'transfer'
            ? {
                ...base,
                fromWarehouseId: values.fromWarehouseId,
                toWarehouseId: values.toWarehouseId,
                reference: values.reference || null,
                reason: values.reason || null,
              }
            : {
                ...base,
                warehouseId: values.warehouseId,
                reference: values.reference || null,
                reason: values.reason || null,
              };
      await run.mutateAsync({ action, input });
      toast.success(DONE[action]);
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: [
          'itemId',
          'warehouseId',
          'fromWarehouseId',
          'toWarehouseId',
          'quantity',
          'reference',
          'reason',
        ],
      });
    }
  });

  const picker = (
    name: 'itemId' | 'warehouseId' | 'fromWarehouseId' | 'toWarehouseId',
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <SelectField
          label={label}
          value={field.value ?? ''}
          onValueChange={field.onChange}
          options={options}
          error={errors[name]?.message}
        />
      )}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {picker('itemId', 'Item', itemOptions)}
      {action === 'transfer' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {picker('fromWarehouseId', 'From', warehouses)}
          {picker('toWarehouseId', 'To', warehouses)}
        </div>
      ) : (
        picker('warehouseId', 'Warehouse', warehouses)
      )}
      <Field
        label="Quantity"
        inputMode="decimal"
        hint={
          action === 'adjust'
            ? 'Use a minus sign to remove stock, e.g. -2.5.'
            : 'Up to 3 decimals, e.g. 12 or 2.5.'
        }
        error={errors.quantity?.message}
        {...register('quantity')}
      />
      {action === 'adjust' ? (
        <Field label="Reason" error={errors.reason?.message} {...register('reason')} />
      ) : (
        <>
          <Field
            label="Reference (optional)"
            error={errors.reference?.message}
            {...register('reference')}
          />
          <Field label="Note (optional)" error={errors.reason?.message} {...register('reason')} />
        </>
      )}
      <FormActions
        pending={run.isPending}
        onCancel={onDone}
        submit={ACTIONS.find((a) => a.id === action)!.label}
      />
    </form>
  );
}

// ---------------------------------------------------------------- movements

export function MovementsView() {
  const [filter, setFilter] = useState<MovementFilter>({
    itemId: '',
    warehouseId: '',
    kind: '',
    page: 0,
  });
  const warehouses = useWarehouseOptions(false);
  const items = useItemOptions();
  const query = useMovements(filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <SelectField
            label="Item"
            value={filter.itemId || NONE}
            onValueChange={(v) => setFilter({ ...filter, itemId: v === NONE ? '' : v, page: 0 })}
            options={[
              { value: NONE, label: 'All items' },
              ...(items.data ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.sku})` })),
            ]}
          />
        </div>
        {warehouses.length > 1 ? (
          <div className="w-52">
            <SelectField
              label="Warehouse"
              value={filter.warehouseId || NONE}
              onValueChange={(v) =>
                setFilter({ ...filter, warehouseId: v === NONE ? '' : v, page: 0 })
              }
              options={[{ value: NONE, label: 'All warehouses' }, ...warehouses]}
            />
          </div>
        ) : null}
        <div className="w-48">
          <SelectField
            label="Type"
            value={filter.kind || NONE}
            onValueChange={(v) =>
              setFilter({
                ...filter,
                kind: v === NONE ? '' : (v as MovementFilter['kind']),
                page: 0,
              })
            }
            options={[
              { value: NONE, label: 'All types' },
              ...MOVEMENT_KINDS.map((k) => ({ value: k, label: MOVEMENT_LABEL[k] })),
            ]}
          />
        </div>
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No stock movements yet."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">When</TableHead>
                  <TableHead className="px-4">Item</TableHead>
                  <TableHead className="px-4">Type</TableHead>
                  <TableHead className="px-4">Warehouse</TableHead>
                  <TableHead className="px-4 text-right">Change</TableHead>
                  <TableHead className="px-4 text-right">Balance</TableHead>
                  <TableHead className="px-4">By</TableHead>
                  <TableHead className="px-4">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="px-4 py-3 whitespace-nowrap">
                      {formatMovementTime(m.createdAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{m.item.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{m.item.sku}</div>
                    </TableCell>
                    <TableCell className="px-4 py-3">{MOVEMENT_LABEL[m.kind]}</TableCell>
                    <TableCell className="px-4 py-3">{m.warehouse.code}</TableCell>
                    <TableCell
                      className={`px-4 py-3 text-right tabular-nums ${m.quantity.startsWith('-') ? 'text-destructive' : 'text-success'}`}
                    >
                      {formatSigned(m.quantity)} {m.item.unit}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatQty(m.balanceAfter)}
                    </TableCell>
                    <TableCell className="px-4 py-3">{m.createdByName}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                      {[m.reference, m.reason].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={filter.page}
              total={data.total}
              noun="movement"
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>
    </div>
  );
}
