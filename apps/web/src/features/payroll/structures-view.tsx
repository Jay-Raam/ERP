'use client';

import { paiseToString, parsePaise, salaryFormSchema } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
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
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import {
  PAGE_SIZE,
  useSaveStructure,
  useStructures,
  type Structure,
  type StructureFilter,
} from './api';
import { formatMoney } from './format';

type SalaryIn = z.input<typeof salaryFormSchema>;

const grossOf = (s: Structure) =>
  paiseToString(
    parsePaise(s.basic ?? '0') + parsePaise(s.hra ?? '0') + parsePaise(s.allowance ?? '0'),
  );

export function StructuresView() {
  const canManage = usePermission('payroll.structure.manage');
  const [filter, setFilter] = useState<StructureFilter>({
    search: '',
    missingOnly: false,
    page: 0,
  });
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<Structure | null>(null);
  const query = useStructures(filter);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ ...filter, search: typed.trim(), page: 0 });
        }}
      >
        <div className="w-60">
          <Field
            label="Search"
            placeholder="Name or employee code"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={80}
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="missing-only"
            checked={filter.missingOnly}
            onCheckedChange={(v) => setFilter({ ...filter, missingOnly: v === true, page: 0 })}
          />
          <Label htmlFor="missing-only">Only people with no salary yet</Label>
        </div>
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
                  <TableHead className="px-4">Employee</TableHead>
                  <TableHead className="px-4">Branch</TableHead>
                  <TableHead className="px-4 text-right">Basic</TableHead>
                  <TableHead className="px-4 text-right">HRA</TableHead>
                  <TableHead className="px-4 text-right">Allowance</TableHead>
                  <TableHead className="px-4 text-right">Gross</TableHead>
                  <TableHead className="px-4 text-right">Deductions</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.employeeId}>
                    <TableCell className="px-4 py-3">
                      <div className="font-medium">{s.employeeName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {s.employeeCode}
                        {s.designation ? ` · ${s.designation}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">{s.branch.name}</TableCell>
                    {s.basic === null ? (
                      <TableCell colSpan={5} className="px-4 py-3 text-muted-foreground">
                        No salary set
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(s.basic)}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(s.hra ?? '0')}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(s.allowance ?? '0')}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                          {formatMoney(grossOf(s))}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(s.deductions ?? '0')}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="px-4 py-3 text-right">
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${s.basic === null ? 'Set' : 'Edit'} salary of ${s.employeeName}`}
                          onClick={() => setEditing(s)}
                        >
                          {s.basic === null ? 'Set salary' : 'Edit'}
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
              noun="employee"
              pageSize={PAGE_SIZE}
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Salary of ${editing.employeeName}` : 'Salary'}
        description="Monthly amounts in rupees. Pay is cut for each day of absence."
      >
        {editing ? (
          <SalaryForm key={editing.employeeId} row={editing} onDone={() => setEditing(null)} />
        ) : null}
      </Modal>
    </div>
  );
}

function SalaryForm({ row, onDone }: { row: Structure; onDone: () => void }) {
  const save = useSaveStructure();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<SalaryIn>({
    resolver: zodResolver(salaryFormSchema) as Resolver<SalaryIn>,
    defaultValues: {
      basic: row.basic ?? '',
      hra: row.hra ?? '0',
      allowance: row.allowance ?? '0',
      deductions: row.deductions ?? '0',
    },
  });
  const [basic, hra, allowance] = useWatch({ control, name: ['basic', 'hra', 'allowance'] });
  const gross = (() => {
    try {
      return paiseToString(
        parsePaise(basic || '0') + parsePaise(hra || '0') + parsePaise(allowance || '0'),
      );
    } catch {
      return null;
    }
  })();

  const onSubmit = handleSubmit(async (values) => {
    try {
      await save.mutateAsync({ ...values, employeeId: row.employeeId, version: row.version });
      toast.success('Salary saved');
      onDone();
    } catch (error) {
      handleApiError(error, { setError, fields: ['basic', 'hra', 'allowance', 'deductions'] });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Basic (₹)"
          inputMode="decimal"
          error={errors.basic?.message}
          {...register('basic')}
        />
        <Field
          label="HRA (₹)"
          inputMode="decimal"
          error={errors.hra?.message}
          {...register('hra')}
        />
        <Field
          label="Allowance (₹)"
          inputMode="decimal"
          error={errors.allowance?.message}
          {...register('allowance')}
        />
        <Field
          label="Fixed deductions (₹)"
          inputMode="decimal"
          hint="Taken every month, such as PF or a loan instalment"
          error={errors.deductions?.message}
          {...register('deductions')}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Monthly gross:{' '}
        <span className="font-medium text-foreground">{gross ? formatMoney(gross) : '—'}</span>
      </p>
      <FormActions pending={save.isPending} onCancel={onDone} submit="Save salary" />
    </form>
  );
}
