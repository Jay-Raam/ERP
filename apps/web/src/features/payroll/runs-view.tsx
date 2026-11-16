'use client';

import {
  PAYMENT_METHODS,
  paiseToString,
  parsePaise,
  payRunFormSchema,
  payslipAdjustFormSchema,
} from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';
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
import { METHOD_LABEL } from '@/features/accounts/format';
import { ReasonModal } from '@/features/accounts/reason-form';
import { QueryState } from '@/features/admin/async';
import { FormActions } from '@/features/admin/branches-page';
import { usePermission } from '@/features/auth/viewer';
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import {
  PAGE_SIZE,
  useAdjustPayslip,
  useApproveRun,
  useCancelRun,
  useCreateRun,
  usePayRun,
  usePayslips,
  useRecalculateRun,
  useRun,
  useRuns,
  type PayrollRun,
  type Payslip,
  type Skipped,
} from './api';
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  finishedMonths,
  formatDays,
  formatMoney,
  localToday,
} from './format';

export function RunsView() {
  const canPrepare = usePermission('payroll.run.prepare');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const query = useRuns(page);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canPrepare ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Prepare payroll
          </Button>
        ) : null}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No payroll prepared yet."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Month</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4 text-right">People</TableHead>
                  <TableHead className="px-4 text-right">Gross</TableHead>
                  <TableHead className="px-4 text-right">Deductions</TableHead>
                  <TableHead className="px-4 text-right">Net pay</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="px-4 py-3 font-medium">{r.label}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {r.employeeCount}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(r.grossTotal)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(r.deductionsTotal)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(r.netTotal)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open payroll for ${r.label}`}
                        onClick={() => {
                          setSkipped([]);
                          setOpenId(r.id);
                        }}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={page}
              total={data.total}
              noun="payroll run"
              pageSize={PAGE_SIZE}
              onPage={setPage}
            />
          </div>
        )}
      </QueryState>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Prepare payroll"
        description="Works out every payslip from the salaries and the month's attendance."
      >
        {creating ? (
          <CreateForm
            onDone={(run, skippedPeople) => {
              setCreating(false);
              setSkipped(skippedPeople);
              setOpenId(run.id);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : null}
      </Modal>
      <RunModal id={openId} skipped={skipped} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ----------------------------------------------------------------- prepare

function CreateForm({
  onDone,
  onCancel,
}: {
  onDone: (run: PayrollRun, skipped: Skipped[]) => void;
  onCancel: () => void;
}) {
  const create = useCreateRun();
  const months = finishedMonths(localToday());
  const [month, setMonth] = useState(months[0]!.value);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string>();

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        try {
          const made = await create.mutateAsync({ month, notes: notes.trim() || null });
          toast.success(`Payroll prepared for ${made.run.label}`);
          onDone(made.run, made.skipped);
        } catch (err) {
          setError(handleApiError(err));
        }
      }}
    >
      <SelectField label="Month" value={month} onValueChange={setMonth} options={months} />
      <Field
        label="Notes"
        hint="Optional"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        maxLength={200}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <FormActions pending={create.isPending} onCancel={onCancel} submit="Prepare" />
    </form>
  );
}

// ------------------------------------------------------------------ detail

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

type Sub = 'pay' | 'cancel' | null;

function RunModal({
  id,
  skipped,
  onClose,
}: {
  id: string | null;
  skipped: Skipped[];
  onClose: () => void;
}) {
  const query = useRun(id);
  const canPrepare = usePermission('payroll.run.prepare');
  const canApprove = usePermission('payroll.run.approve');
  const canPay = usePermission('payroll.run.pay');
  const approve = useApproveRun();
  const recalc = useRecalculateRun();
  const cancel = useCancelRun();
  const [sub, setSub] = useState<Sub>(null);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(0);
  const slips = usePayslips(id, { search, page });
  const [extraSkipped, setExtraSkipped] = useState<Skipped[]>([]);

  const run = query.data;
  const close = () => {
    setSub(null);
    setAdjusting(null);
    setSearch('');
    setTyped('');
    setPage(0);
    setExtraSkipped([]);
    onClose();
  };
  const missing = extraSkipped.length > 0 ? extraSkipped : skipped;

  const doApprove = async (r: PayrollRun) => {
    try {
      await approve.mutateAsync({ id: r.id, version: r.version });
      toast.success('Payroll approved and posted to the books');
    } catch (error) {
      handleApiError(error);
    }
  };
  const doRecalc = async (r: PayrollRun) => {
    try {
      const out = await recalc.mutateAsync({ id: r.id, version: r.version });
      setExtraSkipped(out.skipped);
      toast.success('Payslips worked out again');
    } catch (error) {
      handleApiError(error);
    }
  };

  return (
    <Modal
      size="lg"
      open={id !== null}
      onClose={close}
      title={run ? `Payroll: ${run.label}` : 'Payroll'}
      description={run ? `Prepared by ${run.preparedByName}` : undefined}
    >
      <QueryState query={query} emptyText="Not found.">
        {(r) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              <span className="text-muted-foreground">
                {r.periodStart} to {r.periodEnd} · {r.employeeCount} people
              </span>
              {r.approvedByName ? <span>Approved by {r.approvedByName}</span> : null}
              {r.status === 'paid' ? (
                <span>
                  Paid {r.paidOn} by {r.paidByName} (
                  {METHOD_LABEL[r.payMethod as keyof typeof METHOD_LABEL] ?? r.payMethod}
                  {r.payReference ? `, ${r.payReference}` : ''})
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Gross pay" value={formatMoney(r.grossTotal)} />
              <Stat label="Deductions" value={formatMoney(r.deductionsTotal)} />
              <Stat label="Net pay" value={formatMoney(r.netTotal)} />
            </div>

            {r.cancelReason ? (
              <p className="text-sm text-destructive">Cancelled: {r.cancelReason}</p>
            ) : null}

            {r.status === 'draft' && (r.incompleteCount || r.cappedCount || missing.length > 0) ? (
              <div
                role="status"
                className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="space-y-1">
                  {r.incompleteCount ? (
                    <p>
                      {r.incompleteCount} payslip{r.incompleteCount === 1 ? ' has' : 's have'} a day
                      with a punch in but no punch out. Those days are not paid. Fix the attendance
                      and work the payslips out again.
                    </p>
                  ) : null}
                  {r.cappedCount ? (
                    <p>
                      {r.cappedCount} payslip{r.cappedCount === 1 ? ' has' : 's have'} deductions
                      cut down so the net pay is not negative.
                    </p>
                  ) : null}
                  {missing.length > 0 ? (
                    <p>
                      No salary set for {missing.map((m) => m.employeeName).join(', ')}. They are
                      not in this payroll.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {r.status === 'draft' && canPrepare ? (
                <Button
                  variant="outline"
                  onClick={() => void doRecalc(r)}
                  disabled={recalc.isPending}
                >
                  Work out again
                </Button>
              ) : null}
              {r.status === 'draft' && canApprove ? (
                <Button onClick={() => void doApprove(r)} disabled={approve.isPending}>
                  Approve
                </Button>
              ) : null}
              {r.status === 'approved' && canPay ? (
                <Button onClick={() => setSub('pay')}>Mark as paid</Button>
              ) : null}
              {(r.status === 'draft' && canPrepare) ||
              (r.status === 'approved' && canPrepare && canApprove) ? (
                <Button variant="outline" onClick={() => setSub('cancel')}>
                  Cancel payroll
                </Button>
              ) : null}
            </div>
            {r.status === 'draft' ? (
              <p className="text-xs text-muted-foreground">
                Someone other than the person who prepared this must approve it.
              </p>
            ) : null}

            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(typed.trim());
                setPage(0);
              }}
            >
              <div className="w-60">
                <Field
                  label="Find a payslip"
                  placeholder="Name or code"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  maxLength={80}
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>

            <QueryState
              query={slips}
              isEmpty={(d) => d.items.length === 0}
              emptyText="No payslips found."
            >
              {(data) => (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-3">Employee</TableHead>
                        <TableHead className="px-3 text-right">Paid days</TableHead>
                        <TableHead className="px-3 text-right">Earned</TableHead>
                        <TableHead className="px-3 text-right">Bonus</TableHead>
                        <TableHead className="px-3 text-right">Deductions</TableHead>
                        <TableHead className="px-3 text-right">Net pay</TableHead>
                        <TableHead className="px-3" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="px-3 py-2">
                            <div className="font-medium">{s.employeeName}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {s.employeeCode}
                            </div>
                            <div className="flex flex-wrap gap-1 pt-1">
                              {s.incompleteDays > 0 ? (
                                <Badge variant="outline">Open punch</Badge>
                              ) : null}
                              {s.deductionsCapped ? (
                                <Badge variant="outline">Deduction cut</Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right tabular-nums">
                            {formatDays(s.paidHalfDays)} / {s.daysInPeriod}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(s.earned)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(s.bonus)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right tabular-nums">
                            {formatMoney(
                              paiseToString(
                                parsePaise(s.deductions) + parsePaise(s.otherDeductions),
                              ),
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right font-medium tabular-nums">
                            {formatMoney(s.netPay)}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            {r.status === 'draft' && canPrepare ? (
                              <Button
                                size="sm"
                                variant="outline"
                                aria-label={`Adjust payslip of ${s.employeeName}`}
                                onClick={() => setAdjusting(s)}
                              >
                                Adjust
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Pager
                    page={page}
                    total={data.total}
                    noun="payslip"
                    pageSize={PAGE_SIZE}
                    onPage={setPage}
                  />
                </div>
              )}
            </QueryState>

            <Modal
              open={sub === 'pay'}
              onClose={() => setSub(null)}
              title="Mark as paid"
              description={`Pays ${formatMoney(r.netTotal)} to ${r.employeeCount} people.`}
            >
              {sub === 'pay' ? <PayForm run={r} onDone={() => setSub(null)} /> : null}
            </Modal>
            <Modal
              open={adjusting !== null}
              onClose={() => setAdjusting(null)}
              title={adjusting ? `Adjust: ${adjusting.employeeName}` : 'Adjust'}
              description="A bonus adds to the pay. A one-off deduction comes off it."
            >
              {adjusting ? (
                <AdjustForm
                  key={adjusting.id}
                  run={r}
                  slip={adjusting}
                  onDone={() => setAdjusting(null)}
                />
              ) : null}
            </Modal>
            <ReasonModal
              open={sub === 'cancel'}
              title="Cancel payroll"
              description={
                r.status === 'approved'
                  ? 'This reverses what was posted to the books.'
                  : 'The payslips are kept, but the month can be prepared again.'
              }
              submit="Cancel payroll"
              pending={cancel.isPending}
              onClose={() => setSub(null)}
              onConfirm={async (reason) => {
                try {
                  await cancel.mutateAsync({ id: r.id, version: r.version, reason });
                  toast.success('Payroll cancelled');
                  setSub(null);
                } catch (error) {
                  handleApiError(error);
                }
              }}
            />
          </div>
        )}
      </QueryState>
    </Modal>
  );
}

// ------------------------------------------------------------------ adjust

type AdjustIn = z.input<typeof payslipAdjustFormSchema>;

function AdjustForm({ run, slip, onDone }: { run: PayrollRun; slip: Payslip; onDone: () => void }) {
  const adjust = useAdjustPayslip();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AdjustIn>({
    resolver: zodResolver(payslipAdjustFormSchema) as Resolver<AdjustIn>,
    defaultValues: {
      bonus: slip.bonus,
      otherDeductions: slip.otherDeductions,
      note: slip.adjustmentNote ?? '',
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await adjust.mutateAsync({
        id: slip.id,
        input: { ...values, note: values.note || null, version: run.version },
      });
      toast.success('Payslip updated');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['bonus', 'otherDeductions', 'note'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Bonus (₹)"
          inputMode="decimal"
          error={errors.bonus?.message}
          {...register('bonus')}
        />
        <Field
          label="One-off deduction (₹)"
          inputMode="decimal"
          error={errors.otherDeductions?.message}
          {...register('otherDeductions')}
        />
      </div>
      <Field label="Note" maxLength={120} error={errors.note?.message} {...register('note')} />
      <FormActions pending={adjust.isPending} onCancel={onDone} submit="Save" />
    </form>
  );
}

// --------------------------------------------------------------------- pay

type PayIn = z.input<typeof payRunFormSchema>;

function PayForm({ run, onDone }: { run: PayrollRun; onDone: () => void }) {
  const pay = usePayRun();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<PayIn>({
    resolver: zodResolver(payRunFormSchema) as Resolver<PayIn>,
    defaultValues: { method: 'bank', paidOn: localToday(), reference: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await pay.mutateAsync({
        id: run.id,
        input: { ...values, reference: values.reference || null, version: run.version },
      });
      toast.success('Payroll marked as paid');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['method', 'paidOn', 'reference'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on" type="date" error={errors.paidOn?.message} {...register('paidOn')} />
        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <SelectField
              label="Method"
              value={field.value}
              onValueChange={field.onChange}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
              error={errors.method?.message}
            />
          )}
        />
      </div>
      <Field
        label="Reference"
        hint="Bank batch or voucher number"
        maxLength={40}
        error={errors.reference?.message}
        {...register('reference')}
      />
      <FormActions pending={pay.isPending} onCancel={onDone} submit="Mark as paid" />
    </form>
  );
}
