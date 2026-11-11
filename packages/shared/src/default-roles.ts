import { WILDCARD } from './permissions';

export type DataScope = 'own' | 'branch' | 'organisation';

export interface RoleSeed {
  key: string;
  name: string;
  dataScope: DataScope;
  permissions: readonly string[];
}

/**
 * Actions ending in `-own` only ever apply to the caller's own record,
 * whatever the role's data scope is. Everyone who can sign in gets these.
 */
const SELF_SERVICE = [
  'employee.profile.view-own',
  'employee.profile.update-own',
  'attendance.punch.create-own',
  'attendance.record.view-own',
  'attendance.leave.request-own',
  'payroll.payslip.view-own',
] as const;

/**
 * Roles created for every new organisation. These rows are a starting point:
 * each organisation can edit everything except the owner role.
 */
export const DEFAULT_ROLES: readonly RoleSeed[] = [
  { key: 'owner', name: 'Owner', dataScope: 'organisation', permissions: [WILDCARD] },
  {
    key: 'super_admin',
    name: 'Super Admin',
    dataScope: 'organisation',
    permissions: [
      ...SELF_SERVICE,
      'org.*.*',
      'branch.*.*',
      'employee.*.*',
      'rbac.*.*',
      'attendance.*.*',
      'store.*.*',
      'purchase.order.*',
      'accounts.*.view',
      'sale.*.view',
      'report.operational.view',
    ],
  },
  { key: 'employee', name: 'Employee', dataScope: 'own', permissions: [...SELF_SERVICE] },
  {
    key: 'sale_team',
    name: 'Sale team',
    dataScope: 'branch',
    permissions: [
      ...SELF_SERVICE,
      'sale.*.*',
      'accounts.*.view',
      'store.*.view',
      'report.sales.view',
    ],
  },
  {
    key: 'account_team',
    name: 'Account team',
    dataScope: 'organisation',
    permissions: [
      ...SELF_SERVICE,
      'accounts.*.*',
      'payroll.run.view',
      'payroll.run.prepare',
      'purchase.bill.*',
      'purchase.payment.*',
      'sale.*.view',
      'store.*.view',
      'report.financial.view',
    ],
  },
];

export const OWNER_ROLE_KEY = 'owner';
