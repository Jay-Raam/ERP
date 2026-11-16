'use client';

import { createJournalEntryInputSchema } from '@erp/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
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
import { useBranches } from '@/features/admin/api';
import { QueryState } from '@/features/admin/async';
import { FormActions } from '@/features/admin/branches-page';
import { usePermission, useViewer } from '@/features/auth/viewer';
import { Pager } from '@/features/store/pager';
import { handleApiError } from '@/lib/handle-api-error';
import { parsePaise, paiseToString } from '@erp/shared';
import {
  PAGE_SIZE,
  useAccounts,
  useCreateEntry,
  useJournal,
  useJournalEntry,
  useReverseEntry,
  type JournalFilter,
} from './api';
import { SOURCE_LABEL, formatMoney, localToday } from './format';
import { ReasonModal } from './reason-form';

const NONE = '__none__';

export function JournalView() {
  const canCreate = usePermission('accounts.journal.create');
  const [filter, setFilter] = useState<JournalFilter>({ search: '', from: '', to: '', page: 0 });
  const [typed, setTyped] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useJournal(filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ ...filter, search: typed.trim(), page: 0 });
          }}
        >
          <div className="w-52">
            <Field
              label="Search"
              placeholder="Number or memo"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="w-40">
            <Field
              label="From"
              type="date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value, page: 0 })}
            />
          </div>
          <div className="w-40">
            <Field
              label="To"
              type="date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value, page: 0 })}
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {canCreate ? (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> New entry
          </Button>
        ) : null}
      </div>

      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        emptyText="No journal entries found."
      >
        {(data) => (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">Number</TableHead>
                  <TableHead className="px-4">Date</TableHead>
                  <TableHead className="px-4">Memo</TableHead>
                  <TableHead className="px-4">Source</TableHead>
                  <TableHead className="px-4 text-right">Amount</TableHead>
                  <TableHead className="px-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="px-4 py-3 font-mono text-xs">{e.number}</TableCell>
                    <TableCell className="px-4 py-3">{e.entryDate}</TableCell>
                    <TableCell className="px-4 py-3">{e.memo}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge variant="outline">{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(e.total)}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Open ${e.number}`}
                        onClick={() => setOpenId(e.id)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager
              page={filter.page}
              total={data.total}
              noun="entry"
              pageSize={PAGE_SIZE}
              onPage={(page) => setFilter({ ...filter, page })}
            />
          </div>
        )}
      </QueryState>

      <Modal size="lg" open={creating} onClose={() => setCreating(false)} title="New journal entry">
        {creating ? <EntryForm onDone={() => setCreating(false)} /> : null}
      </Modal>
      <EntryModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ detail

function EntryModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useJournalEntry(id);
  const canCreate = usePermission('accounts.journal.create');
  const reverse = useReverseEntry();
  const [reversing, setReversing] = useState(false);

  return (
    <Modal
      open={id !== null}
      onClose={() => {
        setReversing(false);
        onClose();
      }}
      title={query.data ? query.data.number : 'Journal entry'}
      description={query.data?.memo}
    >
      <QueryState query={query} emptyText="Not found.">
        {(e) => (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {e.entryDate} · {SOURCE_LABEL[e.sourceType] ?? e.sourceType} · {e.createdByName}
              {e.branch ? ` · ${e.branch.name}` : ''}
            </p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Account</TableHead>
                    <TableHead className="px-3 text-right">Debit</TableHead>
                    <TableHead className="px-3 text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-3 py-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {l.account.code}
                        </span>{' '}
                        {l.account.name}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {Number(l.debit) > 0 ? formatMoney(l.debit) : ''}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">
                        {Number(l.credit) > 0 ? formatMoney(l.credit) : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {e.reversalOf ? (
              <p className="text-sm text-muted-foreground">This entry reverses an earlier one.</p>
            ) : null}
            {e.reversedById ? (
              <p className="text-sm text-muted-foreground">This entry has been reversed.</p>
            ) : null}
            {e.sourceType === 'manual' && !e.reversedById && canCreate ? (
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setReversing(true)}>
                  Reverse entry
                </Button>
              </div>
            ) : null}
            <ReasonModal
              open={reversing}
              title={`Reverse ${e.number}`}
              description="Posts a new entry with debits and credits swapped. The original stays on record."
              submit="Reverse entry"
              pending={reverse.isPending}
              onClose={() => setReversing(false)}
              onConfirm={async (reason) => {
                try {
                  await reverse.mutateAsync({ id: e.id, reason });
                  toast.success('Entry reversed');
                  setReversing(false);
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

// -------------------------------------------------------------------- form

interface EntryIn {
  entryDate: string;
  memo: string;
  branchId: string;
  lines: { accountId: string; debit: string; credit: string }[];
}

const MONEY = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;
const paise = (v: string) => (MONEY.test(v.trim()) ? parsePaise(v.trim()) : 0n);

function EntryForm({ onDone }: { onDone: () => void }) {
  const viewer = useViewer();
  const create = useCreateEntry();
  const accounts = useAccounts();
  const canBranches = usePermission('branch.branch.view');
  const branchQuery = useBranches(canBranches);
  const branches = (canBranches && branchQuery.data ? branchQuery.data : viewer.branches).filter(
    (b) => !('status' in b) || (b as { status: string }).status === 'active',
  );
  const organisationWide = viewer.role.dataScope === 'organisation';
  const [formError, setFormError] = useState<string>();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<EntryIn>({
    defaultValues: {
      entryDate: localToday(),
      memo: '',
      branchId: organisationWide ? NONE : (branches[0]?.id ?? NONE),
      lines: [
        { accountId: '', debit: '', credit: '' },
        { accountId: '', debit: '', credit: '' },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const watched = useWatch({ control, name: 'lines' }) ?? [];
  const debit = watched.reduce((sum, l) => sum + paise(l?.debit ?? ''), 0n);
  const credit = watched.reduce((sum, l) => sum + paise(l?.credit ?? ''), 0n);
  const balanced = debit === credit && debit > 0n;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined);
    const parsed = createJournalEntryInputSchema.safeParse({
      entryDate: values.entryDate,
      memo: values.memo,
      branchId: values.branchId === NONE ? null : values.branchId,
      lines: values.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit.trim() === '' ? '0' : l.debit,
        credit: l.credit.trim() === '' ? '0' : l.credit,
      })),
    });
    if (!parsed.success) {
      let shown = false;
      for (const issue of parsed.error.issues) {
        const [head, index, field] = issue.path;
        if (head === 'lines' && typeof index === 'number' && typeof field === 'string') {
          setError(`lines.${index}.${field === 'accountId' ? 'accountId' : 'debit'}`, {
            message: issue.message,
          });
        } else if (head === 'entryDate' || head === 'memo') {
          setError(head, { message: issue.message });
        } else if (!shown) {
          setFormError(issue.message);
          shown = true;
        }
      }
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      toast.success('Journal entry posted');
      onDone();
    } catch (error) {
      setFormError(handleApiError(error));
    }
  });

  const accountOptions = (accounts.data ?? [])
    .filter((a) => a.status === 'active')
    .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Date"
          type="date"
          error={errors.entryDate?.message}
          {...register('entryDate')}
        />
        <Field label="Memo" maxLength={200} error={errors.memo?.message} {...register('memo')} />
        <Controller
          control={control}
          name="branchId"
          render={({ field }) => (
            <SelectField
              label="Branch"
              value={field.value}
              onValueChange={field.onChange}
              options={[
                ...(organisationWide ? [{ value: NONE, label: 'Whole organisation' }] : []),
                ...branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
              ]}
            />
          )}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Lines</p>
        {fields.map((f, index) => (
          <div key={f.id} className="grid items-start gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
            <Controller
              control={control}
              name={`lines.${index}.accountId`}
              render={({ field }) => (
                <SelectField
                  label="Account"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={accountOptions}
                  error={errors.lines?.[index]?.accountId?.message}
                />
              )}
            />
            <Field
              label="Debit"
              inputMode="decimal"
              placeholder="0.00"
              error={errors.lines?.[index]?.debit?.message}
              {...register(`lines.${index}.debit`)}
            />
            <Field
              label="Credit"
              inputMode="decimal"
              placeholder="0.00"
              {...register(`lines.${index}.credit`)}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="mt-6"
              aria-label={`Remove line ${index + 1}`}
              disabled={fields.length <= 2}
              onClick={() => remove(index)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={fields.length >= 50}
          onClick={() => append({ accountId: '', debit: '', credit: '' })}
        >
          <Plus className="size-4" aria-hidden /> Add line
        </Button>
      </div>

      <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
        <div className="flex justify-between">
          <span>Total debit</span>
          <span className="tabular-nums">{formatMoney(paiseToString(debit))}</span>
        </div>
        <div className="flex justify-between">
          <span>Total credit</span>
          <span className="tabular-nums">{formatMoney(paiseToString(credit))}</span>
        </div>
        <p
          className={`pt-1 text-xs ${balanced ? 'text-muted-foreground' : 'text-destructive'}`}
          role="status"
        >
          {balanced
            ? 'Balanced.'
            : `Debits and credits must match (difference ${formatMoney(
                paiseToString(debit > credit ? debit - credit : credit - debit),
              )}).`}
        </p>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <FormActions pending={create.isPending} onCancel={onDone} submit="Post entry" />
    </form>
  );
}
