'use client';

import { ACCOUNT_TYPES, createAccountInputSchema, updateAccountInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { QueryState } from '@/features/admin/async';
import { FormActions } from '@/features/admin/branches-page';
import { usePermission } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import { useAccounts, useSaveAccount, type Account } from './api';

const TYPE_LABEL: Record<(typeof ACCOUNT_TYPES)[number], string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

export function AccountsView() {
  const canManage = usePermission('accounts.account.manage');
  const query = useAccounts();
  const [form, setForm] = useState<Account | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The chart of accounts. System accounts are used by invoices and payments and cannot be
          turned off.
        </p>
        {canManage ? (
          <Button onClick={() => setForm('new')}>
            <Plus className="size-4" aria-hidden /> New account
          </Button>
        ) : null}
      </div>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No accounts yet.">
        {(accounts) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Type</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{a.code}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">
                      {a.name} {a.isSystem ? <Badge variant="outline">System</Badge> : null}
                    </TableCell>
                    <TableCell className="px-4 py-3">{TYPE_LABEL[a.type]}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>
                        {a.status === 'active' ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${a.name}`}
                          onClick={() => setForm(a)}
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
        open={form !== null}
        onClose={() => setForm(null)}
        title={form === 'new' ? 'New account' : 'Edit account'}
      >
        {form === 'new' ? <CreateForm onDone={() => setForm(null)} /> : null}
        {form && form !== 'new' ? <EditForm account={form} onDone={() => setForm(null)} /> : null}
      </Modal>
    </div>
  );
}

type CreateIn = z.input<typeof createAccountInputSchema>;

function CreateForm({ onDone }: { onDone: () => void }) {
  const save = useSaveAccount();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateIn>({
    resolver: zodResolver(createAccountInputSchema),
    defaultValues: { code: '', name: '', type: 'expense' },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ input: values });
      toast.success('Account added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['code', 'name', 'type'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Code"
        inputMode="numeric"
        hint="3 to 8 digits. It cannot be changed later."
        maxLength={8}
        error={errors.code?.message}
        {...register('code')}
      />
      <Field label="Name" maxLength={80} error={errors.name?.message} {...register('name')} />
      <Controller
        control={control}
        name="type"
        render={({ field }) => (
          <SelectField
            label="Type"
            value={field.value}
            onValueChange={field.onChange}
            options={ACCOUNT_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            error={errors.type?.message}
          />
        )}
      />
      <FormActions pending={save.isPending} onCancel={onDone} submit="Add account" />
    </form>
  );
}

const editSchema = updateAccountInputSchema.omit({ version: true });
type EditIn = z.input<typeof editSchema>;

function EditForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const save = useSaveAccount();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditIn>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: account.name, status: account.status },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: account.id, version: account.version, input: values });
      toast.success('Saved');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['name', 'status'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {account.code} · {TYPE_LABEL[account.type]}
      </p>
      <Field label="Name" maxLength={80} error={errors.name?.message} {...register('name')} />
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <SelectField
            label="Status"
            value={field.value}
            disabled={account.isSystem}
            onValueChange={field.onChange}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            error={errors.status?.message}
          />
        )}
      />
      <FormActions pending={save.isPending} onCancel={onDone} submit="Save changes" />
    </form>
  );
}
