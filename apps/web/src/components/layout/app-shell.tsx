'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { visibleNavigation, type NavItem } from '@/config/navigation';
import { useSignOut, useViewer } from '@/features/auth/viewer';
import { cn } from '@/lib/utils';

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base = 'flex items-center gap-3 rounded-md px-3 py-2 text-sm';

  if (!item.ready) {
    return (
      <span aria-disabled className={cn(base, 'cursor-default text-muted-foreground/70')}>
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
          Soon
        </span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        base,
        'font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
        active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const signOut = useSignOut();
  const pathname = usePathname();
  // The mobile menu is open for one path only, so navigating closes it without an effect.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const [signingOut, setSigningOut] = useState(false);
  const items = visibleNavigation(viewer.permissions);

  const nav = (
    <nav aria-label="Main" className="space-y-1">
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
        />
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            E
          </span>
          <span className="truncate text-sm font-semibold">{viewer.organisation.name}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{nav}</div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuPath(menuOpen ? null : pathname)}
          >
            {menuOpen ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Menu className="size-4" aria-hidden />
            )}
          </Button>
          <span className="truncate text-sm font-semibold md:hidden">
            {viewer.organisation.name}
          </span>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm leading-tight font-medium">{viewer.user.fullName}</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">
                {viewer.role.name}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut();
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </div>
        </header>

        {menuOpen ? (
          <div id="mobile-nav" className="border-b bg-card p-3 md:hidden">
            {nav}
          </div>
        ) : null}

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
