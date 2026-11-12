'use client';

import { createSupplierInputSchema, updateSupplierInputSchema } from '@erp/shared';
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
import { QueryState } from '@/features/admin/async';
import { FormActions } from '@/features/admin/branches-page';
import { usePermission } from '@/features/auth/viewer';
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import {
  useSaveSupplier,
  useSuppliers,
  PAGE_SIZE,
  type Supplier,
  type SupplierFilter,
} from './api';

const NONE = '__none__';

// The edit form shows the fixed code too, so it uses a plain object without it.
const SUPPLIER_EDIT = z.object(updateSupplierInputSchema.omit({ version: true }).shape);

type SupplierIn = z.input<typeof createSupplierInputSchema> & { status?: 'active' | 'inactive' };
const FIELDS = [
  'code',
  'name',
  'contactName',
  'email',
  'phone',
  'gstin',
  'address',
  'status',
] as const;

export function SuppliersView() {
  const canCreate = usePermission('purchase.supplier.create');
  const canUpdate = usePermission('purchase.supplier.update');
  const [filter, setFilter] = useState<SupplierFilter>({ search: '', status: '', page: 0 });
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const query = useSuppliers(filter);

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
              placeholder="Code or name"
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
            <Plus className="size-4" aria-hidden /> Add supplier
          </Button>
        ) : null}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No suppliers found."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Contact</TableHead>
                  <TableHead className="px-4">GSTIN</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{s.code}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{s.name}</TableCell>
                    <TableCell className="px-4 py-3">
                      {[s.contactName, s.phone].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 font-mono text-xs">{s.gstin ?? '—'}</TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canUpdate ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${s.name}`}
                          onClick={() => setEditing(s)}
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
              noun="supplier"
              pageSize={PAGE_SIZE}
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add supplier' : 'Edit supplier'}
      >
        {editing ? (
          <SupplierForm
            supplier={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const save = useSaveSupplier();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SupplierIn>({
    resolver: zodResolver(
      supplier ? SUPPLIER_EDIT : createSupplierInputSchema,
    ) as Resolver<SupplierIn>,
    defaultValues: {
      code: supplier?.code ?? '',
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      email: supplier?.email ?? '',
      phone: supplier?.phone ?? '',
      gstin: supplier?.gstin ?? '',
      address: supplier?.address ?? '',
      ...(supplier ? { status: supplier.status } : {}),
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const { code, ...rest } = values;
      const input = supplier ? rest : { code, ...rest };
      await save.mutateAsync({ id: supplier?.id, version: supplier?.version, input });
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: FIELDS });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          disabled={supplier !== null}
          hint={supplier ? 'The code cannot be changed.' : 'A short unique code, e.g. ACME.'}
          error={errors.code?.message}
          {...register('code')}
        />
        <Field label="Name" error={errors.name?.message} {...register('name')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Contact person"
          error={errors.contactName?.message}
          {...register('contactName')}
        />
        <Field label="Phone" inputMode="tel" error={errors.phone?.message} {...register('phone')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Field label="GSTIN" maxLength={15} error={errors.gstin?.message} {...register('gstin')} />
      </div>
      <Field label="Address" error={errors.address?.message} {...register('address')} />
      {supplier ? (
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
        submit={supplier ? 'Save changes' : 'Add supplier'}
      />
    </form>
  );
}
