'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveApiError } from '@/lib/api-error';

/** Loading, error-with-retry and empty states shared by the admin lists. */
export function QueryState<T>({
  query,
  isEmpty,
  emptyText,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyText: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    const action = resolveApiError(query.error);
    return (
      <Alert variant="destructive">
        <AlertTitle>{action.message}</AlertTitle>
        <AlertDescription>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (isEmpty?.(query.data)) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return <>{children(query.data)}</>;
}
