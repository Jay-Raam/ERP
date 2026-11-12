'use client';

import { createHolidayInputSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
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
  useDeleteHoliday,
  useSaveHoliday,
  useSaveWeeklyOff,
  useWorkCalendar,
  type Holiday,
  type WorkCalendar,
} from './api';
import { WEEKDAYS, describeWeeklyOff, formatDate } from './format';

type HolidayIn = z.input<typeof createHolidayInputSchema>;

/** Days the organisation is closed: the weekly offs, and the holidays of one year. */
export function CalendarView() {
  const canManage = usePermission('attendance.holiday.manage');
  const [year, setYear] = useState<number | null>(null);
  const query = useWorkCalendar(year);
  return (
    <QueryState query={query} emptyText="No calendar yet.">
      {(calendar) => (
        <div className="space-y-6">
          <WeeklyOffCard calendar={calendar} canManage={canManage} />
          <HolidaysCard calendar={calendar} canManage={canManage} onYear={setYear} />
        </div>
      )}
    </QueryState>
  );
}

function WeeklyOffCard({ calendar, canManage }: { calendar: WorkCalendar; canManage: boolean }) {
  const save = useSaveWeeklyOff();
  // Edits are kept until saved; `null` means "showing what the server has".
  const [draft, setDraft] = useState<number[] | null>(null);
  const days = draft ?? calendar.weeklyOffDays;
  const dirty = draft !== null && draft.join() !== calendar.weeklyOffDays.join();

  const toggle = (day: number, on: boolean) =>
    setDraft((current) => {
      const base = current ?? calendar.weeklyOffDays;
      const next = on ? [...base, day] : base.filter((d) => d !== day);
      return [...new Set(next)].sort((a, b) => a - b);
    });

  async function onSave() {
    try {
      await save.mutateAsync(days);
      setDraft(null);
      toast.success('Weekly off days saved');
    } catch (error) {
      handleApiError(error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly off days</CardTitle>
        <CardDescription>
          {canManage
            ? 'Nobody is marked absent on these days.'
            : `Weekly off: ${describeWeeklyOff(calendar.weeklyOffDays)}.`}
        </CardDescription>
      </CardHeader>
      {canManage ? (
        <CardContent className="space-y-4">
          <div role="group" aria-label="Weekly off days" className="flex flex-wrap gap-x-6 gap-y-3">
            {WEEKDAYS.map((name, day) => (
              <div key={name} className="flex items-center gap-2">
                <Checkbox
                  id={`off-${day}`}
                  checked={days.includes(day)}
                  onCheckedChange={(checked) => toggle(day, checked === true)}
                />
                <Label htmlFor={`off-${day}`}>{name}</Label>
              </div>
            ))}
          </div>
          {days.length >= 7 ? (
            <p role="alert" className="text-sm text-destructive">
              Keep at least one working day.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={!dirty || days.length >= 7 || save.isPending}>
              Save
            </Button>
            {dirty ? (
              <Button variant="outline" onClick={() => setDraft(null)}>
                Reset
              </Button>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function HolidaysCard({
  calendar,
  canManage,
  onYear,
}: {
  calendar: WorkCalendar;
  canManage: boolean;
  onYear: (year: number) => void;
}) {
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Holidays</CardTitle>
          <CardDescription>Days the whole organisation is closed.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label="Previous year"
            onClick={() => onYear(calendar.year - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="w-14 text-center text-sm font-medium tabular-nums">{calendar.year}</span>
          <Button
            size="icon"
            variant="outline"
            aria-label="Next year"
            onClick={() => onYear(calendar.year + 1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          {canManage ? (
            <Button className="sm:ml-2" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add holiday
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {calendar.holidays.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No holidays set for {calendar.year}.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">Name</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {calendar.holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="px-4 py-3">{formatDate(h.holidayDate)}</TableCell>
                    <TableCell className="px-4 py-3 font-medium">{h.name}</TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      {canManage ? (
                        <span className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Edit ${h.name}`}
                            onClick={() => setEditing(h)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Delete ${h.name}`}
                            onClick={() => setRemoving(h)}
                          >
                            Delete
                          </Button>
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add holiday' : 'Edit holiday'}
      >
        {editing ? (
          <HolidayForm
            holiday={editing === 'new' ? null : editing}
            year={calendar.year}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Modal>
      <DeleteHoliday holiday={removing} onClose={() => setRemoving(null)} />
    </Card>
  );
}

function HolidayForm({
  holiday,
  year,
  onDone,
}: {
  holiday: Holiday | null;
  year: number;
  onDone: () => void;
}) {
  const save = useSaveHoliday();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<HolidayIn>({
    resolver: zodResolver(createHolidayInputSchema),
    defaultValues: {
      holidayDate: holiday?.holidayDate ?? `${year}-01-01`,
      name: holiday?.name ?? '',
    },
  });
  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ id: holiday?.id, version: holiday?.version, input: values });
      toast.success(holiday ? 'Holiday updated' : 'Holiday added');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['holidayDate', 'name'] });
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field
        label="Date"
        type="date"
        error={errors.holidayDate?.message}
        {...register('holidayDate')}
      />
      <Field label="Name" error={errors.name?.message} {...register('name')} />
      <FormActions
        pending={save.isPending}
        onCancel={onDone}
        submit={holiday ? 'Save changes' : 'Add holiday'}
      />
    </form>
  );
}

function DeleteHoliday({ holiday, onClose }: { holiday: Holiday | null; onClose: () => void }) {
  const remove = useDeleteHoliday();
  return (
    <AlertDialog open={holiday !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete holiday</AlertDialogTitle>
          <AlertDialogDescription>
            {holiday ? (
              <>
                Delete <strong>{holiday.name}</strong> on {formatDate(holiday.holidayDate)}? People
                who did not clock in that day will show as absent again.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={remove.isPending}
            onClick={async (event) => {
              event.preventDefault();
              if (!holiday) return;
              try {
                await remove.mutateAsync(holiday.id);
                toast.success('Holiday deleted');
                onClose();
              } catch (error) {
                handleApiError(error);
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
