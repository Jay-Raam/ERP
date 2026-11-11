import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

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
    <Badge variant={status === 'active' ? 'success' : 'secondary'}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </Badge>
  );
}

export function NoAccess() {
  return (
    <Alert className="mx-auto max-w-md">
      <AlertTitle>No access</AlertTitle>
      <AlertDescription>
        Your role does not include this page. Ask an administrator if you need it.
      </AlertDescription>
    </Alert>
  );
}
