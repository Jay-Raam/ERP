'use client';

import { ArrowRight, Building2, ShieldCheck, UserCog } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { groupedNavigation } from '@/config/navigation';
import { useBranches, useRoles, useUsers } from '@/features/admin/api';
import { hasPermission } from '@erp/shared';
import { useViewer } from './viewer';

const SCOPE_LABEL = {
  own: 'Your own records',
  branch: 'Your branches',
  organisation: 'The whole organisation',
} as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | undefined;
  hint: string;
  icon: typeof Building2;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="gap-3 py-5 transition-shadow group-hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardDescription className="font-medium">{label}</CardDescription>
          <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        </CardHeader>
        <CardContent className="space-y-1">
          {value === undefined ? (
            <Skeleton className="h-9 w-16" />
          ) : (
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          )}
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function DashboardOverview() {
  const viewer = useViewer();
  const firstName = viewer.user.fullName.split(' ')[0];
  const canUsers = hasPermission(viewer.permissions, 'rbac.user.view');
  const canRoles = hasPermission(viewer.permissions, 'rbac.role.view');
  const canBranches = hasPermission(viewer.permissions, 'branch.branch.view');
  const users = useUsers({ search: '', status: '', page: 0 }, canUsers);
  const roles = useRoles(canRoles);
  const branches = useBranches(canBranches);
  const sections = groupedNavigation(viewer.permissions).filter((s) => s.group !== 'Overview');

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-brand p-6 text-brand-foreground sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary/30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-sm text-brand-muted">{greeting()}</p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance text-white">
              {firstName}, welcome back
            </h1>
            <p className="text-sm text-brand-muted">
              {viewer.organisation.name} · {viewer.user.email}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge className="border-brand-border bg-brand-accent text-white" variant="outline">
              {viewer.role.name}
            </Badge>
            <Badge className="border-brand-border bg-brand-accent text-white" variant="outline">
              {SCOPE_LABEL[viewer.role.dataScope]}
            </Badge>
          </div>
        </div>
      </section>

      {canUsers || canRoles || canBranches ? (
        <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {canBranches ? (
            <Stat
              label="Branches"
              value={branches.data?.length}
              hint="Locations in this organisation"
              icon={Building2}
              href="/branches"
            />
          ) : null}
          {canUsers ? (
            <Stat
              label="Users"
              value={users.data?.total}
              hint="People who can sign in"
              icon={UserCog}
              href="/users"
            />
          ) : null}
          {canRoles ? (
            <Stat
              label="Roles"
              value={roles.data?.length}
              hint="Permission sets you can assign"
              icon={ShieldCheck}
              href="/roles"
            />
          ) : null}
        </section>
      ) : null}

      {sections.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Your role does not include any modules yet. Ask an administrator to update it.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {sections.map(({ group, items }) => (
            <Card key={group} className="gap-4">
              <CardHeader>
                <CardTitle>{group}</CardTitle>
                <CardDescription>Modules available to your role</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {items.map(({ label, href, icon: Icon, ready }) => (
                    <li key={label}>
                      {ready ? (
                        <Link
                          href={href}
                          className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-accent"
                        >
                          <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="font-medium">{label}</span>
                          <ArrowRight
                            className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                            aria-hidden
                          />
                        </Link>
                      ) : (
                        <div className="flex items-center gap-3 py-2.5 text-muted-foreground">
                          <span className="grid size-8 place-items-center rounded-md bg-muted">
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="font-medium">{label}</span>
                          <Badge variant="secondary" className="ml-auto">
                            Coming soon
                          </Badge>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
