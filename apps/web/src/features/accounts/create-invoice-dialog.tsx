'use client';

import { invoiceFormSchema, type InvoiceKind } from '@erp/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { FormActions } from '@/features/admin/branches-page';
import { handleApiError } from '@/lib/handle-api-error';
import { useCreateInvoice } from './api';
import { KIND_LABEL, localToday } from './format';

type FormIn = z.input<typeof invoiceFormSchema>;

/**
 * Turns a delivery (sales) or a goods receipt (purchase) into a draft invoice or bill. The
 * amounts are never typed here: the server prices it from the order and what was delivered.
 */
export function CreateInvoiceDialog({
  kind,
  sourceId,
  sourceNumber,
  onClose,
}: {
  kind: InvoiceKind;
  sourceId: string | null;
  sourceNumber: string;
  onClose: () => void;
}) {
  const word = KIND_LABEL[kind].one;
  return (
    <Modal
      open={sourceId !== null}
      onClose={onClose}
      title={`Create ${word} from ${sourceNumber}`}
      description="Amounts come from the order prices and the quantities on this document."
    >
      {sourceId ? <Form kind={kind} sourceId={sourceId} word={word} onDone={onClose} /> : null}
    </Modal>
  );
}

function Form({
  kind,
  sourceId,
  word,
  onDone,
}: {
  kind: InvoiceKind;
  sourceId: string;
  word: string;
  onDone: () => void;
}) {
  const create = useCreateInvoice();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormIn>({
    resolver: zodResolver(invoiceFormSchema) as Resolver<FormIn>,
    defaultValues: { invoiceDate: localToday(), dueDate: '', reference: '', notes: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const result = await create.mutateAsync({
        kind,
        sourceId,
        invoiceDate: values.invoiceDate,
        dueDate: values.dueDate || null,
        reference: values.reference || null,
        notes: values.notes || null,
      });
      toast.success(`Draft ${word} ${result.createInvoice.number} created`, {
        description: 'Find it under Accounts to review and post.',
      });
      onDone();
    } catch (error) {
      handleApiError(error, {
        setError,
        fields: ['invoiceDate', 'dueDate', 'reference', 'notes'],
      });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${word[0]!.toUpperCase()}${word.slice(1)} date`}
          type="date"
          error={errors.invoiceDate?.message}
          {...register('invoiceDate')}
        />
        <Field
          label="Due on"
          type="date"
          hint="Leave empty if it is due on the invoice date."
          error={errors.dueDate?.message}
          {...register('dueDate')}
        />
      </div>
      <Field
        label={kind === 'purchase' ? 'Supplier bill no.' : 'Reference'}
        maxLength={40}
        error={errors.reference?.message}
        {...register('reference')}
      />
      <Field label="Notes" maxLength={300} error={errors.notes?.message} {...register('notes')} />
      <FormActions pending={create.isPending} onCancel={onDone} submit={`Create draft ${word}`} />
    </form>
  );
}
