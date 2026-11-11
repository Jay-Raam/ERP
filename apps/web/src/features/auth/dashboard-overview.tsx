'use client';

import { visibleNavigation } from '@/config/navigation';
import { useViewer } from './viewer';

const SCOPE_LABEL = {
  own: 'Your own records',
  branch: 'Your branches',
  organisation: 'The whole organisation',
} as const;

export function DashboardOverview() {
  const viewer = useViewer();
  const areas = visibleNavigation(viewer.permissions).filter((item) => item.href !== '/dashboard');
  const firstName = viewer.user.fullName.split(' ')[0];

  const facts = [
    { label: 'Organisation', value: viewer.organisation.name, detail: viewer.organisation.slug },
    { label: 'Role', value: viewer.role.name, detail: SCOPE_LABEL[viewer.role.dataScope] },
    {
      label: viewer.branches.length === 1 ? 'Branch' : 'Branches',
      value: viewer.branches.map((b) => b.name).join(', ') || 'None assigned',
      detail: viewer.branches.map((b) => b.code).join(', '),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Welcome, {firstName}</h1>
        <p className="text-muted-foreground">Signed in as {viewer.user.email}</p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="rounded-lg border bg-card p-4">
            <dt className="text-sm text-muted-foreground">{fact.label}</dt>
            <dd className="mt-1 truncate font-medium">{fact.value}</dd>
            {fact.detail ? (
              <dd className="truncate text-sm text-muted-foreground">{fact.detail}</dd>
            ) : null}
          </div>
        ))}
      </dl>

      <section aria-labelledby="areas-heading" className="space-y-3">
        <h2 id="areas-heading" className="text-sm font-medium">
          Areas you can access
        </h2>
        {areas.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Your role does not include any modules yet. Ask an administrator to update it.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {areas.map(({ label, icon: Icon, ready }) => (
              <li key={label} className="flex items-center gap-3 rounded-lg border bg-card p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="font-medium">{label}</span>
                {ready ? null : (
                  <span className="ml-auto text-xs text-muted-foreground">Coming soon</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
