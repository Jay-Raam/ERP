'use client';

import { useState } from 'react';
import { Field } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { FormActions } from '@/features/admin/branches-page';
import { voidPaymentInputSchema } from '@erp/shared';

/** Asks for a short reason before something that cannot be undone, such as cancelling or voiding. */
export function ReasonModal({
  open,
  title,
  description,
  submit,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  submit: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      {open ? (
        <ReasonForm submit={submit} pending={pending} onCancel={onClose} onConfirm={onConfirm} />
      ) : null}
    </Modal>
  );
}

function ReasonForm({
  submit,
  pending,
  onCancel,
  onConfirm,
}: {
  submit: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = voidPaymentInputSchema.safeParse({ reason });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Enter a reason');
          return;
        }
        setError(undefined);
        void onConfirm(parsed.data.reason);
      }}
    >
      <Field
        label="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        error={error}
        autoFocus
      />
      <FormActions pending={pending} onCancel={onCancel} submit={submit} />
    </form>
  );
}
