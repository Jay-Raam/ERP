import { hasPermission } from '@erp/shared';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  LayoutDashboard,
  Landmark,
  Package,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
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
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, ready: true },
  {
    label: 'Branches',
    href: '/branches',
    icon: Building2,
    anyOf: ['branch.branch.view'],
    ready: false,
  },
  {
    label: 'Employees',
    href: '/employees',
    icon: Users,
    anyOf: ['employee.employee.view'],
    ready: false,
  },
  { label: 'Roles', href: '/roles', icon: ShieldCheck, anyOf: ['rbac.role.view'], ready: false },
  {
    label: 'Accounts',
    href: '/accounts',
    icon: Landmark,
    anyOf: ['accounts.ledger.view'],
    ready: false,
  },
  {
    label: 'Attendance',
    href: '/attendance',
    icon: CalendarCheck,
    anyOf: ['attendance.record.view', 'attendance.record.view-own'],
    ready: false,
  },
  {
    label: 'Payroll',
    href: '/payroll',
    icon: Wallet,
    anyOf: ['payroll.run.view', 'payroll.payslip.view-own'],
    ready: false,
  },
  { label: 'Sales', href: '/sale', icon: ShoppingCart, anyOf: ['sale.invoice.view'], ready: false },
  { label: 'Store', href: '/store', icon: Package, anyOf: ['store.item.view'], ready: false },
  {
    label: 'Purchase',
    href: '/purchase',
    icon: Truck,
    anyOf: ['purchase.order.view', 'purchase.bill.view'],
    ready: false,
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: BarChart3,
    anyOf: ['report.operational.view', 'report.sales.view', 'report.financial.view'],
    ready: false,
  },
];

export function visibleNavigation(permissions: readonly string[]): NavItem[] {
  return NAVIGATION.filter(
    (item) => !item.anyOf || item.anyOf.some((key) => hasPermission(permissions, key)),
  );
}
