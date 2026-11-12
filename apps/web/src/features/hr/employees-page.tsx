'use client';

import { createEmployeeInputSchema, updateEmployeeInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { NoAccess, PageHeader, StatusBadge } from '@/components/ui/page-header';
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
import { useBranches, useUsers } from '@/features/admin/api';
import { Can, usePermission, useViewer } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import {
  EMPLOYEES_PAGE_SIZE,
  useEmployees,
  useSaveEmployee,
  useShifts,
  type Employee,
  type EmployeeFilter,
} from './api';
import { formatDate } from './format';

const NONE = '__none__';
const editSchema = updateEmployeeInputSchema.omit({ version: true });
type CreateIn = z.input<typeof createEmployeeInputSchema>;
type CreateOut = z.output<typeof createEmployeeInputSchema>;
type EditIn = z.input<typeof editSchema>;
type EditOut = z.output<typeof editSchema>;

export function EmployeesPage() {
  const allowed = usePermission('employee.employee.view');
  const [filter, setFilter] = useState<EmployeeFilter>({
    search: '',
    status: '',
    branchId: '',
    page: 0,
  });
  const [typed, setTyped] = useState('');
  const query = useEmployees(filter, allowed);
  const branches = useBranchOptions();
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  if (!allowed) return <NoAccess />;

  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / EMPLOYEES_PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Employees"
        description="Everyone who works for the organisation, with or without a sign-in."
        actions={
          <Can permission="employee.employee.create">
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add employee
            </Button>
          </Can>
        }
      />

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, search: typed.trim(), page: 0 });
        }}
        role="search"
      >
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Search employees"
            className="pl-9"
            placeholder="Search by name, code or email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <div className="w-44">
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
        {branches.length > 1 ? (
          <div className="w-48">
            <SelectField
              label="Branch"
              value={filter.branchId || NONE}
              onValueChange={(v) =>
                setFilter({ ...filter, branchId: v === NONE ? '' : v, page: 0 })
              }
              options={[{ value: NONE, label: 'All branches' }, ...branches]}
            />
          </div>
        ) : null}
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No employees found."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Branch</TableHead>
                  <TableHead className="px-4">Role in company</TableHead>
                  <TableHead className="px-4">Joined</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="px-4 py-3 font-mono">{e.employeeCode}</TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{e.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.email ?? 'No email'}
                        {e.userId ? ' · can sign in' : ''}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">{e.branch.name}</TableCell>
                    <TableCell className="px-4 py-3">
                      {[e.designation, e.department].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3">{formatDate(e.joiningDate)}</TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Can permission="employee.employee.update">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${e.fullName}`}
                          onClick={() => setEditing(e)}
                        >
                          Edit
                        </Button>
                      </Can>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
              <span>
                {total} employee{total === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={filter.page === 0}
                  onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
                >
                  Previous
                </Button>
                <span>
                  Page {filter.page + 1} of {pages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={filter.page + 1 >= pages}
                  onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add employee' : 'Edit employee'}
      >
        {editing === 'new' ? (
          <CreateForm onDone={() => setEditing(null)} />
        ) : editing ? (
          <EditForm employee={editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

/** Branches the viewer can pick from: the full list if they may read it, else their own. */
function useBranchOptions() {
  const viewer = useViewer();
  const canList = usePermission('branch.branch.view');
  const query = useBranches(canList);
  const source = canList && query.data ? query.data : viewer.branches;
  return source
    .filter((b) => !('status' in b) || (b as { status: string }).status === 'active')
    .map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));
}

function useLinkOptions() {
  const canUsers = usePermission('rbac.user.view');
  const canShifts = usePermission('attendance.shift.view');
  const users = useUsers({ search: '', status: 'active', page: 0 }, canUsers);
  const shifts = useShifts(canShifts);
  return {
    users: (users.data?.items ?? []).map((u) => ({
      value: u.id,
      label: `${u.fullName} (${u.email})`,
    })),
    shifts: (shifts.data ?? [])
      .filter((s) => s.status === 'active')
      .map((s) => ({ value: s.id, label: s.name })),
    canUsers,
    canShifts,
  };
}

const FIELDS = [
  'employeeCode',
  'fullName',
  'email',
  'phone',
  'branchId',
  'department',
  'designation',
  'joiningDate',
  'shiftId',
  'userId',
] as const;

function CreateForm({ onDone }: { onDone: () => void }) {
  const save = useSaveEmployee();
  const branches = useBranchOptions();
  const links = useLinkOptions();
  const viewer = useViewer();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CreateIn, unknown, CreateOut>({
    resolver: zodResolver(createEmployeeInputSchema),
    defaultValues: {
      employeeCode: '',
      fullName: '',
      email: '',
      phone: '',
      branchId: viewer.branches[0]?.id ?? '',
      department: '',
      designation: '',
      joiningDate: new Date().toISOString().slice(0, 10),
      shiftId: null,
      userId: null,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ input: values });
      toast.success('Employee added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: FIELDS });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Employee code"
          autoCapitalize="characters"
          hint="Cannot be changed later."
          error={errors.employeeCode?.message}
          {...register('employeeCode')}
        />
        <Field label="Full name" error={errors.fullName?.message} {...register('fullName')} />
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Field label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Field label="Department" error={errors.department?.message} {...register('department')} />
        <Field
          label="Designation"
          error={errors.designation?.message}
          {...register('designation')}
        />
        <Field
          label="Joining date"
          type="date"
          error={errors.joiningDate?.message}
          {...register('joiningDate')}
        />
        <Controller
          control={control}
          name="branchId"
          render={({ field }) => (
            <SelectField
              label="Branch"
              value={field.value}
              onValueChange={field.onChange}
              options={branches}
              error={errors.branchId?.message}
            />
          )}
        />
        {links.canShifts ? (
          <Controller
            control={control}
            name="shiftId"
            render={({ field }) => (
              <SelectField
                label="Shift"
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                options={[{ value: NONE, label: 'No shift' }, ...links.shifts]}
                error={errors.shiftId?.message}
              />
            )}
          />
        ) : null}
        {links.canUsers ? (
          <Controller
            control={control}
            name="userId"
            render={({ field }) => (
              <SelectField
                label="Sign-in account"
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                options={[{ value: NONE, label: 'None' }, ...links.users]}
                error={errors.userId?.message}
              />
            )}
          />
        ) : null}
      </div>
      <FormActions pending={save.isPending} onCancel={onDone} submit="Add employee" />
    </form>
  );
}

function EditForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const save = useSaveEmployee();
  const branches = useBranchOptions();
  const links = useLinkOptions();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EditIn, unknown, EditOut>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      fullName: employee.fullName,
      email: employee.email ?? '',
      phone: employee.phone ?? '',
      branchId: employee.branch.id,
      department: employee.department ?? '',
      designation: employee.designation ?? '',
      joiningDate: employee.joiningDate,
      shiftId: employee.shiftId,
      userId: employee.userId,
      status: employee.status,
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      // Fields this person cannot edit (no permission to list shifts/users) keep their current value.
      await save.mutateAsync({ id: employee.id, version: employee.version, input: values });
      toast.success('Employee updated');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: [...FIELDS.filter((f) => f !== 'employeeCode'), 'status'],
      });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Code <span className="font-mono text-foreground">{employee.employeeCode}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={errors.fullName?.message} {...register('fullName')} />
        <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Field label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Field label="Department" error={errors.department?.message} {...register('department')} />
        <Field
          label="Designation"
          error={errors.designation?.message}
          {...register('designation')}
        />
        <Field
          label="Joining date"
          type="date"
          error={errors.joiningDate?.message}
          {...register('joiningDate')}
        />
        <Controller
          control={control}
          name="branchId"
          render={({ field }) => (
            <SelectField
              label="Branch"
              value={field.value}
              onValueChange={field.onChange}
              options={withCurrent(branches, employee.branch.id, employee.branch.name)}
              error={errors.branchId?.message}
            />
          )}
        />
        {links.canShifts ? (
          <Controller
            control={control}
            name="shiftId"
            render={({ field }) => (
              <SelectField
                label="Shift"
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                options={[{ value: NONE, label: 'No shift' }, ...links.shifts]}
                error={errors.shiftId?.message}
              />
            )}
          />
        ) : null}
        {links.canUsers ? (
          <Controller
            control={control}
            name="userId"
            render={({ field }) => (
              <SelectField
                label="Sign-in account"
                value={field.value ?? NONE}
                onValueChange={(v) => field.onChange(v === NONE ? null : v)}
                options={withCurrent(
                  [{ value: NONE, label: 'None' }, ...links.users],
                  employee.userId,
                  employee.userEmail,
                )}
                error={errors.userId?.message}
              />
            )}
          />
        ) : null}
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <SelectField
              label="Status"
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
              error={errors.status?.message}
            />
          )}
        />
      </div>
      <FormActions pending={save.isPending} onCancel={onDone} submit="Save changes" />
    </form>
  );
}

/** Keeps the saved value selectable even if it is no longer in the option list (e.g. an inactive user). */
function withCurrent(
  options: { value: string; label: string }[],
  id: string | null,
  label: string | null,
) {
  if (!id || options.some((o) => o.value === id)) return options;
  return [...options, { value: id, label: label ?? 'Current' }];
}
