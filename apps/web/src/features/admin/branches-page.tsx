'use client';

import { createBranchInputSchema, updateBranchInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { NoAccess, PageHeader, StatusBadge } from '@/components/ui/page-header';
import { SelectField } from '@/components/ui/select-field';
import { handleApiError } from '@/lib/handle-api-error';
import { Can, usePermission } from '@/features/auth/viewer';
import { useBranches, useSaveBranch, type Branch } from './api';
import { QueryState } from './async';

const editSchema = updateBranchInputSchema.omit({ version: true });
type CreateIn = z.input<typeof createBranchInputSchema>;
type CreateOut = z.output<typeof createBranchInputSchema>;
type EditIn = z.input<typeof editSchema>;
type EditOut = z.output<typeof editSchema>;

export function BranchesPage() {
  const allowed = usePermission('branch.branch.view');
  const query = useBranches();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  if (!allowed) return <NoAccess />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Branches"
        description="Locations your team works from."
        actions={
          <Can permission="branch.branch.create">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add branch
            </Button>
          </Can>
        }
      />
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No branches yet.">
        {(branches) => (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono">{b.code}</td>
                    <td className="px-4 py-3">
                      {b.name}
                      {b.isHeadOffice ? (
                        <span className="ml-2 text-xs text-muted-foreground">Head office</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Can permission="branch.branch.update">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${b.name}`}
                          onClick={() => setEditing(b)}
                        >
                          Edit
                        </Button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add branch' : 'Edit branch'}
      >
        {editing === 'new' ? (
          <CreateForm onDone={() => setEditing(null)} />
        ) : editing ? (
          <EditForm branch={editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const save = useSaveBranch();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateIn, unknown, CreateOut>({
    resolver: zodResolver(createBranchInputSchema),
    defaultValues: { code: '', name: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ create: values });
      toast.success('Branch added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['code', 'name'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Code"
        autoCapitalize="characters"
        hint="Short and unique, e.g. CHN-1. It cannot be changed later."
        error={errors.code?.message}
        {...register('code')}
      />
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <FormActions pending={save.isPending} onCancel={onDone} submit="Add branch" />
    </form>
  );
}

function EditForm({ branch, onDone }: { branch: Branch; onDone: () => void }) {
  const save = useSaveBranch();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditIn, unknown, EditOut>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: branch.name, status: branch.status },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: branch.id, version: branch.version, update: values });
      toast.success('Branch updated');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['name', 'status'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Code <span className="font-mono text-foreground">{branch.code}</span>
      </p>
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <SelectField
        label="Status"
        disabled={branch.isHeadOffice}
        error={errors.status?.message}
        {...register('status')}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </SelectField>
      <FormActions pending={save.isPending} onCancel={onDone} submit="Save changes" />
    </form>
  );
}

export function FormActions({
  pending,
  onCancel,
  submit,
}: {
  pending: boolean;
  onCancel: () => void;
  submit: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {submit}
      </Button>
    </div>
  );
}
