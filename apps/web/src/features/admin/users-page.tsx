'use client';

import {
  createUserInputSchema,
  grantCovered,
  resetPasswordInputSchema,
  updateUserInputSchema,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { NoAccess, PageHeader, StatusBadge } from '@/components/ui/page-header';
import { PasswordField } from '@/components/ui/password-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can, usePermission, useViewer } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import {
  USERS_PAGE_SIZE,
  useBranches,
  useResetPassword,
  useRoles,
  useSaveUser,
  useUsers,
  type ManagedUser,
  type Role,
  type Branch,
} from './api';
import { QueryState } from './async';
import { FormActions } from './branches-page';

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function UsersPage() {
  const allowed = usePermission('rbac.user.view');
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText.trim());
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [page, setPage] = useState(0);
  const query = useUsers({ search, status, page });
  const roles = useRoles();
  const branches = useBranches();
  const [editing, setEditing] = useState<ManagedUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  if (!allowed) return <NoAccess />;

  const total = query.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / USERS_PAGE_SIZE) - 1);
  const ready = roles.data && branches.data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Users"
        description="People who can sign in to this organisation."
        actions={
          <Can permission="rbac.user.create">
            <Button disabled={!ready} onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add user
            </Button>
          </Can>
        }
      />

      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-52 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search users"
            placeholder="Search name or email"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={status === '' ? 'all' : status}
          onValueChange={(v) => {
            setStatus(v === 'all' ? '' : (v as 'active' | 'inactive'));
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="Filter by status" className="h-10 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <QueryState query={query} isEmpty={(d) => d.items.length === 0} emptyText="No users match.">
        {(data) => (
          <>
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Name</TableHead>
                    <TableHead className="px-4">Role</TableHead>
                    <TableHead className="px-4">Branches</TableHead>
                    <TableHead className="px-4">Status</TableHead>
                    <TableHead className="px-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="px-4 py-3">
                        <p className="font-medium">{u.fullName}</p>
                        <p className="text-muted-foreground">{u.email}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3">{u.role.name}</TableCell>
                      <TableCell className="px-4 py-3">
                        {u.branches.map((b) => b.code).join(', ')}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <StatusBadge status={u.status} />
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Can permission="rbac.user.update">
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Edit ${u.fullName}`}
                              disabled={!ready}
                              onClick={() => setEditing(u)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Reset password for ${u.fullName}`}
                              onClick={() => setResetting(u)}
                            >
                              Reset password
                            </Button>
                          </Can>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground">
                {data.total} user{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= lastPage}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </nav>
          </>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add user' : 'Edit user'}
      >
        {editing && roles.data && branches.data ? (
          <UserForm
            user={editing === 'new' ? null : editing}
            roles={roles.data}
            branches={branches.data}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <Modal
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Reset password"
        description="They will be signed out everywhere and must use the new password."
      >
        {resetting ? <ResetForm user={resetting} onDone={() => setResetting(null)} /> : null}
      </Modal>
    </div>
  );
}

const createSchema = createUserInputSchema;
const editSchema = updateUserInputSchema.omit({ version: true });
type CreateIn = z.input<typeof createSchema>;
type CreateOut = z.output<typeof createSchema>;
type EditIn = z.input<typeof editSchema>;
type EditOut = z.output<typeof editSchema>;

function BranchChecklist({
  branches,
  value,
  onChange,
  error,
}: {
  branches: Branch[];
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Branches</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {branches
          .filter((b) => b.status === 'active' || value.includes(b.id))
          .map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.includes(b.id)}
                onCheckedChange={(on) =>
                  onChange(on === true ? [...value, b.id] : value.filter((id) => id !== b.id))
                }
              />
              {b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
            </label>
          ))}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function roleOptions(roles: Role[], viewerPermissions: string[]): SelectOption[] {
  // Roles the viewer cannot hand out stay visible but disabled; the server enforces the same rule.
  return roles.map((r) => ({
    value: r.id,
    label: r.name,
    disabled: !canAssign(r, viewerPermissions),
  }));
}

function canAssign(role: Role, viewerPermissions: string[]): boolean {
  return role.permissions.every((p) => grantCovered(viewerPermissions, p));
}

function UserForm({
  user,
  roles,
  branches,
  onDone,
}: {
  user: ManagedUser | null;
  roles: Role[];
  branches: Branch[];
  onDone: () => void;
}) {
  const viewer = useViewer();
  const save = useSaveUser();
  const isSelf = user?.id === viewer.user.id;

  const create = useForm<CreateIn, unknown, CreateOut>({
    resolver: zodResolver(createSchema),
    defaultValues: { fullName: '', email: '', password: '', roleId: '', branchIds: [] },
  });
  const edit = useForm<EditIn, unknown, EditOut>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fullName: user?.fullName ?? '',
      roleId: user?.role.id ?? '',
      branchIds: user?.branches.map((b) => b.id) ?? [],
      status: user?.status ?? 'active',
    },
  });

  const submitCreate = create.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ create: values });
      toast.success('User added');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError: create.setError,
        fields: ['fullName', 'email', 'password', 'roleId', 'branchIds'],
      });
    }
  });
  const submitEdit = edit.handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: user!.id, version: user!.version, update: values });
      toast.success('User updated');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError: edit.setError,
        fields: ['fullName', 'roleId', 'branchIds', 'status'],
      });
    }
  });

  if (!user) {
    const { register, control, formState } = create;
    const errors = formState.errors;
    return (
      <form onSubmit={submitCreate} noValidate className="space-y-4">
        <Field label="Full name" error={errors.fullName?.message} {...register('fullName')} />
        <Field
          label="Email"
          type="email"
          autoCapitalize="none"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Temporary password"
          autoComplete="new-password"
          hint="At least 10 characters. Share it with them securely."
          error={errors.password?.message}
          {...register('password')}
        />
        <Controller
          control={control}
          name="roleId"
          render={({ field }) => (
            <SelectField
              label="Role"
              placeholder="Choose a role"
              error={errors.roleId?.message}
              value={field.value}
              onValueChange={field.onChange}
              options={roleOptions(roles, viewer.permissions)}
            />
          )}
        />
        <Controller
          control={control}
          name="branchIds"
          render={({ field }) => (
            <BranchChecklist
              branches={branches}
              value={field.value}
              onChange={field.onChange}
              error={errors.branchIds?.message ?? errors.branchIds?.root?.message}
            />
          )}
        />
        <FormActions pending={save.isPending} onCancel={onDone} submit="Add user" />
      </form>
    );
  }

  const { register, control, formState } = edit;
  const errors = formState.errors;
  return (
    <form onSubmit={submitEdit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">{user.email}</p>
      <Field label="Full name" error={errors.fullName?.message} {...register('fullName')} />
      <Controller
        control={control}
        name="roleId"
        render={({ field }) => (
          <SelectField
            label="Role"
            disabled={isSelf}
            error={errors.roleId?.message}
            value={field.value}
            onValueChange={field.onChange}
            options={roleOptions(roles, viewer.permissions)}
          />
        )}
      />
      <Controller
        control={control}
        name="status"
        render={({ field }) => (
          <SelectField
            label="Status"
            disabled={isSelf}
            error={errors.status?.message}
            value={field.value}
            onValueChange={field.onChange}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive (cannot sign in)' },
            ]}
          />
        )}
      />
      <Controller
        control={control}
        name="branchIds"
        render={({ field }) => (
          <BranchChecklist
            branches={branches}
            value={field.value}
            onChange={field.onChange}
            error={errors.branchIds?.message ?? errors.branchIds?.root?.message}
          />
        )}
      />
      <FormActions pending={save.isPending} onCancel={onDone} submit="Save changes" />
    </form>
  );
}

function ResetForm({ user, onDone }: { user: ManagedUser; onDone: () => void }) {
  const reset = useResetPassword();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<z.input<typeof resetPasswordInputSchema>>({
    resolver: zodResolver(resetPasswordInputSchema),
    defaultValues: { password: '' },
  });
  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await reset.mutateAsync({ id: user.id, password });
      toast.success(`Password reset for ${user.fullName}`);
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['password'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <PasswordField
        label={`New password for ${user.fullName}`}
        autoComplete="new-password"
        error={errors.password?.message}
        {...register('password')}
      />
      <FormActions pending={reset.isPending} onCancel={onDone} submit="Reset password" />
    </form>
  );
}
