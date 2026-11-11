'use client';

import { createRoleInputSchema, grantCovered } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { NoAccess, PageHeader } from '@/components/ui/page-header';
import { SelectField } from '@/components/ui/select-field';
import { Can, usePermission, useViewer } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import { useDeleteRole, useRoles, useSaveRole, type Role } from './api';
import { QueryState } from './async';
import { FormActions } from './branches-page';
import {
  checkExtraGrant,
  groupCatalogue,
  moduleLabel,
  splitGrants,
  toggleKey,
} from './permission-model';

const SCOPE = { own: 'Own records', branch: 'Own branches', organisation: 'Whole organisation' };
const formSchema = createRoleInputSchema.omit({ permissions: true });
type In = z.input<typeof formSchema>;
type Out = z.output<typeof formSchema>;

export function RolesPage() {
  const allowed = usePermission('rbac.role.view');
  const query = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  if (!allowed) return <NoAccess />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Roles"
        description="A role is a named set of permissions. Assign one to each user."
        actions={
          <Can permission="rbac.role.create">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> New role
            </Button>
          </Can>
        }
      />
      <QueryState query={query} emptyText="No roles.">
        {(roles) => (
          <ul className="divide-y rounded-lg border bg-card">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {role.name}
                    {role.isSystem ? (
                      <Lock
                        className="size-3.5 text-muted-foreground"
                        aria-label="Protected role"
                      />
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {SCOPE[role.dataScope]} · {role.permissions.length} permission
                    {role.permissions.length === 1 ? '' : 's'} · {role.userCount} user
                    {role.userCount === 1 ? '' : 's'}
                  </p>
                </div>
                {role.isSystem ? null : (
                  <div className="flex gap-2">
                    <Can permission="rbac.role.update">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Edit ${role.name}`}
                        onClick={() => setEditing(role)}
                      >
                        Edit
                      </Button>
                    </Can>
                    <Can permission="rbac.role.delete">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Delete ${role.name}`}
                        onClick={() => setDeleting(role)}
                      >
                        Delete
                      </Button>
                    </Can>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New role' : 'Edit role'}
        description="Tick what this role may do."
      >
        {editing ? (
          <RoleForm role={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
      <DeleteDialog role={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function DeleteDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const remove = useDeleteRole();
  return (
    <Modal open={role !== null} onClose={onClose} title="Delete role">
      {role ? (
        <div className="space-y-4">
          <p className="text-sm">
            Delete <strong>{role.name}</strong>? This cannot be undone.
            {role.userCount > 0
              ? ` ${role.userCount} user${role.userCount === 1 ? ' is' : 's are'} still on it, so it cannot be deleted yet.`
              : ''}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync(role.id);
                  toast.success('Role deleted');
                  onClose();
                } catch (error) {
                  handleApiError(error);
                }
              }}
            >
              Delete role
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function RoleForm({ role, onDone }: { role: Role | null; onDone: () => void }) {
  const viewer = useViewer();
  const save = useSaveRole();
  const initial = splitGrants(role?.permissions ?? []);
  const [checked, setChecked] = useState<string[]>(initial.checked);
  const [extra, setExtra] = useState<string[]>(initial.extra);
  const [extraInput, setExtraInput] = useState('');
  const [extraError, setExtraError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<In, unknown, Out>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: role?.name ?? '', dataScope: role?.dataScope ?? 'branch' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({
        id: role?.id,
        version: role?.version,
        input: { ...values, permissions: [...checked, ...extra] },
      });
      toast.success(role ? 'Role updated' : 'Role created');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['name', 'dataScope'] });
    }
  });

  const addExtra = () => {
    const result = checkExtraGrant(extraInput, [...checked, ...extra], viewer.permissions);
    if (!result.ok) return setExtraError(result.message);
    setExtra([...extra, result.value]);
    setExtraInput('');
    setExtraError(null);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label="Role name" error={errors.name?.message} {...register('name')} />
      <SelectField label="Data access" error={errors.dataScope?.message} {...register('dataScope')}>
        {Object.entries(SCOPE).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>

      <div className="space-y-3">
        {groupCatalogue().map((group) => (
          <fieldset key={group.module} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{moduleLabel(group.module)}</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.items.map((item) => {
                const canGrant = grantCovered(viewer.permissions, item.key);
                return (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2 text-sm ${canGrant ? '' : 'opacity-50'}`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked.includes(item.key)}
                      disabled={!canGrant}
                      onChange={(e) => setChecked(toggleKey(checked, item.key, e.target.checked))}
                    />
                    {item.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Other grants</p>
        {extra.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {extra.map((grant) => (
              <li
                key={grant}
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-xs"
              >
                {grant}
                <button
                  type="button"
                  aria-label={`Remove ${grant}`}
                  onClick={() => setExtra(extra.filter((g) => g !== grant))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Field
              label="Add a grant"
              placeholder="sale.*.view"
              autoCapitalize="none"
              spellCheck={false}
              value={extraInput}
              error={extraError ?? undefined}
              hint="Use * to cover a whole area, e.g. store.*.*"
              onChange={(e) => setExtraInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addExtra();
                }
              }}
            />
          </div>
          <Button type="button" variant="outline" className="mt-[1.65rem]" onClick={addExtra}>
            Add
          </Button>
        </div>
      </div>

      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={role ? 'Save changes' : 'Create role'}
      />
    </form>
  );
}
