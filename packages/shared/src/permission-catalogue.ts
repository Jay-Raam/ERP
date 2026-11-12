import { MODULES, type ModuleKey } from './permissions';

export interface PermissionDef {
  key: string;
  module: ModuleKey;
  label: string;
}

/**
 * Every permission the product knows today, for the role editor.
 * A role may also hold a wildcard such as `sale.*.*`, which covers permissions
 * added by later modules without editing every role.
 */
export const PERMISSION_CATALOGUE: readonly PermissionDef[] = [
  { key: 'rbac.role.view', module: 'rbac', label: 'View roles' },
  { key: 'rbac.role.create', module: 'rbac', label: 'Create roles' },
  { key: 'rbac.role.update', module: 'rbac', label: 'Edit roles' },
  { key: 'rbac.role.delete', module: 'rbac', label: 'Delete roles' },
  { key: 'rbac.user.view', module: 'rbac', label: 'View users' },
  { key: 'rbac.user.create', module: 'rbac', label: 'Create users' },
  { key: 'rbac.user.update', module: 'rbac', label: 'Edit users and reset passwords' },
  { key: 'branch.branch.view', module: 'branch', label: 'View branches' },
  { key: 'branch.branch.create', module: 'branch', label: 'Create branches' },
  { key: 'branch.branch.update', module: 'branch', label: 'Edit branches' },
  { key: 'org.settings.view', module: 'org', label: 'View organisation settings' },
  { key: 'org.settings.update', module: 'org', label: 'Edit organisation settings' },
  { key: 'employee.employee.view', module: 'employee', label: 'View employees' },
  { key: 'employee.employee.create', module: 'employee', label: 'Add employees' },
  { key: 'employee.employee.update', module: 'employee', label: 'Edit employees' },
  { key: 'attendance.record.view', module: 'attendance', label: 'View attendance records' },
  { key: 'attendance.record.manage', module: 'attendance', label: 'Correct attendance' },
  { key: 'attendance.shift.view', module: 'attendance', label: 'View shifts' },
  { key: 'attendance.shift.manage', module: 'attendance', label: 'Manage shifts' },
  {
    key: 'attendance.holiday.manage',
    module: 'attendance',
    label: 'Manage holidays and weekly offs',
  },
  { key: 'attendance.leave.view', module: 'attendance', label: 'View leave requests' },
  { key: 'attendance.leave.approve', module: 'attendance', label: 'Approve or reject leave' },
  { key: 'attendance.leave-type.manage', module: 'attendance', label: 'Manage leave types' },
  { key: 'store.item.view', module: 'store', label: 'View items' },
  { key: 'store.item.create', module: 'store', label: 'Add items' },
  { key: 'store.item.update', module: 'store', label: 'Edit items' },
  { key: 'store.warehouse.view', module: 'store', label: 'View warehouses' },
  { key: 'store.warehouse.manage', module: 'store', label: 'Manage warehouses' },
  { key: 'store.stock.view', module: 'store', label: 'View stock and movements' },
  { key: 'store.stock.receive', module: 'store', label: 'Receive stock' },
  { key: 'store.stock.issue', module: 'store', label: 'Issue stock' },
  { key: 'store.stock.adjust', module: 'store', label: 'Adjust stock' },
  { key: 'store.stock.transfer', module: 'store', label: 'Transfer stock between warehouses' },
  { key: 'employee.profile.view-own', module: 'employee', label: 'View own profile' },
  { key: 'employee.profile.update-own', module: 'employee', label: 'Edit own profile' },
  { key: 'attendance.punch.create-own', module: 'attendance', label: 'Punch in and out' },
  { key: 'attendance.record.view-own', module: 'attendance', label: 'View own attendance' },
  { key: 'attendance.leave.request-own', module: 'attendance', label: 'Request leave' },
  { key: 'payroll.payslip.view-own', module: 'payroll', label: 'View own payslips' },
];

export const PERMISSION_MODULES: readonly ModuleKey[] = MODULES;
