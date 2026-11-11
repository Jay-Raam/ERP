'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Hook for client error reporting once a reporting service is chosen.
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">This page hit a problem</h1>
      <p className="text-muted-foreground">
        Your data is safe. Try again, and if it keeps happening share the reference below with
        support.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <div>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
