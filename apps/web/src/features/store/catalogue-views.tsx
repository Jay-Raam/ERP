'use client';

import {
  UNITS,
  createItemInputSchema,
  createWarehouseInputSchema,
  updateItemInputSchema,
  updateWarehouseInputSchema,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/page-header';
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
import { handleApiError } from '@/lib/handle-api-error';
import {
  useItems,
  useSaveItem,
  useSaveWarehouse,
  useWarehouses,
  type Item,
  type ItemFilter,
  type Warehouse,
} from './api';
import { formatQty } from './format';
import { Pager } from './pager';

const NONE = '__none__';

// The edit forms also hold the fixed fields (SKU, code ...) for display. The server
// schemas are strict, so these plain objects drop what cannot change and the
// submit handler only sends the editable fields.
const ITEM_EDIT = z.object(updateItemInputSchema.omit({ version: true }).shape);
const WAREHOUSE_EDIT = z.object(updateWarehouseInputSchema.omit({ version: true }).shape);

// -------------------------------------------------------------------- items

export function ItemsView() {
  const canCreate = usePermission('store.item.create');
  const canUpdate = usePermission('store.item.update');
  const [filter, setFilter] = useState<ItemFilter>({ search: '', status: '', page: 0 });
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const query = useItems(filter);

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
          <div className="w-64">
            <Field
              label="Search"
              placeholder="SKU or name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="w-40">
            <SelectField
              label="Status"
              value={filter.status || NONE}
              onValueChange={(v) =>
                setFilter({
                  ...filter,
                  status: v === NONE ? '' : (v as 'active' | 'inactive'),
                  page: 0,
                })
              }
              options={[
                { value: NONE, label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {canCreate ? (
          <Button className="ml-auto" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Add item
          </Button>
        ) : null}
      </div>

      <QueryState query={query} isEmpty={(d) => d.items.length === 0} emptyText="No items found.">
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">SKU</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Category</TableHead>
                  <TableHead className="px-4">Unit</TableHead>
                  <TableHead className="px-4 text-right">Reorder at</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{item.sku}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{item.name}</TableCell>
                    <TableCell className="px-4 py-3">{item.category ?? '—'}</TableCell>
                    <TableCell className="px-4 py-3">{item.unit}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatQty(item.reorderLevel)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setEditing(item)}
                        >
                          Edit
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
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add item' : 'Edit item'}
      >
        {editing ? (
          <ItemForm item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

type ItemIn = z.input<typeof createItemInputSchema> & { status?: 'active' | 'inactive' };

function ItemForm({ item, onDone }: { item: Item | null; onDone: () => void }) {
  const save = useSaveItem();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ItemIn>({
    resolver: zodResolver(item ? ITEM_EDIT : createItemInputSchema) as Resolver<ItemIn>,
    defaultValues: item
      ? {
          sku: item.sku,
          unit: item.unit,
          name: item.name,
          category: item.category ?? '',
          reorderLevel: formatQty(item.reorderLevel),
          status: item.status,
        }
      : { sku: '', unit: 'pcs', name: '', category: '', reorderLevel: '0' },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const input = item
        ? {
            name: values.name,
            category: values.category || null,
            reorderLevel: values.reorderLevel,
            status: values.status,
          }
        : { ...values, category: values.category || null };
      await save.mutateAsync({ id: item?.id, version: item?.version, input });
      toast.success(item ? 'Item updated' : 'Item added');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['sku', 'unit', 'name', 'category', 'reorderLevel', 'status'],
      });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="SKU"
        disabled={item !== null}
        hint={item ? 'The SKU cannot be changed.' : 'A short unique code, e.g. RICE-25.'}
        error={errors.sku?.message}
        {...register('sku')}
      />
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="unit"
          render={({ field }) => (
            <SelectField
              label="Unit"
              value={field.value}
              onValueChange={field.onChange}
              disabled={item !== null}
              options={UNITS.map((u) => ({ value: u, label: u }))}
              error={errors.unit?.message}
            />
          )}
        />
        <Field label="Category" error={errors.category?.message} {...register('category')} />
      </div>
      <Field
        label="Reorder level"
        inputMode="decimal"
        hint="Stock at or below this shows as low. Use 0 to switch the warning off."
        error={errors.reorderLevel?.message}
        {...register('reorderLevel')}
      />
      {item ? (
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <SelectField
              label="Status"
              value={field.value ?? 'active'}
              onValueChange={field.onChange}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              error={errors.status?.message}
            />
          )}
        />
      ) : null}
      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={item ? 'Save changes' : 'Add item'}
      />
    </form>
  );
}

// --------------------------------------------------------------- warehouses

export function WarehousesView() {
  const canManage = usePermission('store.warehouse.manage');
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  const query = useWarehouses();
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Add warehouse
          </Button>
        </div>
      ) : null}
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No warehouses yet.">
        {(rows) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Branch</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{w.code}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{w.name}</TableCell>
                    <TableCell className="px-4 py-3">{w.branch.name ?? w.branch.code}</TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${w.name}`}
                          onClick={() => setEditing(w)}
                        >
                          Edit
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </QueryState>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add warehouse' : 'Edit warehouse'}
      >
        {editing ? (
          <WarehouseForm
            warehouse={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

type WarehouseIn = z.input<typeof createWarehouseInputSchema> & { status?: 'active' | 'inactive' };

function useBranchOptions() {
  const viewer = useViewer();
  const canList = usePermission('branch.branch.view');
  const query = useBranches(canList);
  const source = canList && query.data ? query.data : viewer.branches;
  return source
    .filter((b) => !('status' in b) || (b as { status: string }).status === 'active')
    .map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));
}

function WarehouseForm({ warehouse, onDone }: { warehouse: Warehouse | null; onDone: () => void }) {
  const save = useSaveWarehouse();
  const branches = useBranchOptions();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<WarehouseIn>({
    resolver: zodResolver(
      warehouse ? WAREHOUSE_EDIT : createWarehouseInputSchema,
    ) as Resolver<WarehouseIn>,
    defaultValues: warehouse
      ? {
          code: warehouse.code,
          name: warehouse.name,
          branchId: warehouse.branch.id,
          status: warehouse.status,
        }
      : { code: '', name: '', branchId: branches[0]?.value ?? '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const input = warehouse ? { name: values.name, status: values.status } : values;
      await save.mutateAsync({ id: warehouse?.id, version: warehouse?.version, input });
      toast.success(warehouse ? 'Warehouse updated' : 'Warehouse added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['code', 'name', 'branchId', 'status'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Code"
        disabled={warehouse !== null}
        hint={
          warehouse ? 'The code cannot be changed.' : 'Letters, numbers and hyphens, e.g. COLD-1.'
        }
        error={errors.code?.message}
        {...register('code')}
      />
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <Controller
        control={control}
        name="branchId"
        render={({ field }) => (
          <SelectField
            label="Branch"
            value={field.value}
            onValueChange={field.onChange}
            disabled={warehouse !== null}
            options={branches}
            error={errors.branchId?.message}
          />
        )}
      />
      {warehouse ? (
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <SelectField
              label="Status"
              value={field.value ?? 'active'}
              onValueChange={field.onChange}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              error={errors.status?.message}
            />
          )}
        />
      ) : null}
      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={warehouse ? 'Save changes' : 'Add warehouse'}
      />
    </form>
  );
}
