'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { resolveApiError } from '@/lib/api-error';
import { ViewerProvider, useViewerQuery } from './viewer';

/**
 * Loads the signed-in user before showing any app screen. If the session has
 * ended (and could not be refreshed) the user goes to sign-in and comes back
 * to the same page afterwards.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: viewer, error, isPending, refetch, isRefetching } = useViewerQuery();

  const action = error ? resolveApiError(error) : null;
  const sessionEnded = action?.kind === 'login';

  useEffect(() => {
    if (sessionEnded) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [sessionEnded, router, pathname]);

  if (viewer) return <ViewerProvider viewer={viewer}>{children}</ViewerProvider>;

  if (isPending || sessionEnded) {
    return (
      <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">We could not load your account</h1>
      <p className="text-muted-foreground">{action?.message}</p>
      {action?.requestId ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {action.requestId}</p>
      ) : null}
      <div>
        <Button onClick={() => void refetch()} disabled={isRefetching}>
          Try again
        </Button>
      </div>
    </main>
  );
}
