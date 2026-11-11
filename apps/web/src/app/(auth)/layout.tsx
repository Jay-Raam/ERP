import { BadgeCheck, Building2, ShieldCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

const POINTS = [
  { icon: Building2, text: 'Every branch, one organisation, strictly separated from others' },
  { icon: ShieldCheck, text: 'Role-based access enforced on the server for every action' },
  { icon: Wallet, text: 'Sales, purchase, accounts and payroll in one place' },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full bg-primary/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
            E
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">ERP</span>
        </div>
        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-4xl leading-tight font-semibold tracking-tight text-balance text-white">
              Run every branch from one calm workspace.
            </h2>
            <p className="text-sidebar-muted">
              Staff, stock, sales, purchases, accounts and payroll for growing businesses.
            </p>
          </div>
          <ul className="space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-sidebar-accent text-primary">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-sidebar-muted">
          <BadgeCheck className="size-4" aria-hidden /> Multi-tenant by design
        </p>
      </aside>

      <main className="grid place-items-center bg-background px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              E
            </span>
            <span className="text-lg font-semibold tracking-tight">ERP</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
