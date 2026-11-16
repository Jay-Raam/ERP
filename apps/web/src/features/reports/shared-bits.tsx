'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          tone === 'bad'
            ? 'text-destructive'
            : tone === 'good'
              ? 'text-emerald-600 dark:text-emerald-400'
              : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="rounded-lg border bg-card">{children}</div>
    </section>
  );
}

/** A label and an amount on one line, for statements such as the balance sheet. */
export function AmountRow({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 px-4 py-2 text-sm ${
        strong ? 'border-t bg-muted/40 font-semibold' : ''
      } ${muted ? 'text-muted-foreground' : ''}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** From and to dates with an Apply button, so a half-typed date never fires a query. */
export function DateRangeForm({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (range: { from: string; to: string }) => void;
}) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ from: f, to: t });
      }}
    >
      <div className="w-40">
        <Field label="From" type="date" value={f} onChange={(e) => setF(e.target.value)} />
      </div>
      <div className="w-40">
        <Field label="To" type="date" value={t} onChange={(e) => setT(e.target.value)} />
      </div>
      <Button type="submit" variant="outline">
        Show
      </Button>
    </form>
  );
}
