'use client';

import {
  requestLeaveInputSchema,
  createLeaveTypeInputSchema,
  updateLeaveTypeInputSchema,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
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
import { usePermission } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import {
  LEAVE_PAGE_SIZE,
  useBalances,
  useCancelLeave,
  useDecideLeave,
  useLeave,
  useLeaveTypes,
  useRequestLeave,
  useSaveLeaveType,
  type LeaveFilter,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
} from './api';
import { LEAVE_STATUS_LABEL, formatDateRange, isoDate } from './format';

type Tab = 'requests' | 'types';
const ALL = '__all__';

export function LeavePage() {
  const canRequest = usePermission('attendance.leave.request-own');
  const canView = usePermission('attendance.leave.view');
  const canTypes = usePermission('attendance.leave-type.manage');
  const [tab, setTab] = useState<Tab>('requests');
  if (!canRequest && !canView && !canTypes) return <NoAccess />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Leave" description="Request time off and review requests." />
      {canTypes ? (
        <div role="tablist" aria-label="Leave sections" className="flex gap-1 border-b">
          {(
            [
              ['requests', 'Requests'],
              ['types', 'Leave types'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'requests' ? <Requests canRequest={canRequest} /> : <TypesView />}
    </div>
  );
}

// ----------------------------------------------------------------- requests

function Requests({ canRequest }: { canRequest: boolean }) {
  const canApprove = usePermission('attendance.leave.approve');
  const year = new Date().getFullYear();
  const balances = useBalances(year, canRequest);
  const [filter, setFilter] = useState<LeaveFilter>({ status: '', page: 0 });
  const query = useLeave(filter);
  const [requesting, setRequesting] = useState(false);
  const [deciding, setDeciding] = useState<LeaveRequest | null>(null);
  const cancel = useCancelLeave();
  const canViewAll = usePermission('attendance.leave.view');
  const myEmployeeId = balances.data?.employeeId ?? null;
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LEAVE_PAGE_SIZE));

  async function onCancel(r: LeaveRequest) {
    try {
      await cancel.mutateAsync(r.id);
      toast.success('Request cancelled');
    } catch (error) {
      handleApiError(error);
    }
  }

  return (
    <div className="space-y-6">
      {canRequest ? (
        <section aria-label={`Leave balance ${year}`} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Balance for {year}</h2>
            <Button onClick={() => setRequesting(true)}>
              <Plus className="size-4" aria-hidden /> Request leave
            </Button>
          </div>
          <QueryState
            query={balances}
            isEmpty={(d) => d.items.length === 0}
            emptyText="No leave balance yet. Your account may not be linked to an employee record."
          >
            {(data) => (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((b) => (
                  <Card key={b.leaveType.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{b.leaveType.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-semibold tabular-nums">{b.remaining}</div>
                      <p className="text-sm text-muted-foreground">
                        of {b.quota} days left · {b.used} taken · {b.pending} pending
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </QueryState>
        </section>
      ) : null}

      <section aria-label="Leave requests" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {canApprove || canViewAll ? 'Requests' : 'My requests'}
          </h2>
          <div className="w-44">
            <SelectField
              label="Status"
              value={filter.status || ALL}
              onValueChange={(v) =>
                setFilter({ status: v === ALL ? '' : (v as LeaveStatus), page: 0 })
              }
              options={[
                { value: ALL, label: 'All' },
                ...(['pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => ({
                  value: s,
                  label: LEAVE_STATUS_LABEL[s],
                })),
              ]}
            />
          </div>
        </div>
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          emptyText="No leave requests."
        >
          {(data) => (
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-4">Employee</TableHead>
                    <TableHead className="px-4">Type</TableHead>
                    <TableHead className="px-4">Dates</TableHead>
                    <TableHead className="px-4">Days</TableHead>
                    <TableHead className="px-4">Status</TableHead>
                    <TableHead className="px-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((r) => {
                    const mine = myEmployeeId !== null && r.employeeId === myEmployeeId;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 py-3">
                          <div className="font-medium">{r.employeeName}</div>
                          <div
                            className="max-w-64 truncate text-xs text-muted-foreground"
                            title={r.reason}
                          >
                            {r.reason}
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">{r.leaveTypeName}</TableCell>
                        <TableCell className="px-4 py-3">
                          {formatDateRange(r.startDate, r.endDate)}
                        </TableCell>
                        <TableCell className="px-4 py-3">{r.days}</TableCell>
                        <TableCell className="px-4 py-3">
                          <RequestStatus status={r.status} />
                          {r.decisionNote ? (
                            <div className="text-xs text-muted-foreground">{r.decisionNote}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="space-x-2 px-4 py-3 text-right whitespace-nowrap">
                          {canApprove && r.status === 'pending' && !mine ? (
                            <Button size="sm" variant="outline" onClick={() => setDeciding(r)}>
                              Review
                            </Button>
                          ) : null}
                          {mine &&
                          (r.status === 'pending' ||
                            (r.status === 'approved' && r.startDate > isoDate(new Date()))) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={cancel.isPending}
                              onClick={() => void onCancel(r)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                <span>{total} requests</span>
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
      </section>

      <Modal open={requesting} onClose={() => setRequesting(false)} title="Request leave">
        <RequestForm onDone={() => setRequesting(false)} />
      </Modal>
      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title="Review leave request"
        description={
          deciding
            ? `${deciding.employeeName} · ${formatDateRange(deciding.startDate, deciding.endDate)} · ${deciding.days} day(s)`
            : undefined
        }
      >
        {deciding ? <DecideForm request={deciding} onDone={() => setDeciding(null)} /> : null}
      </Modal>
    </div>
  );
}

function RequestStatus({ status }: { status: LeaveStatus }) {
  const variant =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
        ? 'destructive'
        : status === 'pending'
          ? 'default'
          : 'secondary';
  return <Badge variant={variant}>{LEAVE_STATUS_LABEL[status]}</Badge>;
}

type RequestIn = z.input<typeof requestLeaveInputSchema>;
type RequestOut = z.output<typeof requestLeaveInputSchema>;

function RequestForm({ onDone }: { onDone: () => void }) {
  const types = useLeaveTypes();
  const save = useRequestLeave();
  const today = isoDate(new Date());
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RequestIn, unknown, RequestOut>({
    resolver: zodResolver(requestLeaveInputSchema),
    defaultValues: { leaveTypeId: '', startDate: today, endDate: today, reason: '' },
  });
  const [start, end] = useWatch({ control, name: ['startDate', 'endDate'] });
  const days =
    start && end
      ? Math.round(
          (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
        ) + 1
      : 0;
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync(values);
      toast.success('Leave requested');
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['leaveTypeId', 'startDate', 'endDate', 'reason'],
      });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Controller
        control={control}
        name="leaveTypeId"
        render={({ field }) => (
          <SelectField
            label="Leave type"
            value={field.value}
            onValueChange={field.onChange}
            options={(types.data ?? [])
              .filter((t) => t.status === 'active')
              .map((t) => ({ value: t.id, label: t.name }))}
            error={errors.leaveTypeId?.message}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="From"
          type="date"
          error={errors.startDate?.message}
          {...register('startDate')}
        />
        <Field
          label="To"
          type="date"
          hint={days > 0 ? `${days} calendar day${days === 1 ? '' : 's'}` : undefined}
          error={errors.endDate?.message}
          {...register('endDate')}
        />
      </div>
      <Field label="Reason" error={errors.reason?.message} {...register('reason')} />
      <FormActions pending={save.isPending} onCancel={onDone} submit="Send request" />
    </form>
  );
}

function DecideForm({ request, onDone }: { request: LeaveRequest; onDone: () => void }) {
  const decide = useDecideLeave();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function act(decision: 'approve' | 'reject') {
    setError(null);
    try {
      await decide.mutateAsync({
        id: request.id,
        decision,
        note: note.trim() || null,
        version: request.version,
      });
      toast.success(decision === 'approve' ? 'Leave approved' : 'Leave rejected');
      onDone();
    } catch (err) {
      setError(handleApiError(err));
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="text-muted-foreground">Reason: </span>
        {request.reason}
      </p>
      <Field
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={decide.isPending}>
          Close
        </Button>
        <Button
          variant="destructive"
          onClick={() => void act('reject')}
          disabled={decide.isPending}
        >
          Reject
        </Button>
        <Button onClick={() => void act('approve')} disabled={decide.isPending}>
          Approve
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- types

type TypeCreateIn = z.input<typeof createLeaveTypeInputSchema>;
type TypeCreateOut = z.output<typeof createLeaveTypeInputSchema>;

function TypesView() {
  const query = useLeaveTypes();
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden /> Add leave type
        </Button>
      </div>
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No leave types yet.">
        {(types) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Code</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Days a year</TableHead>
                  <TableHead className="px-4">Paid</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 py-3 font-mono">{t.code}</TableCell>
                    <TableCell className="px-4 py-3">{t.name}</TableCell>
                    <TableCell className="px-4 py-3">{t.annualDays}</TableCell>
                    <TableCell className="px-4 py-3">{t.paid ? 'Paid' : 'Unpaid'}</TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => setEditing(t)}
                      >
                        Edit
                      </Button>
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
        title={editing === 'new' ? 'Add leave type' : 'Edit leave type'}
      >
        {editing ? (
          <TypeForm type={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

function TypeForm({ type, onDone }: { type: LeaveType | null; onDone: () => void }) {
  const save = useSaveLeaveType();
  const schema = type
    ? updateLeaveTypeInputSchema.omit({ version: true })
    : createLeaveTypeInputSchema;
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TypeCreateIn & { status?: 'active' | 'inactive' }, unknown, TypeCreateOut>({
    resolver: zodResolver(schema as unknown as typeof createLeaveTypeInputSchema),
    defaultValues: {
      code: type?.code ?? '',
      name: type?.name ?? '',
      annualDays: type?.annualDays ?? 12,
      paid: type?.paid ?? true,
      ...(type ? { status: type.status } : {}),
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    // The code is fixed after creation, so it is not sent on update.
    const { code, ...rest } = values;
    try {
      await save.mutateAsync({
        id: type?.id,
        version: type?.version,
        input: type ? rest : { code, ...rest },
      });
      toast.success(type ? 'Leave type updated' : 'Leave type added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['code', 'name', 'annualDays', 'paid', 'status'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {type ? (
        <p className="text-sm text-muted-foreground">
          Code <span className="font-mono text-foreground">{type.code}</span>
        </p>
      ) : (
        <Field
          label="Code"
          autoCapitalize="characters"
          hint="e.g. CL. It cannot be changed later."
          error={errors.code?.message}
          {...register('code')}
        />
      )}
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <Field
        label="Days a year"
        type="number"
        step="0.5"
        error={errors.annualDays?.message}
        {...register('annualDays', { valueAsNumber: true })}
      />
      <Controller
        control={control}
        name="paid"
        render={({ field }) => (
          <SelectField
            label="Pay"
            value={field.value ? 'paid' : 'unpaid'}
            onValueChange={(v) => field.onChange(v === 'paid')}
            options={[
              { value: 'paid', label: 'Paid' },
              { value: 'unpaid', label: 'Unpaid' },
            ]}
          />
        )}
      />
      {type ? (
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
            />
          )}
        />
      ) : null}
      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={type ? 'Save changes' : 'Add leave type'}
      />
    </form>
  );
}
