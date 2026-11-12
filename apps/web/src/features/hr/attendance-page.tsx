'use client';

import { createShiftInputSchema, updateShiftInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Clock, Loader2, LogIn, LogOut, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useBranches } from '@/features/admin/api';
import { usePermission, useViewer } from '@/features/auth/viewer';
import { handleApiError } from '@/lib/handle-api-error';
import {
  useAttendance,
  useManualPunch,
  usePunch,
  useSaveShift,
  useShifts,
  useToday,
  type AttendanceDay,
  type Shift,
} from './api';
import {
  DAY_STATUS_LABEL,
  addDays,
  formatDate,
  formatDuration,
  formatTime,
  isoDate,
  zonedToIso,
} from './format';

type Tab = 'today' | 'team' | 'shifts';

export function AttendancePage() {
  const canTeam = usePermission('attendance.record.view');
  const canShifts = usePermission('attendance.shift.view');
  const canPunch = usePermission('attendance.punch.create-own');
  const canOwn = usePermission('attendance.record.view-own');
  const [tab, setTab] = useState<Tab>(canOwn ? 'today' : 'team');
  if (!canOwn && !canTeam) return <NoAccess />;

  const tabs: { id: Tab; label: string }[] = [
    ...(canOwn ? [{ id: 'today' as const, label: 'My day' }] : []),
    ...(canTeam ? [{ id: 'team' as const, label: 'Team' }] : []),
    ...(canShifts ? [{ id: 'shifts' as const, label: 'Shifts' }] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Attendance" description="Clock in and out, and review who was in." />
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Attendance sections" className="flex gap-1 border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'today' && canOwn ? <MyDay canPunch={canPunch} /> : null}
      {tab === 'team' && canTeam ? <TeamView /> : null}
      {tab === 'shifts' && canShifts ? <ShiftsView /> : null}
    </div>
  );
}

// ------------------------------------------------------------------- my day

function MyDay({ canPunch }: { canPunch: boolean }) {
  const today = useToday();
  const punch = usePunch();
  const to = today.data?.date ?? isoDate(new Date());
  const history = useAttendance(
    { from: addDays(to, -13), to },
    today.data !== undefined && today.data !== null,
  );

  async function onPunch() {
    try {
      const result = await punch.mutateAsync();
      toast.success(result.punch.kind === 'in' ? 'Clocked in' : 'Clocked out');
    } catch (error) {
      handleApiError(error);
    }
  }

  return (
    <div className="space-y-6">
      <QueryState
        query={today}
        emptyText="No employee record is linked to your account. Ask HR to link it."
        isEmpty={(d) => d === null}
      >
        {(t) => (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-5" aria-hidden /> {formatDate(t!.date)}
              </CardTitle>
              <CardDescription>
                {t!.state === 'in' ? 'You are clocked in.' : 'You are not clocked in.'} Times are in{' '}
                {t!.timeZone}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {canPunch ? (
                  <Button size="lg" onClick={onPunch} disabled={punch.isPending}>
                    {punch.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : t!.state === 'in' ? (
                      <LogOut className="size-4" aria-hidden />
                    ) : (
                      <LogIn className="size-4" aria-hidden />
                    )}
                    {t!.state === 'in' ? 'Clock out' : 'Clock in'}
                  </Button>
                ) : null}
                <div className="text-sm">
                  <div className="text-muted-foreground">Worked today</div>
                  <div className="text-lg font-semibold">
                    {formatDuration(t!.day.workedMinutes)}
                  </div>
                </div>
                {t!.day.late ? <Badge variant="destructive">Late</Badge> : null}
              </div>
              {t!.punches.length > 0 ? (
                <ol className="space-y-1 text-sm" aria-label="Today's punches">
                  {t!.punches.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <Badge variant={p.kind === 'in' ? 'success' : 'secondary'}>
                        {p.kind === 'in' ? 'In' : 'Out'}
                      </Badge>
                      <span className="tabular-nums">{formatTime(p.at, t!.timeZone)}</span>
                      {p.source === 'manual' ? (
                        <span className="text-xs text-muted-foreground">added by HR</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No punches yet today.</p>
              )}
            </CardContent>
          </Card>
        )}
      </QueryState>

      {history.data ? (
        <section aria-label="Last two weeks" className="space-y-2">
          <h2 className="text-lg font-semibold">Last two weeks</h2>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">In</TableHead>
                  <TableHead className="px-4">Out</TableHead>
                  <TableHead className="px-4">Worked</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...(history.data.items[0]?.days ?? [])]
                  .filter((d) => d.status !== 'upcoming')
                  .reverse()
                  .map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="px-4 py-2.5">{formatDate(d.date)}</TableCell>
                      <TableCell className="px-4 py-2.5 tabular-nums">
                        {formatTime(d.firstIn, history.data!.timeZone)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5 tabular-nums">
                        {formatTime(d.lastOut, history.data!.timeZone)}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        {d.workedMinutes ? formatDuration(d.workedMinutes) : '—'}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <DayBadge day={d} />
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DayBadge({ day }: { day: AttendanceDay }) {
  if (day.status === 'upcoming') return null;
  const variant =
    day.status === 'present'
      ? 'success'
      : day.status === 'absent'
        ? 'destructive'
        : day.status === 'leave' || day.status === 'incomplete' || day.status === 'off'
          ? 'outline'
          : 'secondary';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{DAY_STATUS_LABEL[day.status]}</Badge>
      {day.late ? <Badge variant="destructive">Late</Badge> : null}
    </span>
  );
}

// --------------------------------------------------------------------- team

function TeamView() {
  const viewer = useViewer();
  const canManage = usePermission('attendance.record.manage');
  const canBranches = usePermission('branch.branch.view');
  const branches = useBranches(canBranches);
  const today = isoDate(new Date());
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(0);
  const query = useAttendance({ ...range, branchId, page });
  const [fixing, setFixing] = useState(false);
  const branchOptions = canBranches && branches.data ? branches.data : viewer.branches;
  const rangeOk = range.from <= range.to && range.to <= addDays(range.from, 61);
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="From"
          type="date"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
        <Field
          label="To"
          type="date"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
          error={rangeOk ? undefined : 'Choose at most 62 days'}
        />
        {branchOptions.length > 1 ? (
          <div className="w-48">
            <SelectField
              label="Branch"
              value={branchId || '__all__'}
              onValueChange={(v) => {
                setBranchId(v === '__all__' ? '' : v);
                setPage(0);
              }}
              options={[
                { value: '__all__', label: 'All branches' },
                ...branchOptions.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </div>
        ) : null}
        {canManage ? (
          <Button variant="outline" onClick={() => setFixing(true)}>
            <Plus className="size-4" aria-hidden /> Add missed punch
          </Button>
        ) : null}
      </div>

      {rangeOk ? (
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          emptyText="No employees to show."
        >
          {(report) => (
            <div className="space-y-3">
              {report.items.map((item) => (
                <TeamRow key={item.employee.id} item={item} timeZone={report.timeZone} />
              ))}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{total} employees</span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {pages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= pages}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </QueryState>
      ) : null}

      <Modal
        open={fixing}
        onClose={() => setFixing(false)}
        title="Add missed punch"
        description="Enter the in time, the out time, or both. The original record is kept; this is logged as an HR entry."
      >
        <ManualPunchForm
          employees={query.data?.items.map((i) => i.employee) ?? []}
          timeZone={query.data?.timeZone ?? 'Asia/Kolkata'}
          onDone={() => setFixing(false)}
        />
      </Modal>
    </div>
  );
}

function TeamRow({
  item,
  timeZone,
}: {
  item: NonNullable<ReturnType<typeof useAttendance>['data']>['items'][number];
  timeZone: string;
}) {
  const days = item.days.filter((d) => d.status !== 'upcoming');
  const present = days.filter((d) => d.status === 'present' || d.status === 'half_day').length;
  const absent = days.filter((d) => d.status === 'absent').length;
  const late = days.filter((d) => d.late).length;
  return (
    <details className="rounded-lg border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
        <span>
          <span className="font-medium">{item.employee.fullName}</span>{' '}
          <span className="font-mono text-xs text-muted-foreground">
            {item.employee.employeeCode} · {item.employee.branch.code}
          </span>
        </span>
        <span className="flex gap-2 text-xs">
          <Badge variant="success">{present} present</Badge>
          <Badge variant={absent ? 'destructive' : 'secondary'}>{absent} absent</Badge>
          <Badge variant="secondary">{late} late</Badge>
        </span>
      </summary>
      <div className="border-t">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Date</TableHead>
              <TableHead className="px-4">In</TableHead>
              <TableHead className="px-4">Out</TableHead>
              <TableHead className="px-4">Worked</TableHead>
              <TableHead className="px-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d.date}>
                <TableCell className="px-4 py-2">{formatDate(d.date)}</TableCell>
                <TableCell className="px-4 py-2 tabular-nums">
                  {formatTime(d.firstIn, timeZone)}
                </TableCell>
                <TableCell className="px-4 py-2 tabular-nums">
                  {formatTime(d.lastOut, timeZone)}
                </TableCell>
                <TableCell className="px-4 py-2">
                  {d.workedMinutes ? formatDuration(d.workedMinutes) : '—'}
                </TableCell>
                <TableCell className="px-4 py-2">
                  <DayBadge day={d} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}

function ManualPunchForm({
  employees,
  timeZone,
  onDone,
}: {
  employees: { id: string; fullName: string; employeeCode: string }[];
  timeZone: string;
  onDone: () => void;
}) {
  const save = useManualPunch();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [inAt, setInAt] = useState('');
  const [outAt, setOutAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employeeId) return setError('Choose an employee');
    if (!inAt && !outAt) return setError('Enter an in time, an out time, or both');
    try {
      await save.mutateAsync({
        employeeId,
        inAt: inAt ? zonedToIso(inAt, timeZone) : null,
        outAt: outAt ? zonedToIso(outAt, timeZone) : null,
        reason,
      });
      toast.success('Punch added');
      onDone();
    } catch (err) {
      setError(handleApiError(err));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <SelectField
        label="Employee"
        value={employeeId}
        onValueChange={setEmployeeId}
        options={employees.map((e) => ({
          value: e.id,
          label: `${e.fullName} (${e.employeeCode})`,
        }))}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="In"
          type="datetime-local"
          value={inAt}
          onChange={(e) => setInAt(e.target.value)}
        />
        <Field
          label="Out"
          type="datetime-local"
          value={outAt}
          onChange={(e) => setOutAt(e.target.value)}
        />
      </div>
      <Field
        label="Reason"
        hint={`Shown in the record. Times are in ${timeZone}.`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <FormActions pending={save.isPending} onCancel={onDone} submit="Add punch" />
    </form>
  );
}

// ------------------------------------------------------------------- shifts

type ShiftCreateIn = z.input<typeof createShiftInputSchema>;
type ShiftCreateOut = z.output<typeof createShiftInputSchema>;

function ShiftsView() {
  const query = useShifts();
  const canManage = usePermission('attendance.shift.manage');
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Add shift
          </Button>
        </div>
      ) : null}
      <QueryState query={query} isEmpty={(d) => d.length === 0} emptyText="No shifts yet.">
        {(shifts) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4">Hours</TableHead>
                  <TableHead className="px-4">Grace</TableHead>
                  <TableHead className="px-4">Full / half day</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="px-4 py-3 font-medium">{s.name}</TableCell>
                    <TableCell className="px-4 py-3">
                      {s.startTime.slice(0, 5)} – {s.endTime.slice(0, 5)}
                    </TableCell>
                    <TableCell className="px-4 py-3">{s.graceMinutes} min</TableCell>
                    <TableCell className="px-4 py-3">
                      {formatDuration(s.fullDayMinutes)} / {formatDuration(s.halfDayMinutes)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canManage ? (
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
          </div>
        )}
      </QueryState>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add shift' : 'Edit shift'}
      >
        {editing ? (
          <ShiftForm shift={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

const SHIFT_FIELDS = [
  'name',
  'startTime',
  'endTime',
  'graceMinutes',
  'fullDayMinutes',
  'halfDayMinutes',
] as const;

function ShiftForm({ shift, onDone }: { shift: Shift | null; onDone: () => void }) {
  const save = useSaveShift();
  // The shift schemas carry cross-field rules, so zod cannot .omit() from them; the form keeps
  // `version` as a hidden default and strips it before sending (the hook adds it back).
  const schema = shift ? updateShiftInputSchema : createShiftInputSchema;
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<
    ShiftCreateIn & { status?: 'active' | 'inactive'; version?: number },
    unknown,
    ShiftCreateOut
  >({
    // The edit schema only adds `status`, so one form type covers both.
    resolver: zodResolver(schema as unknown as typeof createShiftInputSchema),
    defaultValues: {
      name: shift?.name ?? '',
      startTime: shift?.startTime.slice(0, 5) ?? '09:00',
      endTime: shift?.endTime.slice(0, 5) ?? '18:00',
      graceMinutes: shift?.graceMinutes ?? 15,
      fullDayMinutes: shift?.fullDayMinutes ?? 480,
      halfDayMinutes: shift?.halfDayMinutes ?? 240,
      ...(shift ? { status: shift.status, version: shift.version } : {}),
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      const { version: _version, ...input } = values as typeof values & { version?: number };
      void _version;
      await save.mutateAsync({ id: shift?.id, version: shift?.version, input });
      toast.success(shift ? 'Shift updated' : 'Shift added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: [...SHIFT_FIELDS, 'status'] });
    }
  });
  const num = { valueAsNumber: true } as const;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Starts"
          type="time"
          error={errors.startTime?.message}
          {...register('startTime')}
        />
        <Field label="Ends" type="time" error={errors.endTime?.message} {...register('endTime')} />
        <Field
          label="Grace (minutes)"
          type="number"
          hint="Arriving within this time after the start is not late."
          error={errors.graceMinutes?.message}
          {...register('graceMinutes', num)}
        />
        <Field
          label="Full day (minutes)"
          type="number"
          error={errors.fullDayMinutes?.message}
          {...register('fullDayMinutes', num)}
        />
        <Field
          label="Half day (minutes)"
          type="number"
          error={errors.halfDayMinutes?.message}
          {...register('halfDayMinutes', num)}
        />
        {shift ? (
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
      </div>
      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={shift ? 'Save changes' : 'Add shift'}
      />
    </form>
  );
}
