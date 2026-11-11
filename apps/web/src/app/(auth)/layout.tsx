import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
          >
            E
          </span>
          <span className="text-lg font-semibold tracking-tight">ERP</span>
        </div>
        <div className="rounded-lg border bg-card p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </main>
  );
}
