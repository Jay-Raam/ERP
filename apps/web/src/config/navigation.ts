import { hasPermission } from '@erp/shared';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  LayoutDashboard,
  Landmark,
  Package,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NavGroup = 'Overview' | 'Organisation' | 'Operations' | 'Finance';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Shown when the user holds any one of these. Omit for items everyone sees. */
  anyOf?: readonly string[];
  /** False until the module's screens exist. */
  ready: boolean;
}

/**
 * The whole menu, as data. What a user sees is this list filtered by their
 * permissions; there are no role checks anywhere in the UI.
 */
export const NAVIGATION: readonly NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, group: 'Overview', ready: true },
  {
    label: 'Branches',
    href: '/branches',
    icon: Building2,
    group: 'Organisation',
    anyOf: ['branch.branch.view'],
    ready: true,
  },
  {
    label: 'Employees',
    href: '/employees',
    icon: Users,
    group: 'Organisation',
    anyOf: ['employee.employee.view'],
    ready: true,
  },
  {
    label: 'Users',
    href: '/users',
    icon: UserCog,
    group: 'Organisation',
    anyOf: ['rbac.user.view'],
    ready: true,
  },
  {
    label: 'Roles',
    href: '/roles',
    icon: ShieldCheck,
    group: 'Organisation',
    anyOf: ['rbac.role.view'],
    ready: true,
  },
  {
    label: 'Attendance',
    href: '/attendance',
    icon: CalendarCheck,
    group: 'Operations',
    anyOf: ['attendance.record.view', 'attendance.record.view-own'],
    ready: true,
  },
  {
    label: 'Leave',
    href: '/leave',
    icon: CalendarDays,
    group: 'Operations',
    anyOf: [
      'attendance.leave.request-own',
      'attendance.leave.view',
      'attendance.leave-type.manage',
    ],
    ready: true,
  },
  {
    label: 'Sales',
    href: '/sale',
    icon: ShoppingCart,
    group: 'Operations',
    anyOf: ['sale.invoice.view'],
    ready: false,
  },
  {
    label: 'Store',
    href: '/store',
    icon: Package,
    group: 'Operations',
    anyOf: ['store.item.view'],
    ready: true,
  },
  {
    label: 'Purchase',
    href: '/purchase',
    icon: Truck,
    group: 'Operations',
    anyOf: ['purchase.order.view', 'purchase.bill.view'],
    ready: false,
  },
  {
    label: 'Accounts',
    href: '/accounts',
    icon: Landmark,
    group: 'Finance',
    anyOf: ['accounts.ledger.view'],
    ready: false,
  },
  {
    label: 'Payroll',
    href: '/payroll',
    icon: Wallet,
    group: 'Finance',
    anyOf: ['payroll.run.view', 'payroll.payslip.view-own'],
    ready: false,
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    group: 'Finance',
    anyOf: ['report.operational.view', 'report.sales.view', 'report.financial.view'],
    ready: false,
  },
];

/** Menu sections in display order, each with the items the user may see. */
export function groupedNavigation(
  permissions: readonly string[],
): { group: NavGroup; items: NavItem[] }[] {
  const visible = visibleNavigation(permissions);
  const groups: NavGroup[] = ['Overview', 'Organisation', 'Operations', 'Finance'];
  return groups
    .map((group) => ({ group, items: visible.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}

export function visibleNavigation(permissions: readonly string[]): NavItem[] {
  return NAVIGATION.filter(
    (item) => !item.anyOf || item.anyOf.some((key) => hasPermission(permissions, key)),
  );
}
