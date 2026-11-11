import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  return (
    <span
      className={
        status === 'active'
          ? 'rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success'
          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
      }
    >
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  );
}

export function NoAccess() {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border border-dashed p-8 text-center">
      <h1 className="text-lg font-semibold">No access</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your role does not include this page. Ask an administrator if you need it.
      </p>
    </div>
  );
}
