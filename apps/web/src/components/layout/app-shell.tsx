'use client';

import { Bell, ChevronsUpDown, LogOut, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { groupedNavigation, visibleNavigation, type NavItem } from '@/config/navigation';
import { useSignOut, useViewer } from '@/features/auth/viewer';
import { cn } from '@/lib/utils';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base =
    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors';

  if (!item.ready) {
    return (
      <span aria-disabled className={cn(base, 'cursor-default text-sidebar-muted/70')}>
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sidebar-muted uppercase">
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
        'relative outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-sidebar-accent text-sidebar-active-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-active-foreground',
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      <Icon className={cn('size-4 shrink-0', active ? 'text-primary' : '')} aria-hidden />
      {item.label}
    </Link>
  );
}

function SidebarContent({ pathname }: { pathname: string }) {
  const viewer = useViewer();
  const sections = groupedNavigation(viewer.permissions);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm"
        >
          {viewer.organisation.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-sidebar-active-foreground">
            {viewer.organisation.name}
          </p>
          <p className="truncate text-xs text-sidebar-muted">{viewer.organisation.slug}</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map(({ group, items }) => (
          <div key={group} className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
              {group}
            </p>
            {items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border px-5 py-3 text-xs text-sidebar-muted">
        Branch access: {viewer.branches.map((b) => b.code).join(', ') || 'none'}
      </div>
    </div>
  );
}

function UserMenu() {
  const viewer = useViewer();
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg p-1.5 pr-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-primary">
              {initials(viewer.user.fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block truncate text-sm font-medium">{viewer.user.fullName}</span>
            <span className="block truncate text-xs text-muted-foreground">{viewer.role.name}</span>
          </span>
          <ChevronsUpDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate">{viewer.user.fullName}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{viewer.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          onSelect={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const pathname = usePathname();
  // The mobile menu is open for one path only, so navigating closes it without an effect.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === pathname;
  const current = visibleNavigation(viewer.permissions).find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <Sheet open={menuOpen} onOpenChange={(open) => setMenuPath(open ? pathname : null)}>
        <SheetContent side="left" className="p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <SidebarContent pathname={pathname} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setMenuPath(pathname)}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <div className="min-w-0">
            <p className="hidden text-xs text-muted-foreground sm:block">
              {viewer.organisation.name}
            </p>
            <p className="truncate text-sm font-semibold">{current?.label ?? 'Dashboard'}</p>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative mr-2 hidden lg:block">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                aria-label="Search"
                placeholder="Search…"
                disabled
                className="h-9 w-64 rounded-md border bg-card pr-3 pl-9 text-sm shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-70"
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="Notifications" disabled>
              <Bell className="size-4" aria-hidden />
            </Button>
            <ThemeToggle />
            <span aria-hidden className="mx-1 h-6 w-px bg-border" />
            <UserMenu />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
