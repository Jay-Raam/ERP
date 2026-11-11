'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
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
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }
  if (query.isError) {
    const action = resolveApiError(query.error);
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 p-4">
        <p className="text-sm">{action.message}</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
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
